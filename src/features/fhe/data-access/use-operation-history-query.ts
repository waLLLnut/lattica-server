// src/features/fhe/data-access/use-operation-history-query.ts
// 대시보드에서 사용자의 활동 내역을 보여주는 React Query 훅

import { useQuery } from '@tanstack/react-query';
import { useSolana } from '@/components/solana/use-solana';

export interface OperationHistoryItem {
  signature: string;
  type: string;
  operation: string;
  blockTime: number | null;
  resultHandle: string | null;
  inputHandles: string[];
  slot: number;
  createdAt: Date;
}

export function useOperationHistoryQuery(limit = 20, offset = 0) {
  const { account } = useSolana();
  const address = account?.address?.toString();

  return useQuery({
    queryKey: ['operation-history', address, limit, offset],
    queryFn: async (): Promise<OperationHistoryItem[]> => {
      if (!address) return [];
      const res = await fetch(
        `/api/query/history?caller=${encodeURIComponent(address)}&limit=${limit}&offset=${offset}`
      );
      if (!res.ok) {
        throw new Error('Failed to fetch history');
      }
      const data = await res.json();
      return data.history || [];
    },
    enabled: !!address,
    refetchInterval: 5000, // 5초마다 갱신 (새로운 블록체인 트랜잭션 확인용)
    staleTime: 1000 * 2, // 2초간 Fresh (자주 갱신되므로 짧게)
  });
}

