/**
 * @file confidential-state-store.ts
 * @description 클라이언트 사이드 State Machine: FHE Confidential State 관리
 * 
 * 아키텍처 위치:
 * - 계층: Presentation Layer (Client-Side State Management)
 * - 라이브러리: Zustand + Zundo + Persist + IndexedDB
 * - 패턴: State Machine (OPTIMISTIC → SUBMITTING → CONFIRMED → FAILED)
 * 
 * 책임:
 * 1. Optimistic UI: Deterministic Prediction으로 즉시 UI 반영
 * 2. State Persistence: LocalStorage (메타데이터) + IndexedDB (암호문 Blob)
 * 3. Time Travel: Zundo로 Global Undo 지원
 * 4. Lazy Fetching: Memory → IndexedDB → Server 순차 조회
 * 5. Zombie Cleanup: 새로고침 후 만료된 상태 자동 정리
 * 
 * @module ConfidentialStateStore
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { get, set, del } from 'idb-keyval';
import type { UserPubSubMessage } from '@/types/pubsub';
import type {
  ClientStateItem,
  DependencyEntry,
  ConfidentialStateStoreSerialized,
  BlobEntry,
} from '@/types/local-storage';
import {
  LOCAL_STORAGE_KEYS,
  serializeConfidentialStateStore,
  deserializeConfidentialStateStore,
} from '@/types/local-storage';
import {
  deriveBinaryHandle,
  deriveUnaryHandle,
  deriveTernaryHandle,
  deriveInputHandle,
} from '@/lib/solana/handle';

// ============================================================================
// Configuration
// ============================================================================

/** Solana 프로그램 ID (환경변수 또는 기본값) */
const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || 'FkLGYGk2bypUXgpGmcsCTmKZo6LCjHaXswbhY1LNGAKj';

/** 좀비 아이템 청소 기준 시간 (밀리초) */
const TIMEOUT_MS = 60 * 1000; // 1분

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 서버에서 암호문 데이터 가져오기 (Lazy Fetch용)
 * 
 * IndexedDB에도 없을 때 서버 API를 호출하여 데이터를 가져옵니다.
 * 
 * @param handle - 64자 hex 문자열 (32 bytes)
 * @returns Base64 인코딩된 암호문 데이터, 없으면 null
 * 
 * @private
 */
const fetchCiphertextFromServer = async (handle: string): Promise<string | null> => {
  try {
    const res = await fetch(`/api/query/ciphertext/${handle}`);
    if (!res.ok) return null;
    const json = await res.json();
    // CiphertextRedisPayload 형식: { handle, data, metadata, status }
    return json.data || null;
  } catch {
    console.warn(`[Store] Failed to fetch ciphertext for ${handle.slice(0, 16)}...`);
    return null;
  }
};

/**
 * IndexedDB Blob Storage Helper
 * 
 * 암호문 데이터(Blob)를 IndexedDB에 저장/로드합니다.
 * LocalStorage는 메타데이터만 저장하고, 실제 데이터는 여기에 저장됩니다.
 * 
 * @private
 */
const blobStorage = {
  /**
   * 암호문 Blob 저장
   * 
   * @param handle - 핸들 (키로 사용)
   * @param data - Base64 인코딩된 암호문 데이터
   */
  save: async (handle: string, data: string) => {
    try {
      await set(handle, { data, updatedAt: Date.now() } as BlobEntry);
    } catch (e) {
      console.error('[IDB] Save failed', e);
    }
  },

  /**
   * 암호문 Blob 로드
   * 
   * @param handle - 핸들 (키로 사용)
   * @returns Base64 인코딩된 암호문 데이터, 없으면 null
   */
  load: async (handle: string) => {
    try {
      return (await get<BlobEntry>(handle))?.data || null;
    } catch {
      return null;
    }
  },

  /**
   * 암호문 Blob 삭제
   * 
   * @param handle - 핸들 (키로 사용)
   */
  remove: async (handle: string) => {
    try {
      await del(handle);
    } catch (e) {
      console.error('[IDB] Remove failed', e);
    }
  },
};

