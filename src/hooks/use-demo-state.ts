import { useState } from 'react';
import { Ciphertext } from '@/types/fhe';

export function useDemoState() {
  // 1. Confidential State
  const [confidentialSOL, setConfidentialSOL] = useState('0');
  const [confidentialUSDC, setConfidentialUSDC] = useState('0');
  const [solBalanceState, setSolBalanceState] = useState<'initial' | 'encrypted' | 'decrypted'>('initial');
  const [usdcBalanceState, setUsdcBalanceState] = useState<'initial' | 'encrypted' | 'decrypted'>('initial');
  
  // 2. CIDs
  const [solCid, setSolCid] = useState('');
  const [usdcCid, setUsdcCid] = useState('');
  
  // 3. Inputs
  const [amounts, setAmounts] = useState({ deposit: '500', borrow: '200', withdraw: '100' });
  const [ciphertexts, setCiphertexts] = useState<{ [key: string]: Ciphertext | null }>({
    sol: null, deposit: null, borrow: null, usdc: null, withdraw: null
  });
  
  // 4. Transaction State
  const [regTxSig, setRegTxSig] = useState('');
  const [jobTxSig, setJobTxSig] = useState('');
  const [jobPda, setJobPda] = useState('');
  const [resultCid, setResultCid] = useState('');
  const [decryptedResult, setDecryptedResult] = useState('');
  const [operation, setOperation] = useState<'deposit' | 'withdraw' | 'borrow'>('deposit');

  return {
    confidentialSOL, setConfidentialSOL,
    confidentialUSDC, setConfidentialUSDC,
    solBalanceState, setSolBalanceState,
    usdcBalanceState, setUsdcBalanceState,
    solCid, setSolCid,
    usdcCid, setUsdcCid,
    amounts, setAmounts,
    ciphertexts, setCiphertexts,
    regTxSig, setRegTxSig,
    jobTxSig, setJobTxSig,
    jobPda, setJobPda,
    resultCid, setResultCid,
    decryptedResult, setDecryptedResult,
    operation, setOperation
  };
}

