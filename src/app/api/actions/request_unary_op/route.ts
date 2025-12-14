/**
 * Solana Actions API: Request Unary Operation
 * Requests a unary FHE16 operation (NOT, ABS, NEG)
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
import { buildRequestUnaryOpData, Fhe16UnaryOp, validatePublicKey } from '@/lib/host-programs-utils'

const log = createLogger('API:RequestUnaryOp')
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
    title: 'Host Programs · Request Unary Operation',
    description: 'Request a unary FHE16 operation (NOT, ABS, NEG).',
    label: 'Request Unary Op',
    links: {
      actions: [{
        type: 'transaction',
        href: `${baseURL}/api/actions/request_unary_op?op={op}&input_handle={input_handle}`,
        label: 'Request Unary Operation',
        parameters: [
          {
            name: 'op',
            label: 'Operation',
            type: 'select',
            required: true,
            options: [
              { label: 'NOT', value: '0', selected: true },
              { label: 'ABS', value: '1' },
              { label: 'NEG', value: '2' },
            ]
          },
          {
            name: 'input_handle',
            label: 'Input Handle (32 bytes hex)',
            required: true,
          }
        ]
      }]
    },
    notes: {
      operations: 'NOT (0), ABS (1), NEG (2)',
      handle_format: 'Input handle must be 32 bytes, provided as hex string',
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
    const inputHandleStr = url.searchParams.get('input_handle') || bodyData.input_handle

    if (!account || !opStr || !inputHandleStr) {
      return cors(NextResponse.json({
        message: 'Missing required fields: account, op, input_handle'
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
    if (op < 0 || op > 2) {
      return cors(NextResponse.json({
        message: 'Invalid operation. Must be 0 (NOT), 1 (ABS), or 2 (NEG)'
      }, { status: 400 }))
    }

    // Parse input handle (hex string to Buffer)
    let inputHandle: Buffer
    try {
      if (inputHandleStr.startsWith('0x')) {
        inputHandle = Buffer.from(inputHandleStr.slice(2), 'hex')
      } else {
        inputHandle = Buffer.from(inputHandleStr, 'hex')
      }
      if (inputHandle.length !== 32) {
        throw new Error(`Handle must be 32 bytes, got ${inputHandle.length}`)
      }
    } catch (e) {
      return cors(NextResponse.json({
        message: `Invalid input_handle format: ${e instanceof Error ? e.message : String(e)}`
      }, { status: 400 }))
    }

    // Build instruction data
    const data = buildRequestUnaryOpData(op, inputHandle)

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

    const opName = Object.keys(Fhe16UnaryOp).find(key => Fhe16UnaryOp[key as keyof typeof Fhe16UnaryOp] === op) || op.toString()
    log.info('Unary op transaction created', {
      caller: caller.toBase58(),
      op: opName,
      input_handle: inputHandle.toString('hex').slice(0, 16) + '...',
    })

    const response: ActionPostResponse = {
      type: 'transaction',
      transaction: Buffer.from(serializedTx).toString('base64'),
    }

    return cors(NextResponse.json(response))
  } catch (e: unknown) {
    log.error('Request unary op error', e)
    return cors(NextResponse.json({
      message: e instanceof Error ? e.message : 'Internal server error',
      details: e instanceof Error ? e.stack : String(e)
    }, { status: 500 }))
  }
}

