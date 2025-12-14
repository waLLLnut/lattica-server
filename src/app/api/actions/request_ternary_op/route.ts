/**
 * Solana Actions API: Request Ternary Operation
 * Requests a ternary FHE16 operation (ADD3, EQ3, MAJ3, XOR3, SELECT)
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
import { buildRequestTernaryOpData, Fhe16TernaryOp, validatePublicKey } from '@/lib/host-programs-utils'

const log = createLogger('API:RequestTernaryOp')
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

  const response: ActionGetResponse = {
    type: 'action',
    icon: new URL('/logo.png', baseURL).toString(),
    title: 'Host Programs · Request Ternary Operation',
    description: 'Request a ternary FHE16 operation (ADD3, EQ3, MAJ3, XOR3, SELECT).',
    label: 'Request Ternary Op',
    links: {
      actions: [{
        type: 'transaction',
        href: `${baseURL}/api/actions/request_ternary_op?op={op}&a_handle={a_handle}&b_handle={b_handle}&c_handle={c_handle}`,
        label: 'Request Ternary Operation',
        parameters: [
          {
            name: 'op',
            label: 'Operation',
            type: 'select',
            required: true,
            options: [
              { label: 'ADD3', value: '0', selected: true },
              { label: 'EQ3', value: '1' },
              { label: 'MAJ3', value: '2' },
              { label: 'XOR3', value: '3' },
              { label: 'SELECT', value: '4' },
            ]
          },
          {
            name: 'a_handle',
            label: 'A Handle (32 bytes hex)',
            required: true,
          },
          {
            name: 'b_handle',
            label: 'B Handle (32 bytes hex)',
            required: true,
          },
          {
            name: 'c_handle',
            label: 'C Handle (32 bytes hex)',
            required: true,
          }
        ]
      }]
    },
    notes: {
      operations: 'ADD3 (0), EQ3 (1), MAJ3 (2), XOR3 (3), SELECT (4)',
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
    const aHandleStr = url.searchParams.get('a_handle') || bodyData.a_handle
    const bHandleStr = url.searchParams.get('b_handle') || bodyData.b_handle
    const cHandleStr = url.searchParams.get('c_handle') || bodyData.c_handle

    if (!account || !opStr || !aHandleStr || !bHandleStr || !cHandleStr) {
      return cors(NextResponse.json({
        message: 'Missing required fields: account, op, a_handle, b_handle, c_handle'
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
    if (op < 0 || op > 4) {
      return cors(NextResponse.json({
        message: 'Invalid operation. Must be 0 (ADD3), 1 (EQ3), 2 (MAJ3), 3 (XOR3), or 4 (SELECT)'
      }, { status: 400 }))
    }

    // Parse handles (hex string to Buffer)
    let aHandle: Buffer
    let bHandle: Buffer
    let cHandle: Buffer
    try {
      // Parse a handle
      if (aHandleStr.startsWith('0x')) {
        aHandle = Buffer.from(aHandleStr.slice(2), 'hex')
      } else {
        aHandle = Buffer.from(aHandleStr, 'hex')
      }
      if (aHandle.length !== 32) {
        throw new Error(`A handle must be 32 bytes, got ${aHandle.length}`)
      }

      // Parse b handle
      if (bHandleStr.startsWith('0x')) {
        bHandle = Buffer.from(bHandleStr.slice(2), 'hex')
      } else {
        bHandle = Buffer.from(bHandleStr, 'hex')
      }
      if (bHandle.length !== 32) {
        throw new Error(`B handle must be 32 bytes, got ${bHandle.length}`)
      }

      // Parse c handle
      if (cHandleStr.startsWith('0x')) {
        cHandle = Buffer.from(cHandleStr.slice(2), 'hex')
      } else {
        cHandle = Buffer.from(cHandleStr, 'hex')
      }
      if (cHandle.length !== 32) {
        throw new Error(`C handle must be 32 bytes, got ${cHandle.length}`)
      }
    } catch (e) {
      return cors(NextResponse.json({
        message: `Invalid handle format: ${e instanceof Error ? e.message : String(e)}`
      }, { status: 400 }))
    }

    // Build instruction data
    const data = buildRequestTernaryOpData(op, aHandle, bHandle, cHandle)

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

    const opName = Object.keys(Fhe16TernaryOp).find(key => Fhe16TernaryOp[key as keyof typeof Fhe16TernaryOp] === op) || op.toString()
    log.info('Ternary op transaction created', {
      caller: caller.toBase58(),
      op: opName,
      a_handle: aHandle.toString('hex').slice(0, 16) + '...',
      b_handle: bHandle.toString('hex').slice(0, 16) + '...',
      c_handle: cHandle.toString('hex').slice(0, 16) + '...',
    })

    const response: ActionPostResponse = {
      type: 'transaction',
      transaction: Buffer.from(serializedTx).toString('base64'),
    }

    return cors(NextResponse.json(response))
  } catch (e: unknown) {
    log.error('Request ternary op error', e)
    return cors(NextResponse.json({
      message: e instanceof Error ? e.message : 'Internal server error',
      details: e instanceof Error ? e.stack : String(e)
    }, { status: 500 }))
  }
}

