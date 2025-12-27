/**
 * @file handle-dependency-repository.ts
 * @description 서버 사이드 Repository: 핸들 의존성 그래프 저장
 * 
 * 아키텍처 위치:
 * - 계층: Data Access Layer (Repository Pattern)
 * - 스토리지: PostgreSQL (영구 저장)
 * - 용도: Lineage Tracking (연산 결과와 입력 핸들 간의 관계 추적)
 * 
 * 책임:
 * 1. 연산 결과 핸들과 입력 핸들 간의 의존성 저장
 * 2. 핸들별 의존성 조회 (Lineage Tracking)
 * 
 * @module HandleDependencyRepository
 */

import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import type {
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
} from '@/types/indexer';

const log = createLogger('HandleDependencyRepository');

// ============================================================================
// Utilities
// ============================================================================

/**
 * Buffer나 number[]를 Hex String으로 변환
 */
const toHex = (data: number[] | Uint8Array): string => {
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString('hex');
  }
  return Buffer.from(data).toString('hex');
};

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * Handle Dependency Repository
 * 
 * 연산 결과 핸들과 입력 핸들 간의 의존성 관계를 저장하고 조회합니다.
 */
export const HandleDependencyRepository = {
  /**
   * 단항 연산 의존성 저장
   * 
   * @param event - 단항 연산 이벤트
   */
  async saveUnary(event: Fhe16UnaryOpRequestedEvent): Promise<void> {
    try {
      const outputHandleId = toHex(event.resultHandle);
      const inputHandle = toHex(event.inputHandle);

      await prisma.handleDependency.upsert({
        where: { outputHandleId },
        update: {
          inputHandles: [inputHandle],
          operation: event.op,
          operationType: 'Unary',
          signature: event.signature,
          slot: BigInt(event.slot),
        },
        create: {
          outputHandleId,
          inputHandles: [inputHandle],
          operation: event.op,
          operationType: 'Unary',
          signature: event.signature,
          slot: BigInt(event.slot),
        },
      });

      log.debug('Unary dependency saved', { outputHandleId, operation: event.op });
    } catch (e) {
      log.error('Failed to save unary dependency', e);
      throw e;
    }
  },

  /**
   * 이항 연산 의존성 저장
   * 
   * @param event - 이항 연산 이벤트
   */
  async saveBinary(event: Fhe16BinaryOpRequestedEvent): Promise<void> {
    try {
      const outputHandleId = toHex(event.resultHandle);
      const lhsHandle = toHex(event.lhsHandle);
      const rhsHandle = toHex(event.rhsHandle);

      await prisma.handleDependency.upsert({
        where: { outputHandleId },
        update: {
          inputHandles: [lhsHandle, rhsHandle],
          operation: event.op,
          operationType: 'Binary',
          signature: event.signature,
          slot: BigInt(event.slot),
        },
        create: {
          outputHandleId,
          inputHandles: [lhsHandle, rhsHandle],
          operation: event.op,
          operationType: 'Binary',
          signature: event.signature,
          slot: BigInt(event.slot),
        },
      });

      log.debug('Binary dependency saved', { outputHandleId, operation: event.op });
    } catch (e) {
      log.error('Failed to save binary dependency', e);
      throw e;
    }
  },

  /**
   * 삼항 연산 의존성 저장
   * 
   * @param event - 삼항 연산 이벤트
   */
  async saveTernary(event: Fhe16TernaryOpRequestedEvent): Promise<void> {
    try {
      const outputHandleId = toHex(event.resultHandle);
      const aHandle = toHex(event.aHandle);
      const bHandle = toHex(event.bHandle);
      const cHandle = toHex(event.cHandle);

      await prisma.handleDependency.upsert({
        where: { outputHandleId },
        update: {
          inputHandles: [aHandle, bHandle, cHandle],
          operation: event.op,
          operationType: 'Ternary',
          signature: event.signature,
          slot: BigInt(event.slot),
        },
        create: {
          outputHandleId,
          inputHandles: [aHandle, bHandle, cHandle],
          operation: event.op,
          operationType: 'Ternary',
          signature: event.signature,
          slot: BigInt(event.slot),
        },
      });

      log.debug('Ternary dependency saved', { outputHandleId, operation: event.op });
    } catch (e) {
      log.error('Failed to save ternary dependency', e);
      throw e;
    }
  },

  /**
   * 결과 핸들로 의존성 조회
   * 
   * @param outputHandleId - 결과 핸들
   * @returns 의존성 정보 또는 null
   */
  async getByOutputHandle(outputHandleId: string) {
    try {
      const dependency = await prisma.handleDependency.findUnique({
        where: { outputHandleId },
      });

      if (!dependency) return null;

      return {
        ...dependency,
        slot: dependency.slot ? Number(dependency.slot) : null,
      };
    } catch (e) {
      log.error('Failed to fetch dependency by output handle', e);
      throw e;
    }
  },
};


