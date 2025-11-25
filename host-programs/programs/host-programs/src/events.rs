// programs/fhe16_executor/src/events.rs
use anchor_lang::prelude::*;
use crate::types::{Fhe16UnaryOp, Fhe16BinaryOp, Fhe16TernaryOp, Handle};

/// 유저가 "새로운 입력 handle"을 등록할 때 찍는 이벤트
#[event]
pub struct InputHandleRegistered {
    pub caller: Pubkey,
    pub handle: Handle,
    pub client_tag: [u8; 32],
}

/// FHE16 단항 연산 요청 (예: NOT)
#[event]
pub struct Fhe16UnaryOpRequested {
    pub caller: Pubkey,
    pub op: Fhe16UnaryOp,
    pub input_handle: Handle,
    pub result_handle: Handle,
}

/// FHE16 이항 연산 요청 (예: AND, OR, XOR, SDIV)
#[event]
pub struct Fhe16BinaryOpRequested {
    pub caller: Pubkey,
    pub op: Fhe16BinaryOp,
    pub lhs_handle: Handle,
    pub rhs_handle: Handle,
    pub result_handle: Handle,
}

/// FHE16 삼항 연산 요청 (예: ADD3, EQ3)
#[event]
pub struct Fhe16TernaryOpRequested {
    pub caller: Pubkey,
    pub op: Fhe16TernaryOp,
    pub a_handle: Handle,
    pub b_handle: Handle,
    pub c_handle: Handle,
    pub result_handle: Handle,
}
