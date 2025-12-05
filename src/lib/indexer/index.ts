// src/lib/indexer/index.ts

import { HostProgramsIndexer } from "@/lib/indexer/indexer";
import type { IndexerConfig, EventHandlers } from "@/types/indexer";
import { createDefaultConfig } from "@/lib/indexer/config";
import type { Idl as AnchorIdl } from "@coral-xyz/anchor";
import idl from "@/idl/host_programs.json";
import { createLogger } from "@/lib/logger";

const log = createLogger("IndexerFactory");

// 모든 타입 및 클래스 재export
export { HostProgramsIndexer } from "@/lib/indexer/indexer";
export type {
  IndexedEvent,
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
  IndexerConfig,
  EventHandlers,
  IndexerMode,
  Network,
} from "@/types/indexer";

/**
 * Next.js 환경에서 싱글톤 인덱서 인스턴스 관리
 * globalThis를 사용하여 개발 모드에서도 단일 인스턴스 보장
 */
const globalForIndexer = globalThis as unknown as {
  indexer: HostProgramsIndexer | undefined;
};

/**
 * 싱글톤 인덱서 인스턴스 가져오기 또는 생성
 * @param config - 인덱서 설정 (선택적, 환경변수에서 필수 값 가져옴)
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
  const network = process.env.NEXT_PUBLIC_NETWORK as "localnet" | "devnet" | "mainnet-beta" | undefined;
  const programId = process.env.NEXT_PUBLIC_PROGRAM_ID;
  
  if (!network) {
    throw new Error("NEXT_PUBLIC_NETWORK environment variable is required (localnet|devnet|mainnet-beta)");
  }
  
  if (!programId) {
    throw new Error("NEXT_PUBLIC_PROGRAM_ID environment variable is required");
  }

  // createDefaultConfig로 모든 설정 처리 (환경변수에서 필수 값 가져옴)
  const finalConfig = createDefaultConfig(network, programId, config);

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
        log.info("InputHandleRegistered", { caller: e.caller, slot: e.slot }),
      onFhe16UnaryOpRequested: (e) =>
        log.info("Fhe16UnaryOpRequested", { op: e.op, caller: e.caller, slot: e.slot }),
      onFhe16BinaryOpRequested: (e) =>
        log.info("Fhe16BinaryOpRequested", { op: e.op, caller: e.caller, slot: e.slot }),
      onFhe16TernaryOpRequested: (e) =>
        log.info("Fhe16TernaryOpRequested", { op: e.op, caller: e.caller, slot: e.slot }),
      onError: (err) => log.error("Indexer error", err),
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