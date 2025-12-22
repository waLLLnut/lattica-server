// src/lib/indexer/config.ts
// 설정 기본값 및 네트워크 엔드포인트 관리

import type { Network, IndexerConfig, Commitment } from "@/types/indexer";
import { createLogger } from "@/lib/logger";

const log = createLogger("IndexerConfig");

/**
 * RPC 타입 (Public vs Private)
 */
export type RpcType = 'public' | 'private' | 'local';

/**
 * RPC 타입 감지
 */
export function detectRpcType(rpcEndpoint: string): RpcType {
  // Localnet
  if (rpcEndpoint.includes('127.0.0.1') || rpcEndpoint.includes('localhost')) {
    return 'local';
  }

  // Public RPC (Solana 공식 엔드포인트)
  const publicRpcPatterns = [
    'api.devnet.solana.com',
    'api.mainnet-beta.solana.com',
    'api.testnet.solana.com',
  ];

  const isPublic = publicRpcPatterns.some(pattern => rpcEndpoint.includes(pattern));
  
  if (isPublic) {
    return 'public';
  }

  // Private RPC (Helius, QuickNode, Alchemy 등)
  const privateRpcPatterns = [
    'helius',
    'quicknode',
    'alchemy',
    'triton',
    'genesysgo',
    'rpcpool',
  ];

  const isPrivate = privateRpcPatterns.some(pattern => 
    rpcEndpoint.toLowerCase().includes(pattern)
  );

  return isPrivate ? 'private' : 'public'; // 기본값은 public으로 가정
}

/**
 * RPC 타입별 권장 설정
 */
export interface RpcConfig {
  pollInterval: number; // 기본 polling interval (ms)
  maxBatches: number; // 최대 배치 수
  requestDelay: number; // 요청 간 지연 (ms)
  rateLimitBackoff: number; // Rate limit 발생 시 backoff 배수
  maxRetries: number; // 최대 재시도 횟수
}

export function getRpcConfig(rpcType: RpcType): RpcConfig {
  const configs: Record<RpcType, RpcConfig> = {
    local: {
      pollInterval: 500, // 로컬은 빠르게
      maxBatches: 10,
      requestDelay: 0, // 지연 없음
      rateLimitBackoff: 2,
      maxRetries: 3,
    },
    public: {
      pollInterval: 3000, // Public RPC는 느리게 (3초)
      maxBatches: 3, // 배치 수 제한
      requestDelay: 200, // 요청 간 200ms 지연
      rateLimitBackoff: 5, // Rate limit 시 5배 backoff
      maxRetries: 5,
    },
    private: {
      pollInterval: 1000, // Private RPC는 중간 속도 (1초)
      maxBatches: 10,
      requestDelay: 50, // 요청 간 50ms 지연
      rateLimitBackoff: 3,
      maxRetries: 3,
    },
  };

  return configs[rpcType];
}

/**
 * 네트워크별 기본 RPC 엔드포인트
 * Solana 공식 엔드포인트 사용
 */
export function getDefaultRpcEndpoint(network: Network): string {
  const endpoints: Record<Network, string> = {
    localnet: "http://127.0.0.1:8899",
    devnet: "https://api.devnet.solana.com",
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
  };
  return endpoints[network];
}

/**
 * 네트워크별 기본 WebSocket 엔드포인트
 * Solana 공식 엔드포인트 사용
 */
export function getDefaultWsEndpoint(network: Network): string {
  const endpoints: Record<Network, string> = {
    localnet: "ws://127.0.0.1:8900",
    devnet: "wss://api.devnet.solana.com",
    "mainnet-beta": "wss://api.mainnet-beta.solana.com",
  };
  return endpoints[network];
}

/**
 * 기본 설정 생성
 * 모든 설정은 env.local에서 필수로 제공되어야 함
 */
export function createDefaultConfig(
  network: Network,
  programId: string,
  overrides?: Partial<IndexerConfig>
): Required<IndexerConfig> {
  // 환경변수에서 필수 설정 가져오기
  const commitment = overrides?.commitment || 
    (process.env.INDEXER_COMMITMENT as Commitment | undefined);
  
  if (!commitment) {
    throw new Error("INDEXER_COMMITMENT environment variable is required (processed|confirmed|finalized)");
  }

  // RPC 엔드포인트 결정
  const rpcEndpoint = overrides?.rpcEndpoint || getDefaultRpcEndpoint(network);
  
  // RPC 타입 감지
  const rpcType = detectRpcType(rpcEndpoint);
  const rpcConfig = getRpcConfig(rpcType);

  log.info('RPC configuration detected', {
    rpcEndpoint,
    rpcType,
    recommendedPollInterval: rpcConfig.pollInterval,
    recommendedMaxBatches: rpcConfig.maxBatches,
  });

  // Polling interval: 환경변수 > override > RPC 타입별 권장값
  const pollInterval = overrides?.pollInterval || 
    (process.env.INDEXER_POLL_INTERVAL 
      ? parseInt(process.env.INDEXER_POLL_INTERVAL, 10) 
      : rpcConfig.pollInterval);
  
  // Max batches: 환경변수 > override > RPC 타입별 권장값
  const maxBatches = overrides?.maxBatches || 
    (process.env.INDEXER_MAX_BATCHES 
      ? parseInt(process.env.INDEXER_MAX_BATCHES, 10) 
      : rpcConfig.maxBatches);
  
  return {
    network,
    programId,
    rpcEndpoint,
    wsEndpoint: overrides?.wsEndpoint || getDefaultWsEndpoint(network),
    commitment: commitment as Commitment,
    pollInterval,
    maxBatches,
    // RPC 타입별 추가 설정 (내부 사용)
    rpcType,
    rpcConfig,
  } as Required<IndexerConfig & { rpcType: RpcType; rpcConfig: RpcConfig }>;
}