// ============================================================================
// Store Interface
// ============================================================================

/**
 * Confidential State Store Interface
 * 
 * State Machine 전이:
 * - Void → OPTIMISTIC (Deterministic Prediction)
 * - OPTIMISTIC → SUBMITTING (트랜잭션 전송)
 * - SUBMITTING → CONFIRMED (SSE 이벤트 수신)
 * - SUBMITTING → FAILED (타임아웃 또는 에러)
 */
interface ConfidentialStateStore {
  // ----------------------------------------------------
  // State (In-Memory)
  // ----------------------------------------------------
  /** 핸들별 상태 아이템 (Map<handle, ClientStateItem>) */
  items: Map<string, ClientStateItem>;
  
  /** 의존성 그래프 (Map<resultHandle, DependencyEntry>) */
  dependencies: Map<string, DependencyEntry>;
  
  /** 마지막 수신 이벤트 ID (Gap Filling용) */
  lastEventId?: string;

  // ----------------------------------------------------
  // Actions: State Machine Transitions
  // ----------------------------------------------------
  /**
   * 입력 핸들 등록 (Void → OPTIMISTIC)
   * 
   * Client-side encryption 후 호출됩니다.
   * deriveInputHandle로 핸들을 계산하고 OPTIMISTIC 상태를 생성합니다.
   * 
   * @param encryptedData - 암호화된 데이터 배열 (number[])
   * @param owner - 지갑 주소 (Solana PublicKey, Base58)
   * @param txSignature - 트랜잭션 서명 (optional, 나중에 업데이트)
   * @param clientTag - 클라이언트 태그 (optional)
   * @returns 생성된 핸들 (64자 hex 문자열)
   */
  registerInputHandle: (
    encryptedData: number[],
    owner: string,
    txSignature?: string,
    clientTag?: string
  ) => string;

  /**
   * 연산 요청 (Void → OPTIMISTIC)
   * 
   * Deterministic Prediction으로 결과 핸들을 미리 계산하고
   * OPTIMISTIC 상태를 생성합니다.
   * 
   * @param op - 연산 타입 ('UNARY_{opEnum}' | 'BINARY_{opEnum}' | 'TERNARY_{opEnum}')
   * @param inputs - 입력 핸들 배열 (string[])
   * @param owner - 지갑 주소
   * @param txSignature - 트랜잭션 서명 (optional)
   * @param clientTag - 클라이언트 태그 (optional)
   * @returns 예측된 결과 핸들
   */
  requestOperation: (
    op: string,
    inputs: string[],
    owner: string,
    txSignature?: string,
    clientTag?: string
  ) => Promise<string>;

  /**
   * 트랜잭션 전송 시작 (OPTIMISTIC → SUBMITTING)
   * 
   * @param handle - 핸들
   */
  submitTransaction: (handle: string) => void;

  /**
   * 트랜잭션 확정 (SUBMITTING → CONFIRMED)
   * 
   * SSE 이벤트 수신 시 호출됩니다.
   * 데이터가 제공되면 IndexedDB에 저장합니다.
   * 
   * @param handle - 핸들
   * @param data - 암호문 데이터 (Base64, optional)
   */
  confirmTransaction: (handle: string, data?: string) => Promise<void>;

  /**
   * 트랜잭션 실패 (SUBMITTING → FAILED)
   * 
   * 타임아웃 또는 에러 발생 시 호출됩니다.
   * 
   * @param handle - 핸들
   */
  failTransaction: (handle: string) => void;

  /**
   * 롤백 (Emergency Exit)
   * 
   * 개별 아이템을 삭제합니다.
   * Zundo의 temporal.undo()는 Global Undo용으로 별도 사용합니다.
   * 
   * @param handle - 핸들
   */
  rollback: (handle: string) => void;

