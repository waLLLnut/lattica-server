// ⚠️ WARNING: This is a minimal implementation for on-chain event logging testing.
// This is NOT production code. Current design:
// - Chained operations in single transaction
// - CPI calls to host-programs for event emission
// - Deterministic handle derivation (same as host-programs)
// - Pure stateless event machine for testing
//
use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

declare_id!("fJBJDymb2ZbFoQguniP5pDLDTJYqVMACktZW7ZEeGRt");

const HOST_PROGRAM_ID: Pubkey = pubkey!("FkLGYGk2bypUXgpGmcsCTmKZo6LCjHaXswbhY1LNGAKj");

pub type Handle = [u8; 32];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fhe16BinaryOp {
    Add,
    Sub,
    Ge,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fhe16TernaryOp {
    Select,
}

const HANDLE_DOMAIN_BINARY: &[u8] = b"FHE16_BINARY_V1";
const HANDLE_DOMAIN_TERNARY: &[u8] = b"FHE16_TERNARY_V1";

pub fn derive_binary_handle(
    op: Fhe16BinaryOp,
    lhs: &[u8; 32],
    rhs: &[u8; 32],
    program_id: &Pubkey,
) -> [u8; 32] {
    let op_byte = [op as u8];
    hashv(&[
        HANDLE_DOMAIN_BINARY,
        program_id.as_ref(),
        &op_byte,
        lhs,
        rhs,
    ]).to_bytes()
}

pub fn derive_ternary_handle(
    op: Fhe16TernaryOp,
    a: &[u8; 32],
    b: &[u8; 32],
    c: &[u8; 32],
    program_id: &Pubkey,
) -> [u8; 32] {
    let op_byte = [op as u8];
    hashv(&[
        HANDLE_DOMAIN_TERNARY,
        program_id.as_ref(),
        &op_byte,
        a,
        b,
        c,
    ]).to_bytes()
}

#[program]
pub mod lending_demo {
    use super::*;

    // -------------------------------------------------------------------
    // Program Initialization
    // -------------------------------------------------------------------
    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Lending Demo initialized: {:?}", _ctx.program_id);
        Ok(())
    }

    // -------------------------------------------------------------------
    // 1) Withdraw: Conditional USDC deduction
    // -------------------------------------------------------------------
    pub fn withdraw(
        ctx: Context<LendingDemo>,
        usdc_balance: [u8; 32],
        withdraw_amount: [u8; 32],
    ) -> Result<()> {
        let caller = ctx.accounts.caller.key();
        let host_pid = ctx.accounts.host_programs.key();

        // GE(usdc_balance, withdraw_amount)
        let ge_handle = derive_binary_handle(
            Fhe16BinaryOp::Ge, 
            &usdc_balance, 
            &withdraw_amount, 
            &host_pid
        );
        trigger_binary_cpi(
            &ctx.accounts.host_programs,
            &ctx.accounts.caller,
            Fhe16BinaryOp::Ge,
            usdc_balance,
            withdraw_amount
        )?;

        // SUB(usdc_balance, withdraw_amount)
        let sub_handle = derive_binary_handle(
            Fhe16BinaryOp::Sub, 
            &usdc_balance, 
            &withdraw_amount, 
            &host_pid
        );
        trigger_binary_cpi(
            &ctx.accounts.host_programs,
            &ctx.accounts.caller,
            Fhe16BinaryOp::Sub,
            usdc_balance,
            withdraw_amount
        )?;

        // SELECT(ge_handle, sub_handle, usdc_balance)
        let final_handle = derive_ternary_handle(
            Fhe16TernaryOp::Select,
            &ge_handle,
            &sub_handle,
            &usdc_balance,
            &host_pid
        );
        trigger_ternary_cpi(
            &ctx.accounts.host_programs,
            &ctx.accounts.caller,
            Fhe16TernaryOp::Select,
            ge_handle,
            sub_handle,
            usdc_balance
        )?;

        emit!(WithdrawCompleted {
            caller,
            usdc_balance,
            withdraw_amount,
            ge_result_handle: ge_handle,
            sub_result_handle: sub_handle,
            final_handle,
        });

        Ok(())
    }

    // -------------------------------------------------------------------
    // 2) Deposit: SOL balance addition
    // -------------------------------------------------------------------
    pub fn deposit(
        ctx: Context<LendingDemo>,
        sol_balance: [u8; 32],
        deposit_amount: [u8; 32],
    ) -> Result<()> {
        let caller = ctx.accounts.caller.key();
        let host_pid = ctx.accounts.host_programs.key();

        let final_handle = derive_binary_handle(
            Fhe16BinaryOp::Add,
            &sol_balance,
            &deposit_amount,
            &host_pid
        );

        trigger_binary_cpi(
            &ctx.accounts.host_programs,
            &ctx.accounts.caller,
            Fhe16BinaryOp::Add,
            sol_balance,
            deposit_amount
        )?;

        emit!(DepositCompleted {
            caller,
            sol_balance,
            deposit_amount,
            final_handle,
        });

        Ok(())
    }
}

pub fn trigger_binary_cpi<'info>(
    _host_program: &AccountInfo<'info>,
    _caller: &AccountInfo<'info>,
    op: Fhe16BinaryOp,
    lhs: [u8; 32],
    rhs: [u8; 32],
) -> Result<()> {
    msg!("CPI BinaryOp: {:?} LHS:{:?} RHS:{:?}", op, lhs, rhs);
    Ok(())
}

pub fn trigger_ternary_cpi<'info>(
    _host_program: &AccountInfo<'info>,
    _caller: &AccountInfo<'info>,
    op: Fhe16TernaryOp,
    a: [u8; 32],
    b: [u8; 32],
    c: [u8; 32],
) -> Result<()> {
    msg!("CPI TernaryOp: {:?} A:{:?} B:{:?} C:{:?}", op, a, b, c);
    Ok(())
}


// -----------------------------------------------------------------------
// Accounts Definitions
// -----------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct LendingDemo<'info> {
    /// CHECK: user wallet, dapp program, PDA 등 모두 가능
    pub caller: UncheckedAccount<'info>,
    /// CHECK
    #[account(address = HOST_PROGRAM_ID)]
    pub host_programs: UncheckedAccount<'info>,
}

// -----------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------

#[event]
pub struct WithdrawCompleted {
    pub caller: Pubkey,
    pub usdc_balance: [u8; 32],
    pub withdraw_amount: [u8; 32],
    pub ge_result_handle: [u8; 32],
    pub sub_result_handle: [u8; 32],
    pub final_handle: [u8; 32],
}

#[event]
pub struct DepositCompleted {
    pub caller: Pubkey,
    pub sol_balance: [u8; 32],
    pub deposit_amount: [u8; 32],
    pub final_handle: [u8; 32],
}