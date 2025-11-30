// src/lib/indexer/index.ts

import { HostProgramsIndexer } from "./indexer";
import type { IndexerConfig, EventHandlers } from "./indexer";
import type { Idl as AnchorIdl } from "@coral-xyz/anchor";
import idl from "./host_programs.json";

export { HostProgramsIndexer } from "./indexer";
export type {
  IndexedEvent,
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
  IndexerConfig,
  EventHandlers,
  IndexerMode,
} from "./indexer";

/**
 * Next.js 환경에서 싱글톤 인덱서 인스턴스 관리
 * globalThis를 사용하여 개발 모드에서도 단일 인스턴스 보장
 */
const globalForIndexer = globalThis as unknown as {
  indexer: HostProgramsIndexer | undefined;
};

/**
 * 싱글톤 인덱서 인스턴스 가져오기 또는 생성
 * @param config - 인덱서 설정 (선택적, 기본값 사용)
 * @param handlers - 이벤트 핸들러 (선택적)
 * @returns 인덱서 인스턴스
 */
export async function getIndexer(
  config?: Partial<IndexerConfig>,
  handlers?: EventHandlers
): Promise<HostProgramsIndexer> {
  // 기존 인스턴스가 있으면 반환
  if (globalForIndexer.indexer) {
    // 핸들러가 제공되면 업데이트
    if (handlers) {
      globalForIndexer.indexer.on(handlers);
    }
    return globalForIndexer.indexer;
  }

  // 기본 설정
  const network = (process.env.NEXT_PUBLIC_NETWORK as "localnet" | "devnet" | "testnet" | "mainnet-beta") || "localnet";
  const defaultConfig: IndexerConfig = {
    network,
    programId: process.env.NEXT_PUBLIC_PROGRAM_ID || "FkLGYGk2bypUXgpGmcsCTmKZo6LCjHaXswbhY1LNGAKj",
    commitment: "confirmed",
    pollInterval: network === "localnet" ? 500 : 2000, // localnet은 더 빠르게
    maxBatches: parseInt(process.env.INDEXER_MAX_BATCHES || "100", 10),
  };

  const finalConfig = { ...defaultConfig, ...config };

  // 새 인스턴스 생성
  globalForIndexer.indexer = new HostProgramsIndexer(
    finalConfig,
    idl as AnchorIdl
  );

  // 핸들러 등록 (제공되지 않으면 기본 로깅 핸들러 사용)
  if (handlers) {
    globalForIndexer.indexer.on(handlers);
  } else if (process.env.NODE_ENV === "development") {
    // 개발 환경에서만 기본 로깅 핸들러 제공
    globalForIndexer.indexer.on({
      onInputHandleRegistered: (e) =>
        console.log(`[INFO] InputHandleRegistered: caller=${e.caller} slot=${e.slot}`),
      onFhe16UnaryOpRequested: (e) =>
        console.log(`[INFO] Fhe16UnaryOpRequested: op=${e.op} caller=${e.caller} slot=${e.slot}`),
      onFhe16BinaryOpRequested: (e) =>
        console.log(`[INFO] Fhe16BinaryOpRequested: op=${e.op} caller=${e.caller} slot=${e.slot}`),
      onFhe16TernaryOpRequested: (e) =>
        console.log(`[INFO] Fhe16TernaryOpRequested: op=${e.op} caller=${e.caller} slot=${e.slot}`),
      onError: (err) => console.error(`[ERROR] Indexer error: ${err.message}`),
    });
  }

  // Polling 모드로 시작 (순서 보장 확실)
  await globalForIndexer.indexer.start("polling");

  return globalForIndexer.indexer;
}

/**
 * 인덱서 인스턴스 정리 (테스트 환경 등에서 사용)
 */
export async function cleanupIndexer(): Promise<void> {
  if (globalForIndexer.indexer) {
    await globalForIndexer.indexer.stop();
    globalForIndexer.indexer = undefined;
  }
}