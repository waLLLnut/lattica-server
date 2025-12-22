// src/app/api/state/route.ts
// Cold Start용 초기 상태 조회 API
// 특정 owner의 모든 확정된(confirmed) 암호문을 스냅샷으로 반환

import { NextRequest, NextResponse } from 'next/server';
import { CiphertextRepository } from '@/lib/store/ciphertext-repository';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:State');

/**
 * GET /api/state?owner={wallet}
 * 
 * Cold Start용 초기 상태 조회
 * 
 * Query Parameters:
 * - owner: 지갑 주소 (Solana PublicKey, Base58) - 필수
 * 
 * Returns:
 * - items: 확정된 암호문 배열 (CiphertextRedisPayload[])
 * 
 * @example
 * GET /api/state?owner=WalletAddress...
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get('owner');

    if (!owner) {
      return NextResponse.json(
        { error: 'owner parameter is required' },
        { status: 400 }
      );
    }

    // Owner별 확정된 암호문 조회
    const items = await CiphertextRepository.getByOwner(owner);

    log.info('State snapshot retrieved', { owner, count: items.length });

    return NextResponse.json({
      items,
      count: items.length,
    });
  } catch (error) {
    log.error('Failed to fetch state', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

