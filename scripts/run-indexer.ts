// scripts/run-indexer.ts
// ⚠️  주의: 이 스크립트는 오직 독립 실행용입니다!
// 
// Next.js와 함께 사용하면 중복 실행됩니다!
// Next.js를 사용할 경우: npm run dev 를 사용하세요!
// 
// 독립 실행이 필요한 경우에만 사용:
// - Next.js 없이 인덱서만 실행하고 싶을 때
// - PM2나 Docker로 별도 프로세스로 관리할 때
//
// 단순하고 견고한 인덱서 실행 스크립트
// Polling 모드를 기본으로 사용하여 순서 보장

// .env.local 파일 로드 (독립 실행 시 필요)
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getIndexer, cleanupIndexer } from "@/lib/indexer";
import type {
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
} from "@/lib/indexer";

// Next.js 환경에서 실행되는지 체크 (import 이후에 실행)
if (process.env.NEXT_PHASE || process.env.NEXT_RUNTIME) {
  console.error("[ERROR] This script should not be run with Next.js");
  console.error("[ERROR] Use 'npm run dev' if using Next.js");
  console.error("[ERROR] Next.js automatically starts the indexer (see instrumentation.ts)");
  process.exit(1);
}

async function main() {
  // 로컬 네트워크 기본값 사용
  const network = process.env.NEXT_PUBLIC_NETWORK as "localnet" | "devnet" | "mainnet-beta" | undefined;
  const programId = process.env.NEXT_PUBLIC_PROGRAM_ID;
  
  if (!network) {
    console.error("[ERROR] NEXT_PUBLIC_NETWORK environment variable is required");
    console.error("[ERROR] Valid values: localnet, devnet, mainnet-beta");
    console.error("[ERROR] Please set it in your .env.local file");
    process.exit(1);
  }
  
  if (!programId) {
    console.error("[ERROR] NEXT_PUBLIC_PROGRAM_ID environment variable is required");
    console.error("[ERROR] Please set it in your .env.local file");
    process.exit(1);
  }

  // 로컬 네트워크 엔드포인트
  const rpcEndpoint = network === "localnet" 
    ? "http://127.0.0.1:8899" 
    : undefined;
  const wsEndpoint = network === "localnet"
    ? "ws://127.0.0.1:8900"
    : undefined;

  console.log("[INFO] Host Programs Indexer (standalone mode)");
  console.log(`[INFO] Network: ${network}`);
  if (network === "localnet") {
    console.log(`[INFO] RPC Endpoint: ${rpcEndpoint}`);
    console.log(`[INFO] WebSocket Endpoint: ${wsEndpoint}`);
  }
  console.log(`[INFO] Program ID: ${programId}`);
  console.log(`[INFO] Mode: Polling (sequential order guaranteed)`);

  // 싱글톤 인덱서 가져오기 (Polling 모드로 자동 시작)
  const indexer = await getIndexer(
    {
      network,
      programId,
      rpcEndpoint,
      wsEndpoint,
    },
    {
    onInputHandleRegistered: async (event: InputHandleRegisteredEvent) => {
      console.log(`[INFO] InputHandleRegistered: caller=${event.caller} slot=${event.slot} signature=${event.signature}`);
    },

    onFhe16UnaryOpRequested: async (event: Fhe16UnaryOpRequestedEvent) => {
      console.log(`[INFO] Fhe16UnaryOpRequested: op=${event.op} caller=${event.caller} slot=${event.slot} signature=${event.signature}`);
    },

    onFhe16BinaryOpRequested: async (event: Fhe16BinaryOpRequestedEvent) => {
      console.log(`[INFO] Fhe16BinaryOpRequested: op=${event.op} caller=${event.caller} slot=${event.slot} signature=${event.signature}`);
    },

    onFhe16TernaryOpRequested: async (event: Fhe16TernaryOpRequestedEvent) => {
      console.log(`[INFO] Fhe16TernaryOpRequested: op=${event.op} caller=${event.caller} slot=${event.slot} signature=${event.signature}`);
    },

    onError: (error: Error) => {
      console.error(`[ERROR] Indexer error: ${error.message}`);
    },

      onReconnect: () => {
        console.log("[INFO] Reconnecting...");
      },
    }
  );

  console.log("[INFO] Indexer started (Polling mode)");

  // 통계 주기적으로 출력 (1분마다)
  setInterval(() => {
    const stats = indexer.getStats();
    console.log("[STATS] Indexer statistics:");
    console.log(`[STATS]   Program ID: ${stats.programId}`);
    console.log(`[STATS]   Network: ${stats.network}`);
    console.log(`[STATS]   Last Processed Slot: ${stats.lastProcessedSlot}`);
    console.log(`[STATS]   Last Processed Signature: ${stats.lastProcessedSignature || "none"}`);
    console.log(`[STATS]   Is Polling: ${stats.isPolling}`);
    console.log(`[STATS]   Subscription ID: ${stats.subscriptionId}`);
    console.log(`[STATS]   Reconnect Attempts: ${stats.reconnectAttempts}`);
    console.log(`[STATS]   Current Mode: ${stats.currentMode || "none"}`);
    console.log(`[STATS]   Is Running: ${stats.isRunning}`);
  }, 60000);

  // 종료 처리
  const shutdown = async () => {
    console.log("[INFO] Shutting down indexer...");
    await cleanupIndexer();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(`[ERROR] Failed to start indexer: ${error.message}`);
  process.exit(1);
});