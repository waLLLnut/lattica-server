import { useState } from 'react'
import { Connection } from '@solana/web3.js'
import { useSolana } from '@/components/solana/use-solana'
import { useFHE } from '@/components/fhe/fhe-provider'
import { Fhe16BinaryOp, Fhe16UnaryOp, Fhe16TernaryOp } from '@/types/fhe'
import { getDefaultRpcEndpoint } from '@/lib/indexer/config'
import type { Network } from '@/types/indexer'

export function useFheActions() {
  const { account, cluster } = useSolana()
  const { addLog } = useFHE()
  const [loading, setLoading] = useState(false)

  // getConnection은 나중에 transaction 서명 시 사용 예정
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getConnection = () => {
    // cluster.id를 Network 타입으로 매핑하여 RPC endpoint 가져오기
    // cluster.id는 'solana:devnet', 'solana:mainnet-beta' 형식일 수 있음
    let network: Network = 'devnet' // 기본값
    const clusterId = cluster?.id || ''
    
    if (clusterId.includes('mainnet')) {
      network = 'mainnet-beta'
    } else if (clusterId.includes('devnet')) {
      network = 'devnet'
    } else if (clusterId.includes('localnet')) {
      network = 'localnet'
    }
    const rpcUrl = getDefaultRpcEndpoint(network)
    return new Connection(rpcUrl, 'confirmed')
  }

  const registerInputHandle = async (handle: string, encryptedData: number[]) => {
    if (!account?.address) {
      addLog('Wallet not connected', 'warn', 'Register')
      return null
    }

    setLoading(true)
    try {
      // 1. Redis에 데이터 업로드
      addLog('Uploading to Redis...', 'debug', 'Register')
      const ciphertextBase64 = Buffer.from(JSON.stringify(encryptedData)).toString('base64')
      const clientTag = '00'.repeat(32) // 데모용 더미 태그

      const uploadRes = await fetch('/api/ciphertext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle,
          ciphertext: ciphertextBase64,
          owner: account.address,
          clientTag,
        }),
      })

      if (!uploadRes.ok) {
        throw new Error('Failed to upload ciphertext to Redis')
      }

      // 2. 온체인 트랜잭션 생성 요청
      addLog('Building transaction...', 'debug', 'Register')
      const res = await fetch('/api/actions/register_input_handle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { handle, client_tag: clientTag },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json() as { message?: string }
        throw new Error(errorData.message || 'Failed to create transaction')
      }

      // transaction 변수는 나중에 서명 시 사용 예정
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { transaction } = await res.json()

      // 3. 서명 및 전송
      // TODO: @wallet-ui/react에서 transaction 서명 방법 확인 필요
      // Transaction.from(Buffer.from(transaction, 'base64'))
      // const connection = getConnection()

      // @wallet-ui/react에서는 sendTransaction을 직접 제공하지 않을 수 있음
      // 실제 구현은 wallet adapter에 따라 다름
      addLog('Transaction signing not implemented - need wallet adapter integration', 'warn', 'Register')
      addLog('Transaction created successfully', 'info', 'Register')

      addLog('Input registered', 'info', 'Register')
      return handle
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      addLog(`Register failed | ${errorMsg}`, 'error', 'Register')
      throw e
    } finally {
      setLoading(false)
    }
  }

  const requestBinaryOp = async (
    op: Fhe16BinaryOp,
    lhsHandle: string,
    rhsHandle: string
  ) => {
    if (!account?.address) {
      addLog('Wallet not connected', 'warn', 'BinaryOp')
      return
    }

    setLoading(true)
    try {
      addLog(`Requesting binary operation | Op: ${op}`, 'info', 'BinaryOp')
      const res = await fetch('/api/actions/request_binary_op', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { op, lhs_handle: lhsHandle, rhs_handle: rhsHandle },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json() as { message?: string }
        throw new Error(errorData.message || 'Failed to create transaction')
      }

      // transaction 변수는 나중에 서명 시 사용 예정
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { transaction } = await res.json()
      // TODO: Transaction 서명 구현
      // const tx = Transaction.from(Buffer.from(transaction, 'base64'))

      addLog('Transaction signing not implemented - need wallet adapter integration', 'warn', 'BinaryOp')
      addLog(`Binary operation requested | Op: ${op}`, 'info', 'BinaryOp')
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      addLog(`Binary operation failed | ${errorMsg}`, 'error', 'BinaryOp')
    } finally {
      setLoading(false)
    }
  }

  const requestUnaryOp = async (op: Fhe16UnaryOp, inputHandle: string) => {
    if (!account?.address) {
      addLog('Wallet not connected', 'warn', 'UnaryOp')
      return
    }

    setLoading(true)
    try {
      addLog(`Requesting unary operation | Op: ${op}`, 'info', 'UnaryOp')
      const res = await fetch('/api/actions/request_unary_op', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { op, input_handle: inputHandle },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json() as { message?: string }
        throw new Error(errorData.message || 'Failed to create transaction')
      }

      // Transaction 응답은 나중에 서명 시 사용 예정 (TODO: 구현 필요)
      await res.json()

      addLog('Transaction signing not implemented - need wallet adapter integration', 'warn', 'UnaryOp')
      addLog(`Unary operation requested | Op: ${op}`, 'info', 'UnaryOp')
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      addLog(`Unary operation failed | ${errorMsg}`, 'error', 'UnaryOp')
    } finally {
      setLoading(false)
    }
  }

  const requestTernaryOp = async (
    op: Fhe16TernaryOp,
    lhsHandle: string,
    mhsHandle: string,
    rhsHandle: string
  ) => {
    if (!account?.address) {
      addLog('Wallet not connected', 'warn', 'TernaryOp')
      return
    }

    setLoading(true)
    try {
      addLog(`Requesting ternary operation | Op: ${op}`, 'info', 'TernaryOp')
      const res = await fetch('/api/actions/request_ternary_op', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { op, lhs_handle: lhsHandle, mhs_handle: mhsHandle, rhs_handle: rhsHandle },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json() as { message?: string }
        throw new Error(errorData.message || 'Failed to create transaction')
      }

      // Transaction 응답은 나중에 서명 시 사용 예정 (TODO: 구현 필요)
      await res.json()

      addLog('Transaction signing not implemented - need wallet adapter integration', 'warn', 'TernaryOp')
      addLog(`Ternary operation requested | Op: ${op}`, 'info', 'TernaryOp')
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      addLog(`Ternary operation failed | ${errorMsg}`, 'error', 'TernaryOp')
    } finally {
      setLoading(false)
    }
  }

  return {
    registerInputHandle,
    requestBinaryOp,
    requestUnaryOp,
    requestTernaryOp,
    loading,
  }
}

