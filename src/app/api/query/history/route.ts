// src/app/api/query/history/route.ts
// 현재 연결된 지갑의 연산 내역을 조회

import { NextResponse } from 'next/server';
import { OperationLogRepository } from '@/lib/store/operation-log-repository';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const caller = searchParams.get('caller');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!caller) {
      return NextResponse.json(
        { error: 'Caller address required' },
        { status: 400 }
      );
    }

    // 유효성 검사
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'Limit must be between 1 and 100' },
        { status: 400 }
      );
    }

    if (isNaN(offset) || offset < 0) {
      return NextResponse.json(
        { error: 'Offset must be non-negative' },
        { status: 400 }
      );
    }

    const history = await OperationLogRepository.getHistoryByCaller(
      caller,
      limit,
      offset
    );

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Failed to fetch history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}

