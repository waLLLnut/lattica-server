// src/types/wasm.ts

export interface FHE16Module {
    _FHE16_init_params: (row: number, col: number, q: number, qtot: number, sigma: number) => void;
    _FHE16_load_pk_from_fs: (path: string) => number;
    _FHE16_set_pk: (ptr: number, nints: number) => void;
    _FHE16_ENC_WASM: (msg: number, bit: number) => number;
    _FHE16_free: (ptr: number) => void;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    UTF8ToString: (ptr: number) => string;
    HEAP8: Int8Array;
    HEAPU8: Uint8Array;
  }
  
  export const FHE_PARAMS = {
    PK_ROW: 1024,
    PK_COL: 1025,
    PK_Q: 163603459,
    Q_TOT: 163603459,
    SIGMA: 10.0,
    BIT: 32,
  };
  
  // IDL에 정의된 Op Enum 매핑
  export enum Fhe16UnaryOp { Not = 0, Abs = 1, Neg = 2 }
  export enum Fhe16BinaryOp { And = 0, Or = 1, Xor = 2, Add = 3, Sub = 4, SDiv = 5, Eq = 6, Neq = 7, Gt = 8, Ge = 9, Lt = 10, Le = 11, Max = 12, Min = 13 } 
  export enum Fhe16TernaryOp { Add3 = 0, Eq3 = 1, Maj3 = 2, Xor3 = 3, Select = 4 }
  
  export interface Ciphertext {
    handle: string; // 32 bytes hex
    encrypted_data: number[]; // For visualization
    timestamp: number;
  }
  
  export type OperationType = 'unary' | 'binary' | 'ternary';