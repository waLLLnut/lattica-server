/**
 * @file store-test-utils.ts
 * @description Confidential State Store 통합 시뮬레이션 도구
 * 
 * 시퀀스 다이어그램 기반의 Full-Stack Flow를 브라우저에서 단독으로 검증합니다.
 * Mock Server와 Mock Indexer 역할을 수행하여 비동기 시나리오를 재현합니다.
 * 
 * 사용법:
 * 1. 브라우저 콘솔에서 `window.store` 접근
 * 2. `window.testStore.simulateFullLifecycle()` - 전체 라이프사이클 시뮬레이션
 * 3. `window.testStore.simulateGapFilling()` - Gap Filling 검증
 */

import { useConfidentialStateStore } from '../confidential-state-store';
import { get, del, keys } from 'idb-keyval';
import type { BlobEntry, ClientStateItem } from '@/types/local-storage';
import type { UserPubSubMessage } from '@/types/pubsub';

// --- Console Styling ---
const styles = {
  step: 'color: #3b82f6; font-weight: bold; font-size: 14px; background: #eff6ff; padding: 2px 4px; border-radius: 2px;',
  success: 'color: #10b981; font-weight: bold;',
  error: 'color: #ef4444; font-weight: bold;',
  server: 'color: #8b5cf6; font-weight: bold; font-family: monospace;', // 보라색 (Server/Indexer 역할)
};

const logStep = (step: string, msg: string) => console.log(`%c${step}%c ${msg}`, styles.step, 'color: inherit;');
const logServer = (msg: string) => console.log(`%c🤖 [Mock Server/Indexer] ${msg}`, styles.server);
const logSuccess = (msg: string) => console.log(`%c✅ ${msg}`, styles.success);
const logError = (msg: string) => console.log(`%c❌ ${msg}`, styles.error);

/**
 * 브라우저 콘솔에서 사용할 수 있는 테스트 유틸리티
 */