  // ----------------------------------------------------
  // Query & Utilities
  // ----------------------------------------------------
  /**
   * 아이템 조회 (메타데이터만)
   * 
   * @param handle - 핸들
   * @returns ClientStateItem 또는 undefined
   */
  getItem: (handle: string) => ClientStateItem | undefined;

  /**
   * Owner별 아이템 조회
   * 
   * @param owner - 지갑 주소
   * @returns 해당 owner의 모든 아이템 배열
   */
  getItemsByOwner: (owner: string) => ClientStateItem[];

  /**
   * 아이템 조회 (데이터 포함, Lazy Fetching)
   * 
   * 조회 순서:
   * 1. Memory Hit (즉시 반환)
   * 2. IndexedDB Hit (로드 후 메모리 캐싱)
   * 3. Server Hit (CONFIRMED 상태인 경우, 로드 후 로컬 캐싱)
   * 
   * @param handle - 핸들
   * @returns ClientStateItem (데이터 포함) 또는 undefined
   */
  getItemWithData: (handle: string) => Promise<ClientStateItem | undefined>;

  // ----------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------
  /**
   * SSE 이벤트 처리
   * 
   * Pub/Sub 이벤트를 받아 상태를 업데이트합니다.
   * 
   * @param message - UserPubSubMessage
   */
  handleEvent: (message: UserPubSubMessage) => Promise<void>;

  /**
   * 좀비 아이템 청소 (Hydration Logic)
   * 
   * 새로고침 후 만료된 OPTIMISTIC 항목을 FAILED로 처리합니다.
   * merge() 함수에서 자동 호출됩니다.
   */
  cleanupStaleItems: () => void;

