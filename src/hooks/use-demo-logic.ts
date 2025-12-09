import { useState, useEffect } from 'react';
import { useFHE } from '@/components/fhe/fhe-provider';
import { useSolana } from '@/components/solana/use-solana';
import { Ciphertext } from '@/types/fhe';

export type Operation = 'deposit' | 'withdraw' | 'borrow';
export type BalanceState = 'initial' | 'encrypted' | 'decrypted';

export function useDemoLogic() {
  const { account } = useSolana();
  const { encryptValue, moduleReady, addLog } = useFHE();

  // --- State Variables ---
  // 1. Confidential State (Balances)
  const [confidentialSOL, setConfidentialSOL] = useState('0');
  const [confidentialUSDC, setConfidentialUSDC] = useState('0');
  const [solBalanceState, setSolBalanceState] = useState<BalanceState>('initial');
  const [usdcBalanceState, setUsdcBalanceState] = useState<BalanceState>('initial');
  const [solCid, setSolCid] = useState(''); // CID for SOL
  const [usdcCid, setUsdcCid] = useState(''); // CID for USDC

  // 2. Inputs & Operation
  const [amounts, setAmounts] = useState({ deposit: '500', borrow: '200', withdraw: '100' });
  const [operation, setOperation] = useState<Operation>('deposit');
  
  // 3. Ciphertexts (Current Transaction)
  const [ciphertexts, setCiphertexts] = useState<{ [key: string]: Ciphertext | null }>({
    sol: null, usdc: null, deposit: null, borrow: null, withdraw: null
  });

  // 4. Transaction Status
  const [regTxSig, setRegTxSig] = useState('');
  const [jobTxSig, setJobTxSig] = useState('');
  const [jobPda, setJobPda] = useState('');
  const [resultCid, setResultCid] = useState('');
  const [decryptedResult, setDecryptedResult] = useState('');

  // 5. CIDs for Current Job
  const [inputCids, setInputCids] = useState<{ [key: string]: string }>({
    deposit: '', borrow: '', withdraw: ''
  });

  // 초기 SOL 밸런스 암호화 (데모용)
  useEffect(() => {
    if (moduleReady && solBalanceState === 'initial') {
      const initialSOL = '1000';
      setConfidentialSOL(initialSOL);
      const ct = encryptValue(initialSOL);
      if (ct) {
        setCiphertexts(prev => ({ ...prev, sol: ct }));
        setSolBalanceState('encrypted');
        addLog('Initial SOL balance encrypted: 1000', 'info', 'Init');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleReady, solBalanceState]);

  // --- Actions ---
  // Step 1: Encrypt
  const handleEncrypt = () => {
    const currentAmount = amounts[operation];
    addLog(`Encrypting input | Operation: ${operation}, Amount: ${currentAmount}`, 'info', 'Encrypt');
    
    const ct = encryptValue(currentAmount);
    
    if (ct) {
      setCiphertexts(prev => ({ ...prev, [operation]: ct }));
      addLog(`Encryption successful | Handle: ${ct.handle.slice(0, 8)}... | Elements: ${ct.encrypted_data.length}`, 'info', 'Encrypt');
    } else {
      addLog(`Encryption failed | Operation: ${operation}, Amount: ${currentAmount}`, 'error', 'Encrypt');
    }
  };

  // Step 2: Register CIDs
  const handleRegisterCIDs = async () => {
    if (!account?.address) {
      addLog('Wallet not connected', 'warn', 'Register');
      return;
    }

    // Determine required ciphertexts based on operation logic
    const requiredCts: Ciphertext[] = [];
    
    // Logic: Reuse existing balance CIDs, register ONLY new input CIDs
    if (operation === 'deposit' && ciphertexts.deposit) requiredCts.push(ciphertexts.deposit);
    if (operation === 'withdraw' && ciphertexts.withdraw) requiredCts.push(ciphertexts.withdraw);
    if (operation === 'borrow' && ciphertexts.borrow) requiredCts.push(ciphertexts.borrow);
    
    if (requiredCts.length === 0) {
      addLog('Please encrypt input first', 'warn', 'Register');
      return;
    }

    try {
      addLog(`Registering CIDs | Operation: ${operation}, Count: ${requiredCts.length}`, 'info', 'Register');
      
      // TODO: 실제 API 엔드포인트로 변경 필요
      // 현재는 register_input_handle을 사용하지만, 실제로는 /api/actions/job/registerCIDs가 필요할 수 있음
      const ct = requiredCts[0];
      const ciphertextBase64 = Buffer.from(JSON.stringify(ct.encrypted_data)).toString('base64');
      const clientTag = '00'.repeat(32); // 데모용 더미 태그

      // 1. Redis에 업로드
      addLog(`Uploading to Redis | Handle: ${ct.handle.slice(0, 8)}...`, 'debug', 'Register');
      const uploadRes = await fetch('/api/ciphertext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: ct.handle,
          ciphertext: ciphertextBase64,
          owner: account.address,
          clientTag,
        }),
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload ciphertext to Redis');
      }

      // 2. 온체인 트랜잭션 생성 요청
      addLog(`Building transaction | Account: ${account.address.slice(0, 8)}...`, 'debug', 'Register');
      const res = await fetch('/api/actions/register_input_handle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          data: { handle: ct.handle, client_tag: clientTag },
        }),
      });

      if (!res.ok) {
        const errorData = await res.json() as { message?: string };
        throw new Error(errorData.message || 'Failed to create transaction');
      }

      await res.json();
      
      // TODO: 실제 트랜잭션 서명 및 전송 구현
      // const tx = Transaction.from(Buffer.from(transaction, 'base64'));
      // const sig = await sendTransaction(tx, connection);
      
      // 데모용 모의 서명
      const mockSig = 'Mock_' + Date.now().toString(36);
      setRegTxSig(mockSig);
      addLog(`Transaction sent | Sig: ${mockSig.slice(0, 8)}...`, 'info', 'Register');
      addLog(`CIDs registered | CID: ${ct.handle.slice(0, 8)}...`, 'info', 'Register');

      // Update State with new CID (handle를 CID로 사용)
      setInputCids(prev => ({ ...prev, [operation]: ct.handle }));
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      addLog(`Register failed | ${errorMsg}`, 'error', 'Register');
    }
  };

  // Step 3: Submit Job
  const handleSubmitJob = async () => {
    if (!account?.address) {
      addLog('Wallet not connected', 'warn', 'Job');
      return;
    }

    // Collect all CIDs needed for the operation (State CIDs + Input CID)
    let jobCids: string[] = [];
    
    if (operation === 'deposit') {
      if (!solCid || !inputCids.deposit) {
        addLog('Missing CIDs | Required: SOL, Deposit', 'error', 'Job');
        return;
      }
      jobCids = [solCid, inputCids.deposit];
    } else if (operation === 'withdraw') {
      if (!usdcCid || !inputCids.withdraw) {
        addLog('Missing CIDs | Required: USDC, Withdraw', 'error', 'Job');
        return;
      }
      jobCids = [usdcCid, inputCids.withdraw];
    } else if (operation === 'borrow') {
      if (!solCid || !usdcCid || !inputCids.borrow) {
        addLog('Missing CIDs | Required: SOL, USDC, Borrow', 'error', 'Job');
        return;
      }
      jobCids = [solCid, inputCids.borrow, usdcCid];
    }

    try {
      addLog(`Submitting job | Operation: ${operation}, CIDs: ${jobCids.length} | ${jobCids.map(c => c.slice(0, 6)).join(', ')}...`, 'info', 'Job');
      
      // TODO: 실제 Job API 호출 구현
      // const response = await fetch('/api/actions/job/submit', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     account: account.address,
      //     cids: jobCids,
      //     operation,
      //     policy_type: 'owner-controlled',
      //     provenance: '1',
      //   }),
      // });

      // 데모용 모의 응답
      setTimeout(() => {
        const mockJobSig = 'Job_' + Date.now().toString(36);
        const mockPda = 'PDA_' + Date.now().toString(36);
        setJobTxSig(mockJobSig);
        setJobPda(mockPda);
        addLog(`Transaction sent | Sig: ${mockJobSig.slice(0, 8)}...`, 'info', 'Job');
        addLog(`Job submitted | PDA: ${mockPda}`, 'info', 'Job');

        // Polling Logic (Simplified for demo)
        setTimeout(() => {
          const mockResultCid = 'Result_' + Date.now().toString(36);
          setResultCid(mockResultCid);
          addLog(`Job completed | Result CID: ${mockResultCid.slice(0, 8)}...`, 'info', 'Job');
        }, 3000);
      }, 1000);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      addLog(`Job submit failed | ${errorMsg}`, 'error', 'Job');
    }
  };

  // Step 4: Decrypt
  const handleDecrypt = async () => {
    if (!resultCid) {
      addLog('No result CID available', 'warn', 'Decrypt');
      return;
    }

    addLog(`Decrypting result | Result CID: ${resultCid.slice(0, 8)}...`, 'info', 'Decrypt');
    
    // TODO: 실제 복호화 로직 구현
    // 1. Result CID에서 암호문 가져오기
    // 2. WASM으로 복호화
    // 3. 결과 업데이트

    // 데모용 모의 복호화
    setTimeout(() => {
      let result = '';
      if (operation === 'deposit') {
        result = String(parseInt(confidentialSOL) + parseInt(amounts.deposit));
        setConfidentialSOL(result);
        setSolBalanceState('decrypted');
      } else if (operation === 'withdraw') {
        result = String(parseInt(confidentialUSDC) - parseInt(amounts.withdraw));
        setConfidentialUSDC(result);
        setUsdcBalanceState('decrypted');
      } else if (operation === 'borrow') {
        result = String(parseInt(confidentialUSDC) + parseInt(amounts.borrow));
        setConfidentialUSDC(result);
        setUsdcBalanceState('decrypted');
      }
      
      setDecryptedResult(result);
      addLog(`Decryption successful | Operation: ${operation}, Result: ${result}`, 'info', 'Decrypt');
    }, 1000);
  };

  return {
    // Data
    confidentialSOL, confidentialUSDC,
    solBalanceState, usdcBalanceState,
    solCid, setSolCid, usdcCid, setUsdcCid,
    amounts, setAmounts,
    ciphertexts, operation, setOperation,
    
    // Status
    regTxSig, jobTxSig, jobPda, resultCid, decryptedResult,
    inputCids,
    
    // Actions
    handleEncrypt, handleRegisterCIDs, handleSubmitJob, handleDecrypt,
    
    // Utils
    publicKey: account?.address,
    moduleReady
  };
}

