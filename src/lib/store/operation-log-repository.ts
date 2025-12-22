/**
 * @file operation-log-repository.ts
 * @description 서버 사이드 Repository: 블록체인 연산 로그 저장 (PostgreSQL)
 * 
 * 아키텍처 위치:
 * - 계층: Data Access Layer (Repository Pattern)
 * - 스토리지: PostgreSQL (영구 저장)
 * - 용도: 연산 이력 조회 및 추적성(Traceability) 제공
 * 
 * 책임:
 * 1. 온체인 연산 이벤트를 로그로 저장 (Unary, Binary, Ternary)
 * 2. 사용자별 연산 이력 조회
 * 3. 핸들별 연산 추적 (Lineage Tracking)
 * 
 * @module OperationLogRepository
 */

import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import type {
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
} from '@/types/indexer';

const log = createLogger('OperationLogRepository');

// ============================================================================
// Utilities
// ============================================================================

/**
 * Buffer나 number[]를 Hex String으로 변환
 * 
 * @param data - Uint8Array 또는 number[]
 * @returns 64자 hex 문자열 (32 bytes)
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
 * Operation Log Repository
 * 
 * 블록체인에서 발생한 FHE 연산 이벤트를 로그로 저장하고,
 * 사용자별 이력 조회 및 핸들 추적 기능을 제공합니다.
 */
