// src/types/pubsub.ts
// Redis Pub/Sub 이벤트 타입 정의

import type {
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
  IndexedEvent,
} from './indexer';

/**
 * Redis Pub/Sub 채널명
 */
export const PUBSUB_CHANNELS = {
  /** 
   * Global 채널: 기존 indexer가 구독하는 모든 온체인 이벤트
   * - 모든 InputHandleRegistered 이벤트
   * - 모든 Fhe16UnaryOpRequested 이벤트
   * - 모든 Fhe16BinaryOpRequested 이벤트
   * - 모든 Fhe16TernaryOpRequested 이벤트
   * - 인덱서 상태 변경 이벤트
   */
  GLOBAL: 'channel:global',
  
  /** 
   * User 채널: 각 유저의 온체인 이벤트 로그와 등록한 ciphertext의 tracking 관련 이벤트
   * - 해당 유저가 caller인 모든 온체인 이벤트
   * - 해당 유저가 등록한 ciphertext의 상태 변경 이벤트
   */
  USER: (walletAddress: string) => `channel:user:${walletAddress}`,
} as const;

/**
 * Global 채널 이벤트 타입
 * 기존 indexer가 구독하는 모든 온체인 이벤트를 그대로 전달
 */
export type GlobalEventType =
  | 'indexer.InputHandleRegistered'
  | 'indexer.Fhe16UnaryOpRequested'
  | 'indexer.Fhe16BinaryOpRequested'
  | 'indexer.Fhe16TernaryOpRequested'
  | 'indexer.status'
  | 'indexer.error';

/**
 * User 채널 이벤트 타입
 * 각 유저의 온체인 이벤트 로그와 등록한 ciphertext의 tracking 관련 이벤트
 */
export type UserEventType =
  | 'user.ciphertext.registered' // 유저가 등록한 ciphertext가 온체인에 등록됨
  | 'user.ciphertext.confirmed' // 유저가 등록한 ciphertext가 확정됨
  | 'user.operation.completed' // 유저가 요청한 연산이 완료됨
  | 'user.operation.failed'; // 유저가 요청한 연산이 실패함

/**
 * Global 채널 메시지 페이로드
 * 온체인 이벤트를 그대로 전달하거나 인덱서 상태 정보를 포함
 */
export type GlobalEventPayload =
  | {
      type: 'indexer.InputHandleRegistered';
      event: InputHandleRegisteredEvent;
    }
  | {
      type: 'indexer.Fhe16UnaryOpRequested';
      event: Fhe16UnaryOpRequestedEvent;
    }
  | {
      type: 'indexer.Fhe16BinaryOpRequested';
      event: Fhe16BinaryOpRequestedEvent;
    }
  | {
      type: 'indexer.Fhe16TernaryOpRequested';
      event: Fhe16TernaryOpRequestedEvent;
    }
  | {
      type: 'indexer.status';
      status: 'running' | 'stopped' | 'error';
      lastSlot?: number;
      lastSignature?: string;
      error?: string;
    }
  | {
      type: 'indexer.error';
      error: string;
      lastSlot?: number;
      lastSignature?: string;
    };

/**
 * User 채널 메시지 페이로드
 * 유저 관련 이벤트와 ciphertext tracking 정보
 */
export type UserEventPayload =
  | {
      type: 'user.ciphertext.registered';
      handle: string; // Hex handle
      owner: string; // 지갑 주소
      clientTag?: string; // 클라이언트 태그 (hex)
      signature: string; // 트랜잭션 서명
      slot: number;
      blockTime: number | null;
    }
  | {
      type: 'user.ciphertext.confirmed';
      handle: string; // Hex handle
      owner: string; // 지갑 주소
      clientTag?: string; // 클라이언트 태그 (hex)
      status: 'confirmed';
      signature: string; // 트랜잭션 서명
      slot: number;
      blockTime: number | null;
    }
  | {
      type: 'user.operation.completed';
      operation: string; // 연산 타입 (ADD, SUB, AND, OR, ADD3 등)
      operationType: 'unary' | 'binary' | 'ternary';
      inputHandles: string[]; // 입력 핸들 배열 (hex)
      resultHandle: string; // 결과 핸들 (hex)
      owner: string; // 지갑 주소
      signature: string; // 트랜잭션 서명
      slot: number;
      blockTime: number | null;
    }
  | {
      type: 'user.operation.failed';
      operation?: string; // 연산 타입 (실패한 경우)
      operationType?: 'unary' | 'binary' | 'ternary';
      owner: string; // 지갑 주소
      signature: string; // 트랜잭션 서명
      slot: number;
      blockTime: number | null;
      error: string; // 에러 메시지
    };

/**
 * Global 채널 Pub/Sub 메시지
 */
export interface GlobalPubSubMessage {
  eventId: string; // 고유 이벤트 ID (timestamp-based UUID)
  eventType: GlobalEventType;
  payload: GlobalEventPayload;
  publishedAt: number; // Unix timestamp (ms)
}

/**
 * User 채널 Pub/Sub 메시지
 */
export interface UserPubSubMessage {
  eventId: string; // 고유 이벤트 ID (timestamp-based UUID)
  eventType: UserEventType;
  targetOwner: string; // 대상 지갑 주소
  payload: UserEventPayload;
  publishedAt: number; // Unix timestamp (ms)
}

/**
 * Pub/Sub 메시지 (Union 타입)
 */
export type PubSubMessage = GlobalPubSubMessage | UserPubSubMessage;

/**
 * Global 채널 이벤트 타입 가드
 */
export function isGlobalEvent(message: PubSubMessage): message is GlobalPubSubMessage {
  return 'targetOwner' in message === false;
}

/**
 * User 채널 이벤트 타입 가드
 */
export function isUserEvent(message: PubSubMessage): message is UserPubSubMessage {
  return 'targetOwner' in message === true;
}

