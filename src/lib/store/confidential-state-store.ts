// src/lib/store/confidential-state-store.ts
// Confidential State Store (Map 구조, 의존성 그래프, Optimistic Update 지원)

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { UserPubSubMessage } from '@/types/pubsub';

/**
 * Confidential State Item 상태
 */
export type ConfidentialStateItemStatus = 'optimistic' | 'confirmed' | 'failed';

/**
 * Confidential State Item
 */
export interface ConfidentialStateItem {
  handle: string; // Ciphertext handle (hex)
  owner: string; // 지갑 주소
  data: string | null; // 암호문 데이터 (Base64, pending일 때는 null)
  status: ConfidentialStateItemStatus;
  txSignature?: string; // 트랜잭션 서명
  predictedHandle?: string; // 예측된 핸들 (로컬 계산 결과)
  timeoutId?: number; // 롤백 타이머 ID
  createdAt: number; // 생성 시간
  confirmedAt?: number; // 확정 시간
  clientTag?: string; // 클라이언트 태그
}

/**
 * Confidential State Store
 */
interface ConfidentialStateStore {
  // Map<handle, item>
  items: Map<string, ConfidentialStateItem>;
  
  // 의존성 그래프: Map<resultHandle, inputHandles[]>
  dependencyGraph: Map<string, string[]>;

  // Actions
  addOptimistic: (
    handle: string,
    owner: string,
    txSignature: string,
    predictedHandle?: string,
    clientTag?: string
  ) => void;
  
  confirm: (handle: string, data?: string) => void;
  
  fail: (handle: string) => void;
  
  rollback: (handle: string) => void;
  
  addDependency: (resultHandle: string, inputHandles: string[]) => void;
  
  getItem: (handle: string) => ConfidentialStateItem | undefined;
  
  getItemsByOwner: (owner: string) => ConfidentialStateItem[];
  
  clear: () => void;
  
  // SSE 이벤트 처리
  handleEvent: (message: UserPubSubMessage) => void;
}

/**
 * Confidential State Store 생성
 */
