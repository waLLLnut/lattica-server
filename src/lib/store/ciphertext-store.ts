// src/lib/store/ciphertext-store.ts
// 하이브리드 스토어: Redis (임시) + PostgreSQL (영구 저장)

import Redis from 'ioredis';
import { prisma } from '@/lib/db';
import { CiphertextRedisPayload, HexHandle } from '@/types/store';
import { createLogger } from '@/lib/logger';

const log = createLogger('CiphertextStore');

// 싱글톤 Redis 인스턴스
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Redis 연결 이벤트 처리
redis.on('connect', () => {
  log.info('Redis connection established');
});

redis.on('error', (error) => {
  log.error('Redis connection error', error);
});

redis.on('close', () => {
  log.info('Redis connection closed');
});

const TTL_PENDING = 3600; // 1시간 (트랜잭션 대기)
const TTL_CACHE = 600;    // 10분 (확정 후 조회 캐싱)

export const CiphertextStore = {
  /**
   * [API] 암호문 임시 저장 (Redis Only)
   * 사용자가 트랜잭션을 보내기 직전에 호출
   */
  async save(
    handle: HexHandle,
    data: string,
    owner: string,
    clientTag: string
  ): Promise<void> {
    const payload: CiphertextRedisPayload = {
      handle,
      data,
      metadata: { owner, clientTag, createdAt: Date.now() },
      status: 'pending',
    };

    const key = `fhe:input:${handle}`;
    await redis.set(key, JSON.stringify(payload), 'EX', TTL_PENDING);
    
    log.info('Ciphertext cached (pending)', { handle, owner });
  },

  /**
   * [Indexer] 상태 확정 및 영구 저장
   * 온체인 이벤트 감지 시 호출 -> DB 이동
   */
  async confirm(handle: HexHandle): Promise<void> {
    const key = `fhe:input:${handle}`;
    const raw = await redis.get(key);

    if (!raw) {
      log.warn('Pending ciphertext not found in Redis during confirmation', { handle });
      return;
    }

    const payload: CiphertextRedisPayload = JSON.parse(raw);

    try {
      // 1. PostgreSQL 영구 저장 (Upsert로 중복 방지)
      await prisma.ciphertext.upsert({
        where: { handle },
        update: { 
          status: 'confirmed', 
          confirmedAt: new Date() 
        },
        create: {
          handle: payload.handle,
          data: payload.data,
          owner: payload.metadata.owner,
          clientTag: payload.metadata.clientTag,
          status: 'confirmed',
          confirmedAt: new Date(),
        },
      });

      // 2. Redis 상태 업데이트 (캐시 모드로 전환)
      payload.status = 'confirmed';
      await redis.set(key, JSON.stringify(payload), 'EX', TTL_CACHE);

      log.info('Ciphertext confirmed and persisted', { handle });
    } catch (error) {
      log.error('Failed to persist ciphertext', error);
      throw error;
    }
  },

  /**
   * [API] 조회 (Look-Aside Pattern)
   * Redis -> 없으면 DB -> Redis 적재 -> 반환
   */
  async get(handle: HexHandle): Promise<CiphertextRedisPayload | null> {
    const key = `fhe:input:${handle}`;
    
    // 1. Redis 확인
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. DB 확인
    const record = await prisma.ciphertext.findUnique({
      where: { handle },
    });

    if (!record) return null;

    // 3. Redis에 다시 적재 (Cache Warming)
    const payload: CiphertextRedisPayload = {
      handle: record.handle,
      data: record.data,
      metadata: {
        owner: record.owner,
        clientTag: record.clientTag || '',
        createdAt: record.createdAt.getTime(),
      },
      status: 'confirmed',
    };
    
    await redis.set(key, JSON.stringify(payload), 'EX', TTL_CACHE);
    
    return payload;
  },

  /**
   * 암호문 삭제 (선택적)
   */
  async delete(handle: HexHandle): Promise<void> {
    const key = `fhe:input:${handle}`;
    await redis.del(key);
    
    // DB에서도 삭제 (선택적)
    try {
      await prisma.ciphertext.delete({ where: { handle } });
      log.info('Ciphertext deleted from both Redis and DB', { handle });
    } catch {
      log.warn('Failed to delete from DB (may not exist)', { handle });
    }
  },
};
