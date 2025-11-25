use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::types::{Fhe16UnaryOp, Fhe16BinaryOp, Fhe16TernaryOp, Handle};

const HANDLE_DOMAIN_UNARY: &[u8] = b"FHE16_UNARY_V1";
const HANDLE_DOMAIN_BINARY: &[u8] = b"FHE16_BINARY_V1";
const HANDLE_DOMAIN_TERNARY: &[u8] = b"FHE16_TERNARY_V1";

pub fn derive_unary_handle(
    op: Fhe16UnaryOp,
    input: &Handle,
    program_id: &Pubkey,
) -> Handle {
    let op_byte = [op as u8];
    let hash = hashv(&[
        HANDLE_DOMAIN_UNARY,
        program_id.as_ref(),
        &op_byte,
        input,
    ]);
    hash.to_bytes()
}

pub fn derive_binary_handle(
    op: Fhe16BinaryOp,
    lhs: &Handle,
    rhs: &Handle,
    program_id: &Pubkey,
) -> Handle {
    let op_byte = [op as u8];
    let hash = hashv(&[
        HANDLE_DOMAIN_BINARY,
        program_id.as_ref(),
        &op_byte,
        lhs,
        rhs,
    ]);
    hash.to_bytes()
}

pub fn derive_ternary_handle(
    op: Fhe16TernaryOp,
    a: &Handle,
    b: &Handle,
    c: &Handle,
    program_id: &Pubkey,
) -> Handle {
    let op_byte = [op as u8];
    let hash = hashv(&[
        HANDLE_DOMAIN_TERNARY,
        program_id.as_ref(),
        &op_byte,
        a,
        b,
        c,
    ]);
    hash.to_bytes()
}