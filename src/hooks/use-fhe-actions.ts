import { useState, useCallback } from 'react'
import { useSolana } from '@/components/solana/use-solana'
import { useFHE } from '@/components/fhe/fhe-provider'
import { Fhe16BinaryOp, Fhe16UnaryOp, Fhe16TernaryOp } from '@/types/fhe'
// gill 라이브러리 활용 (이전 컨텍스트 기반)
import { getBase58Decoder } from 'gill'

export function useFheActions() {
  // useSolana()는 walletUi 객체를 포함하므로 wallet 접근 가능
  const { account, wallet } = useSolana()
  const { addLog } = useFHE()
  const [loading, setLoading] = useState(false)

  // --- 내부 헬퍼: Base64 트랜잭션을 받아 지갑에 서명 요청 ---
  const signAndSendBase64Tx = useCallback(async (base64Tx: string, logPrefix: string) => {
    if (!wallet || !account) {
      throw new Error('Wallet not connected')
    }

    // 1. Feature 확인
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features = wallet.features as any
    const feature = features?.['solana:signAndSendTransaction'] as
      | {
          signAndSendTransaction: (params: {
            account: typeof account
            chain: string
            transaction: Uint8Array
          }) => Promise<[{ signature: Uint8Array }]>
        }
      | undefined
    if (!feature) {
      throw new Error('Wallet does not support signAndSendTransaction')
    }

    // 2. Base64 -> Uint8Array 변환 (Browser Native)
    const transactionBytes = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0))

    // 3. 지갑에 서명 요청
    addLog('Requesting wallet signature...', 'debug', logPrefix)
    const [output] = await feature.signAndSendTransaction({
      account,
      chain: 'solana:devnet', // 서버 환경에 맞춤
      transaction: transactionBytes,
    })

    // 4. 서명(Signature) 디코딩
    const signature = getBase58Decoder().decode(output.signature)
    addLog(`Transaction sent: ${signature.slice(0, 8)}...`, 'info', logPrefix)
    
    return signature
  }, [wallet, account, addLog])

  // --- 1. Register Input Handle ---
  const registerInputHandle = async (handle: string, encryptedData: number[]) => {
    if (!account?.address) {
      addLog('Wallet not connected', 'warn', 'Register')
      return null
    }

    setLoading(true)
    try {
      // 1. Redis Upload
      addLog('Uploading to Redis...', 'debug', 'Register')
      const ciphertextBase64 = Buffer.from(JSON.stringify(encryptedData)).toString('base64')
      const clientTag = '00'.repeat(32)

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

      if (!uploadRes.ok) throw new Error('Redis upload failed')

      // 2. Transaction Fetch
      const res = await fetch('/api/actions/register_input_handle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { handle, client_tag: clientTag },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Tx fetch failed')

      // 3. Wallet Sign & Send
      const signature = await signAndSendBase64Tx(data.transaction, 'Register')
      
      addLog('Input registered successfully', 'info', 'Register')
      return signature

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Register failed: ${msg}`, 'error', 'Register')
      throw e
    } finally {
      setLoading(false)
    }
  }

  // --- 2. Request Binary Op ---
  const requestBinaryOp = async (op: Fhe16BinaryOp, lhsHandle: string, rhsHandle: string) => {
    if (!account?.address) return null

    setLoading(true)
    try {
      addLog(`Requesting Binary Op: ${op}`, 'info', 'BinaryOp')
      
      const res = await fetch('/api/actions/request_binary_op', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { op, lhs_handle: lhsHandle, rhs_handle: rhsHandle },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Tx fetch failed')

      // Sign & Send
      const signature = await signAndSendBase64Tx(data.transaction, 'BinaryOp')
      return signature

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Binary Op failed: ${msg}`, 'error', 'BinaryOp')
      throw e
    } finally {
      setLoading(false)
    }
  }

  // --- 3. Request Unary Op (동일 패턴) ---
  const requestUnaryOp = async (op: Fhe16UnaryOp, inputHandle: string) => {
    if (!account?.address) return null
    setLoading(true)
    try {
      const res = await fetch('/api/actions/request_unary_op', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { op, input_handle: inputHandle },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      return await signAndSendBase64Tx(data.transaction, 'UnaryOp')
    } catch (e) {
       addLog(`Unary Op failed: ${e}`, 'error', 'UnaryOp')
       throw e
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

