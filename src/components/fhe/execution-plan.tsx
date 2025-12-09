'use client';

interface ExecutionPlanProps {
  operation: 'deposit' | 'withdraw' | 'borrow' | string;
}

export function ExecutionPlan({ operation }: ExecutionPlanProps) {
  return (
    <div className="mb-5 p-4 bg-[#1a1a2e] rounded-lg border-2 border-[#0f0]">
      <div className="text-base font-bold text-[#0f0] mb-3">
        FHE Execution Plan
      </div>
      
      {operation === 'deposit' && (
        <div className="font-mono text-sm">
          <div className="p-2 bg-[#0a0a0a] rounded mb-2 border border-[#3b82f6]">
            <span className="text-[#3b82f6]">(1)</span> = ADD(<span className="text-[#3b82f6]">(1)</span>, <span className="text-[#10b981]">(2)</span>)
          </div>
          <div className="text-xs text-[#888] mt-2">
            → SOL Balance = SOL Balance + Deposit Amount
          </div>
        </div>
      )}
      
      {operation === 'borrow' && (
        <div className="font-mono text-sm">
          <div className="p-2 bg-[#0a0a0a] rounded mb-1.5 border border-[#666]">
            <span className="text-[#888]">(a)</span> = MUL_CONST(<span className="text-[#8b5cf6]">(3)</span>, 2)
          </div>
          <div className="p-2 bg-[#0a0a0a] rounded mb-1.5 border border-[#666]">
            <span className="text-[#888]">(b)</span> = GE(<span className="text-[#3b82f6]">(1)</span>, <span className="text-[#888]">(a)</span>)
          </div>
          <div className="p-2 bg-[#0a0a0a] rounded mb-1.5 border border-[#666]">
            <span className="text-[#888]">(d)</span> = ADD(<span className="text-[#f59e0b]">(4)</span>, <span className="text-[#8b5cf6]">(3)</span>)
          </div>
          <div className="p-2 bg-[#0a0a0a] rounded mb-2 border border-[#f59e0b]">
            <span className="text-[#f59e0b]">(4)</span> = SELECT(<span className="text-[#888]">(b)</span>, <span className="text-[#888]">(d)</span>, <span className="text-[#f59e0b]">(4)</span>)
          </div>
          <div className="text-xs text-[#888] mt-2">
            → If SOL ≥ Borrow×2: USDC = USDC + Borrow<br/>
            → Else: USDC = USDC (no change)
          </div>
        </div>
      )}
      
      {operation === 'withdraw' && (
        <div className="font-mono text-sm">
          <div className="p-2 bg-[#0a0a0a] rounded mb-1.5 border border-[#666]">
            <span className="text-[#888]">(a)</span> = GE(<span className="text-[#f59e0b]">(4)</span>, <span className="text-[#ef4444]">(5)</span>)
          </div>
          <div className="p-2 bg-[#0a0a0a] rounded mb-1.5 border border-[#666]">
            <span className="text-[#888]">(b)</span> = SUB(<span className="text-[#f59e0b]">(4)</span>, <span className="text-[#ef4444]">(5)</span>)
          </div>
          <div className="p-2 bg-[#0a0a0a] rounded mb-2 border border-[#f59e0b]">
            <span className="text-[#f59e0b]">(4)</span> = SELECT(<span className="text-[#888]">(a)</span>, <span className="text-[#888]">(b)</span>, <span className="text-[#f59e0b]">(4)</span>)
          </div>
          <div className="text-xs text-[#888] mt-2">
            → If USDC ≥ Withdraw: USDC = USDC - Withdraw<br/>
            → Else: USDC = USDC (no change)
          </div>
        </div>
      )}
    </div>
  );
}

