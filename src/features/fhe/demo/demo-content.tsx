'use client';

import { LogConsole } from '@/features/fhe/ui/log-console';
import { EventMonitor } from '@/features/fhe/ui/event-monitor';
import { StepCard } from '@/features/fhe/ui/step-card';
import { ExecutionPlan } from '@/features/fhe/ui/execution-plan';
import { ConfidentialVariableCard } from '@/features/fhe/ui/confidential-variable-card';
import { useDemoLogic } from './use-demo-logic';
import { WalletDropdown } from '@/components/wallet-dropdown';

export function DemoContent() {
  const logic = useDemoLogic();

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'monospace', color: '#0f0', background: '#0a0a0a', minHeight: '100vh' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, fontWeight: 'bold' }}>LatticA FHE Demo</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
           <div style={{ fontSize: '12px', color: '#666' }}>
             WASM: <span style={{ color: logic.moduleReady ? '#0f0' : '#ebbc26' }}>{logic.moduleReady ? "Ready" : "Loading"}</span>
           </div>
          <WalletDropdown />
        </div>
      </div>

      {/* Dashboard */}
      <StepCard title="Confidential Variables" isActive={true} isCompleted={!!logic.solHandle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
          <div>
            <ConfidentialVariableCard 
              label="(1) SOL Balance" 
              value={logic.confidentialSOL} 
              state={logic.solBalanceState} 
              ciphertext={logic.solCiphertext || logic.ciphertexts.sol} 
              cid={logic.solHandle} 
              color="#3b82f6"
              actionButton={!logic.solHandle ? (
                <button 
                  onClick={() => logic.handleInitializeBalance('sol')}
                  disabled={!logic.publicKey || !logic.moduleReady}
                  style={{ 
                    width: '100%',
                    padding: '4px 8px', 
                    background: (!logic.publicKey || !logic.moduleReady) ? '#555' : '#3b82f6', 
                    color: '#fff', 
                    border: 'none', 
                    cursor: (!logic.publicKey || !logic.moduleReady) ? 'not-allowed' : 'pointer', 
                    fontWeight: 'bold',
                    fontSize: '10px',
                    opacity: (!logic.publicKey || !logic.moduleReady) ? 0.6 : 1,
                    borderRadius: '4px'
                  }}
                >
                  Initialize PDA
                </button>
              ) : undefined}
            />
          </div>
          <div>
            <ConfidentialVariableCard 
              label="(4) USDC Balance" 
              value={logic.confidentialUSDC} 
              state={logic.usdcBalanceState} 
              ciphertext={logic.usdcCiphertext || logic.ciphertexts.usdc} 
              cid={logic.usdcHandle} 
              color="#f59e0b"
              actionButton={!logic.usdcHandle ? (
                <button 
                  onClick={() => logic.handleInitializeBalance('usdc')}
                  disabled={!logic.publicKey || !logic.moduleReady}
                  style={{ 
                    width: '100%',
                    padding: '4px 8px', 
                    background: (!logic.publicKey || !logic.moduleReady) ? '#555' : '#f59e0b', 
                    color: '#fff', 
                    border: 'none', 
                    cursor: (!logic.publicKey || !logic.moduleReady) ? 'not-allowed' : 'pointer', 
                    fontWeight: 'bold',
                    fontSize: '10px',
                    opacity: (!logic.publicKey || !logic.moduleReady) ? 0.6 : 1,
                    borderRadius: '4px'
                  }}
                >
                  Initialize PDA
                </button>
              ) : undefined}
            />
          </div>
          {/* Input Preview Card */}
          {logic.ciphertexts[logic.operation] && (
             <ConfidentialVariableCard
                label={`(2) ${logic.operation.toUpperCase()} Amount`}
                value={logic.amounts[logic.operation]}
                state="encrypted"
                ciphertext={logic.ciphertexts[logic.operation]}
                color="#10b981"
             />
          )}
        </div>
      </StepCard>

      {/* Step 1 */}
      <StepCard 
        title="Step 1: Prepare" 
        description="Select operation & Encrypt inputs locally." 
        isActive={logic.moduleReady}
        isCompleted={!!logic.ciphertexts[logic.operation]}
      >
        <div style={{ marginBottom: '15px' }}>
          <label style={{ fontWeight: 'bold' }}>Operation: </label>
          <select 
            value={logic.operation} 
            onChange={(e) => logic.setOperation(e.target.value as 'deposit' | 'withdraw' | 'borrow')}
            style={{ background: '#000', color: '#0f0', border: '1px solid #0f0', padding: '5px', marginLeft: '10px' }}
          >
            <option value="deposit">Deposit</option>
            <option value="withdraw">Withdraw</option>
            <option value="borrow">Borrow</option>
          </select>
        </div>

        <ExecutionPlan operation={logic.operation} />

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '15px' }}>
          <input 
            type="number" 
            value={logic.amounts[logic.operation]} 
            onChange={(e) => logic.setAmounts(prev => ({ ...prev, [logic.operation]: e.target.value }))}
            style={{ background: '#000', color: '#fff', border: '1px solid #555', padding: '8px', width: '150px' }}
          />
          <button onClick={logic.handleEncrypt} style={{ background: '#0f0', color: '#000', border: 'none', padding: '8px 20px', cursor: 'pointer', fontWeight: 'bold' }}>
            Encrypt
          </button>
        </div>
      </StepCard>

      {/* Step 2 */}
      <StepCard 
        title="Step 2: Register" 
        isActive={!!logic.ciphertexts[logic.operation]} 
        isCompleted={!!logic.regTxSig}
      >
        <button 
          onClick={logic.handleRegister} 
          disabled={logic.isRegistering || !logic.publicKey || !logic.ciphertexts[logic.operation]}
          style={{ 
            padding: '10px 20px', 
            background: logic.isRegistering ? '#555' : '#0f0', 
            color: '#000', 
            border: 'none', 
            cursor: logic.isRegistering ? 'wait' : 'pointer', 
            fontWeight: 'bold',
            opacity: logic.isRegistering ? 0.6 : 1
          }}
        >
          {logic.isRegistering ? 'Registering...' : 'Register On-Chain'}
        </button>
        {logic.regTxSig && <div style={{ marginTop: '10px', fontSize: '12px', wordBreak: 'break-all' }}>Tx: {logic.regTxSig}</div>}
      </StepCard>

      {/* Step 3 */}
      <StepCard 
        title="Step 3: Request Op" 
        isActive={!!logic.regTxSig} 
        isCompleted={!!logic.opTxSig}
      >
        <button 
          onClick={logic.handleSubmitJob} 
          disabled={!logic.publicKey || !logic.regTxSig}
          style={{ 
            padding: '10px 20px', 
            background: (!logic.publicKey || !logic.regTxSig) ? '#555' : '#0f0', 
            color: '#000', 
            border: 'none', 
            cursor: (!logic.publicKey || !logic.regTxSig) ? 'not-allowed' : 'pointer', 
            fontWeight: 'bold',
            opacity: (!logic.publicKey || !logic.regTxSig) ? 0.6 : 1
          }}
        >
          Submit Operation Request
        </button>
        {logic.opTxSig && (
            <div style={{ marginTop: '10px', fontSize: '12px', wordBreak: 'break-all' }}>
                <div>Tx: {logic.opTxSig}</div>
                {logic.resultHandle && <div style={{ color: '#0f0', marginTop: '5px' }}>Result Handle: {logic.resultHandle}</div>}
            </div>
        )}
      </StepCard>

      {/* Step 4 */}
      <StepCard 
        title="Step 4: Decrypt" 
        isActive={!!logic.resultHandle} 
        isCompleted={!!logic.decryptedResult}
      >
        <button onClick={logic.handleDecrypt} style={{ padding: '10px 20px', background: '#ff0', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
          Decrypt Result
        </button>
        {logic.decryptedResult && (
          <div style={{ marginTop: '15px', padding: '10px', border: '2px solid #ff0', color: '#ff0', fontSize: '20px', fontWeight: 'bold', background: '#3a3a1a' }}>
            Result: {logic.decryptedResult}
          </div>
        )}
      </StepCard>

      <LogConsole />
      
      {/* Real-time Event Monitor */}
      <EventMonitor />
    </div>
  );
}