export const OperationLogRepository = {
  /**
   * 단항 연산(Unary) 로그 저장
   * 
   * NOT, ABS, NEG 등의 단항 연산 이벤트를 저장합니다.
   * 
   * @param event - 단항 연산 이벤트 데이터
   * @throws {Error} DB 저장 실패 시
   * 
   * @example
   * ```typescript
   * await OperationLogRepository.saveUnary({
   *   signature: '...',
   *   slot: 12345,
   *   op: 'NOT',
   *   inputHandle: [...],
   *   resultHandle: [...],
   *   ...
   * });
   * ```
   */
  async saveUnary(event: Fhe16UnaryOpRequestedEvent): Promise<void> {
    try {
      await prisma.operationLog.create({
        data: {
          signature: event.signature,
          slot: BigInt(event.slot), // BigInt 변환 주의
          blockTime: event.blockTime ? BigInt(event.blockTime) : null,
          caller: event.caller,
          type: 'Unary',
          operation: event.op, // e.g., "NOT", "ABS"
          inputHandles: [toHex(event.inputHandle)],
          resultHandle: toHex(event.resultHandle),
        },
      });
      log.info('Unary op logged', { signature: event.signature, op: event.op });
    } catch (e) {
      log.error('Failed to log unary op', e);
      throw e; // 에러를 다시 throw하여 상위에서 처리 가능하도록
    }
  },

  /**
   * 이항 연산(Binary) 로그 저장
   * 
   * ADD, SUB, AND, OR 등의 이항 연산 이벤트를 저장합니다.
   * 
   * @param event - 이항 연산 이벤트 데이터
   * @throws {Error} DB 저장 실패 시
   * 
   * @example
   * ```typescript
   * await OperationLogRepository.saveBinary({
   *   signature: '...',
   *   slot: 12345,
   *   op: 'ADD',
   *   lhsHandle: [...],
   *   rhsHandle: [...],
   *   resultHandle: [...],
   *   ...
   * });
   * ```
   */
  async saveBinary(event: Fhe16BinaryOpRequestedEvent): Promise<void> {
    try {
      await prisma.operationLog.create({
        data: {
          signature: event.signature,
          slot: BigInt(event.slot),
          blockTime: event.blockTime ? BigInt(event.blockTime) : null,
          caller: event.caller,
          type: 'Binary',
          operation: event.op, // e.g., "ADD", "SUB"
          inputHandles: [toHex(event.lhsHandle), toHex(event.rhsHandle)],
          resultHandle: toHex(event.resultHandle),
        },
      });
      log.info('Binary op logged', { signature: event.signature, op: event.op });
    } catch (e) {
      log.error('Failed to log binary op', e);
      throw e;
    }
  },

  /**
   * 삼항 연산(Ternary) 로그 저장
   * 
   * ADD3, SELECT, MAJ3 등의 삼항 연산 이벤트를 저장합니다.
   * 
   * @param event - 삼항 연산 이벤트 데이터
   * @throws {Error} DB 저장 실패 시
   * 
   * @example
   * ```typescript
   * await OperationLogRepository.saveTernary({
   *   signature: '...',
   *   slot: 12345,
   *   op: 'ADD3',
   *   aHandle: [...],
   *   bHandle: [...],
   *   cHandle: [...],
   *   resultHandle: [...],
   *   ...
   * });
   * ```
   */
  async saveTernary(event: Fhe16TernaryOpRequestedEvent): Promise<void> {
    try {
      await prisma.operationLog.create({
        data: {
          signature: event.signature,
          slot: BigInt(event.slot),
          blockTime: event.blockTime ? BigInt(event.blockTime) : null,
          caller: event.caller,
          type: 'Ternary',
          operation: event.op, // e.g., "SELECT", "ADD3"
          inputHandles: [
            toHex(event.aHandle),
            toHex(event.bHandle),
            toHex(event.cHandle),
          ],
          resultHandle: toHex(event.resultHandle),
        },
      });
      log.info('Ternary op logged', { signature: event.signature, op: event.op });
    } catch (e) {
      log.error('Failed to log ternary op', e);
      throw e;
    }
  },

  /**
   * 특정 사용자의 연산 기록 조회
   * 
   * 지갑 주소별로 연산 이력을 조회합니다.
   * 최신순으로 정렬되어 반환됩니다.
   * 
   * @param caller - 지갑 주소 (Solana PublicKey, Base58)
   * @param limit - 조회할 최대 개수 (기본값: 20, 최대: 100)
   * @param offset - 페이지네이션 오프셋 (기본값: 0)
   * @returns 연산 로그 배열 (BigInt는 number로 변환됨)
   * 
   * @throws {Error} DB 조회 실패 시
   * 
   * @example
   * ```typescript
   * const history = await OperationLogRepository.getHistoryByCaller(
   *   'WalletAddress...',
   *   20,  // limit
   *   0    // offset
   * );
   * ```
   */
  async getHistoryByCaller(
    caller: string,
    limit = 20,
    offset = 0
  ) {
    try {
      const logs = await prisma.operationLog.findMany({
        where: { caller },
        orderBy: { blockTime: 'desc' }, // 최신순
        take: limit,
        skip: offset,
        select: {
          signature: true,
          type: true,
          operation: true,
          blockTime: true,
          resultHandle: true,
          inputHandles: true,
          slot: true,
          createdAt: true,
        },
      });

      // BigInt를 number로 변환 (JSON 직렬화를 위해)
      return logs.map((log) => ({
        ...log,
        slot: Number(log.slot),
        blockTime: log.blockTime ? Number(log.blockTime) : null,
      }));
    } catch (e) {
      log.error('Failed to fetch operation history', e);
      throw e;
    }
  },

  /**
   * 특정 핸들이 결과로 생성된 연산 찾기 (Lineage Tracking)
   * 
   * 주어진 핸들이 어떤 연산의 결과인지 추적합니다.
   * 의존성 그래프 구축 및 디버깅에 유용합니다.
   * 
   * @param handle - 결과 핸들 (64자 hex 문자열)
   * @returns 연산 로그 (없으면 null, BigInt는 number로 변환됨)
   * 
   * @throws {Error} DB 조회 실패 시
   * 
   * @example
   * ```typescript
   * const operation = await OperationLogRepository.getOperationByResultHandle(handle);
   * if (operation) {
   *   console.log('Created by:', operation.operation);
   *   console.log('Inputs:', operation.inputHandles);
   * }
   * ```
   */
  async getOperationByResultHandle(handle: string) {
    try {
      const log = await prisma.operationLog.findFirst({
        where: { resultHandle: handle },
        orderBy: { blockTime: 'desc' },
      });

      if (!log) return null;

      // BigInt를 number로 변환
      return {
        ...log,
        slot: Number(log.slot),
        blockTime: log.blockTime ? Number(log.blockTime) : null,
      };
    } catch (e) {
      log.error('Failed to fetch operation by result handle', e);
      throw e;
    }
  },
};