  /**
   * 전체 초기화
   * 
   * 모든 상태를 초기화합니다.
   */
  clear: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

/**
 * Confidential State Store
 * 
 * Layer 1: Zundo (Global Time Travel)
 * Layer 2: Persist (LocalStorage - Metadata Only)
 * Layer 3: Immer (Immutable Logic)
 */
export const useConfidentialStateStore = create<ConfidentialStateStore>()(
  temporal( // Layer 1: Time Travel (Global Undo용)
    persist( // Layer 2: Persistence (LocalStorage)
      immer((set, get) => ({
        // Initial State
        items: new Map(),
        dependencies: new Map(),
        lastEventId: undefined,

        // ==================================================================
        // Transition 1: Void -> OPTIMISTIC
        // ==================================================================

        registerInputHandle: (encryptedData, owner, txSignature, clientTag) => {
          // 1. Deterministic Input Handle Derivation
          const handle = deriveInputHandle(encryptedData);

          // 2. State Entry: OPTIMISTIC (UI 즉시 반영)
          set((state) => {
            state.items.set(handle, {
              handle,
              owner,
              txSignature,
              clientTag,
              status: 'OPTIMISTIC',
              createdAt: Date.now(),
              data: null, // 런타임 메모리에는 null, IndexedDB에서 lazy load
              isCached: false,
            });
          });
          // Note: setTimeout 제거 -> cleanupStaleItems가 담당
          return handle;
        },

        requestOperation: async (op, inputs, owner, txSignature, clientTag) => {
          // 1. Deterministic Prediction (The "Oracle")
          let predictedHandle: string;

          if (op.startsWith('UNARY_')) {
            const opEnum = parseInt(op.replace('UNARY_', ''), 10);
            predictedHandle = deriveUnaryHandle(opEnum, inputs[0], PROGRAM_ID);
          } else if (op.startsWith('BINARY_')) {
            const opEnum = parseInt(op.replace('BINARY_', ''), 10);
            predictedHandle = deriveBinaryHandle(opEnum, inputs[0], inputs[1], PROGRAM_ID);
          } else if (op.startsWith('TERNARY_')) {
            const opEnum = parseInt(op.replace('TERNARY_', ''), 10);
            predictedHandle = deriveTernaryHandle(opEnum, inputs[0], inputs[1], inputs[2], PROGRAM_ID);
          } else {
            throw new Error(`Unknown operation type: ${op}`);
          }

          // 2. State Entry: OPTIMISTIC (UI 즉시 반영)
          set((state) => {
            state.items.set(predictedHandle, {
              handle: predictedHandle,
              owner,
              txSignature,
              clientTag,
              status: 'OPTIMISTIC',
              predictedHandle,
              createdAt: Date.now(),
              data: null, // 런타임 메모리에는 null, IndexedDB에서 lazy load
              isCached: false,
            });
            state.dependencies.set(predictedHandle, { op, inputs });
          });

          return predictedHandle;
        },

        // ==================================================================
        // Transition 2: OPTIMISTIC -> SUBMITTING
        // ==================================================================

        submitTransaction: (handle) => {
          set((state) => {
            const item = state.items.get(handle);
            if (item?.status === 'OPTIMISTIC') {
              item.status = 'SUBMITTING';
            }
          });
        },

        // ==================================================================
        // Transition 3: SUBMITTING -> CONFIRMED
        // ==================================================================

        confirmTransaction: async (handle, data) => {
          set((state) => {
            const item = state.items.get(handle);
            if (!item) return;

            item.status = 'CONFIRMED';
            item.confirmedAt = Date.now();

            // 데이터가 제공되면 IndexedDB에 저장
            if (data) {
              item.data = data;
              item.isCached = true;
              blobStorage.save(handle, data); // Fire & Forget
            }
          });
        },

        // ==================================================================
        // Transition 4: Failure & Cleanup
        // ==================================================================

        failTransaction: (handle) => {
          set((state) => {
            const item = state.items.get(handle);
            if (item) {
              item.status = 'FAILED';
            }
          });
        },

        rollback: (handle) => {
          set((state) => {
            state.items.delete(handle);
            state.dependencies.delete(handle);
            blobStorage.remove(handle); // Fire & Forget
          });
        },

        // ==================================================================
        // Advanced Query: True Lazy Fetching
        // ==================================================================

        getItemWithData: async (handle) => {
          const item = get().items.get(handle);
          if (!item) return undefined;

          // 1. Memory Hit
          if (item.data) return item;

          // 2. IndexedDB Hit
          const localData = await blobStorage.load(handle);
          if (localData) {
            set((state) => {
              const i = state.items.get(handle);
              if (i) {
                i.data = localData;
                i.isCached = true;
              }
            });
            return get().items.get(handle);
          }

          // 3. Server Hit (Fallback)
          if (item.status === 'CONFIRMED') {
            const serverData = await fetchCiphertextFromServer(handle);
            if (serverData) {
              await blobStorage.save(handle, serverData); // 캐싱
              set((state) => {
                const i = state.items.get(handle);
                if (i) {
                  i.data = serverData;
                  i.isCached = true;
                }
              });
              return get().items.get(handle);
            }
          }

          return item; // 데이터 없음
        },

        // ==================================================================
        // Zombie Cleanup (Hydration Logic)
        // ==================================================================

        cleanupStaleItems: () => {
          const now = Date.now();
          set((state) => {
            state.items.forEach((item) => {
              if (item.status === 'OPTIMISTIC' && now - item.createdAt > TIMEOUT_MS) {
                console.warn(`[Store] Cleaning up stale item: ${item.handle.slice(0, 16)}...`);
                item.status = 'FAILED';
              }
            });
          });
        },

        // ==================================================================
        // Getters
        // ==================================================================

        getItem: (handle) => get().items.get(handle),
        getItemsByOwner: (owner) =>
          Array.from(get().items.values()).filter((i) => i.owner === owner),

        // ==================================================================
        // SSE Event Handler
        // ==================================================================

        handleEvent: async (message) => {
          const { eventType, payload, eventId } = message;

          // lastEventId 업데이트
          set((state) => {
            state.lastEventId = eventId;
          });

          switch (eventType) {
            case 'user.ciphertext.registered':
            case 'user.ciphertext.confirmed': {
              if (
                payload.type === 'user.ciphertext.registered' ||
                payload.type === 'user.ciphertext.confirmed'
              ) {
                const handle = payload.handle;
                const item = get().items.get(handle);

                if (item) {
                  // OPTIMISTIC 또는 SUBMITTING 상태였으면 확정
                  if (item.status === 'OPTIMISTIC' || item.status === 'SUBMITTING') {
                    await get().confirmTransaction(handle);
                  }
                } else {
                  // 새 아이템 추가 (확정 상태로)
                  const newItem: ClientStateItem = {
                    handle: payload.handle,
                    owner: payload.owner,
                    data: null,
                    status: 'CONFIRMED',
                    txSignature: payload.signature,
                    clientTag: payload.clientTag,
                    createdAt: payload.blockTime || Date.now(),
                    confirmedAt: payload.blockTime || Date.now(),
                    isCached: false,
                  };

                  set((state) => {
                    state.items.set(handle, newItem);
                  });
                }
              }
              break;
            }

            case 'user.operation.completed': {
              if (payload.type === 'user.operation.completed') {
                const resultHandle = payload.resultHandle;
                const inputHandles = payload.inputHandles;

                // 의존성 그래프 추가
                set((state) => {
                  state.dependencies.set(resultHandle, {
                    op: payload.operation || 'UNKNOWN',
                    inputs: inputHandles,
                  });
                });

                // 결과 핸들을 확정
                const existingItem = get().items.get(resultHandle);
                if (existingItem) {
                  if (existingItem.status === 'OPTIMISTIC' || existingItem.status === 'SUBMITTING') {
                    await get().confirmTransaction(resultHandle);
                  }
                } else {
                  // 새 아이템 추가
                  const newItem: ClientStateItem = {
                    handle: resultHandle,
                    owner: payload.owner,
                    data: null,
                    status: 'CONFIRMED',
                    txSignature: payload.signature,
                    createdAt: payload.blockTime || Date.now(),
                    confirmedAt: payload.blockTime || Date.now(),
                    isCached: false,
                  };

                  set((state) => {
                    state.items.set(resultHandle, newItem);
                  });
                }
              }
              break;
            }

            case 'user.operation.failed': {
              if (payload.type === 'user.operation.failed') {
                if (payload.signature) {
                  // signature로 optimistic 아이템 찾기
                  const items = Array.from(get().items.values());
                  const failedItem = items.find(
                    (item) =>
                      item.txSignature === payload.signature &&
                      (item.status === 'OPTIMISTIC' || item.status === 'SUBMITTING')
                  );

                  if (failedItem) {
                    get().failTransaction(failedItem.handle);
                  }
                }
              }
              break;
            }
          }
        },

        clear: () => {
          set((state) => {
            state.items.clear();
            state.dependencies.clear();
            state.lastEventId = undefined;
          });
        },
      })),
      {
        name: LOCAL_STORAGE_KEYS.CONFIDENTIAL_STATE,
        // [Storage Layer] 표준 JSON 스토리지 사용
        storage: createJSONStorage(() => localStorage),

        // [Filter] 메타데이터만 저장 (data 필드는 자동 제외됨)
        partialize: (state) => {
          return serializeConfidentialStateStore(
            state.items,
            state.dependencies,
            state.lastEventId
          );
        },

        // [Hydration] 복원 및 좀비 청소
        merge: (persistedState, currentState) => {
          const serialized = persistedState as unknown as ConfidentialStateStoreSerialized;
          const { items, dependencies, lastEventId } = deserializeConfidentialStateStore(serialized);

          // 비동기 틱으로 청소 로직 예약 (Merge 완료 후 실행됨)
          setTimeout(() => {
            useConfidentialStateStore.getState().cleanupStaleItems();
          }, 0);

          return {
            ...currentState,
            items,
            dependencies,
            lastEventId,
          };
        },
      }
    )
  )
);

// ============================================================================
// Exports
// ============================================================================

/** Zundo temporal API (Global Undo용) */
export const useTemporalStore = useConfidentialStateStore.temporal;
