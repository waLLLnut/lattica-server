// src/types/store.ts
// Redis와 DB 공통 타입 정의

import type { Ciphertext, OperationLog, IndexerState } from '@prisma/client';

// Redis와 DB 공통으로 사용할 기본 데이터 구조
export type HexHandle = string; // "010203... (64 chars hex)"

// Redis에 저장될 Payload (Metadata 포함)
export interface CiphertextRedisPayload {
  handle: HexHandle;
  data: string; // Base64
  metadata: {
    owner: string;
    clientTag: string;
    createdAt: number;
  };
  status: 'pending' | 'confirmed';
}

// DB에서 조회된 데이터 (Prisma 타입 확장)
export type CiphertextRecord = Ciphertext;

// 연산 로그 타입 (이벤트 핸들러용)
export interface OperationLogData {
  signature: string;
  slot: number;
  blockTime: number | null;
  caller: string;
  type: 'Unary' | 'Binary' | 'Ternary';
  operation: string;
  inputHandles: string[];
  resultHandle?: string;
}

// 인덱서 상태 타입
export type IndexerStateRecord = IndexerState;


