// src/app/api/query/ciphertext/[handle]/route.ts
// 특정 핸들의 암호문 데이터와 상태를 조회

import { NextResponse } from 'next/server';
import { CiphertextRepository } from '@/lib/store/ciphertext-repository';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;

    if (!handle) {
      return NextResponse.json(
        { error: 'Handle parameter is required' },
        { status: 400 }
      );
    }

    // 1. Redis/DB에서 조회 (Look-aside)
    const data = await CiphertextRepository.get(handle);

    if (!data) {
      return NextResponse.json(
        { error: 'Ciphertext not found' },
        { status: 404 }
      );
    }

    // 2. 응답 반환
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch ciphertext:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

