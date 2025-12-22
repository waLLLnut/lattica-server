/**
 * @file indexer-state-repository.ts
 * @description 서버 사이드 Repository: 인덱서 상태 관리 (PostgreSQL)
 * 
 * 아키텍처 위치:
 * - 계층: Data Access Layer (Repository Pattern)
 * - 스토리지: PostgreSQL (영구 저장)
 * - 용도: 인덱서 체크포인트 저장 (서버 재시작 시 복구)
 * 
 * 책임:
 * 1. 마지막 처리된 슬롯/서명 저장 (체크포인트)
 * 2. 서버 재시작 시 복구 지점 제공
 * 3. 인덱서의 중단 지점 추적
 * 
 * @module IndexerStateRepository
 */

import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('IndexerStateRepository');

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * Indexer State Repository
 * 
 * 인덱서의 처리 상태를 영구 저장하여, 서버 재시작 후에도
 * 마지막 처리 지점부터 이어서 인덱싱할 수 있도록 합니다.
 */
export const IndexerStateRepository = {
  /**
   * 마지막 처리된 슬롯 조회
   * 
   * 인덱서가 마지막으로 처리한 블록 슬롯 번호를 반환합니다.
   * 서버 재시작 시 이 슬롯부터 이어서 인덱싱을 시작합니다.
   * 
   * @param programId - 모니터링 중인 Solana 프로그램 ID
   * @returns 마지막 처리된 슬롯 번호 (없으면 0)
   * 
   * @example
   * ```typescript
   * const lastSlot = await IndexerStateRepository.getLastSlot(programId);
   * if (lastSlot > 0) {
   *   indexer.setLastProcessedSlot(lastSlot);
   * }
   * ```
   */
  async getLastSlot(programId: string): Promise<number> {
    try {
      const state = await prisma.indexerState.findUnique({
        where: { programId },
      });
      return state ? Number(state.lastSlot) : 0;
    } catch (e) {
      log.error('Failed to get last slot', e);
      return 0; // 에러 시 0 반환 (처음부터 시작)
    }
  },

  /**
   * 마지막 처리된 트랜잭션 서명 조회
   * 
   * 인덱서가 마지막으로 처리한 트랜잭션의 서명을 반환합니다.
   * 슬롯과 함께 사용하여 정확한 복구 지점을 제공합니다.
   * 
   * @param programId - 모니터링 중인 Solana 프로그램 ID
   * @returns 마지막 처리된 트랜잭션 서명 (없으면 null)
   * 
   * @example
   * ```typescript
   * const lastSignature = await IndexerStateRepository.getLastSignature(programId);
   * if (lastSignature) {
   *   log.info('Resuming from', { signature: lastSignature });
   * }
   * ```
   */
  async getLastSignature(programId: string): Promise<string | null> {
    try {
      const state = await prisma.indexerState.findUnique({
        where: { programId },
      });
      return state?.lastSignature || null;
    } catch (e) {
      log.error('Failed to get last signature', e);
      return null;
    }
  },

  /**
   * 인덱서 상태 업데이트 (체크포인트 저장)
   * 
   * 이벤트 처리 후 호출되어 현재 처리 지점을 저장합니다.
   * Upsert 패턴으로 프로그램별 상태를 유지합니다.
   * 
   * @param programId - 모니터링 중인 Solana 프로그램 ID
   * @param slot - 처리된 블록 슬롯 번호
   * @param signature - 처리된 트랜잭션 서명
   * 
   * @throws {Error} DB 저장 실패 시
   * 
   * @example
   * ```typescript
   * // 이벤트 처리 후
   * await IndexerStateRepository.updateState(
   *   programId,
   *   event.slot,
   *   event.signature
   * );
   * ```
   */
  async updateState(programId: string, slot: number, signature: string): Promise<void> {
    try {
      await prisma.indexerState.upsert({
        where: { programId },
        update: {
          lastSlot: BigInt(slot),
          lastSignature: signature,
        },
        create: {
          programId,
          lastSlot: BigInt(slot),
          lastSignature: signature,
        },
      });
      // 너무 잦은 로그 방지를 위해 디버그 레벨 권장
      log.debug('Indexer state updated', { slot, signature });
    } catch (e) {
      log.error('Failed to update indexer state', e);
      throw e; // 에러를 다시 throw하여 상위에서 처리 가능하도록
    }
  },
};
