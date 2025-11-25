// ⚠️ WARNING: This is a minimal implementation for on-chain event logging testing.
// This is NOT production code. Current design:
// - Permissionless event emission (CCIP logging layer)
// - No handle ownership verification (to be added later)
// - No handle registry (to be added later)
// - Pure stateless event machine for testing
//
use anchor_lang::prelude::*;

pub mod events;
pub mod handle;
pub mod types;

use crate::events::*;
use crate::handle::*;
use crate::types::*;

declare_id!("FkLGYGk2bypUXgpGmcsCTmKZo6LCjHaXswbhY1LNGAKj");

#[program]
pub mod host_contracts {
    use super::*;

    // -------------------------------------------------------------------
    // Program Initialization
    // -------------------------------------------------------------------
    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("FHE16 Executor initialized: {:?}", _ctx.program_id);
        Ok(())
    }

    // -------------------------------------------------------------------
    // 1) Input handle Registration
    // -------------------------------------------------------------------
    pub fn register_input_handle(
        ctx: Context<RegisterInputHandle>,
        handle: Handle,
        client_tag: [u8; 32],
    ) -> Result<()> {
        let caller = ctx.accounts.caller.key();

        emit!(InputHandleRegistered {
            caller,
            handle,
            client_tag,
        });

        Ok(())
    }

    // -------------------------------------------------------------------
    // 2) Unary Operations (NOT, ABS, NEG, ...)
    // -------------------------------------------------------------------
    pub fn request_unary_op(
        ctx: Context<RequestUnaryOp>,
        op: Fhe16UnaryOp,
        input_handle: Handle,
    ) -> Result<()> {
        let caller = ctx.accounts.caller.key();

        // handle 생성 (immutable, deterministic)
        let result_handle = derive_unary_handle(op, &input_handle, ctx.program_id);

        // 이벤트 → executor 가 이 job 을 비동기 처리
        emit!(Fhe16UnaryOpRequested {
            caller,
            op,
            input_handle,
            result_handle,
        });

        Ok(())
    }

    // -------------------------------------------------------------------
    // 3) Binary Operations (ADD, SUB, AND, OR, MAX, LT ...)
    // -------------------------------------------------------------------
    pub fn request_binary_op(
        ctx: Context<RequestBinaryOp>,
        op: Fhe16BinaryOp,
        lhs_handle: Handle,
        rhs_handle: Handle,
    ) -> Result<()> {
        let caller = ctx.accounts.caller.key();

        let result_handle =
            derive_binary_handle(op, &lhs_handle, &rhs_handle, ctx.program_id);

        emit!(Fhe16BinaryOpRequested {
            caller,
            op,
            lhs_handle,
            rhs_handle,
            result_handle,
        });

        Ok(())
    }

    // -------------------------------------------------------------------
    // 4) Ternary Operations (ADD3, EQ3, MAJ3, XOR3, SELECT)
    // -------------------------------------------------------------------
    pub fn request_ternary_op(
        ctx: Context<RequestTernaryOp>,
        op: Fhe16TernaryOp,
        a_handle: Handle,
        b_handle: Handle,
        c_handle: Handle,
    ) -> Result<()> {
        let caller = ctx.accounts.caller.key();

        let result_handle =
            derive_ternary_handle(op, &a_handle, &b_handle, &c_handle, ctx.program_id);

        emit!(Fhe16TernaryOpRequested {
            caller,
            op,
            a_handle,
            b_handle,
            c_handle,
            result_handle,
        });

        Ok(())
    }

}

// -----------------------------------------------------------------------
// Accounts Definitions
// -----------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct RegisterInputHandle<'info> {
    /// CHECK: user wallet, dapp program, PDA 등 모두 가능
    pub caller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RequestUnaryOp<'info> {
    /// CHECK: signer 요구 없음 → Dapp CPI 허용
    pub caller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RequestBinaryOp<'info> {
    /// CHECK
    pub caller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RequestTernaryOp<'info> {
    /// CHECK
    pub caller: UncheckedAccount<'info>,
}

