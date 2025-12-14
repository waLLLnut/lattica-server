'use client'

import { type BlinkAdapter } from '@dialectlabs/blinks'
import { useSolana } from '@/components/solana/use-solana'
import { useMemo } from 'react'
import { getBase58Decoder } from 'gill'

/**
 * 환경 변수에서 네트워크에 따른 blockchain ID 가져오기
 */
function getBlockchainId(): string {
  const network = process.env.NEXT_PUBLIC_NETWORK
  
  // localnet은 devnet으로 매핑
  if (!network || network === 'localnet') {
    return 'solana:devnet'
  }
  
  if (network === 'mainnet-beta') {
    return 'solana:mainnet'
  }
  
  // 기본값: devnet
  return 'solana:devnet'
}

export function useBlinkAdapter(): BlinkAdapter | null {
  const { account, wallet } = useSolana()
  const blockchainId = getBlockchainId()

  return useMemo(() => {
    if (!wallet || !account) {
      return null
    }

    const adapter: BlinkAdapter = {
      metadata: {
        // 표준 CAIP-2 ID(제네시스 해시)를 추가해야 인식됩니다.
        supportedBlockchainIds: [
            // Alias (사람이 읽기 쉬운 이름)
        //   'solana:mainnet',
          'solana:devnet',
          'solana:localnet',
          
          // Official Genesis Hashes (CAIP-2 표준 ID)
        //   'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // Mainnet Beta
          'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', // Devnet
          'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z', // Testnet
        ],
      },
      connect: async () => {
        return account.address || null
      },
      signTransaction: async (tx) => {
        if (!wallet || !account) {
          return { error: 'Wallet not connected' }
        }

        const transactionBytes = Uint8Array.from(atob(tx), (c) => c.charCodeAt(0))

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const feature = (wallet.features as any)?.['solana:signAndSendTransaction']
        if (!feature) {
          return { error: 'Wallet does not support signAndSendTransaction' }
        }

        try {
          const [output] = await feature.signAndSendTransaction({
            account,
            chain: blockchainId,
            transaction: transactionBytes,
          })

          return {
            signature: getBase58Decoder().decode(output.signature),
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      confirmTransaction: async () => {
        // no-op
      },
      signMessage: async () => {
        return { error: 'Not implemented' }
      },
    }

    return adapter
  }, [wallet, account])
}
