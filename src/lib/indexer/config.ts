// src/lib/indexer/config.ts
// 설정 기본값 및 네트워크 엔드포인트 관리

import type { Network, IndexerConfig, Commitment } from "@/types/indexer";

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
  
  const pollInterval = overrides?.pollInterval || 
    (process.env.INDEXER_POLL_INTERVAL ? parseInt(process.env.INDEXER_POLL_INTERVAL, 10) : undefined);
  
  if (pollInterval === undefined) {
    throw new Error("INDEXER_POLL_INTERVAL environment variable is required (number in milliseconds)");
  }
  
  const maxBatches = overrides?.maxBatches || 
    (process.env.INDEXER_MAX_BATCHES ? parseInt(process.env.INDEXER_MAX_BATCHES, 10) : undefined);
  
  if (maxBatches === undefined) {
    throw new Error("INDEXER_MAX_BATCHES environment variable is required (number)");
  }
  
  return {
    network,
    programId,
    rpcEndpoint: overrides?.rpcEndpoint || getDefaultRpcEndpoint(network),
    wsEndpoint: overrides?.wsEndpoint || getDefaultWsEndpoint(network),
    commitment: commitment as Commitment,
    pollInterval,
    maxBatches,
  };
}

