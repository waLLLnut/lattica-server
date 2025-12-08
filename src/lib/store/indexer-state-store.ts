// src/lib/store/indexer-state-store.ts
// 인덱서 상태 관리 (서버 재시작 시 복구용)

import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('IndexerStateStore');

export const IndexerStateStore = {
  /**
   * 마지막 처리된 슬롯 가져오기
   * @returns 처리된 마지막 slot 번호 (없으면 0)
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
   * 마지막 처리된 signature 가져오기
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
   * 처리된 슬롯 업데이트 (체크포인트)
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


