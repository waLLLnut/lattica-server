// src/features/fhe/data-access/use-ciphertext-query.ts
// 결과값을 폴링하거나 조회할 때 사용하는 React Query 훅

import { useQuery } from '@tanstack/react-query';
import type { CiphertextRedisPayload } from '@/types/store';

export function useCiphertextQuery(handle: string | null) {
  return useQuery({
    queryKey: ['ciphertext', handle],
    queryFn: async () => {
      if (!handle) return null;
      const res = await fetch(`/api/query/ciphertext/${handle}`);
      if (!res.ok) {
        if (res.status === 404) {
          return null; // 404는 에러가 아닌 "없음"으로 처리
        }
        throw new Error('Failed to fetch ciphertext');
      }
      return res.json() as Promise<CiphertextRedisPayload>;
    },
    enabled: !!handle,
    staleTime: 1000 * 60 * 5, // 5분간 Fresh (암호문은 불변이므로 길게 잡아도 됨)
    retry: 2,
  });
}

