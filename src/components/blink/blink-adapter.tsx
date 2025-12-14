'use client'

import { type BlinkAdapter } from '@dialectlabs/blinks'
import { useMemo } from 'react'
import { useSolana } from '@/components/solana/use-solana'
import { signAndSendBase64Transaction } from '@/lib/solana-signer'

const SUPPORTED_BLOCKCHAIN_IDS = [
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
]

/**
 * Blink Adapter를 제공하는 커스텀 훅입니다.
 */
export function useBlinkAdapter(): BlinkAdapter | null {
  const { account, wallet, cluster } = useSolana()

  return useMemo(() => {
    if (!account) return null

    return {
      connect: async () => account.address.toString(),
      metadata: {
        supportedBlockchainIds: SUPPORTED_BLOCKCHAIN_IDS,
      },
      signTransaction: async (tx: string) => {
        return await signAndSendBase64Transaction(tx, wallet, cluster.id)
      },
      confirmTransaction: async () => {
        // Blinks 클라이언트가 자체적으로 폴링하므로 빈 함수로 구현
      },
      signMessage: async () => ({ error: 'Not implemented' }),
    }
  }, [account, wallet, cluster.id])
}