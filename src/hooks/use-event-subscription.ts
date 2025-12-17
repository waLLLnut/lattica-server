// src/hooks/use-event-subscription.ts
// SSE 이벤트 구독 훅 (자동 재연결, Back-off 포함)

import { useEffect, useRef, useState, useCallback } from 'react';
import type { PubSubMessage } from '@/types/pubsub';
import { isUserEvent } from '@/types/pubsub';

export interface UseEventSubscriptionOptions {
  channel: 'global' | 'user';
  wallet?: string; // user 채널일 때 필수
  enabled?: boolean; // 구독 활성화 여부
  onEvent?: (message: PubSubMessage) => void; // 이벤트 수신 핸들러
  onError?: (error: Error) => void; // 에러 핸들러
  onConnect?: () => void; // 연결 성공 핸들러
  onDisconnect?: () => void; // 연결 끊김 핸들러
  lastEventId?: string; // 마지막 이벤트 ID (Gap Filling)
  sinceSlot?: number; // 블록 높이 (Gap Filling)
}

export interface UseEventSubscriptionReturn {
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  reconnect: () => void;
  disconnect: () => void;
  lastEventId: string | null;
}

/**
 * SSE 이벤트 구독 훅
 * 
 * @example
 * const { isConnected, lastEventId } = useEventSubscription({
 *   channel: 'user',
 *   wallet: walletAddress,
 *   onEvent: (message) => {
 *     // Handle event
 *   },
 * });
 */
export function useEventSubscription(
  options: UseEventSubscriptionOptions
): UseEventSubscriptionReturn {
  const {
    channel,
    wallet,
    enabled = true,
    onEvent,
    onError,
    onConnect,
    onDisconnect,
    lastEventId: initialLastEventId,
    sinceSlot,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(initialLastEventId || null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);

  // 핸들러를 ref로 저장하여 dependency 문제 해결
  const handlersRef = useRef({
    onEvent,
    onError,
    onConnect,
    onDisconnect,
  });

  // 핸들러 업데이트
  useEffect(() => {
    handlersRef.current = {
      onEvent,
      onError,
      onConnect,
      onDisconnect,
    };
  }, [onEvent, onError, onConnect, onDisconnect]);

  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000; // 1초
  const maxReconnectDelay = 30000; // 30초

  /**
   * 재연결 지연 시간 계산 (Exponential Back-off)
   */
  const getReconnectDelay = useCallback(() => {
    const attempts = reconnectAttemptsRef.current;
    const delay = Math.min(
      baseReconnectDelay * Math.pow(2, attempts),
      maxReconnectDelay
    );
    return delay;
  }, []);

  /**
   * 연결 종료
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    reconnectAttemptsRef.current = 0;
  }, []);

  // lastEventId를 ref로 저장하여 dependency 문제 해결
  const lastEventIdRef = useRef<string | null>(initialLastEventId || null);
  
  useEffect(() => {
    lastEventIdRef.current = lastEventId;
  }, [lastEventId]);

  /**
   * SSE 연결
   */
  const connect = useCallback(() => {
    if (!enabled) return;
    if (channel === 'user' && !wallet) {
      setError(new Error('wallet is required for user channel'));
      return;
    }

    // 이미 연결 중이면 중복 연결 방지
    const currentEventSource = eventSourceRef.current;
    if (currentEventSource && currentEventSource.readyState !== EventSource.CLOSED) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // 현재 lastEventId를 ref로 가져오기 (최신 값 사용)
      const currentLastEventId = lastEventIdRef.current;
      
      // SSE URL 구성
      const params = new URLSearchParams({
        channel,
        ...(wallet && { wallet }),
        ...(currentLastEventId && { lastEventId: currentLastEventId }),
        ...(sinceSlot && { since: sinceSlot.toString() }),
      });

      const url = `/api/events/stream?${params.toString()}`;
      const eventSource = new EventSource(url);

      eventSourceRef.current = eventSource;

      // 연결 성공
      eventSource.onopen = () => {
        if (!isMountedRef.current) return;

        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        setError(null);
        handlersRef.current.onConnect?.();
      };

      // 메시지 수신 (기본 이벤트 타입)
      eventSource.onmessage = (event) => {
        if (!isMountedRef.current) return;

        try {
          const message: PubSubMessage = JSON.parse(event.data);

          // Last-Event-ID 업데이트
          if (message.eventId) {
            setLastEventId(message.eventId);
          }

          // User 채널일 때는 해당 wallet의 이벤트만 처리
          if (channel === 'user' && isUserEvent(message)) {
            if (message.targetOwner !== wallet) {
              return; // 다른 유저의 이벤트는 무시
            }
          }

          handlersRef.current.onEvent?.(message);
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Failed to parse event');
          setError(error);
          handlersRef.current.onError?.(error);
        }
      };

      // 특정 이벤트 타입 수신
      eventSource.addEventListener('error', () => {
        if (!isMountedRef.current) return;

        const error = new Error('SSE error event received');
        setError(error);
        handlersRef.current.onError?.(error);
      });

      // 연결 확인 이벤트 수신 (커스텀 이벤트)
      eventSource.addEventListener('connected', () => {
        if (!isMountedRef.current) return;
        
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        setError(null);
        handlersRef.current.onConnect?.();
      });

      // 연결 끊김
      eventSource.onerror = () => {
        if (!isMountedRef.current) return;

        const es = eventSourceRef.current;
        if (!es) return;

        // CONNECTING 상태면 아직 연결 시도 중
        if (es.readyState === EventSource.CONNECTING) {
          // 연결 시도 중이면 조금 더 기다림
          return;
        }

        // CLOSED 상태면 완전히 끊긴 것
        if (es.readyState === EventSource.CLOSED) {
          setIsConnected(false);
          setIsConnecting(false);
          handlersRef.current.onDisconnect?.();

          // 자동 재연결 시도
          if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current += 1;
            const delay = getReconnectDelay();

            reconnectTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current && enabled) {
                connect();
              }
            }, delay);
          } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            const error = new Error('Max reconnection attempts reached');
            setError(error);
            handlersRef.current.onError?.(error);
          }
        } else if (es.readyState === EventSource.OPEN) {
          // OPEN 상태인데 에러가 발생한 경우는 네트워크 문제일 수 있음
          // 상태는 유지하되 에러만 기록
          const error = new Error('SSE connection error (connection may be unstable)');
          setError(error);
          handlersRef.current.onError?.(error);
        }
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create EventSource');
      setError(error);
      setIsConnecting(false);
      handlersRef.current.onError?.(error);
    }
  }, [channel, wallet, enabled, sinceSlot, getReconnectDelay]);

  /**
   * 수동 재연결
   */
  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    setTimeout(() => {
      if (isMountedRef.current && enabled) {
        connect();
      }
    }, 100);
  }, [disconnect, connect, enabled]);

  // 초기 연결 및 enabled/wallet 변경 시 재연결
  useEffect(() => {
    if (enabled && (channel === 'global' || wallet)) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, channel, wallet, connect, disconnect]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isConnecting,
    error,
    reconnect,
    disconnect,
    lastEventId,
  };
}

