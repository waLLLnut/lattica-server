'use client';

import { FHEProvider } from '@/components/fhe/fhe-provider';
import { LogConsole } from '@/components/fhe/log-console';
import { StepCard } from '@/components/fhe/step-card';
import { ExecutionPlan } from '@/components/fhe/execution-plan';
import { ConfidentialVariableCard } from '@/components/fhe/confidential-variable-card';
import { useDemoLogic } from '@/hooks/use-demo-logic';
import { WalletDropdown } from '@/components/wallet-dropdown';

function DemoContent() {
  const logic = useDemoLogic(); // 모든 상태와 로직을 여기서 가져옴

  return (
    <div className="max-w-6xl mx-auto p-5 font-mono bg-[#0a0a0a] text-[#0f0] min-h-screen">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl m-0 font-bold">LatticA FHE Demo</h1>
        <div className="flex items-center gap-4">
          {/* Status Indicators */}
          <div className="text-xs text-[#666]">
            WASM: <span className={logic.moduleReady ? "text-[#0f0]" : "text-yellow-500"}>
              {logic.moduleReady ? "Ready" : "Loading"}
            </span>
          </div>
        </div>
      </div>

      {/* Dashboard: Confidential Variables */}
      <StepCard title="Confidential Variables" isActive={true} isCompleted={!!logic.solCid}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ConfidentialVariableCard 
            label="(1) SOL Balance" 
            value={logic.confidentialSOL} 
            state={logic.solBalanceState} 
            ciphertext={logic.ciphertexts.sol} 
            cid={logic.solCid} 
            color="#3b82f6" 
          />
          <ConfidentialVariableCard 
            label="(4) USDC Balance" 
            value={logic.confidentialUSDC} 
            state={logic.usdcBalanceState} 
            ciphertext={logic.ciphertexts.usdc} 
            cid={logic.usdcCid} 
            color="#f59e0b" 
          />
          {logic.ciphertexts[logic.operation] && (
            <ConfidentialVariableCard 
              label={`(2) ${logic.operation.charAt(0).toUpperCase() + logic.operation.slice(1)} Amount`} 
              value={logic.amounts[logic.operation]} 
              state="encrypted" 
              ciphertext={logic.ciphertexts[logic.operation]} 
              color="#10b981" 
            />
          )}
        </div>
      </StepCard>

      {/* Step 1: Prepare */}
      <StepCard 
        title="Step 1: Prepare Transaction" 
        description="Select operation and encrypt inputs locally." 
        isActive={logic.moduleReady}
        isCompleted={!!logic.ciphertexts[logic.operation]}
      >
        <div className="mb-4">
          <label className="font-bold mr-2">Operation:</label>
          <select 
            value={logic.operation} 
            onChange={(e) => logic.setOperation(e.target.value as 'deposit' | 'withdraw' | 'borrow')}
            className="bg-black text-[#0f0] border border-[#0f0] p-2 rounded cursor-pointer"
          >
            <option value="deposit">Deposit</option>
            <option value="withdraw">Withdraw</option>
            <option value="borrow">Borrow</option>
          </select>
        </div>

        <ExecutionPlan operation={logic.operation} />

        <div className="flex gap-4 items-center mt-4 flex-wrap">
          <div>
            <label className="font-bold block text-xs mb-1 text-[#888]">Amount</label>
            <input 
              type="number" 
              value={logic.amounts[logic.operation]} 
              onChange={(e) => logic.setAmounts(prev => ({ ...prev, [logic.operation]: e.target.value }))}
              className="bg-black text-white border border-[#555] p-2 w-32 rounded"
            />
          </div>
          <button 
            onClick={logic.handleEncrypt} 
            disabled={!logic.moduleReady}
            className="px-6 py-2 bg-[#0f0] text-black font-bold rounded hover:bg-[#00cc00] self-end disabled:bg-[#555] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Encrypt Input
          </button>
        </div>
        
        {/* Ciphertext Preview */}
        {logic.ciphertexts[logic.operation] && (
           <div className="mt-4 p-3 bg-[#1a3a1a] border border-[#0f0] rounded text-xs text-[#0f0]">
             ✓ Input Encrypted ({logic.ciphertexts[logic.operation]?.encrypted_data.length} ints)
           </div>
        )}
      </StepCard>

      {/* Step 2: Register */}
      <StepCard 
        title="Step 2: Register CIDs" 
        description="Submit encrypted data to Solana blockchain."
        isActive={!!logic.ciphertexts[logic.operation]} 
        isCompleted={!!logic.regTxSig}
      >
        <p className="text-sm text-[#888] mb-3">Register encrypted input handle on-chain via Solana Actions API.</p>
        <button 
          onClick={logic.handleRegisterCIDs} 
          disabled={!logic.publicKey || !logic.ciphertexts[logic.operation]}
          className="px-6 py-3 bg-[#0f0] text-black font-bold rounded disabled:bg-[#555] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Register via Solana Actions
        </button>
        {logic.regTxSig && (
          <div className="mt-3 p-2 bg-[#1a3a1a] border border-[#0f0] rounded text-xs break-all font-mono">
            Tx: {logic.regTxSig}
          </div>
        )}
      </StepCard>

      {/* Step 3: Submit Job */}
      <StepCard 
        title="Step 3: Submit Job" 
        description="Request FHE computation on encrypted CIDs."
        isActive={!!logic.regTxSig} 
        isCompleted={!!logic.jobTxSig}
      >
        <p className="text-sm text-[#888] mb-3">Submit computation job to FHE executor with registered CIDs.</p>
        <button 
          onClick={logic.handleSubmitJob} 
          disabled={!logic.regTxSig}
          className="px-6 py-3 bg-[#0f0] text-black font-bold rounded disabled:bg-[#555] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Submit to FHE Executor
        </button>
        {logic.jobTxSig && (
          <div className="mt-3 p-2 bg-[#1a3a1a] border border-[#0f0] rounded text-xs font-mono">
            <div>Tx: {logic.jobTxSig}</div>
            <div className="mt-1 text-[#0f0]">Job PDA: {logic.jobPda}</div>
          </div>
        )}
        {logic.resultCid && (
          <div className="mt-3 p-2 bg-[#1a3a1a] border border-[#ff0] rounded text-xs text-[#ff0] font-mono">
            Result CID: {logic.resultCid}
          </div>
        )}
      </StepCard>

      {/* Step 4: Decrypt */}
      <StepCard 
        title="Step 4: Decrypt Result" 
        description="Decrypt and display the computation result."
        isActive={!!logic.resultCid} 
        isCompleted={!!logic.decryptedResult}
      >
        <button 
          onClick={logic.handleDecrypt} 
          disabled={!logic.resultCid}
          className="px-6 py-3 bg-[#ff0] text-black font-bold rounded disabled:bg-[#555] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Decrypt Result
        </button>
        {logic.decryptedResult && (
          <div className="mt-4 p-4 border-2 border-[#ff0] text-[#ff0] font-bold text-xl rounded bg-[#3a3a1a]">
            Result: {logic.decryptedResult}
          </div>
        )}
      </StepCard>

      <LogConsole />
    </div>
  );
}

export default function DemoPage() {
  return (
    <FHEProvider>
      <DemoContent />
    </FHEProvider>
  );
}
