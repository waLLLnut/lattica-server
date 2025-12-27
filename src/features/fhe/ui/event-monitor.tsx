// src/features/fhe/ui/event-monitor.tsx
// 실시간 이벤트 모니터링 컴포넌트 (테스트용)

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useEventSubscription } from '@/hooks/use-event-subscription';
import { useSolana } from '@/components/solana/use-solana';
import { useFHE } from './fhe-provider';
import type { PubSubMessage } from '@/types/pubsub';
import { isUserEvent, isGlobalEvent } from '@/types/pubsub';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface EventLogEntry {
  id: string; // eventId + timestamp 조합으로 고유성 보장
  eventId: string;
  timestamp: string;
  eventType: string;
  channel: 'global' | 'user';
  payload: unknown;
  raw: PubSubMessage;
}

export function EventMonitor() {
  const { account } = useSolana();
  const { addLog } = useFHE();
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [userEnabled, setUserEnabled] = useState(true);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [maxEvents] = useState(50); // 최대 50개 이벤트 유지
  const eventsContainerRef = useRef<HTMLDivElement>(null);

  // 이벤트 추가 (중복 제거, 스택 형태로 최신이 위에)
  const addEvent = useCallback((entry: EventLogEntry) => {
    setEvents((prev) => {
      // 중복 체크: eventId와 channel이 동일한 경우 제외
      const isDuplicate = prev.some(
        (e) => e.eventId === entry.eventId && e.channel === entry.channel
      );
      
      if (isDuplicate) {
        return prev; // 중복이면 기존 리스트 반환
      }

      // 새 이벤트를 맨 앞에 추가하고 최대 개수 제한 (스택 형태: 최신이 위)
      const newEvents = [entry, ...prev].slice(0, maxEvents);
      return newEvents;
    });
  }, [maxEvents]);

  // 새 이벤트가 추가될 때 스크롤을 맨 위로 이동 (최신 이벤트 표시)
  useEffect(() => {
    if (eventsContainerRef.current && events.length > 0) {
      eventsContainerRef.current.scrollTop = 0;
    }
  }, [events.length]);

  // User 채널 구독
  const userSubscription = useEventSubscription({
    channel: 'user',
    wallet: account?.address,
    enabled: userEnabled && !!account?.address,
    onEvent: (message) => {
      const timestamp = Date.now();
      const entry: EventLogEntry = {
        id: `user-${message.eventId}-${timestamp}-${Math.random()}`, // channel 포함하여 고유 key 생성
        eventId: message.eventId,
        timestamp: new Date().toLocaleTimeString(),
        eventType: message.eventType,
        channel: 'user',
        payload: message.payload,
        raw: message,
      };

      addEvent(entry);

      // LogConsole에 표시
      if (isUserEvent(message)) {
        const payload = message.payload;
        let logMessage = `[SSE] ${message.eventType}`;
        
        if (payload.type === 'user.ciphertext.registered' || payload.type === 'user.ciphertext.confirmed') {
          logMessage += ` | Handle: ${payload.handle.slice(0, 8)}... | Owner: ${payload.owner.slice(0, 8)}...`;
        } else if (payload.type === 'user.operation.completed') {
          logMessage += ` | Op: ${payload.operation} | Result: ${payload.resultHandle.slice(0, 8)}...`;
        } else if (payload.type === 'user.operation.failed') {
          logMessage += ` | Error: ${payload.error}`;
        }

        addLog(logMessage, 'info', 'SSE');
      }
    },
    onError: (error) => {
      addLog(`[SSE] User Error: ${error.message}`, 'error', 'SSE');
    },
    onConnect: () => {
      addLog('[SSE] User channel connected', 'info', 'SSE');
    },
    onDisconnect: () => {
      addLog('[SSE] User channel disconnected', 'warn', 'SSE');
    },
  });

  // Global 채널 구독
  const globalSubscription = useEventSubscription({
    channel: 'global',
    enabled: globalEnabled,
    onEvent: (message) => {
      const timestamp = Date.now();
      const entry: EventLogEntry = {
        id: `global-${message.eventId}-${timestamp}-${Math.random()}`, // channel 포함하여 고유 key 생성
        eventId: message.eventId,
        timestamp: new Date().toLocaleTimeString(),
        eventType: message.eventType,
        channel: 'global',
        payload: message.payload,
        raw: message,
      };

      addEvent(entry);

      // LogConsole에 표시
      if (isGlobalEvent(message)) {
        const payload = message.payload;
        let logMessage = `[SSE] ${message.eventType}`;
        
        if (payload.type === 'indexer.InputHandleRegistered') {
          logMessage += ` | Caller: ${payload.event.caller.slice(0, 8)}...`;
        } else if (payload.type === 'indexer.Fhe16BinaryOpRequested') {
          logMessage += ` | Op: ${payload.event.op} | Caller: ${payload.event.caller.slice(0, 8)}...`;
        } else if (payload.type === 'indexer.status') {
          logMessage += ` | Status: ${payload.status}`;
        } else if (payload.type === 'indexer.error') {
          logMessage += ` | Error: ${payload.error}`;
        }

        addLog(logMessage, 'info', 'SSE');
      }
    },
    onError: (error) => {
      addLog(`[SSE] Global Error: ${error.message}`, 'error', 'SSE');
    },
    onConnect: () => {
      addLog('[SSE] Global channel connected', 'info', 'SSE');
    },
    onDisconnect: () => {
      addLog('[SSE] Global channel disconnected', 'warn', 'SSE');
    },
  });

  const clearEvents = () => {
    setEvents([]);
    addLog('[EventMonitor] Events cleared', 'info', 'EventMonitor');
  };

  const formatPayload = (payload: unknown): string => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  };

  const toggleUser = () => {
    setUserEnabled((prev) => !prev);
    if (userEnabled) {
      addLog('[EventMonitor] User channel disabled', 'info', 'EventMonitor');
    } else {
      addLog('[EventMonitor] User channel enabled', 'info', 'EventMonitor');
    }
  };

  const toggleGlobal = () => {
    setGlobalEnabled((prev) => !prev);
    if (globalEnabled) {
      addLog('[EventMonitor] Global channel disabled', 'info', 'EventMonitor');
    } else {
      addLog('[EventMonitor] Global channel enabled', 'info', 'EventMonitor');
    }
  };

  return (
    <Card className="mt-4 p-4 bg-black border-zinc-800 font-mono text-xs">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <span className="text-zinc-400">Real-time Events</span>
          
          {/* User 채널 토글 */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleUser}
              disabled={!account?.address}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                userEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              User {userEnabled ? 'ON' : 'OFF'}
            </button>
            {userEnabled && (
              <div className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    userSubscription.isConnected
                      ? 'bg-green-500'
                      : userSubscription.isConnecting
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-zinc-500 text-[10px]">
                  {userSubscription.isConnected
                    ? 'Connected'
                    : userSubscription.isConnecting
                    ? 'Connecting...'
                    : 'Disconnected'}
                </span>
              </div>
            )}
          </div>

          {/* Global 채널 토글 */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleGlobal}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                globalEnabled
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Global {globalEnabled ? 'ON' : 'OFF'}
            </button>
            {globalEnabled && (
              <div className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    globalSubscription.isConnected
                      ? 'bg-green-500'
                      : globalSubscription.isConnecting
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-zinc-500 text-[10px]">
                  {globalSubscription.isConnected
                    ? 'Connected'
                    : globalSubscription.isConnecting
                    ? 'Connecting...'
                    : 'Disconnected'}
                </span>
              </div>
            )}
          </div>
        </div>
        <Button
          onClick={clearEvents}
          variant="ghost"
          className="text-zinc-600 hover:text-white h-auto p-1 text-xs"
        >
          Clear
        </Button>
      </div>

      {userEnabled && !account?.address && (
        <div className="mb-2 text-yellow-500 text-xs">
          Connect wallet to subscribe to user channel
        </div>
      )}

      {(userSubscription.error || globalSubscription.error) && (
        <div className="mb-2 text-red-500 text-xs">
          {userSubscription.error && `User Error: ${userSubscription.error.message}`}
          {globalSubscription.error && `Global Error: ${globalSubscription.error.message}`}
        </div>
      )}

      <div ref={eventsContainerRef} className="h-60 overflow-y-auto space-y-2">
        {events.length === 0 ? (
          <div className="text-zinc-600 text-center py-8">No events received yet...</div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="p-2 bg-zinc-900 border border-zinc-800 rounded text-xs"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">{event.timestamp}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      event.channel === 'user'
                        ? 'bg-green-900 text-green-300'
                        : 'bg-blue-900 text-blue-300'
                    }`}
                  >
                    {event.channel.toUpperCase()}
                  </span>
                  <span className="text-cyan-400 font-semibold">{event.eventType}</span>
                </div>
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-zinc-400 hover:text-zinc-300 text-[10px]">
                  View Payload
                </summary>
                <pre className="mt-1 p-2 bg-black rounded text-[10px] text-zinc-400 overflow-x-auto">
                  {formatPayload(event.payload)}
                </pre>
              </details>
            </div>
          ))
        )}
      </div>

      {events.length > 0 && (
        <div className="mt-2 text-zinc-600 text-[10px] text-center">
          Showing {events.length} event{events.length !== 1 ? 's' : ''} (max {maxEvents})
        </div>
      )}
    </Card>
  );
}
