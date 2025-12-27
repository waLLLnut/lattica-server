'use client';

/**
 * @file store-test/page.tsx
 * @description Confidential State Store 테스트 페이지
 * 
 * 로컬스토리지와 IndexedDB 저장이 정상 작동하는지 UI에서 직접 확인할 수 있는 테스트 페이지
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfidentialStateStore } from '@/lib/store/confidential-state-store';
import { get } from 'idb-keyval';
import type { BlobEntry, ClientStateItem, ConfidentialStateStoreSerialized } from '@/types/local-storage';

export default function StoreTestPage() {
  const store = useConfidentialStateStore();
  const items = Array.from(store.items.values());
  
  const [testResults, setTestResults] = useState<Record<string, unknown>>({});
  const [localStorageData, setLocalStorageData] = useState<{ state: ConfidentialStateStoreSerialized } | null>(null);
  const [indexedDBData, setIndexedDBData] = useState<Record<string, BlobEntry | null>>({});

  // LocalStorage 데이터 로드
  const loadLocalStorage = useCallback(() => {
    const key = 'fhe-state-machine-v1';
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setLocalStorageData(parsed);
      } catch (error) {
        console.error('LocalStorage 파싱 실패:', error);
      }
    } else {
      setLocalStorageData(null);
    }
  }, []);

  // IndexedDB 데이터 로드
  const loadIndexedDB = useCallback(async () => {
    const currentItems = useConfidentialStateStore.getState().items;
    const handles = Array.from(currentItems.keys());
    const results: Record<string, BlobEntry | null> = {};
    
    for (const handle of handles.slice(0, 10)) {
      try {
        const blob = await get<BlobEntry>(handle);
        results[handle] = blob || null;
      } catch {
        results[handle] = null;
      }
    }
    
    setIndexedDBData(results);
  }, []);

  // 초기 로드만 수행 (무한 루프 방지)
  const hasInitializedRef = useRef(false);
  
  useEffect(() => {
    // 초기 마운트 시에만 실행
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      loadLocalStorage();
      void loadIndexedDB();
    }
  }, [loadLocalStorage, loadIndexedDB]);

  // 테스트 1: Basic Flow
  const testBasicFlow = async () => {
    setTestResults({ ...testResults, basicFlow: '실행 중...' });
    
    try {
      const owner = 'TestOwner_' + Date.now();
      const encryptedData = [1, 2, 3, 4, 5];
      
      // 1. Register
      const handle = store.registerInputHandle(encryptedData, owner);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 2. LocalStorage 확인
      await new Promise(resolve => setTimeout(resolve, 100)); // Persist 대기
      const currentLS = JSON.parse(localStorage.getItem('fhe-state-machine-v1') || '{}');
      const lsItem = currentLS.state?.items?.[handle];
      const hasDataInLS = lsItem?.data !== undefined;
      
      // 3. Confirm with data
      const mockCiphertext = btoa('mock-data-' + Date.now());
      await store.confirmTransaction(handle, mockCiphertext);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 4. IndexedDB 확인
      await loadIndexedDB();
      
      // 5. LocalStorage 재확인
      loadLocalStorage();
      
      // 5. Lazy Loading 테스트
      store.items.get(handle)!.data = null;
      const reloadedItem = await store.getItemWithData(handle);
      
      const success = reloadedItem?.data === mockCiphertext && !hasDataInLS;
      
      setTestResults({
        ...testResults,
        basicFlow: {
          success,
          handle,
          hasDataInLS: hasDataInLS ? '❌ 문제: LocalStorage에 data 있음' : '✅ 정상: LocalStorage에 data 없음',
          hasDataInIDB: indexedDBData[handle] ? '✅ 있음' : '❌ 없음',
          lazyLoadSuccess: reloadedItem?.data ? '✅ 성공' : '❌ 실패',
        },
      });
    } catch (e) {
      setTestResults({ ...testResults, basicFlow: { error: String(e) } });
    }
  };

  // 테스트 2: Zombie Cleanup
  const testZombieCleanup = () => {
    setTestResults({ ...testResults, zombieCleanup: '실행 중...' });
    
    try {
      const oldTime = Date.now() - 100000; // 1분 이상 경과
      const handle = 'zombie-test-' + Date.now();
      
      // 강제로 좀비 아이템 생성
      const zombieItem: ClientStateItem = {
        handle,
        owner: 'test',
        status: 'OPTIMISTIC',
        createdAt: oldTime,
        data: null,
        isCached: false,
      };
      store.items.set(handle, zombieItem);
      
      const beforeStatus = store.getItem(handle)?.status;
      store.cleanupStaleItems();
      const afterStatus = store.getItem(handle)?.status;
      
      // 정리
      store.items.delete(handle);
      
      const success = beforeStatus === 'OPTIMISTIC' && afterStatus === 'FAILED';
      
      setTestResults({
        ...testResults,
        zombieCleanup: {
          success,
          beforeStatus,
          afterStatus,
        },
      });
    } catch (e) {
      setTestResults({ ...testResults, zombieCleanup: { error: String(e) } });
    }
  };

  // 테스트 3: Persistence 확인
  const testPersistence = async () => {
    setTestResults({ ...testResults, persistence: '실행 중...' });
    
    try {
      const owner = 'PersistenceTest';
      const encryptedData = [10, 20, 30];
      
      const handle = store.registerInputHandle(encryptedData, owner);
      await new Promise(resolve => setTimeout(resolve, 200));
      
      loadLocalStorage();
      await new Promise(resolve => setTimeout(resolve, 50)); // 상태 업데이트 대기
      const currentLS = JSON.parse(localStorage.getItem('fhe-state-machine-v1') || '{}');
      const lsExists = currentLS.state !== undefined;
      const itemInLS = currentLS.state?.items?.[handle];
      const hasDataField = itemInLS?.data !== undefined;
      
      setTestResults({
        ...testResults,
        persistence: {
          success: lsExists && !hasDataField,
          handle,
          lsExists: lsExists ? '✅ LocalStorage에 저장됨' : '❌ 없음',
          hasDataField: hasDataField ? '❌ 문제: data 필드 있음' : '✅ 정상: data 필드 없음',
          message: '새로고침(F5) 후 복원 여부를 확인하세요',
        },
      });
    } catch (e) {
      setTestResults({ ...testResults, persistence: { error: String(e) } });
    }
  };

  // 전체 테스트 실행
  const runAllTests = async () => {
    await testBasicFlow();
    testZombieCleanup();
    await testPersistence();
  };

  // 초기화
  const clearAll = async () => {
    localStorage.removeItem('fhe-state-machine-v1');
    const handles = Array.from(store.items.keys());
    const { del } = await import('idb-keyval');
    for (const handle of handles) {
      await del(handle);
    }
    store.clear();
    loadLocalStorage();
    loadIndexedDB();
    setTestResults({});
  };

  return (
    <div className="container mx-auto p-8 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">🔬 Confidential State Store 테스트</h1>
      
      {/* 테스트 버튼 */}
      <div className="mb-8 space-x-4">
        <button
          onClick={runAllTests}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          전체 테스트 실행
        </button>
        <button
          onClick={testBasicFlow}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          기본 플로우 테스트
        </button>
        <button
          onClick={testZombieCleanup}
          className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          좀비 클린업 테스트
        </button>
        <button
          onClick={testPersistence}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          영속성 테스트
        </button>
        <button
          onClick={clearAll}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          전체 초기화
        </button>
      </div>

      {/* 테스트 결과 */}
      <div className="mb-8 space-y-4">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">테스트 결과</h2>
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
          <pre className="text-sm overflow-auto text-gray-900 dark:text-gray-100">
            {JSON.stringify(testResults, null, 2)}
          </pre>
        </div>
      </div>

      {/* 현재 스토어 상태 */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-gray-100">현재 스토어 상태</h2>
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
          <p className="mb-2 text-gray-900 dark:text-gray-100">Items 개수: {items.length}</p>
          <p className="mb-2 text-gray-900 dark:text-gray-100">Dependencies 개수: {store.dependencies.size}</p>
          <p className="mb-4 text-gray-900 dark:text-gray-100">Last Event ID: {store.lastEventId || '없음'}</p>
          
          {items.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Items:</h3>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.handle} className="bg-white dark:bg-gray-700 p-2 rounded text-sm text-gray-900 dark:text-gray-100">
                    <div>Handle: {item.handle.slice(0, 16)}...</div>
                    <div>Status: {item.status}</div>
                    <div>Owner: {item.owner}</div>
                    <div>Data in Memory: {item.data ? '✅ 있음' : '❌ 없음'}</div>
                    <div>Is Cached: {item.isCached ? '✅ 예' : '❌ 아니오'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* LocalStorage 상태 */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-gray-100">LocalStorage 상태</h2>
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
          {localStorageData ? (
            <>
              <p className="mb-2 text-green-600 dark:text-green-400">✅ 데이터 존재</p>
              <details className="mt-2">
                <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-100">데이터 보기</summary>
                <pre className="text-xs mt-2 overflow-auto bg-white dark:bg-gray-700 p-2 rounded text-gray-900 dark:text-gray-100">
                  {JSON.stringify(localStorageData, null, 2)}
                </pre>
              </details>
              
              {/* 데이터 필드 검증 */}
              <div className="mt-4">
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">검증:</h3>
                {Object.values(localStorageData.state?.items || {}).some((item: unknown) => 
                  item && typeof item === 'object' && 'data' in item && 
                  (item.data !== undefined && item.data !== null)
                ) ? (
                  <p className="text-red-600 dark:text-red-400">❌ 문제: LocalStorage에 data 필드가 포함되어 있습니다!</p>
                ) : (
                  <p className="text-green-600 dark:text-green-400">✅ 정상: LocalStorage에 data 필드가 없습니다 (메타데이터만 저장됨)</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">데이터 없음</p>
          )}
        </div>
      </div>

      {/* IndexedDB 상태 */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-gray-100">IndexedDB 상태</h2>
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
          {Object.keys(indexedDBData).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(indexedDBData).map(([handle, blob]) => (
                <div key={handle} className="bg-white dark:bg-gray-700 p-2 rounded text-sm text-gray-900 dark:text-gray-100">
                  <div>Handle: {handle.slice(0, 16)}...</div>
                  <div>Data: {blob ? '✅ 있음' : '❌ 없음'}</div>
                  {blob && <div>Updated At: {new Date(blob.updatedAt).toLocaleString()}</div>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">데이터 없음</p>
          )}
        </div>
      </div>

      {/* 사용 가이드 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">📖 사용 가이드</h2>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-900 dark:text-gray-100">
          <li>브라우저 개발자 도구(F12)를 열고 Console 탭에서 window.testStore 명령어를 사용할 수 있습니다</li>
          <li>Application 탭 → Local Storage에서 &apos;fhe-state-machine-v1&apos; 키를 확인하세요</li>
          <li>Application 탭 → IndexedDB → keyval-store에서 실제 암호문 데이터를 확인하세요</li>
          <li>새로고침(F5) 후 데이터가 복원되는지 확인하세요</li>
        </ul>
      </div>
    </div>
  );
}