export const useConfidentialStateStore = create<ConfidentialStateStore>()(
  subscribeWithSelector((set, get) => ({
    items: new Map(),
    dependencyGraph: new Map(),

    /**
     * Optimistic Update: 트랜잭션 전송 시 예측 상태 추가
     */
    addOptimistic: (
      handle,
      owner,
      txSignature,
      predictedHandle,
      clientTag
    ) => {
      const item: ConfidentialStateItem = {
        handle,
        owner,
        data: null, // pending 상태
        status: 'optimistic',
        txSignature,
        predictedHandle,
        clientTag,
        createdAt: Date.now(),
      };

      // 30초 타임아웃 설정 (시간 내 이벤트 미수신 시 'failed' 처리)
      const timeoutId = window.setTimeout(() => {
        const currentItem = get().items.get(handle);
        if (currentItem && currentItem.status === 'optimistic') {
          get().fail(handle);
        }
      }, 30000);

      item.timeoutId = timeoutId;

      set((state) => {
        const newItems = new Map(state.items);
        newItems.set(handle, item);
        return { items: newItems };
      });
    },

    /**
     * 상태 확정: SSE로 Confirmed 이벤트 수신 시
     */
    confirm: (handle, data) => {
      set((state) => {
        const item = state.items.get(handle);
        if (!item) return state;

        // 타임아웃 해제
        if (item.timeoutId) {
          clearTimeout(item.timeoutId);
        }

        const updatedItem: ConfidentialStateItem = {
          ...item,
          status: 'confirmed',
          data: data ?? item.data,
          confirmedAt: Date.now(),
          timeoutId: undefined,
        };

        const newItems = new Map(state.items);
        newItems.set(handle, updatedItem);
        return { items: newItems };
      });
    },

    /**
     * 실패 처리: 타임아웃 또는 에러 발생 시
     */
    fail: (handle) => {
      set((state) => {
        const item = state.items.get(handle);
        if (!item) return state;

        // 타임아웃 해제
        if (item.timeoutId) {
          clearTimeout(item.timeoutId);
        }

        const updatedItem: ConfidentialStateItem = {
          ...item,
          status: 'failed',
          timeoutId: undefined,
        };

        const newItems = new Map(state.items);
        newItems.set(handle, updatedItem);
        return { items: newItems };
      });
    },

    /**
     * 롤백: Optimistic Update 취소
     */
    rollback: (handle) => {
      set((state) => {
        const item = state.items.get(handle);
        if (!item) return state;

        // 타임아웃 해제
        if (item.timeoutId) {
          clearTimeout(item.timeoutId);
        }

        const newItems = new Map(state.items);
        newItems.delete(handle);
        return { items: newItems };
      });
    },

    /**
     * 의존성 추가: 연산 결과와 입력 핸들 간의 관계
     */
    addDependency: (resultHandle, inputHandles) => {
      set((state) => {
        const newGraph = new Map(state.dependencyGraph);
        newGraph.set(resultHandle, inputHandles);
        return { dependencyGraph: newGraph };
      });
    },

    /**
     * 아이템 조회
     */
    getItem: (handle) => {
      return get().items.get(handle);
    },

    /**
     * Owner별 아이템 조회
     */
    getItemsByOwner: (owner) => {
      const items = Array.from(get().items.values());
      return items.filter((item) => item.owner === owner);
    },

    /**
     * 전체 초기화
     */
    clear: () => {
      // 모든 타임아웃 해제
      const items = get().items;
      items.forEach((item) => {
        if (item.timeoutId) {
          clearTimeout(item.timeoutId);
        }
      });

      set({
        items: new Map(),
        dependencyGraph: new Map(),
      });
    },

    /**
     * SSE 이벤트 처리
     */
    handleEvent: (message) => {
      const { eventType, payload } = message;

      switch (eventType) {
        case 'user.ciphertext.registered':
        case 'user.ciphertext.confirmed': {
          if (payload.type === 'user.ciphertext.registered' || payload.type === 'user.ciphertext.confirmed') {
            const handle = payload.handle;
            const item = get().items.get(handle);

            if (item) {
              // Optimistic 상태였으면 확정
              if (item.status === 'optimistic') {
                get().confirm(handle);
              }
            } else {
              // 새 아이템 추가 (확정 상태로)
              const newItem: ConfidentialStateItem = {
                handle: payload.handle,
                owner: payload.owner,
                data: null, // 실제 데이터는 별도 조회 필요
                status: 'confirmed',
                txSignature: payload.signature,
                clientTag: payload.clientTag,
                createdAt: payload.blockTime || Date.now(),
                confirmedAt: payload.blockTime || Date.now(),
              };

              set((state) => {
                const newItems = new Map(state.items);
                newItems.set(handle, newItem);
                return { items: newItems };
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
            get().addDependency(resultHandle, inputHandles);

            // 결과 핸들을 optimistic 상태로 추가 (이미 있다면 확정)
            const existingItem = get().items.get(resultHandle);
            if (existingItem) {
              if (existingItem.status === 'optimistic') {
                get().confirm(resultHandle);
              }
            } else {
              // 새 아이템 추가
              const newItem: ConfidentialStateItem = {
                handle: resultHandle,
                owner: payload.owner,
                data: null,
                status: 'confirmed',
                txSignature: payload.signature,
                createdAt: payload.blockTime || Date.now(),
                confirmedAt: payload.blockTime || Date.now(),
              };

              set((state) => {
                const newItems = new Map(state.items);
                newItems.set(resultHandle, newItem);
                return { items: newItems };
              });
            }
          }
          break;
        }

        case 'user.operation.failed': {
          if (payload.type === 'user.operation.failed') {
            // 실패한 연산의 결과 핸들 처리
            // (실제로는 예측된 핸들이 있을 수 있음)
            if (payload.signature) {
              // signature로 optimistic 아이템 찾기
              const items = Array.from(get().items.values());
              const failedItem = items.find(
                (item) => item.txSignature === payload.signature && item.status === 'optimistic'
              );

              if (failedItem) {
                get().fail(failedItem.handle);
              }
            }
          }
          break;
        }
      }
    },
  }))
);

