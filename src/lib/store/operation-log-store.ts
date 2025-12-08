// src/lib/store/operation-log-store.ts
// 블록체인 이벤트를 PostgreSQL에 로그로 저장

import { prisma } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import type {
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
} from '@/types/indexer';

const log = createLogger('OperationLogStore');

// Buffer나 number[]를 Hex String으로 변환하는 유틸리티
const toHex = (data: number[] | Uint8Array): string => {
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString('hex');
  }
  return Buffer.from(data).toString('hex');
};

export const OperationLogStore = {
  /**
   * 단항 연산(Unary) 로그 저장
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
};


