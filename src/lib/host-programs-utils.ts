/**
 * Host Programs utility functions
 * Helper functions for serializing Anchor instruction data
 */

import { PublicKey } from '@solana/web3.js'
import { getInstructionDiscriminator } from './anchor-utils'

/**
 * Validate and parse Solana public key
 * @throws Error if account is not a valid base58 public key
 */
export function validatePublicKey(account: string): PublicKey {
  if (!account || typeof account !== 'string') {
    throw new Error('Account must be a non-empty string')
  }

  // Trim whitespace
  const trimmed = account.trim()

  // Basic length check (Solana public keys are 32-44 base58 characters)
  if (trimmed.length < 32 || trimmed.length > 44) {
    throw new Error(`Invalid account length: ${trimmed.length}. Solana public keys are 32-44 base58 characters`)
  }

  try {
    return new PublicKey(trimmed)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Non-base58')) {
      throw new Error(`Invalid account format: "${trimmed}". Account must be a valid base58-encoded Solana public key. Example: 11111111111111111111111111111111`)
    }
    throw error
  }
}

export type Handle = Uint8Array | Buffer | number[]

/**
 * Convert handle to Buffer (32 bytes)
 */
export function handleToBuffer(handle: Handle): Buffer {
  if (Buffer.isBuffer(handle)) {
    if (handle.length !== 32) {
      throw new Error(`Handle must be 32 bytes, got ${handle.length}`)
    }
    return handle
  }
  if (handle instanceof Uint8Array) {
    if (handle.length !== 32) {
      throw new Error(`Handle must be 32 bytes, got ${handle.length}`)
    }
    return Buffer.from(handle)
  }
  if (Array.isArray(handle)) {
    if (handle.length !== 32) {
      throw new Error(`Handle must be 32 bytes, got ${handle.length}`)
    }
    return Buffer.from(handle)
  }
  throw new Error(`Invalid handle type: ${typeof handle}`)
}

/**
 * Serialize enum value (u8)
 */
export function serializeEnum(value: number): Buffer {
  return Buffer.from([value])
}

/**
 * Build initialize instruction data
 */
export function buildInitializeData(): Buffer {
  const discriminator = getInstructionDiscriminator('initialize')
  return discriminator
}

/**
 * Build register_input_handle instruction data
 */
export function buildRegisterInputHandleData(
  handle: Handle,
  clientTag: Handle
): Buffer {
  const discriminator = getInstructionDiscriminator('register_input_handle')
  const handleBuf = handleToBuffer(handle)
  const clientTagBuf = handleToBuffer(clientTag)
  
  return Buffer.concat([discriminator, handleBuf, clientTagBuf])
}

/**
 * Build request_unary_op instruction data
 */
export function buildRequestUnaryOpData(
  op: number,
  inputHandle: Handle
): Buffer {
  const discriminator = getInstructionDiscriminator('request_unary_op')
  const opBuf = serializeEnum(op)
  const handleBuf = handleToBuffer(inputHandle)
  
  return Buffer.concat([discriminator, opBuf, handleBuf])
}

/**
 * Build request_binary_op instruction data
 */
export function buildRequestBinaryOpData(
  op: number,
  lhsHandle: Handle,
  rhsHandle: Handle
): Buffer {
  const discriminator = getInstructionDiscriminator('request_binary_op')
  const opBuf = serializeEnum(op)
  const lhsBuf = handleToBuffer(lhsHandle)
  const rhsBuf = handleToBuffer(rhsHandle)
  
  return Buffer.concat([discriminator, opBuf, lhsBuf, rhsBuf])
}

/**
 * Build request_ternary_op instruction data
 */
export function buildRequestTernaryOpData(
  op: number,
  aHandle: Handle,
  bHandle: Handle,
  cHandle: Handle
): Buffer {
  const discriminator = getInstructionDiscriminator('request_ternary_op')
  const opBuf = serializeEnum(op)
  const aBuf = handleToBuffer(aHandle)
  const bBuf = handleToBuffer(bHandle)
  const cBuf = handleToBuffer(cHandle)
  
  return Buffer.concat([discriminator, opBuf, aBuf, bBuf, cBuf])
}

/**
 * Enum value mappings from IDL
 */
export const Fhe16UnaryOp = {
  Not: 0,
  Abs: 1,
  Neg: 2,
} as const

export const Fhe16BinaryOp = {
  And: 0,
  Or: 1,
  Xor: 2,
  Add: 3,
  Sub: 4,
  SDiv: 5,
  Eq: 6,
  Neq: 7,
  Gt: 8,
  Ge: 9,
  Lt: 10,
  Le: 11,
  Max: 12,
  Min: 13,
  MaxOrMin: 14,
  Compare: 15,
  OrVec: 16,
  AndVec: 17,
  XorVec: 18,
  LShiftL: 19,
  SMulL: 20,
  AddPowTwo: 21,
  SubPowTwo: 22,
  GateTemplete: 23,
  PrefixTemplete: 24,
  AddPowTwoTemplete: 25,
  OrXor: 26,
  AndXor: 27,
} as const

export const Fhe16TernaryOp = {
  Add3: 0,
  Eq3: 1,
  Maj3: 2,
  Xor3: 3,
  Select: 4,
} as const

