/**
 * Anchor instruction discriminator utilities
 * Gets instruction discriminators from IDL
 */

import hostProgramsIdl from '@/idl/host_programs.json'

type InstructionName = 
  | 'initialize'
  | 'register_input_handle'
  | 'request_unary_op'
  | 'request_binary_op'
  | 'request_ternary_op'

/**
 * Get instruction discriminator from IDL
 */
export function getInstructionDiscriminator(instructionName: InstructionName): Buffer {
  const instruction = hostProgramsIdl.instructions.find(
    (ix) => ix.name === instructionName
  )

  if (!instruction) {
    throw new Error(`Instruction ${instructionName} not found in IDL`)
  }

  return Buffer.from(instruction.discriminator)
}

