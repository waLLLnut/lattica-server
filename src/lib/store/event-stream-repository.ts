/**
 * @file event-stream-repository.ts
 * @description 서버 사이드 Repository: 이벤트 스트림 저장 (Gap Filling용)
 * 
 * 아키텍처 위치:
 * - 계층: Data Access Layer (Repository Pattern)
 * - 스토리지: PostgreSQL (영구 저장)
 * - 용도: SSE Gap Filling (연결 끊김 후 재연결 시 놓친 이벤트 조회)
 * 
 * 책임:
 * 1. Pub/Sub 이벤트를 EventStream 테이블에 저장
 * 2. Gap Filling용 이벤트 조회 (lastEventId 기반)
 * 
 * @module EventStreamRepository
 */

import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import type { PubSubMessage } from '@/types/pubsub';

const log = createLogger('EventStreamRepository');

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * Event Stream Repository
 * 
 * SSE Gap Filling을 위한 이벤트 스트림 저장 및 조회
 */
export const EventStreamRepository = {
  /**
   * 이벤트 스트림 저장
   * 
   * Pub/Sub 이벤트를 EventStream 테이블에 저장합니다.
   * Gap Filling 시 사용됩니다.
   * 
   * @param message - Pub/Sub 메시지
   */
  async save(message: PubSubMessage): Promise<void> {
    try {
      await prisma.eventStream.create({
        data: {
          eventId: message.eventId,
          eventType: message.eventType,
          targetOwner: 'targetOwner' in message ? message.targetOwner : null,
          payload: message as unknown as object, // JSON 타입으로 저장
          signature: 'signature' in message && typeof message.signature === 'string' ? message.signature : null,
          slot: 'slot' in message && typeof message.slot === 'number' ? BigInt(message.slot) : null,
        },
      });

      log.debug('Event stream saved', { eventId: message.eventId, eventType: message.eventType });
    } catch (e) {
      // Unique constraint violation은 무시 (중복 저장 방지)
      if (e instanceof Error && e.message.includes('Unique constraint')) {
        log.debug('Event stream already exists', { eventId: message.eventId });
        return;
      }
      log.error('Failed to save event stream', e);
      throw e;
    }
  },

  /**
   * Gap Filling용 이벤트 조회
   * 
   * lastEventId 이후의 이벤트를 조회합니다.
   * 
   * @param options - 조회 옵션
   * @returns 이벤트 배열
   */
  async getGapEvents(options: {
    lastEventId?: string;
    sinceSlot?: number;
    targetOwner?: string;
    limit?: number;
  }): Promise<Array<{
    eventId: string;
    eventType: string;
    payload: unknown;
    publishedAt: number;
  }>> {
    try {
      const limit = options.limit || 100;

      const where: {
        targetOwner?: string;
        slot?: { gte: bigint };
        eventId?: { gt: string };
      } = {};

      if (options.targetOwner) {
        where.targetOwner = options.targetOwner;
      }

      if (options.sinceSlot) {
        where.slot = { gte: BigInt(options.sinceSlot) };
      }

      if (options.lastEventId) {
        // eventId는 타임스탬프 기반이므로 문자열 비교로 정렬 가능
        where.eventId = { gt: options.lastEventId };
      }

      const events = await prisma.eventStream.findMany({
        where,
        orderBy: { createdAt: 'asc' }, // 오래된 것부터
        take: limit,
      });

      return events.map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        payload: event.payload,
        publishedAt: event.createdAt.getTime(),
      }));
    } catch (e) {
      log.error('Failed to fetch gap events', e);
      throw e;
    }
  },
};

