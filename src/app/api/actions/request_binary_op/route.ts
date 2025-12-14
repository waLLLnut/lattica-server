/**
 * Solana Actions API: Request Binary Operation
 * Requests a binary FHE16 operation (ADD, SUB, AND, OR, etc.)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
} from '@solana/web3.js'
import { ACTIONS_CORS_HEADERS, BLOCKCHAIN_IDS, ActionGetResponse, ActionPostRequest, ActionPostResponse } from '@solana/actions'
import { createLogger } from '@/lib/logger'
import { buildRequestBinaryOpData, Fhe16BinaryOp, validatePublicKey } from '@/lib/host-programs-utils'

const log = createLogger('API:RequestBinaryOp')
const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const PROGRAM_ID = new PublicKey('FkLGYGk2bypUXgpGmcsCTmKZo6LCjHaXswbhY1LNGAKj')

// CAIP-2 format for Solana
const blockchain = BLOCKCHAIN_IDS.devnet

// Set standardized headers for Blink Providers
const headers = {
  ...ACTIONS_CORS_HEADERS,
  'x-blockchain-ids': blockchain,
  'x-action-version': '2.4',
}

function cors(res: NextResponse) {
  Object.entries(headers).forEach(([key, value]) => {
    res.headers.set(key, value)
  })
  return res
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers,
  })
}

export async function GET(req: NextRequest) {
  const baseURL = new URL(req.url).origin

  const binaryOps = Object.entries(Fhe16BinaryOp)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => ({
      label: name,
      value: value.toString(),
      selected: name === 'Add',
    }))

  const response: ActionGetResponse = {
    type: 'action',
    icon: new URL('/logo.png', baseURL).toString(),
    title: 'Host Programs · Request Binary Operation',
    description: 'Request a binary FHE16 operation (ADD, SUB, AND, OR, etc.).',
    label: 'Request Binary Op',
    links: {
      actions: [{
        type: 'transaction',
        href: `${baseURL}/api/actions/request_binary_op?op={op}&lhs_handle={lhs_handle}&rhs_handle={rhs_handle}`,
        label: 'Request Binary Operation',
        parameters: [
          {
            name: 'op',
            label: 'Operation',
            type: 'select',
            required: true,
            options: binaryOps,
          },
          {
            name: 'lhs_handle',
            label: 'Left Handle (32 bytes hex)',
            required: true,
          },
          {
            name: 'rhs_handle',
            label: 'Right Handle (32 bytes hex)',
            required: true,
          }
        ]
      }]
    },
    notes: {
      operations: 'See Fhe16BinaryOp enum for all available operations',
      handle_format: 'Handles must be 32 bytes, provided as hex strings',
      program_id: PROGRAM_ID.toBase58(),
    }
  }

  return cors(NextResponse.json(response))
}

export async function POST(req: NextRequest) {
  try {
    const request: ActionPostRequest = await req.json()
    const url = new URL(req.url)
    const account = request.account

    // Get parameters from query params or body
    const bodyData = request.data || request
    const opStr = url.searchParams.get('op') || bodyData.op
    const lhsHandleStr = url.searchParams.get('lhs_handle') || bodyData.lhs_handle
    const rhsHandleStr = url.searchParams.get('rhs_handle') || bodyData.rhs_handle

    if (!account || !opStr || !lhsHandleStr || !rhsHandleStr) {
      return cors(NextResponse.json({
        message: 'Missing required fields: account, op, lhs_handle, rhs_handle'
      }, { status: 400 }))
    }

    // Validate and parse account
    let caller: PublicKey
    try {
      caller = validatePublicKey(account)
    } catch (e) {
      return cors(NextResponse.json({
        message: e instanceof Error ? e.message : 'Invalid account format',
        hint: 'Account must be a valid Solana public key (base58 encoded, 32-44 characters)'
      }, { status: 400 }))
    }
    const op = parseInt(opStr, 10)
    
    // Validate op
    if (op < 0 || op > 27) {
      return cors(NextResponse.json({
        message: 'Invalid operation. Must be 0-27'
      }, { status: 400 }))
    }

    // Parse handles (hex string to Buffer)
    let lhsHandle: Buffer
    let rhsHandle: Buffer
    try {
      // Parse lhs handle
      if (lhsHandleStr.startsWith('0x')) {
        lhsHandle = Buffer.from(lhsHandleStr.slice(2), 'hex')
      } else {
        lhsHandle = Buffer.from(lhsHandleStr, 'hex')
      }
      if (lhsHandle.length !== 32) {
        throw new Error(`LHS handle must be 32 bytes, got ${lhsHandle.length}`)
      }

      // Parse rhs handle
      if (rhsHandleStr.startsWith('0x')) {
        rhsHandle = Buffer.from(rhsHandleStr.slice(2), 'hex')
      } else {
        rhsHandle = Buffer.from(rhsHandleStr, 'hex')
      }
      if (rhsHandle.length !== 32) {
        throw new Error(`RHS handle must be 32 bytes, got ${rhsHandle.length}`)
      }
    } catch (e) {
      return cors(NextResponse.json({
        message: `Invalid handle format: ${e instanceof Error ? e.message : String(e)}`
      }, { status: 400 }))
    }

    // Build instruction data
    const data = buildRequestBinaryOpData(op, lhsHandle, rhsHandle)

    // Build instruction
    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: caller, isSigner: false, isWritable: false },
      ],
      data,
    })

    // Build transaction
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction()
    tx.feePayer = caller
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.add(instruction)

    // Serialize transaction
    const serializedTx = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })

    const opName = Object.keys(Fhe16BinaryOp).find(key => Fhe16BinaryOp[key as keyof typeof Fhe16BinaryOp] === op) || op.toString()
    log.info('Binary op transaction created', {
      caller: caller.toBase58(),
      op: opName,
      lhs_handle: lhsHandle.toString('hex').slice(0, 16) + '...',
      rhs_handle: rhsHandle.toString('hex').slice(0, 16) + '...',
    })

    const response: ActionPostResponse = {
      type: 'transaction',
      transaction: Buffer.from(serializedTx).toString('base64'),
    }

    return cors(NextResponse.json(response))
  } catch (e: unknown) {
    log.error('Request binary op error', e)
    return cors(NextResponse.json({
      message: e instanceof Error ? e.message : 'Internal server error',
      details: e instanceof Error ? e.stack : String(e)
    }, { status: 500 }))
  }
}

