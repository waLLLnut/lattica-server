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
// 하이브리드 스토어 (Redis + PostgreSQL) 연동 인덱서 워커

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
import { getDefaultRpcEndpoint, getDefaultWsEndpoint } from "@/lib/indexer/config";
import { CiphertextStore } from "@/lib/store/ciphertext-store";
import { OperationLogStore } from "@/lib/store/operation-log-store";
import { IndexerStateStore } from "@/lib/store/indexer-state-store";
import { createLogger } from "@/lib/logger";
// Pub/Sub 이벤트 발행 함수들
import {
  publishGlobalInputHandleRegistered,
  publishGlobalUnaryOpRequested,
  publishGlobalBinaryOpRequested,
  publishGlobalTernaryOpRequested,
  publishGlobalIndexerStatus,
  publishUserCiphertextRegistered,
  publishUserCiphertextConfirmed,
  publishUserOperationCompletedUnary,
  publishUserOperationCompletedBinary,
  publishUserOperationCompletedTernary,
} from "@/lib/redis/pubsub";

const log = createLogger('IndexerWorker');

// Next.js 환경에서 실행되는지 체크 (import 이후에 실행)
if (process.env.NEXT_PHASE || process.env.NEXT_RUNTIME) {
  console.error("[ERROR] This script should not be run with Next.js");
  console.error("[ERROR] Use 'npm run dev' if using Next.js");
  console.error("[ERROR] Next.js automatically starts the indexer (see instrumentation.ts)");
  process.exit(1);
}

// Buffer/Array -> Hex String 유틸리티
const toHex = (data: number[] | Uint8Array): string => {
  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString('hex');
  }
  return Buffer.from(data).toString('hex');
};

