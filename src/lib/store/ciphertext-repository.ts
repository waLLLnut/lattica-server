/**
 * @file ciphertext-repository.ts
 * @description 서버 사이드 Repository: 암호문 데이터 영구 저장 및 캐싱
 * 
 * 아키텍처 위치:
 * - 계층: Data Access Layer (Repository Pattern)
 * - 스토리지: Redis (캐싱) + PostgreSQL (영구 저장)
 * - 패턴: Look-Aside Caching (Redis -> DB -> Redis Cache Warming)
 * 
 * 책임:
 * 1. 트랜잭션 전송 전 임시 저장 (Redis, TTL: 3분)
 * 2. 온체인 이벤트 감지 시 영구 저장 (PostgreSQL)
 * 3. 조회 시 캐시 우선, 없으면 DB 조회 후 캐시 적재
 * 
 * @module CiphertextRepository
 */

import Redis from 'ioredis';
import { prisma } from '@/lib/db';
import { CiphertextRedisPayload, HexHandle } from '@/types/store';
import { createLogger } from '@/lib/logger';

const log = createLogger('CiphertextRepository');

// ============================================================================
// Configuration
// ============================================================================

/** 싱글톤 Redis 인스턴스 */
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/** Redis TTL 설정 (초 단위) */
const TTL_PENDING = parseInt(process.env.REDIS_TTL_PENDING || '180', 10); // 3분 (트랜잭션 대기)
const TTL_CACHE = parseInt(process.env.REDIS_TTL_CACHE || '600', 10);     // 10분 (확정 후 조회 캐싱)

// ============================================================================
// Redis Connection Event Handlers
// ============================================================================

redis.on('connect', () => {
  log.info('Redis connection established');
});

redis.on('error', (error) => {
  log.error('Redis connection error', error);
});

redis.on('close', () => {
  log.info('Redis connection closed');
});

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * Ciphertext Repository
 * 
 * 암호문 데이터의 생명주기 관리:
 * 1. save()    → Redis 임시 저장 (pending 상태)
 * 2. confirm() → PostgreSQL 영구 저장 + Redis 캐시 업데이트
 * 3. get()     → Look-Aside Pattern (Redis → DB → Redis)
 */
export const CiphertextRepository = {
  /**
   * 암호문 임시 저장 (Redis Only)
   * 
   * 사용자가 트랜잭션을 보내기 직전에 호출됩니다.
   * 온체인 이벤트가 감지되면 `confirm()`으로 영구 저장됩니다.
   * 
   * @param handle - 64자 hex 문자열 (32 bytes)
   * @param data - Base64 인코딩된 암호문 데이터
   * @param owner - Solana PublicKey (Base58)
   * @param clientTag - 클라이언트 태그 (32 bytes hex, optional)
   * 
   * @throws {Error} Redis 연결 실패 시
   * 
   * @example
   * ```typescript
   * await CiphertextRepository.save(
   *   'abc123...',
   *   'base64data...',
   *   'WalletAddress...',
   *   'clientTag...'
   * );
   * ```
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
   * 상태 확정 및 영구 저장
   * 
   * 인덱서가 온체인 이벤트를 감지했을 때 호출됩니다.
   * Redis의 pending 데이터를 PostgreSQL로 이동하고,
   * Redis에는 confirmed 상태로 캐시를 업데이트합니다.
   * 
   * @param handle - 64자 hex 문자열 (32 bytes)
   * 
   * @throws {Error} DB 저장 실패 시
   * 
   * @example
   * ```typescript
   * // Indexer 이벤트 핸들러에서
   * await CiphertextRepository.confirm(handleHex);
   * ```
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
   * 암호문 조회 (Look-Aside Pattern)
   * 
   * 조회 순서:
   * 1. Redis 캐시 확인 (빠른 응답)
   * 2. 캐시 미스 시 PostgreSQL 조회
   * 3. DB에서 조회한 데이터를 Redis에 캐시 적재 (Cache Warming)
   * 
   * @param handle - 64자 hex 문자열 (32 bytes)
   * @returns 암호문 데이터 및 메타데이터, 없으면 null
   * 
   * @example
   * ```typescript
   * const data = await CiphertextRepository.get(handle);
   * if (data) {
   *   console.log(data.data); // Base64 암호문
   * }
   * ```
   */
  async get(handle: HexHandle): Promise<CiphertextRedisPayload | null> {
    const key = `fhe:input:${handle}`;
    
    // 1. Redis 확인 (Cache Hit)
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. DB 확인 (Cache Miss)
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
   * Owner별 암호문 조회 (Cold Start용)
   * 
   * 특정 지갑 주소의 모든 확정된(confirmed) 암호문을 조회합니다.
   * Cold Start 시 스냅샷 데이터로 사용됩니다.
   * 
   * @param owner - 지갑 주소 (Solana PublicKey, Base58)
   * @returns 암호문 데이터 배열
   * 
   * @example
   * ```typescript
   * const items = await CiphertextRepository.getByOwner('WalletAddress...');
   * ```
   */
  async getByOwner(owner: string): Promise<CiphertextRedisPayload[]> {
    // DB에서 owner의 모든 confirmed 암호문 조회
    const records = await prisma.ciphertext.findMany({
      where: {
        owner,
        status: 'confirmed', // 확정된 것만 반환
      },
      orderBy: {
        confirmedAt: 'desc', // 최신순
      },
    });

    // CiphertextRedisPayload 형식으로 변환
    const payloads: CiphertextRedisPayload[] = records.map((record) => ({
      handle: record.handle,
      data: record.data,
      metadata: {
        owner: record.owner,
        clientTag: record.clientTag || '',
        createdAt: record.createdAt.getTime(),
      },
      status: 'confirmed',
    }));

    // Redis 캐시에도 적재 (Cache Warming)
    for (const payload of payloads) {
      const key = `fhe:input:${payload.handle}`;
      await redis.set(key, JSON.stringify(payload), 'EX', TTL_CACHE).catch((err) => {
        log.warn('Failed to cache ciphertext in Redis', { handle: payload.handle, error: err });
      });
    }

    return payloads;
  },

  /**
   * 암호문 삭제
   * 
   * Redis와 PostgreSQL에서 모두 삭제합니다.
   * 주의: 영구 저장된 데이터를 삭제하므로 신중하게 사용해야 합니다.
   * 
   * @param handle - 64자 hex 문자열 (32 bytes)
   * 
   * @example
   * ```typescript
   * await CiphertextRepository.delete(handle);
   * ```
   */
  async delete(handle: HexHandle): Promise<void> {
    const key = `fhe:input:${handle}`;
    await redis.del(key);
    
    // DB에서도 삭제
    try {
      await prisma.ciphertext.delete({ where: { handle } });
      log.info('Ciphertext deleted from both Redis and DB', { handle });
    } catch {
      log.warn('Failed to delete from DB (may not exist)', { handle });
    }
  },
};
