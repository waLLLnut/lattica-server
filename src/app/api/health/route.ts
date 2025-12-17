// src/app/api/health/route.ts
// Indexer Health Check 엔드포인트
// 인덱서 상태, Redis 연결 상태 등을 확인

import { NextResponse } from 'next/server';
import { getPubSubClient } from '@/lib/redis/pubsub';
import { getIndexer } from '@/lib/indexer';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:Health');

/**
 * Health Check 엔드포인트
 * 
 * Returns:
 * - indexer: 인덱서 상태 정보
 * - redis: Redis Pub/Sub 연결 상태
 * - status: 전체 상태 ('healthy' | 'degraded' | 'unhealthy')
 */
export async function GET() {
  try {
    const health: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      indexer: {
        running: boolean;
        mode?: string;
        lastSlot?: number;
        error?: string;
      };
      redis: {
        connected: boolean;
        error?: string;
      };
      timestamp: number;
    } = {
      status: 'healthy',
      indexer: {
        running: false,
      },
      redis: {
        connected: false,
      },
      timestamp: Date.now(),
    };

    // 1. Indexer 상태 확인
    try {
      const indexer = await getIndexer();
      const stats = indexer.getStats();

      health.indexer = {
        running: stats.isRunning,
        mode: stats.currentMode || undefined,
        lastSlot: stats.lastProcessedSlot,
      };

      if (!stats.isRunning) {
        health.status = 'degraded';
        health.indexer.error = 'Indexer is not running';
      }
    } catch (error) {
      health.status = 'unhealthy';
      health.indexer.error =
        error instanceof Error ? error.message : 'Failed to get indexer status';
      log.error('Failed to get indexer status', error);
    }

    // 2. Redis Pub/Sub 연결 상태 확인
    try {
      const client = getPubSubClient();
      health.redis.connected = client.isReady();

      if (!client.isReady()) {
        health.status = health.status === 'unhealthy' ? 'unhealthy' : 'degraded';
        health.redis.error = 'Redis Pub/Sub client is not ready';
      }
    } catch (error) {
      health.status = 'unhealthy';
      health.redis.error =
        error instanceof Error ? error.message : 'Failed to check Redis status';
      log.error('Failed to check Redis status', error);
    }

    // 3. HTTP 상태 코드 결정
    const statusCode =
      health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    log.error('Health check failed', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
      { status: 503 }
    );
  }
}

