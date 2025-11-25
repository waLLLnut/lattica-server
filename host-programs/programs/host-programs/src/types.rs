use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Fhe16UnaryOp {
    Not, // C_FHE16_NOT
    Abs, // FHE16_ABS
    Neg, // FHE16_NEG
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Fhe16BinaryOp {
    // Logic
    And, // C_FHE16_AND
    Or,  // C_FHE16_OR
    Xor, // C_FHE16_XOR
    // Arithmetic
    Add,  // FHE16_ADD
    Sub,  // FHE16_SUB
    SDiv, // FHE16_SDIV
    // Comparison
    Eq,      // FHE16_EQ
    Neq,     // FHE16_NEQ
    Gt,      // FHE16_GT
    Ge,      // FHE16_GE
    Lt,      // FHE16_LT
    Le,      // FHE16_LE
    Max,     // FHE16_MAX
    Min,     // FHE16_MIN
    MaxOrMin, // FHE16_MAXorMIN
    Compare, // FHE16_COMPARE
    // Vector
    OrVec,  // FHE16_ORVEC
    AndVec, // FHE16_ANDVEC
    XorVec, // FHE16_XORVEC
    // Shift
    LShiftL, // FHE16_LSHIFTL
    // Other
    SMulL,          // FHE16_SMULL
    AddPowTwo,      // FHE16_ADD_POWTWO
    SubPowTwo,      // FHE16_SUB_POWTWO
    GateTemplete,   // FHE16_GATE_TEMPLETE
    PrefixTemplete, // FHE16_PREFIX_Templete
    AddPowTwoTemplete, // FHE16_ADD_POWTWO_TEMPLETE
    // Combined
    OrXor,  // C_FHE16_OR_XOR
    AndXor, // C_FHE16_AND_XOR
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Fhe16TernaryOp {
    Add3,   // FHE16_ADD3
    Eq3,    // C_FHE16_EQ3
    Maj3,   // C_FHE16_MAJ3
    Xor3,   // C_FHE16_XOR3
    Select, // FHE16_SELECT
}

pub type Handle = [u8; 32];
