import { useState, useEffect, useMemo } from 'react';
import { useFHE } from '@/features/fhe/ui/fhe-provider';
import { useSolana } from '@/components/solana/use-solana';
import { useFheActions } from '@/features/fhe/data-access/use-fhe-actions';
import { Ciphertext, Fhe16BinaryOp } from '@/types/fhe';
import { useEventSubscription } from '@/hooks/use-event-subscription';
import { useConfidentialStateStore } from '@/lib/store/confidential-state-store';
import { isUserEvent } from '@/types/pubsub';

export type Operation = 'deposit' | 'withdraw' | 'borrow';
export type BalanceState = 'initial' | 'encrypted' | 'decrypted';

export function useDemoLogic() {
  const { account } = useSolana();
  const { encryptValue, moduleReady, addLog } = useFHE();
  
  // ★ useFheActions 훅 사용
  const { registerInputHandle, requestBinaryOp, loading: isActionLoading } = useFheActions();
  
  // ★ Confidential State Store
  const {
    registerInputHandle: storeRegisterInputHandle,
    requestOperation,
    submitTransaction,
    failTransaction,
    getItem,
    getItemsByOwner,
    handleEvent,
  } = useConfidentialStateStore();
  
  // ★ SSE 이벤트 구독
  const { isConnected, lastEventId } = useEventSubscription({
    channel: 'user',
    wallet: account?.address,
    enabled: !!account?.address,
    onEvent: (message) => {
      // User 이벤트만 처리
      if (isUserEvent(message)) {
        handleEvent(message);
        addLog(`Event received: ${message.eventType}`, 'info', 'SSE');
        
        // 데모 페이지 한정: client_tag 기반 밸런스 핸들 실시간 업데이트
        if (
          message.payload.type === 'user.ciphertext.confirmed' ||
          message.payload.type === 'user.ciphertext.registered'
        ) {
          const payload = message.payload as { handle?: string; clientTag?: string };
          const clientTag = payload.clientTag;
          
          if (clientTag === 'sol_balance' && payload.handle) {
            setSolHandle(payload.handle);
            addLog(`Sol Balance handle updated: ${payload.handle.slice(0, 16)}...`, 'info', 'Balance');
          } else if (clientTag === 'usdc_balance' && payload.handle) {
            setUsdcHandle(payload.handle);
            addLog(`USDC Balance handle updated: ${payload.handle.slice(0, 16)}...`, 'info', 'Balance');
          }
        }
      }
    },
    onError: (error) => {
      addLog(`SSE error: ${error.message}`, 'error', 'SSE');
    },
    onConnect: () => {
      addLog('SSE connected', 'info', 'SSE');
    },
    onDisconnect: () => {
      addLog('SSE disconnected', 'warn', 'SSE');
    },
  });

  // --- State Variables ---
  // Handles (CIDs) - 초기화용으로만 사용, 실제 상태는 Store에서 관리
  const [solHandle, setSolHandle] = useState('');
  const [usdcHandle, setUsdcHandle] = useState('');

  // Store의 items를 구독하여 변경 감지
  const storeItems = useConfidentialStateStore((state) => state.items);
  
  // Store의 특정 핸들 아이템 가져오기 (useMemo로 캐싱하여 무한 루프 방지)
  const solItem = useMemo(() => {
    if (!solHandle) return undefined;
    return storeItems.get(solHandle);
  }, [solHandle, storeItems]);
  
  const usdcItem = useMemo(() => {
    if (!usdcHandle) return undefined;
    return storeItems.get(usdcHandle);
  }, [usdcHandle, storeItems]);

  // Store 기반 Derived State (단일 소스 원칙)
  // SOL 잔고 및 상태 - Store의 solItem을 직접 구독하여 자동 업데이트
  const { confidentialSOL, solBalanceState } = useMemo(() => {
    if (!solHandle || !solItem) {
      return { confidentialSOL: '0', solBalanceState: 'initial' as BalanceState };
    }

    // Store 상태에 따라 balance state 결정
    let balanceState: BalanceState = 'initial';
    if (solItem.status === 'CONFIRMED') {
      balanceState = 'decrypted';
    } else if (solItem.status === 'OPTIMISTIC' || solItem.status === 'SUBMITTING') {
      balanceState = 'encrypted';
    }

    // 상태에 따라 표시할 값 결정
    let balance = '0';
    if (solItem.status === 'CONFIRMED') {
      balance = '0'; // 초기화 값은 0
    } else if (solItem.status === 'OPTIMISTIC' || solItem.status === 'SUBMITTING') {
      balance = '...'; // 중간 상태 표시
    }

    return { confidentialSOL: balance, solBalanceState: balanceState };
  }, [solHandle, solItem]);

  // USDC 잔고 및 상태 - Store의 usdcItem을 직접 구독하여 자동 업데이트
  const { confidentialUSDC, usdcBalanceState } = useMemo(() => {
    if (!usdcHandle || !usdcItem) {
      return { confidentialUSDC: '0', usdcBalanceState: 'initial' as BalanceState };
    }

    // Store 상태에 따라 balance state 결정
    let balanceState: BalanceState = 'initial';
    if (usdcItem.status === 'CONFIRMED') {
      balanceState = 'decrypted';
    } else if (usdcItem.status === 'OPTIMISTIC' || usdcItem.status === 'SUBMITTING') {
      balanceState = 'encrypted';
    }

    // 상태에 따라 표시할 값 결정
    let balance = '0';
    if (usdcItem.status === 'CONFIRMED') {
      balance = '0'; // 초기화 값은 0
    } else if (usdcItem.status === 'OPTIMISTIC' || usdcItem.status === 'SUBMITTING') {
      balance = '...'; // 중간 상태 표시
    }

    return { confidentialUSDC: balance, usdcBalanceState: balanceState };
  }, [usdcHandle, usdcItem]);

  // Store에서 가져온 handle을 ciphertext 형태로 변환
  // CONFIRMED 상태일 때만 핸들 값 표시 (OPTIMISTIC/SUBMITTING은 중간 상태 표시)
  const solCiphertext = useMemo(() => {
    if (solHandle && solItem && solItem.status === 'CONFIRMED') {
      return {
        handle: solHandle,
        encrypted_data: [] as number[], // Store에 저장된 데이터는 IndexedDB에 있음
        timestamp: solItem.createdAt,
      } as Ciphertext;
    }
    return null;
  }, [solHandle, solItem]);

  const usdcCiphertext = useMemo(() => {
    if (usdcHandle && usdcItem && usdcItem.status === 'CONFIRMED') {
      return {
        handle: usdcHandle,
        encrypted_data: [] as number[], // Store에 저장된 데이터는 IndexedDB에 있음
        timestamp: usdcItem.createdAt,
      } as Ciphertext;
    }
    return null;
  }, [usdcHandle, usdcItem]);

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


  // --- 초기화: Store에서 client_tag 기반 밸런스 핸들 찾기 ---
  // Store의 items 크기를 구독하여 변경 시 자동으로 업데이트 (Map 참조 동일성 문제 방지)
  const storeItemsSize = useConfidentialStateStore((state) => state.items.size);
  
  useEffect(() => {
    if (account?.address) {
      const items = getItemsByOwner(account.address);
      
      // client_tag가 'sol_balance'인 최신 아이템 찾기 (confirmedAt 또는 createdAt 기준)
      const solBalanceItems = items
        .filter(item => item.clientTag === 'sol_balance')
        .sort((a, b) => (b.confirmedAt || b.createdAt) - (a.confirmedAt || a.createdAt));
      
      if (solBalanceItems.length > 0) {
        const latestSol = solBalanceItems[0];
        // 현재 solHandle과 다를 때만 업데이트
        if (solHandle !== latestSol.handle) {
          setSolHandle(latestSol.handle);
          addLog(`Sol Balance handle updated from Store: ${latestSol.handle.slice(0, 16)}...`, 'info', 'Init');
        }
      }
      
      // client_tag가 'usdc_balance'인 최신 아이템 찾기
      const usdcBalanceItems = items
        .filter(item => item.clientTag === 'usdc_balance')
        .sort((a, b) => (b.confirmedAt || b.createdAt) - (a.confirmedAt || a.createdAt));
      
      if (usdcBalanceItems.length > 0) {
        const latestUsdc = usdcBalanceItems[0];
        // 현재 usdcHandle과 다를 때만 업데이트
        if (usdcHandle !== latestUsdc.handle) {
          setUsdcHandle(latestUsdc.handle);
          addLog(`USDC Balance handle updated from Store: ${latestUsdc.handle.slice(0, 16)}...`, 'info', 'Init');
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address, storeItemsSize, solHandle, usdcHandle]);

  // --- Actions ---
  // 1. Encrypt Input
  const handleEncrypt = () => {
    const amount = amounts[operation];
    const prevCt = ciphertexts[operation];
    addLog(`Encrypting ${operation} amount: ${amount}...`, 'info', 'Encrypt');
    const ct = encryptValue(amount);
    if (ct) {
      const isReEncrypt = prevCt !== null && prevCt.handle !== ct.handle;
      setCiphertexts(prev => ({ ...prev, [operation]: ct }));
      if (isReEncrypt) {
        addLog(`Re-encryption successful! New handle: ${ct.handle.slice(0, 16)}... (Previous: ${prevCt.handle.slice(0, 16)}...)`, 'info', 'Encrypt');
      } else {
        addLog(`Encryption successful! Handle: ${ct.handle.slice(0, 16)}...`, 'info', 'Encrypt');
      }
    }
  };

  // 0. Initialize Balance (잔액 0짜리 handle 생성)
  const handleInitializeBalance = async (balanceType: 'sol' | 'usdc') => {
    if (!account?.address) {
      addLog('Connect wallet first', 'warn', 'Init');
      return;
    }

    try {
      // 잔액 0을 암호화
      const zeroCt = encryptValue('0');
      if (!zeroCt) {
        addLog('Failed to encrypt zero value', 'error', 'Init');
        return;
      }

      const clientTag = balanceType === 'sol' ? 'sol_balance' : 'usdc_balance';
      
      // 1. Store에 Optimistic 상태 생성 (Void → OPTIMISTIC)
      const handle = storeRegisterInputHandle(
        zeroCt.encrypted_data,
        account.address,
        undefined, // signature는 나중에 업데이트
        clientTag
      );
      addLog(`Optimistic state created for ${balanceType} balance: ${handle.slice(0, 16)}...`, 'info', 'Init');

      // 2. 트랜잭션 전송
      const signature = await registerInputHandle(handle, zeroCt.encrypted_data);
      
      if (signature) {
        // 3. Store 상태 전이 (OPTIMISTIC → SUBMITTING)
        submitTransaction(handle);
        
        // 4. 핸들 상태 업데이트
        if (balanceType === 'sol') {
          setSolHandle(handle);
        } else {
          setUsdcHandle(handle);
        }
        
        addLog(`${balanceType.toUpperCase()} balance initialized with signature: ${signature.slice(0, 8)}...`, 'info', 'Init');
      }
    } catch (e) {
      console.error(e);
      addLog(`Initialize ${balanceType} balance failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 'Init');
    }
  };

  // 1. Register Input (Real Wallet)
  const handleRegister = async () => {
    const ct = ciphertexts[operation];
    if (!ct) {
      addLog('Encrypt first', 'warn', 'Register');
      return;
    }

    if (!account?.address) {
      addLog('Connect wallet first', 'warn', 'Register');
      return;
    }

    try {
      // 1. Store에 Optimistic 상태 생성 (Void → OPTIMISTIC)
      storeRegisterInputHandle(
        ct.encrypted_data,
        account.address,
        undefined, // signature는 나중에 업데이트
        ct.handle // clientTag로 handle 사용
      );
      addLog(`Optimistic state created for handle: ${ct.handle.slice(0, 16)}...`, 'info', 'Register');

      // 2. 트랜잭션 전송 (useFheActions의 함수 호출)
      const signature = await registerInputHandle(ct.handle, ct.encrypted_data);
      
      if (signature) {
        setRegTxSig(signature);
        setInputHandles(prev => ({ ...prev, [operation]: ct.handle }));
        
        // 3. Store 상태 전이 (OPTIMISTIC → SUBMITTING)
        submitTransaction(ct.handle);
        
        addLog(`Registered with signature: ${signature.slice(0, 8)}...`, 'info', 'Register');
      }
    } catch (e) {
      // 에러 발생 시 optimistic 상태 롤백
      const item = getItem(ct.handle);
      if (item && item.status === 'OPTIMISTIC') {
        failTransaction(ct.handle);
      }
      console.error(e);
      addLog(`Register failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 'Register');
    }
  };

  // 2. Request Operation (Real Wallet)
  const handleSubmitJob = async () => {
    if (!account?.address) {
      addLog('Connect wallet first', 'warn', 'OpRequest');
      return;
    }

    let predictedHandle: string | null = null;
    
    try {
      // 파라미터 준비
      let opCode: number = Fhe16BinaryOp.Add;
      let lhs = '';
      let rhs = '';

      if (operation === 'deposit') {
        if (!solHandle || !inputHandles.deposit) {
          addLog(`Missing handles for deposit: solHandle=${!!solHandle ? solHandle.slice(0, 16) + '...' : 'MISSING'}, deposit=${!!inputHandles.deposit ? inputHandles.deposit.slice(0, 16) + '...' : 'MISSING'}`, 'error', 'OpRequest');
          return;
        }
        opCode = Fhe16BinaryOp.Add;
        lhs = solHandle;
        rhs = inputHandles.deposit;
        addLog(`Using handles: lhs=${lhs.slice(0, 16)}..., rhs=${rhs.slice(0, 16)}...`, 'info', 'OpRequest');
      } else if (operation === 'withdraw') {
        if (!usdcHandle || !inputHandles.withdraw) {
          addLog(`Missing handles for withdraw: usdcHandle=${!!usdcHandle ? usdcHandle.slice(0, 16) + '...' : 'MISSING'}, withdraw=${!!inputHandles.withdraw ? inputHandles.withdraw.slice(0, 16) + '...' : 'MISSING'}`, 'error', 'OpRequest');
          return;
        }
        opCode = Fhe16BinaryOp.Sub;
        lhs = usdcHandle;
        rhs = inputHandles.withdraw;
        addLog(`Using handles: lhs=${lhs.slice(0, 16)}..., rhs=${rhs.slice(0, 16)}...`, 'info', 'OpRequest');
      } else if (operation === 'borrow') {
        if (!solHandle || !usdcHandle || !inputHandles.borrow) {
          addLog(`Missing handles for borrow: solHandle=${!!solHandle ? solHandle.slice(0, 16) + '...' : 'MISSING'}, usdcHandle=${!!usdcHandle ? usdcHandle.slice(0, 16) + '...' : 'MISSING'}, borrow=${!!inputHandles.borrow ? inputHandles.borrow.slice(0, 16) + '...' : 'MISSING'}`, 'error', 'OpRequest');
          return;
        }
        opCode = Fhe16BinaryOp.Add;
        lhs = usdcHandle;
        rhs = inputHandles.borrow;
        addLog(`Using handles: lhs=${lhs.slice(0, 16)}..., rhs=${rhs.slice(0, 16)}...`, 'info', 'OpRequest');
      }

      // 입력 핸들이 Store에 존재하는지 확인 (상태 전이 규칙 검증)
      const missingInputs: string[] = [];
      if (!getItem(lhs)) missingInputs.push(`lhs: ${lhs.slice(0, 16)}...`);
      if (!getItem(rhs)) missingInputs.push(`rhs: ${rhs.slice(0, 16)}...`);
      
      if (missingInputs.length > 0) {
        addLog(`Input handles not in Store: ${missingInputs.join(', ')}. Please register them first.`, 'error', 'OpRequest');
        return;
      }
      
      addLog('All input handles validated in Store', 'info', 'OpRequest');
      
      if (missingInputs.length > 0) {
        addLog(`Input handles not in Store: ${missingInputs.join(', ')}. Please register them first.`, 'error', 'OpRequest');
        return;
      }
      
      addLog('All input handles validated in Store', 'info', 'OpRequest');

      // 1. Store에 Optimistic 상태 생성 (Void → OPTIMISTIC)
      // 연산 타입은 'BINARY_{opEnum}' 형식이어야 함
      const opType = `BINARY_${opCode}`;
      predictedHandle = await requestOperation(
        opType,
        [lhs, rhs],
        account.address,
        undefined, // signature는 나중에 업데이트
        `${operation}_${Date.now()}` // clientTag
      );
      
      if (predictedHandle) {
        addLog(`🔮 Handle Prediction: ${predictedHandle.slice(0, 8)}...`, 'info', 'Prediction');
        setResultHandle(predictedHandle);
      }

      // 2. 실제 트랜잭션 요청 및 서명
      const signature = await requestBinaryOp(opCode, lhs, rhs);

      if (signature && predictedHandle) {
        setOpTxSig(signature);
        
        // 3. Store 상태 전이 (OPTIMISTIC → SUBMITTING)
        submitTransaction(predictedHandle);
        
        addLog('Operation submitted successfully', 'info', 'OpRequest');
      }

    } catch (e) {
      console.error(e);
      addLog(`Operation failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 'OpRequest');
      // 에러 발생 시 optimistic 상태 롤백
      if (predictedHandle) {
        const item = getItem(predictedHandle);
        if (item && item.status === 'OPTIMISTIC') {
          failTransaction(predictedHandle);
        }
      }
    }
  };

  // 3. Decrypt (Demo Mock)
  // 실제 복호화는 서버 Re-encryption -> Client Decryption이 필요하지만 
  // 여기서는 데모 흐름을 위해 Mocking 유지 (혹은 별도 API 구현)
  // Note: Store 기반으로 변경되어 잔고는 자동으로 업데이트됨
  const handleDecrypt = async () => {
    if (!resultHandle) return;

    addLog('Decrypting result...', 'info', 'Decrypt');
    
    // Store에서 결과 핸들의 상태 확인
    const resultItem = getItem(resultHandle);
    if (!resultItem || resultItem.status !== 'CONFIRMED') {
      addLog('Result not confirmed yet', 'warn', 'Decrypt');
      return;
    }

    setTimeout(() => {
        // Store 상태에 따라 자동으로 업데이트되므로, 여기서는 계산만 수행
        let newVal = 0;
        if (operation === 'deposit') {
            newVal = parseInt(confidentialSOL) + parseInt(amounts.deposit);
        } else if (operation === 'withdraw') {
            newVal = parseInt(confidentialUSDC) - parseInt(amounts.withdraw);
        } else if (operation === 'borrow') {
            newVal = parseInt(confidentialUSDC) + parseInt(amounts.borrow);
        }
        setDecryptedResult(newVal.toString());
        addLog('Decryption Complete!', 'info', 'Decrypt');
    }, 1000);
  };

  // Store에서 상태 동기화 (SSE 이벤트로 업데이트된 상태 반영)
  useEffect(() => {
    if (account?.address) {
      const storeItems = getItemsByOwner(account.address);
      // Store의 CONFIRMED 상태를 로컬 상태와 동기화
      storeItems.forEach((item) => {
        if (item.status === 'CONFIRMED') {
          // 결과 핸들이면 resultHandle 업데이트
          if (item.handle === resultHandle || item.predictedHandle === resultHandle) {
            setResultHandle(item.handle);
          }
          // 입력 핸들이면 inputHandles 업데이트
          if (item.handle && inputHandles[operation] !== item.handle) {
            // 해당 operation의 handle인지 확인 필요
          }
        }
      });
    }
  }, [account?.address, getItemsByOwner, resultHandle, inputHandles, operation]);

  return {
    confidentialSOL, confidentialUSDC,
    solBalanceState, usdcBalanceState,
    solHandle, usdcHandle,
    solCiphertext, usdcCiphertext, // Store에서 가져온 ciphertext
    amounts, setAmounts,
    ciphertexts, operation, setOperation,
    regTxSig, opTxSig, resultHandle, decryptedResult,
    inputHandles,
    handleEncrypt, handleRegister, handleSubmitJob, handleDecrypt, handleInitializeBalance,
    publicKey: account?.address,
    moduleReady,
    isRegistering,
    // SSE 연결 상태 추가
    sseConnected: isConnected,
    lastEventId,
  };
}