async function main() {
  log.info('🚀 Starting Host Programs Indexer Worker...');

  const network = process.env.NEXT_PUBLIC_NETWORK as "localnet" | "devnet" | "mainnet-beta" | undefined;
  const programId = process.env.NEXT_PUBLIC_PROGRAM_ID;
  
  if (!network) {
    log.error('NEXT_PUBLIC_NETWORK environment variable is required');
    log.error('Valid values: localnet, devnet, mainnet-beta');
    process.exit(1);
  }
  
  if (!programId) {
    log.error('NEXT_PUBLIC_PROGRAM_ID environment variable is required');
    process.exit(1);
  }

  // 네트워크별 엔드포인트 설정 (localnet, devnet, mainnet-beta 모두 지원)
  const rpcEndpoint = getDefaultRpcEndpoint(network);
  const wsEndpoint = getDefaultWsEndpoint(network);

  log.info('Indexer configuration', {
    network,
    programId,
    rpcEndpoint,
    wsEndpoint,
    mode: 'Polling (sequential order guaranteed)',
  });

  // 1. DB에서 마지막 처리 슬롯 가져오기 (Resume 기능)
  const lastProcessedSlot = await IndexerStateStore.getLastSlot(programId);
  const lastProcessedSignature = await IndexerStateStore.getLastSignature(programId);
  
  if (lastProcessedSlot > 0) {
    log.info(`Resuming from slot: ${lastProcessedSlot}`, { 
      lastSignature: lastProcessedSignature 
    });
  } else {
    log.info('Starting from the beginning (no previous state found)');
  }

  // 싱글톤 인덱서 가져오기
  const indexer = await getIndexer(
    {
      network,
      programId,
      rpcEndpoint,
      wsEndpoint,
    },
    {
      // --- [이벤트 A] 암호문 입력 등록 ---
      onInputHandleRegistered: async (event: InputHandleRegisteredEvent) => {
        const handleHex = toHex(event.handle);
        log.info('InputHandleRegistered', { 
          handle: handleHex,
          caller: event.caller,
          slot: event.slot,
        });
        
        try {
          // Redis -> Postgres 영구 저장 확정
          await CiphertextStore.confirm(handleHex);
          
          // 상태 업데이트
          await IndexerStateStore.updateState(programId, event.slot, event.signature);
          
          // Pub/Sub 이벤트 발행
          // 1. Global 채널: 온체인 이벤트를 그대로 전달
          await publishGlobalInputHandleRegistered(event).catch((err) => {
            log.error('Failed to publish global InputHandleRegistered event', err);
          });
          
          // 2. User 채널: 유저 관점의 이벤트 발행
          await publishUserCiphertextRegistered(event).catch((err) => {
            log.error('Failed to publish user ciphertext registered event', err);
          });
          await publishUserCiphertextConfirmed(event).catch((err) => {
            log.error('Failed to publish user ciphertext confirmed event', err);
          });
          
          log.debug('Input handle confirmed and state updated', { handle: handleHex });
        } catch (error) {
          log.error('Failed to confirm input handle', error, { handle: handleHex });
          // 에러가 발생해도 다음 이벤트 계속 처리
        }
      },

      // --- [이벤트 B] 단항 연산 요청 ---
      onFhe16UnaryOpRequested: async (event: Fhe16UnaryOpRequestedEvent) => {
        log.info('Fhe16UnaryOpRequested', { 
          op: event.op,
          caller: event.caller,
          slot: event.slot,
        });
        
        try {
          await OperationLogStore.saveUnary(event);
          await IndexerStateStore.updateState(programId, event.slot, event.signature);
          
          // Pub/Sub 이벤트 발행
          // 1. Global 채널: 온체인 이벤트를 그대로 전달
          await publishGlobalUnaryOpRequested(event).catch((err) => {
            log.error('Failed to publish global UnaryOpRequested event', err);
          });
          
          // 2. User 채널: 유저 관점의 이벤트 발행
          await publishUserOperationCompletedUnary(event).catch((err) => {
            log.error('Failed to publish user operation completed event', err);
          });
        } catch (error) {
          log.error('Failed to save unary operation', error);
        }
      },

      // --- [이벤트 C] 이항 연산 요청 ---
      onFhe16BinaryOpRequested: async (event: Fhe16BinaryOpRequestedEvent) => {
        log.info('Fhe16BinaryOpRequested', { 
          op: event.op,
          caller: event.caller,
          slot: event.slot,
        });
        
        try {
          await OperationLogStore.saveBinary(event);
          await IndexerStateStore.updateState(programId, event.slot, event.signature);
          
          // Pub/Sub 이벤트 발행
          // 1. Global 채널: 온체인 이벤트를 그대로 전달
          await publishGlobalBinaryOpRequested(event).catch((err) => {
            log.error('Failed to publish global BinaryOpRequested event', err);
          });
          
          // 2. User 채널: 유저 관점의 이벤트 발행
          await publishUserOperationCompletedBinary(event).catch((err) => {
            log.error('Failed to publish user operation completed event', err);
          });
        } catch (error) {
          log.error('Failed to save binary operation', error);
        }
      },

      // --- [이벤트 D] 삼항 연산 요청 ---
      onFhe16TernaryOpRequested: async (event: Fhe16TernaryOpRequestedEvent) => {
        log.info('Fhe16TernaryOpRequested', { 
          op: event.op,
          caller: event.caller,
          slot: event.slot,
        });
        
        try {
          await OperationLogStore.saveTernary(event);
          await IndexerStateStore.updateState(programId, event.slot, event.signature);
          
          // Pub/Sub 이벤트 발행
          // 1. Global 채널: 온체인 이벤트를 그대로 전달
          await publishGlobalTernaryOpRequested(event).catch((err) => {
            log.error('Failed to publish global TernaryOpRequested event', err);
          });
          
          // 2. User 채널: 유저 관점의 이벤트 발행
          await publishUserOperationCompletedTernary(event).catch((err) => {
            log.error('Failed to publish user operation completed event', err);
          });
        } catch (error) {
          log.error('Failed to save ternary operation', error);
        }
      },

      // --- 에러 및 재연결 핸들링 ---
      onError: async (error: Error) => {
        log.error('Indexer fatal error', error);
        
        // 인덱서 에러 이벤트 발행
        const stats = indexer.getStats();
        await publishGlobalIndexerStatus(
          'error',
          stats.lastProcessedSlot,
          stats.lastProcessedSignature || undefined,
          error.message
        ).catch((err) => {
          log.error('Failed to publish indexer error event', err);
        });
      },
      
      onReconnect: () => {
        log.warn('Indexer reconnecting...');
      },
    }
  );

  // 인덱서에 마지막 처리 슬롯 설정 (복구)
  if (lastProcessedSlot > 0) {
    indexer.setLastProcessedSlot(lastProcessedSlot, lastProcessedSignature);
  }

  log.info('Indexer is running and listening for events.');
  
  // 인덱서 시작 상태 이벤트 발행
  await publishGlobalIndexerStatus(
    'running',
    lastProcessedSlot,
    lastProcessedSignature || undefined
  ).catch((err) => {
    log.error('Failed to publish indexer status event', err);
  });

  // 통계 주기적으로 출력 (1분마다)
  setInterval(() => {
    const stats = indexer.getStats();
    log.info('Indexer statistics', {
      programId: stats.programId,
      network: stats.network,
      lastProcessedSlot: stats.lastProcessedSlot,
      lastProcessedSignature: stats.lastProcessedSignature || 'none',
      isPolling: stats.isPolling,
      subscriptionId: stats.subscriptionId,
      reconnectAttempts: stats.reconnectAttempts,
      currentMode: stats.currentMode || 'none',
      isRunning: stats.isRunning,
    });
  }, 60000);

  // 프로세스 종료 시그널 처리
  const shutdown = async () => {
    log.info('Shutting down indexer...');
    
    // 인덱서 중지 상태 이벤트 발행
    const stats = indexer.getStats();
    await publishGlobalIndexerStatus(
      'stopped',
      stats.lastProcessedSlot,
      stats.lastProcessedSignature || undefined
    ).catch((err) => {
      log.error('Failed to publish indexer stopped event', err);
    });
    
    await cleanupIndexer();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log.error('Worker failed to start', error);
  process.exit(1);
});
