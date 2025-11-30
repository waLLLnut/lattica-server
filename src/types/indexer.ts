// src/types/indexer.ts
// Indexer 관련 타입 정의

// 이벤트 타입 정의
export interface BaseEvent {
  signature: string;
  slot: number;
  blockTime: number | null;
  caller: string;
}

export interface InputHandleRegisteredEvent extends BaseEvent {
  type: "InputHandleRegistered";
  handle: number[];
  clientTag: number[];
}

export interface Fhe16UnaryOpRequestedEvent extends BaseEvent {
  type: "Fhe16UnaryOpRequested";
  op: string;
  inputHandle: number[];
  resultHandle: number[];
}

export interface Fhe16BinaryOpRequestedEvent extends BaseEvent {
  type: "Fhe16BinaryOpRequested";
  op: string;
  lhsHandle: number[];
  rhsHandle: number[];
  resultHandle: number[];
}

export interface Fhe16TernaryOpRequestedEvent extends BaseEvent {
  type: "Fhe16TernaryOpRequested";
  op: string;
  aHandle: number[];
  bHandle: number[];
  cHandle: number[];
  resultHandle: number[];
}

export type IndexedEvent =
  | InputHandleRegisteredEvent
  | Fhe16UnaryOpRequestedEvent
  | Fhe16BinaryOpRequestedEvent
  | Fhe16TernaryOpRequestedEvent;

// 설정 타입
export type Network = "localnet" | "devnet" | "mainnet-beta";
export type Commitment = "processed" | "confirmed" | "finalized";

export interface IndexerConfig {
  network: Network;
  programId: string;
  rpcEndpoint?: string;
  wsEndpoint?: string;
  commitment?: Commitment;
  pollInterval?: number;
  maxBatches?: number;
}

export interface EventHandlers {
  onInputHandleRegistered?: (event: InputHandleRegisteredEvent) => void | Promise<void>;
  onFhe16UnaryOpRequested?: (event: Fhe16UnaryOpRequestedEvent) => void | Promise<void>;
  onFhe16BinaryOpRequested?: (event: Fhe16BinaryOpRequestedEvent) => void | Promise<void>;
  onFhe16TernaryOpRequested?: (event: Fhe16TernaryOpRequestedEvent) => void | Promise<void>;
  onError?: (error: Error) => void;
  onReconnect?: () => void;
}

export type IndexerMode = "websocket" | "polling";

// Anchor Idl 타입 재export
export type { Idl } from "@coral-xyz/anchor";