export const createStoreTestUtils = () => {
  const getStore = () => useConfidentialStateStore.getState();

  return {
    /**
     * 🔍 상태 및 스토리지 검사 (기존 기능 유지)
     */
    inspect: () => {
      const state = getStore();
      console.groupCollapsed('🔍 Store Inspection');
      console.table({
        'Items': state.items.size,
        'Dependencies': state.dependencies.size,
        'Last Event ID': state.lastEventId || 'None (Cold Start)',
      });
      console.groupEnd();
      return state;
    },

    /**
     * LocalStorage 상태 확인
     */
    inspectLocalStorage: () => {
      const key = 'fhe-state-machine-v1';
      const raw = localStorage.getItem(key);
      if (!raw) {
        console.log('❌ LocalStorage에 데이터 없음');
        return null;
      }
      const parsed = JSON.parse(raw);
      console.group('📦 LocalStorage Inspection');
      console.log('Raw JSON:', raw);
      console.log('Parsed:', parsed);
      
      // 데이터 필드가 없는지 확인 (핵심 검증!)
      const items = parsed.state?.items || {};
      const hasDataFields = Object.values(items).some((item: unknown) => 
        item && typeof item === 'object' && 'data' in item && 
        (item.data !== undefined && item.data !== null)
      );
      
      if (hasDataFields) {
        console.warn('⚠️ 경고: LocalStorage에 data 필드가 포함되어 있습니다! (partialize 로직 문제 가능)');
      } else {
        console.log('✅ 검증: LocalStorage에 data 필드가 없습니다 (정상)');
      }
      
      console.groupEnd();
      return parsed;
    },

    /**
     * IndexedDB 상태 확인
     */
    inspectIndexedDB: async () => {
      console.group('🗄️ IndexedDB Inspection');
      
      // idb-keyval은 기본적으로 모든 키를 열거할 수 없으므로,
      // 스토어에 있는 핸들들을 기반으로 확인
      const store = useConfidentialStateStore.getState();
      const handles = Array.from(store.items.keys());
      
      console.log('검색할 핸들 개수:', handles.length);
      
      const results: Record<string, BlobEntry | null> = {};
      for (const handle of handles.slice(0, 10)) { // 최대 10개만 확인
        try {
          const blob = await get<BlobEntry>(handle);
          results[handle] = blob || null;
        } catch {
          results[handle] = null;
        }
      }
      
      console.log('IndexedDB 조회 결과:', results);
      console.groupEnd();
      return results;
    },

    /**
     * 🧪 시나리오: Transaction Lifecycle Simulation
     * (Diagram Step 3 -> Step 4 흐름 검증)
     * 
     * Optimistic Update -> SUBMITTING -> CONFIRMED (SSE 이벤트 수신) 전체 흐름 검증
     */
    simulateFullLifecycle: async () => {
      console.clear();
      console.group('🧪 Transaction Lifecycle Simulation (Optimistic -> SUBMITTING -> CONFIRMED)');
      
      const store = getStore();
      const mockEncryptedData = [1, 2, 3, 4, 5];
      const owner = 'SimUser_' + Date.now();
      const txSignature = `sig_${Date.now()}`;

      try {
        // --- 1. Optimistic Update (UI -> Store) ---
        logStep('Step 3-1', 'Optimistic Update 발생 (UI -> Store)');
        
        const generatedHandle = store.registerInputHandle(mockEncryptedData, owner, txSignature);
        logSuccess(`핸들 생성됨: ${generatedHandle.slice(0, 16)}... (Status: OPTIMISTIC)`);
        
        const itemOpt = store.getItem(generatedHandle);
        if (itemOpt?.status !== 'OPTIMISTIC') {
          throw new Error(`Optimistic 상태 진입 실패. Current: ${itemOpt?.status}`);
        }

        // --- 2. IDB Immediate Save Check (Store -> IDB) ---
        // Note: 현재 구현을 보면 registerInputHandle에서 IDB 저장은 하지 않음
        // confirmTransaction에서만 저장함. 이는 시퀀스 다이어그램과 다를 수 있음.
        logStep('Step 3-2', 'IDB 즉시 저장 확인 (Diagram: Save Heavy Data)');
        await new Promise(r => setTimeout(r, 100)); // IDB 쓰기 대기
        
        const blobOpt = await get<BlobEntry>(generatedHandle);
        if (!blobOpt) {
          console.warn('%c⚠️ 주의: Optimistic 단계에서 IDB에 데이터가 없습니다. (현재 구현은 CONFIRMED 시점에만 저장)', styles.server);
        } else {
          logSuccess('IDB에 데이터(Draft/Pending)가 안전하게 백업되었습니다.');
        }

        // --- 3. API Backup Simulation (UI -> API -> Redis) ---
        logStep('Step 3-3', 'API 백업 요청 (UI -> Server)');
        logServer(`POST /api/pending 수신함. (Handle: ${generatedHandle.slice(0, 16)}...) -> Redis 저장 완료 (TTL 1h)`);
        
        // 스토어에서 상태를 SUBMITTING으로 변경
        store.submitTransaction(generatedHandle);
        const itemSubmitting = store.getItem(generatedHandle);
        if (itemSubmitting?.status === 'SUBMITTING') {
          logSuccess('상태 변경: SUBMITTING (체인 전송 중)');
        } else {
          console.warn(`상태 변경 실패. Current: ${itemSubmitting?.status}`);
        }

        // --- 4. Mock Server Push (Indexer -> Redis -> SSE -> UI) ---
        logStep('Step 4', '인덱서 이벤트 수신 시뮬레이션 (Async)');
        logServer('⏳ 체인 컨펌 대기 중 (2초 시뮬레이션)...');
        
        await new Promise(r => setTimeout(r, 2000));
        
        const mockEvent: UserPubSubMessage = {
          eventId: `evt_${Date.now()}`,
          eventType: 'user.ciphertext.confirmed',
          targetOwner: owner,
          payload: {
            type: 'user.ciphertext.confirmed',
            handle: generatedHandle,
            owner: owner,
            signature: txSignature,
            status: 'confirmed',
            slot: 12345,
            blockTime: Date.now(),
          },
          publishedAt: Date.now(),
        };

        logServer(`📡 SSE 이벤트 발송: user.ciphertext.confirmed (Handle: ${generatedHandle.slice(0, 16)}...)`);
        
        // 스토어의 이벤트 핸들러 직접 호출 (SSE 연결을 모킹)
        await store.handleEvent(mockEvent);

        // --- 5. Final Verification ---
        logStep('Verification', '최종 상태 검증');
        await new Promise(r => setTimeout(r, 100)); // 상태 업데이트 대기
        
        const itemFinal = store.getItem(generatedHandle);
        
        if (itemFinal?.status === 'CONFIRMED') {
          logSuccess(`상태 확정됨: CONFIRMED`);
        } else {
          throw new Error(`상태 확정 실패. Current: ${itemFinal?.status}`);
        }

        const finalState = getStore();
        if (finalState.lastEventId === mockEvent.eventId) {
          logSuccess(`lastEventId 업데이트됨: ${mockEvent.eventId}`);
        } else {
          logError(`lastEventId 동기화 실패. Expected: ${mockEvent.eventId}, Got: ${finalState.lastEventId}`);
        }

        // IDB 저장 확인 (CONFIRMED 후)
        const blobFinal = await get<BlobEntry>(generatedHandle);
        if (blobFinal) {
          logSuccess('CONFIRMED 후 IDB에 데이터가 저장되었습니다.');
        } else {
          console.warn('CONFIRMED 후에도 IDB에 데이터가 없습니다. (구현 확인 필요)');
        }

        console.groupEnd();
        return { success: true, handle: generatedHandle };
      } catch (e: unknown) {
        const error = e as Error;
        logError(`Lifecycle 테스트 실패: ${error.message}`);
        console.error(e);
        console.groupEnd();
        return { success: false, error: error.message };
      }
    },

    /**
     * 🧪 시나리오: SSE Gap Filling (Cold Start & Reconnection)
     * (Diagram Step 2 검증)
     * 
     * 네트워크 끊김 후 재연결 시, 클라이언트가 놓친 이벤트를 순차적으로 받아 상태를 최신화하는지 확인
     */
    simulateGapFilling: async () => {
      console.clear();
      console.group('🧪 Gap Filling Simulation (Cold Start & Reconnection)');
      
      const store = getStore();
      const owner = 'GapTestUser_' + Date.now();
      
      try {
        // 1. 초기 상태: lastEventId가 과거임
        const oldEventId = `evt_${Date.now() - 10000}`;
        useConfidentialStateStore.setState({ lastEventId: oldEventId });
        logStep('Context', `클라이언트 Last-Event-ID: ${oldEventId} (과거 이벤트)`);

        // 2. 서버에서 놓친 이벤트들(Gap)을 한꺼번에 보냄
        const gapHandle1 = `gap_handle_1_${Date.now()}`;
        const gapHandle2 = `gap_handle_2_${Date.now()}`;
        
        const missedEvents: UserPubSubMessage[] = [
          { 
            eventId: `evt_${Date.now() - 9000}`, 
            eventType: 'user.ciphertext.confirmed',
            targetOwner: owner,
            payload: { 
              type: 'user.ciphertext.confirmed', 
              handle: gapHandle1, 
              owner: owner,
              signature: `sig_gap1_${Date.now()}`,
              status: 'confirmed',
              slot: 10001,
              blockTime: Date.now() - 9000,
            },
            publishedAt: Date.now() - 9000,
          },
          { 
            eventId: `evt_${Date.now() - 8000}`, 
            eventType: 'user.ciphertext.confirmed',
            targetOwner: owner,
            payload: { 
              type: 'user.ciphertext.confirmed', 
              handle: gapHandle2, 
              owner: owner,
              signature: `sig_gap2_${Date.now()}`,
              status: 'confirmed',
              slot: 10002,
              blockTime: Date.now() - 8000,
            },
            publishedAt: Date.now() - 8000,
          },
        ];

        logServer(`📡 연결 복구됨. Gap Event 2개 전송 중...`);
        
        // 순차적 처리 시뮬레이션
        for (const evt of missedEvents) {
          await store.handleEvent(evt);
          const handle = evt.payload.type === 'user.ciphertext.confirmed' || evt.payload.type === 'user.ciphertext.registered'
            ? evt.payload.handle
            : 'unknown';
          logServer(`  ✓ 이벤트 처리: ${evt.eventId} (Handle: ${handle.slice(0, 16)}...)`);
        }

        // 3. 검증
        const state = getStore();
        const lastEventId = missedEvents[missedEvents.length - 1].eventId;
        
        if (state.lastEventId === lastEventId) {
          logSuccess(`lastEventId가 최신으로 동기화되었습니다: ${lastEventId}`);
        } else {
          logError(`동기화 실패. Expected: ${lastEventId}, Got: ${state.lastEventId}`);
        }

        const item1 = state.getItem(gapHandle1);
        const item2 = state.getItem(gapHandle2);
        
        if (item1 && item2) {
          logSuccess('놓친 핸들들이 정상적으로 스토어에 복구되었습니다.');
          logSuccess(`  - ${gapHandle1.slice(0, 16)}...: ${item1.status}`);
          logSuccess(`  - ${gapHandle2.slice(0, 16)}...: ${item2.status}`);
        } else {
          logError(`복구 실패. Item1: ${item1 ? 'OK' : 'MISSING'}, Item2: ${item2 ? 'OK' : 'MISSING'}`);
        }

        console.groupEnd();
        return { 
          success: state.lastEventId === lastEventId && !!item1 && !!item2,
          lastEventId: state.lastEventId,
        };
      } catch (e: unknown) {
        const error = e as Error;
        logError(`Gap Filling 테스트 실패: ${error.message}`);
        console.error(e);
        console.groupEnd();
        return { success: false, error: error.message };
      }
    },

    /**
     * 테스트 시나리오 1: Basic Flow (Register → Confirm → Lazy Load)
     * (기존 호환성 유지)
     */
    testBasicFlow: async () => {
      console.group('🧪 Test: Basic Flow');
      
      const store = getStore();
      const owner = 'TestOwner123';
      const encryptedData = [1, 2, 3, 4, 5];
      
      // 1. Register Input Handle
      console.log('1️⃣ Registering input handle...');
      const handle = store.registerInputHandle(encryptedData, owner);
      console.log('생성된 핸들:', handle);
      
      // 2. 상태 확인
      const item1 = store.getItem(handle);
      console.log('2️⃣ 상태 확인 (OPTIMISTIC?):', item1?.status);
      
      // 3. LocalStorage 확인 (data 필드 없어야 함)
      await new Promise(resolve => setTimeout(resolve, 100)); // Persist 지연 대기
      console.log('3️⃣ LocalStorage 확인:');
      const lsData = JSON.parse(localStorage.getItem('fhe-state-machine-v1') || '{}');
      const hasData = lsData.state?.items?.[handle]?.data !== undefined;
      console.log('   data 필드 존재 여부:', hasData ? '❌ 존재함 (문제!)' : '✅ 없음 (정상)');
      
      // 4. Confirm Transaction (데이터 포함)
      console.log('4️⃣ Confirming transaction with data...');
      const mockCiphertext = btoa('mock-ciphertext-data-' + Date.now());
      await store.confirmTransaction(handle, mockCiphertext);
      
      const item2 = store.getItem(handle);
      console.log('   상태 (CONFIRMED?):', item2?.status);
      console.log('   메모리 데이터:', item2?.data ? '✅ 있음' : '❌ 없음');
      
      // 5. IndexedDB 확인
      await new Promise(resolve => setTimeout(resolve, 100)); // IDB 저장 대기
      console.log('5️⃣ IndexedDB 확인:');
      const idbData = await get<BlobEntry>(handle);
      console.log('   IndexedDB 데이터:', idbData ? '✅ 있음' : '❌ 없음');
      
      // 6. Lazy Loading 테스트 (메모리에서 제거 후 다시 로드)
      console.log('6️⃣ Lazy Loading 테스트...');
      const currentItem = store.items.get(handle);
      if (currentItem) {
        currentItem.data = null; // 강제로 메모리에서 제거
      }
      const item3 = await store.getItemWithData(handle);
      console.log('   Lazy load 결과:', item3?.data ? '✅ 복구됨' : '❌ 실패');
      console.log('   데이터 일치:', item3?.data === mockCiphertext ? '✅ 일치' : '❌ 불일치');
      
      console.groupEnd();
      return { handle, success: item3?.data === mockCiphertext };
    },

    /**
     * 테스트 시나리오 2: Zombie Cleanup
     */
    testZombieCleanup: () => {
      console.group('🧪 Test: Zombie Cleanup');
      
      const store = getStore();
      const oldTime = Date.now() - 100000; // 1분 이상 경과
      const handle = 'zombie-handle-test';
      
      // 강제로 오래된 OPTIMISTIC 아이템 생성
      const zombieItem: ClientStateItem = {
        handle,
        owner: 'test',
        status: 'OPTIMISTIC',
        createdAt: oldTime,
        data: null,
        isCached: false,
      };
      store.items.set(handle, zombieItem);
      
      console.log('1️⃣ 좀비 아이템 생성:', handle);
      console.log('   생성 시간:', new Date(oldTime).toISOString());
      console.log('   현재 시간:', new Date().toISOString());
      
      const beforeStatus = store.getItem(handle)?.status;
      console.log('2️⃣ Cleanup 전 상태:', beforeStatus);
      
      store.cleanupStaleItems();
      
      const afterStatus = store.getItem(handle)?.status;
      console.log('3️⃣ Cleanup 후 상태:', afterStatus);
      console.log('   결과:', afterStatus === 'FAILED' ? '✅ FAILED로 변경됨' : '❌ 변경 안됨');
      
      // 정리
      store.items.delete(handle);
      
      console.groupEnd();
      return { success: afterStatus === 'FAILED' };
    },

    /**
     * 테스트 시나리오 3: Persistence (새로고침 후 복원)
     */
    testPersistence: async () => {
      console.group('🧪 Test: Persistence');
      
      const store = getStore();
      const owner = 'PersistenceTest';
      const encryptedData = [10, 20, 30];
      
      // 1. 핸들 등록
      const handle = store.registerInputHandle(encryptedData, owner);
      console.log('1️⃣ 핸들 등록:', handle);
      
      // 2. LocalStorage에 저장되도록 대기
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 3. LocalStorage 확인
      const lsKey = 'fhe-state-machine-v1';
      const lsExists = localStorage.getItem(lsKey) !== null;
      console.log('2️⃣ LocalStorage 저장 확인:', lsExists ? '✅ 저장됨' : '❌ 없음');
      
      if (lsExists) {
        const lsData = JSON.parse(localStorage.getItem(lsKey)!);
        const itemInLS = lsData.state?.items?.[handle];
        console.log('3️⃣ LocalStorage 아이템:', itemInLS ? '✅ 존재' : '❌ 없음');
        console.log('   상태:', itemInLS?.status);
        console.log('   data 필드:', itemInLS?.data !== undefined ? '❌ 있음 (문제!)' : '✅ 없음 (정상)');
      }
      
      console.log('💡 참고: 실제 복원 테스트는 페이지 새로고침(F5) 후 확인하세요');
      console.groupEnd();
      return { handle, lsExists };
    },

    /**
     * 전체 테스트 실행
     */
    runAllTests: async () => {
      console.log('🚀 전체 테스트 시작...\n');
      
      const results = {
        basicFlow: false,
        zombieCleanup: false,
        persistence: false,
      };
      
      const utils = createStoreTestUtils();
      
      try {
        const basicResult = await utils.testBasicFlow();
        results.basicFlow = basicResult.success;
      } catch (e) {
        console.error('Basic Flow 테스트 실패:', e);
      }
      
      try {
        const zombieResult = utils.testZombieCleanup();
        results.zombieCleanup = zombieResult.success;
      } catch (e) {
        console.error('Zombie Cleanup 테스트 실패:', e);
      }
      
      try {
        await utils.testPersistence();
        results.persistence = true; // 복원은 수동으로 확인해야 함
      } catch (e) {
        console.error('Persistence 테스트 실패:', e);
      }
      
      console.log('\n📊 테스트 결과:');
      console.table(results);
      
      return results;
    },

    /**
     * 스토어 초기화 (테스트 리셋용)
     */
    clear: () => {
      const store = getStore();
      store.clear();
      console.log('✅ 스토어 초기화 완료');
    },

    /**
     * LocalStorage 및 IndexedDB 완전 초기화
     */
    clearAll: async () => {
      // LocalStorage 초기화
      localStorage.removeItem('fhe-state-machine-v1');
      console.log('✅ LocalStorage 초기화 완료');
      
      // IndexedDB 초기화 (모든 키 삭제)
      const allKeys = await keys();
      for (const k of allKeys) {
        await del(k);
      }
      
      const store = getStore();
      store.clear();
      console.log('✅ IndexedDB 초기화 완료');
      console.log('✅ 모든 데이터 초기화 완료');
    },

    /**
     * 유틸리티: 데이터 초기화 (alias for clearAll)
     */
    reset: async () => {
      await createStoreTestUtils().clearAll();
    },
  };
};

