'use client';

/**
 * @file store-test/realtime-monitor/page.tsx
 * @description 실시간 Store/LocalStorage/IndexedDB 모니터링 페이지
 * 
 * 실행 중인 시스템의 실시간 데이터 플로우를 시각화합니다:
 * - SSE 이벤트 수신
 * - Store 상태 변경
 * - LocalStorage 저장
 * - IndexedDB 저장
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfidentialStateStore } from '@/lib/store/confidential-state-store';
import { useEventSubscription } from '@/hooks/use-event-subscription';
import { useSolana } from '@/components/solana/use-solana';
import { get } from 'idb-keyval';
import type { BlobEntry, ClientStateItem } from '@/types/local-storage';
import type { PubSubMessage } from '@/types/pubsub';
import { isUserEvent } from '@/types/pubsub';

interface TimelineEntry {
  id: string;
  timestamp: number;
  type: 'sse-event' | 'store-change' | 'localstorage-change' | 'indexeddb-change';
  eventType?: string;
  handle?: string;
  status?: string;
  details: Record<string, unknown>;
}

export default function RealtimeMonitorPage() {
  const { account } = useSolana();
  const store = useConfidentialStateStore();
  
  // Store 구독 (items 변경 감지)
  const items = useConfidentialStateStore((state) => state.items);
  const dependencies = useConfidentialStateStore((state) => state.dependencies);
  const lastEventId = useConfidentialStateStore((state) => state.lastEventId);
  
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [localStorageData, setLocalStorageData] = useState<string | null>(null);
  const [indexedDBStatus, setIndexedDBStatus] = useState<Record<string, boolean>>({});
  const [sseConnected, setSseConnected] = useState(false);
  
  const prevItemsRef = useRef<Map<string, ClientStateItem>>(new Map());
  const prevLocalStorageRef = useRef<string | null>(null);
  const indexedDBInitializedRef = useRef(false);

  // Timeline에 항목 추가
  const addTimelineEntry = useCallback((entry: Omit<TimelineEntry, 'id' | 'timestamp'>) => {
    const newEntry: TimelineEntry = {
      ...entry,
      id: `entry_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
    };
    setTimeline((prev) => [newEntry, ...prev].slice(0, 100)); // 최대 100개
  }, []);

  // Store 변경 감지
  useEffect(() => {
    const currentItems = store.items;
    
    // 새로 추가된 아이템
    currentItems.forEach((item, handle) => {
      const prevItem = prevItemsRef.current.get(handle);
      if (!prevItem) {
        addTimelineEntry({
          type: 'store-change',
          handle: handle.slice(0, 16),
          status: item.status,
          details: { action: 'added', owner: item.owner },
        });
      } else if (prevItem.status !== item.status) {
        // 상태 변경
        addTimelineEntry({
          type: 'store-change',
          handle: handle.slice(0, 16),
          status: item.status,
          details: { 
            action: 'status-changed', 
            from: prevItem.status, 
            to: item.status 
          },
        });
      }
    });
    
    // 삭제된 아이템
    prevItemsRef.current.forEach((item, handle) => {
      if (!currentItems.has(handle)) {
        addTimelineEntry({
          type: 'store-change',
          handle: handle.slice(0, 16),
          details: { action: 'removed' },
        });
      }
    });
    
    prevItemsRef.current = new Map(currentItems);
  }, [items, store.items, addTimelineEntry]);

  // LocalStorage 변경 감지 (Polling)
  useEffect(() => {
    const key = 'fhe-state-machine-v1';
    const interval = setInterval(() => {
      const current = localStorage.getItem(key);
      if (current !== prevLocalStorageRef.current) {
        setLocalStorageData(current);
        
        if (prevLocalStorageRef.current !== null) {
          addTimelineEntry({
            type: 'localstorage-change',
            details: { action: 'updated' },
          });
        }
        
        prevLocalStorageRef.current = current;
      }
    }, 200); // 200ms마다 체크
    
    return () => clearInterval(interval);
  }, [addTimelineEntry]);

  // IndexedDB 상태 확인 (Polling)
  useEffect(() => {
    const interval = setInterval(async () => {
      const handles = Array.from(store.items.keys());
      const status: Record<string, boolean> = {};
      
      for (const handle of handles) {
        try {
          const blob = await get<BlobEntry>(handle);
          status[handle] = !!blob;
        } catch {
          status[handle] = false;
        }
      }
      
      // 변경 감지 (초기 상태에서는 이벤트 트리거 안 함)
      if (indexedDBInitializedRef.current) {
        const prevStatus = indexedDBStatus;
        Object.keys({ ...prevStatus, ...status }).forEach((handle) => {
          // 이전에 실제로 값이 있었고, 지금 변경된 경우에만 이벤트 트리거
          if (prevStatus[handle] !== undefined && prevStatus[handle] !== status[handle]) {
            addTimelineEntry({
              type: 'indexeddb-change',
              handle: handle.slice(0, 16),
              details: { 
                action: status[handle] ? 'saved' : 'removed',
              },
            });
          }
        });
      } else {
        // 첫 번째 체크 완료 표시
        indexedDBInitializedRef.current = true;
      }
      
      setIndexedDBStatus(status);
    }, 500); // 500ms마다 체크
    
    return () => clearInterval(interval);
  }, [store.items, indexedDBStatus, addTimelineEntry]);

  // SSE 이벤트 구독
  useEventSubscription({
    channel: 'user',
    wallet: account?.address,
    enabled: !!account?.address,
    onEvent: (message: PubSubMessage) => {
      if (isUserEvent(message)) {
        addTimelineEntry({
          type: 'sse-event',
          eventType: message.eventType,
          handle: message.payload.type === 'user.ciphertext.confirmed' || 
                  message.payload.type === 'user.ciphertext.registered'
            ? (message.payload as { handle?: string }).handle?.slice(0, 16)
            : undefined,
          details: { payload: message.payload },
        });
        
        // Store에 이벤트 처리 (기존 로직)
        store.handleEvent(message);
      }
    },
    onConnect: () => {
      setSseConnected(true);
    },
    onDisconnect: () => {
      setSseConnected(false);
    },
  });

  // Timeline 항목 타입별 스타일
  const getTimelineEntryStyle = (type: TimelineEntry['type']) => {
    switch (type) {
      case 'sse-event':
        return 'bg-purple-100 dark:bg-purple-900/20 border-l-4 border-purple-500';
      case 'store-change':
        return 'bg-blue-100 dark:bg-blue-900/20 border-l-4 border-blue-500';
      case 'localstorage-change':
        return 'bg-green-100 dark:bg-green-900/20 border-l-4 border-green-500';
      case 'indexeddb-change':
        return 'bg-yellow-100 dark:bg-yellow-900/20 border-l-4 border-yellow-500';
      default:
        return 'bg-gray-100 dark:bg-gray-800 border-l-4 border-gray-500';
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-7xl">
      <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">
        🔴 실시간 Store 모니터링
      </h1>

      {/* SSE 연결 상태 */}
      <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-800 rounded">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${sseConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-gray-900 dark:text-gray-100">
            SSE: {sseConnected ? '연결됨' : '연결 안됨'}
          </span>
          <span className="text-gray-600 dark:text-gray-400">
            | Last Event ID: {lastEventId || '없음'}
          </span>
          <span className="text-gray-600 dark:text-gray-400">
            | Store Items: {items.size}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 타임라인 */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
            실시간 타임라인
          </h2>
          <div className="bg-gray-100 dark:bg-gray-800 rounded p-4 max-h-[600px] overflow-y-auto">
            {timeline.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">이벤트가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {timeline.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-3 rounded ${getTimelineEntryStyle(entry.type)}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-white dark:bg-gray-700 rounded">
                            {entry.type}
                          </span>
                          {entry.eventType && (
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              {entry.eventType}
                            </span>
                          )}
                        </div>
                        {entry.handle && (
                          <div className="text-sm text-gray-900 dark:text-gray-100 font-mono">
                            Handle: {entry.handle}...
                          </div>
                        )}
                        {entry.status && (
                          <div className="text-sm text-gray-900 dark:text-gray-100">
                            Status: <span className="font-semibold">{entry.status}</span>
                          </div>
                        )}
                        {'action' in entry.details && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {JSON.stringify(entry.details)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Store 상태 */}
        <div>
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
            Store 상태
          </h2>
          <div className="bg-gray-100 dark:bg-gray-800 rounded p-4 max-h-[600px] overflow-y-auto">
            <div className="space-y-2">
              {Array.from(items.values()).map((item) => (
                <div
                  key={item.handle}
                  className="bg-white dark:bg-gray-700 p-3 rounded text-sm"
                >
                  <div className="font-mono text-xs text-gray-600 dark:text-gray-400 mb-2">
                    {item.handle.slice(0, 16)}...
                  </div>
                  <div className="space-y-1 text-gray-900 dark:text-gray-100">
                    <div>
                      Status:{' '}
                      <span
                        className={`font-semibold ${
                          item.status === 'CONFIRMED'
                            ? 'text-green-600 dark:text-green-400'
                            : item.status === 'FAILED'
                            ? 'text-red-600 dark:text-red-400'
                            : item.status === 'SUBMITTING'
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      Owner: {item.owner.slice(0, 8)}...
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      Data in Memory: {item.data ? '✅' : '❌'}
                      {!item.data && item.status === 'CONFIRMED' && (
                        <span className="ml-1 text-blue-600 dark:text-blue-400">
                          (lazy load 가능)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      Data in IDB: {indexedDBStatus[item.handle] ? '✅' : '❌'}
                      {!indexedDBStatus[item.handle] && item.status === 'SUBMITTING' && (
                        <span className="ml-1 text-yellow-600 dark:text-yellow-400">
                          (확정 대기 중)
                        </span>
                      )}
                    </div>
                    {item.status === 'CONFIRMED' && !item.data && (
                      <button
                        onClick={async () => {
                          await store.getItemWithData(item.handle);
                        }}
                        className="mt-2 text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        데이터 로드
                      </button>
                    )}
                    {/* Dependencies 정보 표시 */}
                    {dependencies.has(item.handle) && (
                      <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600">
                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                          Dependencies ({dependencies.get(item.handle)?.op}):
                        </div>
                        <div className="space-y-1">
                          {dependencies.get(item.handle)?.inputs.map((inputHandle, idx) => {
                            const inputExists = items.has(inputHandle);
                            return (
                              <div
                                key={idx}
                                className={`text-xs font-mono ${
                                  inputExists
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                Input {idx + 1}: {inputHandle.slice(0, 16)}...
                                {inputExists ? ' ✅' : ' ❌ (Store에 없음)'}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {items.size === 0 && (
                <p className="text-gray-600 dark:text-gray-400">아이템이 없습니다.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LocalStorage 미리보기 */}
      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
          LocalStorage 미리보기
        </h2>
        <div className="bg-gray-100 dark:bg-gray-800 rounded p-4 max-h-[300px] overflow-y-auto">
          {localStorageData ? (
            <pre className="text-xs text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
              {JSON.stringify(JSON.parse(localStorageData), null, 2)}
            </pre>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">데이터 없음</p>
          )}
        </div>
      </div>
    </div>
  );
}

