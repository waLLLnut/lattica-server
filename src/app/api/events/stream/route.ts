// src/app/api/events/stream/route.ts
// Server-Sent Events (SSE) 엔드포인트
// Redis Pub/Sub를 통해 실시간 이벤트를 클라이언트에 전달

import { NextRequest } from 'next/server';
import { getPubSubClient } from '@/lib/redis/pubsub';
import { PUBSUB_CHANNELS } from '@/types/pubsub';
import type { PubSubMessage } from '@/types/pubsub';
import { isUserEvent } from '@/types/pubsub';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { EventStreamRepository } from '@/lib/store/event-stream-repository';

const log = createLogger('SSE:Stream');

/**
 * SSE 스트림 생성 및 Redis Pub/Sub 구독
 * 
 * Query Parameters:
 * - channel: 'global' | 'user' (기본값: 'user')
 * - wallet: 지갑 주소 (user 채널일 때 필수)
 * - lastEventId: 마지막 수신한 이벤트 ID (Gap Filling용)
 * - since: 블록 높이 (Gap Filling용, lastEventId가 없을 때 사용)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel') || 'user';
  const wallet = searchParams.get('wallet');
  const lastEventId = req.headers.get('Last-Event-ID') || searchParams.get('lastEventId');
  const sinceSlot = searchParams.get('since');

  // User 채널일 때 wallet 필수
  if (channel === 'user' && !wallet) {
    return new Response(
      JSON.stringify({ error: 'wallet parameter is required for user channel' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // SSE 스트림 생성
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let unsubscribe: (() => Promise<void>) | null = null;
      let keepAliveInterval: NodeJS.Timeout | null = null;
      let fallbackPollInterval: NodeJS.Timeout | null = null;
      let isClosed = false;

      // 연결 종료 처리
      const cleanup = async () => {
        if (isClosed) return;
        isClosed = true;

        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        if (fallbackPollInterval) {
          clearInterval(fallbackPollInterval);
          fallbackPollInterval = null;
        }

        if (unsubscribe) {
          await unsubscribe().catch((error) => {
            log.error('Failed to unsubscribe', error);
          });
        }

        try {
          controller.close();
        } catch {
          // 이미 닫혔을 수 있음
        }
      };

      // 클라이언트 연결 끊김 감지
      req.signal.addEventListener('abort', cleanup);

      try {
        // 즉시 연결 확인 메시지 전송 (EventSource onopen 트리거)
        const connectedMessage = `event: connected\ndata: ${JSON.stringify({ channel, wallet, timestamp: Date.now() })}\n\n`;
        controller.enqueue(encoder.encode(connectedMessage));

        // Gap Filling: 마지막 이벤트 이후의 이벤트를 DB에서 조회
        if (lastEventId || sinceSlot) {
          await sendGapEvents(controller, encoder, {
            lastEventId: lastEventId || undefined,
            sinceSlot: sinceSlot ? parseInt(sinceSlot, 10) : undefined,
            wallet: channel === 'user' ? wallet! : undefined,
          });
        }

        // Redis Pub/Sub 구독 시도
        let useFallback = false;
        const targetChannel =
          channel === 'global'
            ? PUBSUB_CHANNELS.GLOBAL
            : PUBSUB_CHANNELS.USER(wallet!);

        try {
          const client = getPubSubClient();
          
          // subscribe()를 호출하면 자동으로 초기화됨
          // isReady() 체크 없이 직접 subscribe 시도

          unsubscribe = await client.subscribe(targetChannel, async (message: PubSubMessage) => {
            try {
              // User 채널일 때는 해당 wallet의 이벤트만 전송
              if (channel === 'user' && isUserEvent(message)) {
                if (message.targetOwner !== wallet) {
                  return; // 다른 유저의 이벤트는 무시
                }
              }

              // SSE 형식으로 이벤트 전송
              const data = JSON.stringify(message);
              const sseData = `id: ${message.eventId}\ndata: ${data}\n\n`;

              controller.enqueue(encoder.encode(sseData));
            } catch (error) {
              log.error('Failed to send SSE event', error, {
                eventId: message.eventId,
                eventType: message.eventType,
              });
            }
          });
          
        } catch (error) {
          log.warn('Failed to subscribe to Redis Pub/Sub, using fallback polling', {
            error: error instanceof Error ? error.message : String(error),
          });
          useFallback = true;
        }

        // Fallback: DB Polling 모드
        if (useFallback) {
          fallbackPollInterval = startFallbackPolling(controller, encoder, {
            channel,
            wallet: channel === 'user' ? wallet! : undefined,
            lastEventId,
            sinceSlot: sinceSlot ? parseInt(sinceSlot, 10) : undefined,
          });
          // Fallback 모드에서는 Keep-alive만 설정하고 계속 진행
        }

        // Keep-alive 패킷 전송 (30초마다)
        // 첫 keep-alive는 즉시 전송 (연결 확인)
        controller.enqueue(encoder.encode(': keep-alive\n\n'));
        
        keepAliveInterval = setInterval(() => {
          try {
            if (!isClosed) {
              controller.enqueue(encoder.encode(': keep-alive\n\n'));
            }
          } catch (error) {
            log.error('Failed to send keep-alive', error);
            cleanup();
          }
        }, 30000);

      } catch (error) {
        log.error('Failed to establish SSE stream', error);
        const errorData = JSON.stringify({
          error: 'Failed to establish stream',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${errorData}\n\n`)
        );
        await cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx 버퍼링 비활성화
    },
  });
}

/**
 * Gap Filling: 마지막 이벤트 이후의 누락된 이벤트를 DB에서 조회하여 전송
 */