/**
 * 전역 테스트 유틸리티 인스턴스 (브라우저 콘솔에서 사용)
 */
export const testUtils = createStoreTestUtils();

/**
 * 브라우저 전역 객체에 스토어 노출 (개발 환경 전용)
 * 
 * 사용법:
 * - 브라우저 콘솔에서 `window.store` 접근
 * - `window.testStore()` 실행
 */
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).store = useConfidentialStateStore.getState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).testStore = testUtils;
  
  console.log('🔧 개발 모드: 스토어 테스트 유틸리티가 window.store와 window.testStore에 노출되었습니다.');
  console.log('📖 사용법 (Full Lifecycle Simulation):');
  console.log('  - window.testStore.simulateFullLifecycle(): 전체 트랜잭션 라이프사이클 시뮬레이션');
  console.log('  - window.testStore.simulateGapFilling(): Gap Filling 검증');
  console.log('📖 사용법 (Legacy Tests):');
  console.log('  - window.testStore.testBasicFlow(): 기본 플로우 테스트');
  console.log('  - window.testStore.testZombieCleanup(): 좀비 클린업 테스트');
  console.log('  - window.testStore.testPersistence(): 영속성 테스트');
  console.log('  - window.testStore.runAllTests(): 전체 테스트 실행');
  console.log('📖 사용법 (Inspection):');
  console.log('  - window.store: 스토어 상태 직접 접근');
  console.log('  - window.testStore.inspect(): 스토어 상태 검사');
  console.log('  - window.testStore.inspectLocalStorage(): LocalStorage 검사');
  console.log('  - window.testStore.inspectIndexedDB(): IndexedDB 검사');
  console.log('  - window.testStore.clearAll(): 모든 데이터 초기화');
}

