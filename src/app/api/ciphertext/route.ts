// src/app/api/ciphertext/route.ts
// 암호문 업로드 API (Pre-register)
// Solana 트랜잭션 전에 암호문 데이터를 Redis에 저장

import { NextRequest, NextResponse } from 'next/server';
import { CiphertextStore } from '@/lib/store/ciphertext-store';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:Ciphertext');

export async function POST(req: NextRequest) {
  try {
    const { handle, ciphertext, owner, clientTag } = await req.json();

    // 필수 필드 검증
    if (!handle || !ciphertext || !owner) {
      return NextResponse.json(
        { error: 'Missing required fields: handle, ciphertext, owner' },
        { status: 400 }
      );
    }

    // Handle 형식 검증 (hex string, 64자 = 32 bytes)
    if (typeof handle !== 'string' || handle.length !== 64) {
      return NextResponse.json(
        { error: 'Invalid handle format. Expected 64-character hex string (32 bytes)' },
        { status: 400 }
      );
    }

    // Ciphertext 형식 검증 (Base64 string)
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
      return NextResponse.json(
        { error: 'Invalid ciphertext format. Expected non-empty Base64 string' },
        { status: 400 }
      );
    }

    // Owner 형식 검증 (Base58 PublicKey)
    if (typeof owner !== 'string' || owner.length < 32 || owner.length > 44) {
      return NextResponse.json(
        { error: 'Invalid owner format. Expected valid Solana PublicKey (base58)' },
        { status: 400 }
      );
    }

    // Redis에 저장
    await CiphertextStore.save(
      handle,
      ciphertext,
      owner,
      clientTag || ''
    );

    log.info('Ciphertext uploaded', { handle, owner });

    return NextResponse.json({
      success: true,
      message: 'Ciphertext stored successfully. You can now sign the transaction.',
      handle,
    });
  } catch (error) {
    log.error('Upload failed', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}



