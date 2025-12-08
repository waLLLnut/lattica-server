// src/types/redis.ts
// Redis Ciphertext Store 타입 정의

export type HexHandle = string; // "010203... (32 bytes hex)"

export interface CiphertextData {
  handle: HexHandle;
  data: string; // Base64 encoded ciphertext
  metadata: {
    owner: string; // PublicKey base58
    createdAt: number;
    clientTag: string;
  };
  status: 'pending' | 'confirmed';
}



