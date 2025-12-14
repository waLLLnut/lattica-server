import { getBase58Decoder } from 'gill'
import { Connection, VersionedTransaction } from '@solana/web3.js'

// 상수 정의
const RPC_ENDPOINTS = {
  MAINNET: 'https://api.mainnet-beta.solana.com',
  DEVNET: 'https://api.devnet.solana.com',
  LOCALNET: 'http://127.0.0.1:8899',
} as const

// 타입 정의
export interface WalletProvider {
  signAndSendTransaction?: (tx: VersionedTransaction, options?: { connection: Connection }) => Promise<string | { signature: string }>
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>
  sendTransaction?: (tx: VersionedTransaction, connection: Connection) => Promise<string | { signature: string }>
}

/**
 * 클러스터 ID를 기반으로 RPC 엔드포인트를 반환합니다.
 */
export function getRpcEndpoint(clusterId?: string): string {
  if (clusterId?.includes('mainnet')) {
    return RPC_ENDPOINTS.MAINNET
  }
  if (clusterId?.includes('localnet') || clusterId?.includes('localhost')) {
    return RPC_ENDPOINTS.LOCALNET
  }
  return RPC_ENDPOINTS.DEVNET
}

/**
 * 지갑 Provider를 찾습니다. 우선순위에 따라 순차적으로 탐색합니다.
 */
export function findWalletProvider(wallet: unknown): WalletProvider | null {
  // 1순위: 래퍼 내부의 adapter 속성
  if (wallet && typeof wallet === 'object' && 'adapter' in wallet) {
    const adapter = (wallet as { adapter?: WalletProvider }).adapter
    if (adapter) return adapter
  }

  // 2순위: window.solana (Phantom, Solflare 등 표준 주입 객체)
  if (typeof window !== 'undefined' && 'solana' in window) {
    const solana = (window as { solana?: WalletProvider }).solana
    if (solana) return solana
  }

  // 3순위: window.phantom?.solana (구형 Phantom 대응)
  if (typeof window !== 'undefined' && 'phantom' in window) {
    const phantom = (window as { phantom?: { solana?: WalletProvider } }).phantom
    if (phantom?.solana) return phantom.solana
  }

  return null
}

/**
 * 서명 결과에서 시그니처 문자열을 추출합니다.
 */
export function extractSignature(result: string | { signature: string } | Uint8Array): string {
  if (typeof result === 'string') return result
  if (result instanceof Uint8Array) return getBase58Decoder().decode(result)
  return result.signature
}

/**
 * Provider를 사용하여 트랜잭션을 서명하고 전송합니다.
 */
export async function signAndSendTransaction(
  provider: WalletProvider,
  transaction: VersionedTransaction,
  connection: Connection
): Promise<{ signature: string } | { error: string }> {
  // 방법 1: signAndSendTransaction (표준 방식)
  if (provider.signAndSendTransaction) {
    try {
      const result = await provider.signAndSendTransaction(transaction, { connection })
      const signature = extractSignature(result)
      return { signature }
    } catch (error) {
      console.warn('signAndSendTransaction failed, trying alternative method:', error)
    }
  }

  // 방법 2: signTransaction + sendRawTransaction (가장 안정적인 방법)
  if (provider.signTransaction) {
    try {
      const signedTx = await provider.signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      return { signature }
    } catch (error) {
      console.warn('signTransaction + sendRawTransaction failed:', error)
    }
  }

  // 방법 3: sendTransaction (Legacy 방식)
  if (provider.sendTransaction) {
    try {
      const result = await provider.sendTransaction(transaction, connection)
      const signature = extractSignature(result)
      return { signature }
    } catch (error) {
      console.warn('sendTransaction failed:', error)
    }
  }

  return { error: 'No supported signing method found in wallet provider.' }
}

/**
 * Base64 문자열을 VersionedTransaction으로 변환합니다.
 */
export function deserializeTransaction(base64Tx: string): VersionedTransaction {
  const transactionBytes = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0))
  return VersionedTransaction.deserialize(transactionBytes)
}

/**
 * Base64 트랜잭션을 서명하고 전송하는 통합 함수입니다.
 * @param base64Tx Base64로 인코딩된 트랜잭션
 * @param wallet 지갑 객체
 * @param clusterId 클러스터 ID (선택사항, 기본값: devnet)
 * @returns 서명 결과 또는 에러
 */
export async function signAndSendBase64Transaction(
  base64Tx: string,
  wallet: unknown,
  clusterId?: string
): Promise<{ signature: string } | { error: string }> {
  try {
    // Base64 트랜잭션을 VersionedTransaction으로 변환
    const transaction = deserializeTransaction(base64Tx)

    // RPC Connection 생성
    const rpcEndpoint = getRpcEndpoint(clusterId)
    const connection = new Connection(rpcEndpoint, 'confirmed')

    // 지갑 Provider 찾기
    const provider = findWalletProvider(wallet)
    if (!provider) {
      return { error: 'Wallet provider not found.' }
    }

    // 트랜잭션 서명 및 전송
    return await signAndSendTransaction(provider, transaction, connection)
  } catch (error) {
    console.error('Error signing transaction:', error)
    return {
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
