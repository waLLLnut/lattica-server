/**
 * Solana Actions API: Register Input Handle
 * Registers a new input handle for FHE16 operations
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
} from '@solana/web3.js'
import { createLogger } from '@/lib/logger'
import { buildRegisterInputHandleData, validatePublicKey } from '@/lib/host-programs-utils'

const log = createLogger('API:RegisterInputHandle')
const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const PROGRAM_ID = new PublicKey('FkLGYGk2bypUXgpGmcsCTmKZo6LCjHaXswbhY1LNGAKj')

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return res
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

export async function GET(req: NextRequest) {
  const baseURL = new URL(req.url).origin

  return cors(NextResponse.json({
    type: 'action',
    icon: new URL('/logo.png', baseURL).toString(),
    title: 'Host Programs · Register Input Handle',
    description: 'Register a new input handle for FHE16 operations.',
    label: 'Register Input Handle',
    links: {
      actions: [{
        href: `${baseURL}/api/actions/register_input_handle?handle={handle}&client_tag={client_tag}`,
        label: 'Register Input Handle',
        parameters: [
          {
            name: 'handle',
            label: 'Handle (32 bytes hex)',
            required: true,
          },
          {
            name: 'client_tag',
            label: 'Client Tag (32 bytes hex)',
            required: true,
          }
        ]
      }]
    },
    notes: {
      handle_format: 'Handle must be 32 bytes, provided as hex string',
      client_tag_format: 'Client tag must be 32 bytes, provided as hex string',
      program_id: PROGRAM_ID.toBase58(),
    }
  }))
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json()
    const url = new URL(req.url)
    const account = rawBody.account

    // Get parameters from query params or body
    const bodyData = rawBody.data || rawBody
    const handleStr = url.searchParams.get('handle') || bodyData.handle
    const clientTagStr = url.searchParams.get('client_tag') || bodyData.client_tag

    if (!account || !handleStr || !clientTagStr) {
      return cors(NextResponse.json({
        message: 'Missing required fields: account, handle, client_tag'
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

    // Parse handle (hex string to Buffer)
    let handle: Buffer
    try {
      if (handleStr.startsWith('0x')) {
        handle = Buffer.from(handleStr.slice(2), 'hex')
      } else {
        handle = Buffer.from(handleStr, 'hex')
      }
      if (handle.length !== 32) {
        throw new Error(`Handle must be 32 bytes, got ${handle.length}`)
      }
    } catch (e) {
      return cors(NextResponse.json({
        message: `Invalid handle format: ${e instanceof Error ? e.message : String(e)}`
      }, { status: 400 }))
    }

    // Parse client_tag (hex string to Buffer)
    let clientTag: Buffer
    try {
      if (clientTagStr.startsWith('0x')) {
        clientTag = Buffer.from(clientTagStr.slice(2), 'hex')
      } else {
        clientTag = Buffer.from(clientTagStr, 'hex')
      }
      if (clientTag.length !== 32) {
        throw new Error(`Client tag must be 32 bytes, got ${clientTag.length}`)
      }
    } catch (e) {
      return cors(NextResponse.json({
        message: `Invalid client_tag format: ${e instanceof Error ? e.message : String(e)}`
      }, { status: 400 }))
    }

    // Build instruction data
    const data = buildRegisterInputHandleData(handle, clientTag)

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

    log.info('Register input handle transaction created', {
      caller: caller.toBase58(),
      handle: handle.toString('hex').slice(0, 16) + '...',
      client_tag: clientTag.toString('hex').slice(0, 16) + '...',
    })

    return cors(NextResponse.json({
      transaction: Buffer.from(serializedTx).toString('base64'),
      message: 'Register input handle transaction created successfully',
      handle: handle.toString('hex'),
      client_tag: clientTag.toString('hex'),
    }))
  } catch (e: unknown) {
    log.error('Register input handle error', e)
    return cors(NextResponse.json({
      message: e instanceof Error ? e.message : 'Internal server error',
      details: e instanceof Error ? e.stack : String(e)
    }, { status: 500 }))
  }
}

