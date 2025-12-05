// src/server/start-indexer.ts
// Next.js 서버 내에서 인덱서를 싱글톤으로 시작
// 이 파일은 서버 사이드에서만 실행됩니다 (클라이언트 번들에 포함되지 않음)

import { getIndexer } from "@/lib/indexer";
import type {
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
} from "@/lib/indexer";
import { createLogger } from "@/lib/logger";

const log = createLogger("IndexerStartup");

let started = false;
let startPromise: Promise<void> | null = null;

/**
 * Next.js 서버 내에서 인덱서를 시작합니다.
 * 싱글톤 패턴으로 보장되어 여러 번 호출해도 한 번만 실행됩니다.
 * 
 * @param handlers - 선택적 이벤트 핸들러 (기본 핸들러 사용 시 생략 가능)
 */
export async function startIndexerInNextJs(
  handlers?: {
    onInputHandleRegistered?: (event: InputHandleRegisteredEvent) => void | Promise<void>;
    onFhe16UnaryOpRequested?: (event: Fhe16UnaryOpRequestedEvent) => void | Promise<void>;
    onFhe16BinaryOpRequested?: (event: Fhe16BinaryOpRequestedEvent) => void | Promise<void>;
    onFhe16TernaryOpRequested?: (event: Fhe16TernaryOpRequestedEvent) => void | Promise<void>;
    onError?: (error: Error) => void;
    onReconnect?: () => void;
  }
): Promise<void> {
  // 이미 시작되었으면 즉시 반환
  if (started) {
    return;
  }

  // 이미 시작 중이면 Promise 대기
  if (startPromise) {
    return startPromise;
  }

  // 시작 중 Promise 생성
  startPromise = (async () => {
    try {
        const network = process.env.NEXT_PUBLIC_NETWORK as
          | "localnet"
          | "devnet"
          | "mainnet-beta"
          | undefined;
        const programId = process.env.NEXT_PUBLIC_PROGRAM_ID;
        
        if (!network) {
          throw new Error("NEXT_PUBLIC_NETWORK environment variable is required (localnet|devnet|mainnet-beta)");
        }
        
        if (!programId) {
          throw new Error("NEXT_PUBLIC_PROGRAM_ID environment variable is required");
        }

        // 로컬 네트워크 엔드포인트
        const rpcEndpoint =
          network === "localnet" ? "http://127.0.0.1:8899" : undefined;
        const wsEndpoint =
          network === "localnet" ? "ws://127.0.0.1:8900" : undefined;

        // 프로덕션에서는 간소한 로그만
        if (process.env.NODE_ENV === "production") {
          log.info("Starting FHE indexer in Next.js server (singleton)");
        } else {
          log.info("Starting indexer in Next.js (singleton guaranteed)", {
            network,
            rpc_endpoint: network === "localnet" ? rpcEndpoint : undefined,
            ws_endpoint: network === "localnet" ? wsEndpoint : undefined,
            program_id: programId,
            mode: "Polling (sequential order guaranteed)",
          });
        }

        // 기본 핸들러 (handlers가 제공되지 않은 경우)
        const defaultHandlers = handlers || {
          onInputHandleRegistered: async (event: InputHandleRegisteredEvent) => {
            log.info("InputHandleRegistered", {
              caller: event.caller,
              slot: event.slot,
              signature: event.signature,
            });
            // TODO: 여기에 DB 저장, 큐에 넣기 등의 로직 추가
          },

          onFhe16UnaryOpRequested: async (
            event: Fhe16UnaryOpRequestedEvent
          ) => {
            log.info("Fhe16UnaryOpRequested", {
              op: event.op,
              caller: event.caller,
              slot: event.slot,
              signature: event.signature,
            });
            // TODO: 여기에 FHE 연산 큐에 넣기 등의 로직 추가
          },

          onFhe16BinaryOpRequested: async (
            event: Fhe16BinaryOpRequestedEvent
          ) => {
            log.info("Fhe16BinaryOpRequested", {
              op: event.op,
              caller: event.caller,
              slot: event.slot,
              signature: event.signature,
            });
            // TODO: 여기에 FHE 연산 큐에 넣기 등의 로직 추가
          },

          onFhe16TernaryOpRequested: async (
            event: Fhe16TernaryOpRequestedEvent
          ) => {
            log.info("Fhe16TernaryOpRequested", {
              op: event.op,
              caller: event.caller,
              slot: event.slot,
              signature: event.signature,
            });
            // TODO: 여기에 FHE 연산 큐에 넣기 등의 로직 추가
          },

          onError: (error: Error) => {
            log.error("Indexer error", error);
            // TODO: 여기에 에러 모니터링 (Sentry 등) 추가
          },

          onReconnect: () => {
            log.info("Reconnecting");
          },
        };

        // 싱글톤 인덱서 가져오기 (Polling 모드로 자동 시작)
        await getIndexer(
          {
            network,
            programId,
            rpcEndpoint,
            wsEndpoint,
          },
          defaultHandlers
        );

        if (process.env.NODE_ENV === "production") {
          log.info("FHE indexer started (singleton)");
        } else {
          log.info("Indexer started (Next.js singleton)");
        }
      started = true;
    } catch (error) {
      log.error("Failed to start indexer", error);
      startPromise = null; // 실패 시 재시도 가능하도록
      throw error;
    }
  })();

  await startPromise;
}

/**
 * 인덱서가 시작되었는지 확인
 */
export function isIndexerStarted(): boolean {
  return started;
}