async function sendGapEvents(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  options: {
    lastEventId?: string;
    sinceSlot?: number;
    wallet?: string;
  }
) {
  try {
    // EventStream 테이블에서 Gap Filling 이벤트 조회
    const events = await EventStreamRepository.getGapEvents({
      lastEventId: options.lastEventId,
      sinceSlot: options.sinceSlot,
      targetOwner: options.wallet,
      limit: 100,
    });

    if (events.length > 0) {
      log.info('Gap events retrieved', { count: events.length, wallet: options.wallet });
    }

    // 이벤트 전송
    for (const event of events) {
      const data = JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        payload: event.payload,
        publishedAt: event.publishedAt,
      });
      // event: 필드를 제거하고 항상 기본 message 이벤트로 전송
      const sseData = `id: ${event.eventId}\ndata: ${data}\n\n`;
      controller.enqueue(encoder.encode(sseData));
    }

    if (events.length > 0) {
    }
  } catch (error) {
    log.error('Failed to send gap events', error);
    // Gap filling 실패해도 스트림은 계속 진행
  }
}

/**
 * Fallback: DB Polling 모드
 * Redis 연결이 실패했을 때 DB를 주기적으로 조회하여 이벤트 전송
 * @returns pollIntervalId (cleanup용)
 */
function startFallbackPolling(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  options: {
    channel: string;
    wallet?: string;
    lastEventId?: string | null;
    sinceSlot?: number;
  }
): NodeJS.Timeout {
  let lastPollTime = Date.now();
  let lastEventId = options.lastEventId;
  const pollInterval = 5000; // 5초마다 폴링

  const pollIntervalId = setInterval(async () => {
    try {
      const now = Date.now();
      const events: Array<{
        eventId: string;
        eventType: string;
        payload: unknown;
        publishedAt: number;
      }> = [];

      if (options.channel === 'user' && options.wallet) {
        // User 채널: 최근 이벤트 조회
        const recentOps = await prisma.operationLog.findMany({
          where: {
            caller: options.wallet,
            createdAt: { gt: new Date(lastPollTime) },
          },
          orderBy: { createdAt: 'asc' },
          take: 50,
        });

        const recentCiphertexts = await prisma.ciphertext.findMany({
          where: {
            owner: options.wallet,
            createdAt: { gt: new Date(lastPollTime) },
          },
          orderBy: { createdAt: 'asc' },
          take: 50,
        });

        events.push(
          ...recentOps.map((op) => ({
            eventId: `${op.slot}-${op.signature.substring(0, 8)}-${op.createdAt.getTime()}`,
            eventType: 'user.operation.completed',
            payload: {
              type: 'user.operation.completed',
              operation: op.operation,
              operationType: op.type.toLowerCase() as 'unary' | 'binary' | 'ternary',
              inputHandles: op.inputHandles,
              resultHandle: op.resultHandle || '',
              owner: op.caller,
              signature: op.signature,
              slot: Number(op.slot),
              blockTime: op.blockTime ? Number(op.blockTime) : null,
            },
            publishedAt: op.createdAt.getTime(),
          })),
          ...recentCiphertexts.map((ct) => ({
            eventId: `${ct.handle}-${ct.createdAt.getTime()}`,
            eventType: 'user.ciphertext.confirmed',
            payload: {
              type: 'user.ciphertext.confirmed',
              handle: ct.handle,
              owner: ct.owner,
              clientTag: ct.clientTag || undefined,
              status: 'confirmed' as const,
              signature: '',
              slot: 0,
              blockTime: ct.confirmedAt?.getTime() || ct.createdAt.getTime(),
            },
            publishedAt: ct.confirmedAt?.getTime() || ct.createdAt.getTime(),
          }))
        );
      } else {
        // Global 채널: 최근 모든 이벤트 조회 (간단한 버전)
        // 실제로는 EventStream 테이블이 필요
      }

      // 이벤트 전송 (lastEventId 이후의 것만)
      for (const event of events) {
        if (!lastEventId || event.eventId > lastEventId) {
          const data = JSON.stringify({
            eventId: event.eventId,
            eventType: event.eventType,
            payload: event.payload,
            publishedAt: event.publishedAt,
          });
          const sseData = `id: ${event.eventId}\nevent: ${event.eventType}\ndata: ${data}\n\n`;
          controller.enqueue(encoder.encode(sseData));
          lastEventId = event.eventId;
        }
      }

      lastPollTime = now;
    } catch (error) {
      log.error('Fallback polling error', error);
    }
  }, pollInterval);

  return pollIntervalId;
}

