// src/lib/solana/handle.ts
// Rust 프로그램의 hashv 로직을 TypeScript로 정확히 포팅
// 결정적 핸들 계산을 위한 순수 함수

import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';

// Rust 프로그램의 상수와 100% 일치해야 함
const HANDLE_DOMAIN_UNARY = new TextEncoder().encode('FHE16_UNARY_V1');
const HANDLE_DOMAIN_BINARY = new TextEncoder().encode('FHE16_BINARY_V1');
const HANDLE_DOMAIN_TERNARY = new TextEncoder().encode('FHE16_TERNARY_V1');

// Helper: 여러 Uint8Array를 하나로 합침
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, val) => acc + val.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// Hex String <-> Uint8Array 변환
export function hexToBytes(hex: string): Uint8Array {
  return Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex');
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * [Core Logic] 입력 핸들 생성 (Input Handle Derivation)
 * 암호화된 데이터 배열로부터 결정적 핸들을 생성
 * 규칙: 신규 암호문의 등록의 경우 항상 SHA256 해시를 사용합니다. Solana의 hashv와 동일한 방식으로 계산됩니다.
 * @param encryptedData - 암호화된 데이터 배열 (number[])
 * @returns 32바이트 hex 문자열 핸들
 */
export function deriveInputHandle(encryptedData: number[]): string {
  // 암호화된 데이터 배열을 바이트 배열로 변환 (little-endian 32-bit integer)
  const ctBytes = Buffer.from(new Uint32Array(encryptedData).buffer);

  // SHA256 해시 계산 (Solana의 hashv와 동일한 방식)
  const hash = sha256(ctBytes);

  // 32바이트 해시를 hex 문자열로 변환
  return bytesToHex(hash);
}

/**
 * [Core Logic] 단항 연산 결과 핸들 미리 계산 (Prediction)
 * @param op - 연산자 Enum 값 (예: Not=0, Abs=1, Neg=2)
 * @param inputHandle - 입력 핸들 (32 bytes hex)
 * @param programIdString - 솔라나 프로그램 ID
 */
export function deriveUnaryHandle(
  op: number,
  inputHandle: string,
  programIdString: string
): string {
  try {
    const opByte = new Uint8Array([op]);
    const inputBytes = hexToBytes(inputHandle);
    const programIdBytes = new PublicKey(programIdString).toBuffer();

    // Hash Payload 구조: [DOMAIN, PROGRAM_ID, OP, INPUT]
    const payload = concatBytes(
      HANDLE_DOMAIN_UNARY,
      programIdBytes,
      opByte,
      inputBytes
    );

    const hash = sha256(payload);
    return bytesToHex(hash);
  } catch (e) {
    console.error('Handle derivation failed:', e);
    return '';
  }
}

/**
 * [Core Logic] 이항 연산 결과 핸들 미리 계산 (Prediction)
 * @param op - 연산자 Enum 값 (예: Add=3, Sub=4)
 * @param lhsHandle - 좌변 핸들 (32 bytes hex)
 * @param rhsHandle - 우변 핸들 (32 bytes hex)
 * @param programIdString - 솔라나 프로그램 ID
 */
export function deriveBinaryHandle(
  op: number,
  lhsHandle: string,
  rhsHandle: string,
  programIdString: string
): string {
  try {
    const opByte = new Uint8Array([op]);
    const lhsBytes = hexToBytes(lhsHandle);
    const rhsBytes = hexToBytes(rhsHandle);
    const programIdBytes = new PublicKey(programIdString).toBuffer();

    // Hash Payload 구조: [DOMAIN, PROGRAM_ID, OP, LHS, RHS]
    const payload = concatBytes(
      HANDLE_DOMAIN_BINARY,
      programIdBytes,
      opByte,
      lhsBytes,
      rhsBytes
    );

    const hash = sha256(payload);
    return bytesToHex(hash);
  } catch (e) {
    console.error('Handle derivation failed:', e);
    return '';
  }
}

/**
 * [Core Logic] 삼항 연산 결과 핸들 미리 계산 (Prediction)
 * @param op - 연산자 Enum 값 (예: Add3=0, Select=4)
 * @param aHandle - 첫 번째 핸들 (32 bytes hex)
 * @param bHandle - 두 번째 핸들 (32 bytes hex)
 * @param cHandle - 세 번째 핸들 (32 bytes hex)
 * @param programIdString - 솔라나 프로그램 ID
 */
export function deriveTernaryHandle(
  op: number,
  aHandle: string,
  bHandle: string,
  cHandle: string,
  programIdString: string
): string {
  try {
    const opByte = new Uint8Array([op]);
    const aBytes = hexToBytes(aHandle);
    const bBytes = hexToBytes(bHandle);
    const cBytes = hexToBytes(cHandle);
    const programIdBytes = new PublicKey(programIdString).toBuffer();

    // Hash Payload 구조: [DOMAIN, PROGRAM_ID, OP, A, B, C]
    const payload = concatBytes(
      HANDLE_DOMAIN_TERNARY,
      programIdBytes,
      opByte,
      aBytes,
      bBytes,
      cBytes
    );

    const hash = sha256(payload);
    return bytesToHex(hash);
  } catch (e) {
    console.error('Handle derivation failed:', e);
    return '';
  }
}

