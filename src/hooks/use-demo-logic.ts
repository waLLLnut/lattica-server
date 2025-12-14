import { useState, useEffect } from 'react';
import { useFHE } from '@/components/fhe/fhe-provider';
import { useSolana } from '@/components/solana/use-solana';
import { useFheActions } from './use-fhe-actions'; // 위에서 수정한 파일 임포트
import { Ciphertext, Fhe16BinaryOp } from '@/types/fhe';
import { deriveBinaryHandle } from '@/lib/handle-utils';

// 환경변수에서 Program ID 로드
const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || 'FkLGYGk2bypUXgpGmcsCTmKZo6LCjHaXswbhY1LNGAKj';

export type Operation = 'deposit' | 'withdraw' | 'borrow';
export type BalanceState = 'initial' | 'encrypted' | 'decrypted';

export function useDemoLogic() {
  const { account } = useSolana();
  const { encryptValue, moduleReady, addLog } = useFHE();
  
  // ★ useFheActions 훅 사용
  const { registerInputHandle, requestBinaryOp, loading: isActionLoading } = useFheActions();

  // --- State Variables ---
  // 1. Confidential State (Balances)
  const [confidentialSOL, setConfidentialSOL] = useState('0');
  const [confidentialUSDC, setConfidentialUSDC] = useState('0');
  const [solBalanceState, setSolBalanceState] = useState<BalanceState>('initial');
  const [usdcBalanceState, setUsdcBalanceState] = useState<BalanceState>('initial');
  
  // Handles (CIDs)
  const [solHandle, setSolHandle] = useState('');
  const [usdcHandle, setUsdcHandle] = useState('');

  // 2. Inputs & Operation
  const [amounts, setAmounts] = useState({ deposit: '500', borrow: '200', withdraw: '100' });
  const [operation, setOperation] = useState<Operation>('deposit');
  
  // 3. Ciphertexts (Local)
  const [ciphertexts, setCiphertexts] = useState<{ [key: string]: Ciphertext | null }>({
    sol: null, usdc: null, deposit: null, borrow: null, withdraw: null
  });

  // 4. Transaction Status
  const [regTxSig, setRegTxSig] = useState('');
  const [opTxSig, setOpTxSig] = useState('');
  const [resultHandle, setResultHandle] = useState('');
  const [decryptedResult, setDecryptedResult] = useState('');
  
  // isActionLoading으로 대체 가능하지만, UI 명시성을 위해 남겨둘 수 있음
  const isRegistering = isActionLoading;

  // 5. Registered Handles for Inputs
  const [inputHandles, setInputHandles] = useState<{ [key: string]: string }>({
    deposit: '', borrow: '', withdraw: ''
  });

  // --- 초기화 (Auto Init) ---
  useEffect(() => {
    if (moduleReady && solBalanceState === 'initial') {
      const initSol = encryptValue('1000');
      const initUsdc = encryptValue('1000'); // 데모용 초기 잔고
      if (initSol && initUsdc) {
        setCiphertexts(prev => ({ ...prev, sol: initSol, usdc: initUsdc }));
        setConfidentialSOL('1000');
        setConfidentialUSDC('1000');
        setSolBalanceState('encrypted');
        setUsdcBalanceState('encrypted');
        addLog('Initial balances encrypted locally', 'info', 'Init');
        // 실제로는 여기서 Register 트랜잭션을 날리거나, 이미 등록된 핸들을 가져와야 함
        // 데모 시각화를 위해 가짜 핸들 할당
        setSolHandle(initSol.handle);
        setUsdcHandle(initUsdc.handle);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleReady, solBalanceState]);

  // --- Actions ---
  // 1. Encrypt Input
  const handleEncrypt = () => {
    const amount = amounts[operation];
    addLog(`Encrypting ${operation} amount: ${amount}...`, 'info', 'Encrypt');
    const ct = encryptValue(amount);
    if (ct) {
      setCiphertexts(prev => ({ ...prev, [operation]: ct }));
      addLog('Encryption successful', 'info', 'Encrypt');
    }
  };

  // 1. Register Input (Real Wallet)
  const handleRegister = async () => {
    const ct = ciphertexts[operation];
    if (!ct) {
      addLog('Encrypt first', 'warn', 'Register');
      return;
    }

    try {
      // useFheActions의 함수 호출 (내부에서 서명까지 완료 후 signature 반환)
      const signature = await registerInputHandle(ct.handle, ct.encrypted_data);
      
      if (signature) {
        setRegTxSig(signature);
        setInputHandles(prev => ({ ...prev, [operation]: ct.handle }));
      }
    } catch (e) {
      // 에러 로그는 hook 내부에서 이미 찍혔으므로 여기선 생략 가능
      console.error(e);
    }
  };

  // 2. Request Operation (Real Wallet)
  const handleSubmitJob = async () => {
    if (!account?.address) {
      addLog('Connect wallet first', 'warn', 'OpRequest');
      return;
    }

    try {
      // 파라미터 준비
      let opCode: number = Fhe16BinaryOp.Add;
      let lhs = '';
      let rhs = '';

      if (operation === 'deposit') {
        if (!solHandle || !inputHandles.deposit) return addLog('Missing handles', 'error', 'OpRequest');
        opCode = Fhe16BinaryOp.Add;
        lhs = solHandle;
        rhs = inputHandles.deposit;
      } else if (operation === 'withdraw') {
        if (!usdcHandle || !inputHandles.withdraw) return addLog('Missing handles', 'error', 'OpRequest');
        opCode = Fhe16BinaryOp.Sub;
        lhs = usdcHandle;
        rhs = inputHandles.withdraw;
      } else if (operation === 'borrow') {
        if (!solHandle || !usdcHandle || !inputHandles.borrow) return addLog('Missing handles', 'error', 'OpRequest');
        opCode = Fhe16BinaryOp.Add;
        lhs = usdcHandle;
        rhs = inputHandles.borrow;
      }

      // Optimistic UI: 결과 핸들 예측
      const predictedHandle = deriveBinaryHandle(opCode, lhs, rhs, PROGRAM_ID);
      if (predictedHandle) {
        addLog(`🔮 Handle Prediction: ${predictedHandle.slice(0, 8)}...`, 'info', 'Prediction');
      }

      // 실제 트랜잭션 요청 및 서명
      const signature = await requestBinaryOp(opCode, lhs, rhs);

      if (signature) {
        setOpTxSig(signature);
        // 예측 성공 시 결과 핸들 업데이트 (Optimistic Update)
        if (predictedHandle) {
           setResultHandle(predictedHandle);
        }
        addLog('Operation submitted successfully', 'info', 'OpRequest');
      }

    } catch (e) {
      console.error(e);
      // 에러 발생 시에도 예측 핸들은 남겨둘지 여부 결정 (현재는 hook이 에러 던짐)
    }
  };

  // 3. Decrypt (Demo Mock)
  // 실제 복호화는 서버 Re-encryption -> Client Decryption이 필요하지만 
  // 여기서는 데모 흐름을 위해 Mocking 유지 (혹은 별도 API 구현)
  const handleDecrypt = async () => {
    if (!resultHandle) return;

    addLog('Decrypting result...', 'info', 'Decrypt');
    setTimeout(() => {
        let newVal = 0;
        if (operation === 'deposit') {
            newVal = parseInt(confidentialSOL) + parseInt(amounts.deposit);
            setConfidentialSOL(newVal.toString());
            setSolBalanceState('decrypted');
        } else if (operation === 'withdraw') {
            newVal = parseInt(confidentialUSDC) - parseInt(amounts.withdraw);
            setConfidentialUSDC(newVal.toString());
            setUsdcBalanceState('decrypted');
        } else if (operation === 'borrow') {
            newVal = parseInt(confidentialUSDC) + parseInt(amounts.borrow);
            setConfidentialUSDC(newVal.toString());
            setUsdcBalanceState('decrypted');
        }
        setDecryptedResult(newVal.toString());
        addLog('Decryption Complete!', 'info', 'Decrypt');
    }, 1000);
  };

  return {
    confidentialSOL, confidentialUSDC,
    solBalanceState, usdcBalanceState,
    solHandle, usdcHandle,
    amounts, setAmounts,
    ciphertexts, operation, setOperation,
    regTxSig, opTxSig, resultHandle, decryptedResult,
    inputHandles,
    handleEncrypt, handleRegister, handleSubmitJob, handleDecrypt,
    publicKey: account?.address,
    moduleReady,
    isRegistering
  };
}

