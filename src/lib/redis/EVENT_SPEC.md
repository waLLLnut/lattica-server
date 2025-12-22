# Redis Pub/Sub 이벤트 명세

이 문서는 Redis Pub/Sub를 통해 발행되는 이벤트의 구조와 명세를 정의합니다.

## 채널 구조

| 채널명 | 용도 | 구독 대상 |
|--------|------|-----------|
| `channel:global_events` | 인덱서 상태 변경 | 모든 접속 클라이언트 |
| `channel:user:{wallet_address}` | 특정 유저의 암호문 등록/연산 결과 변경 | 해당 지갑 소유자 |

## 이벤트 타입

### 1. `ciphertext.confirmed`

**발행 시점**: `InputHandleRegistered` 이벤트가 인덱서에서 처리될 때

**채널**: `channel:user:{owner}`

**페이로드 구조**:
```typescript
{
  handle: string;           // Ciphertext handle (64 chars hex)
  owner: string;           // 지갑 주소 (caller)
  clientTag?: string;      // 클라이언트 태그 (hex, optional)
  status: 'confirmed';     // 항상 'confirmed'
  signature: string;        // 트랜잭션 서명
  slot: number;            // Solana slot
  blockTime: number | null; // 블록 타임스탬프
}
```

**예시**:
```json
{
  "eventId": "12345678-abc12345-1704067200000",
  "eventType": "ciphertext.confirmed",
  "targetOwner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "payload": {
    "handle": "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
    "owner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "clientTag": "deadbeef",
    "status": "confirmed",
    "signature": "5VERv8NMvzbJMEkV8xnrLkEaWRt6p5jXK6NxTzQ3rHu8fM5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "slot": 123456789,
    "blockTime": 1704067200
  },
  "publishedAt": 1704067200000
}
```

---

### 2. `operation.completed`

**발행 시점**: 
- `Fhe16UnaryOpRequested` 이벤트 처리 시
- `Fhe16BinaryOpRequested` 이벤트 처리 시
- `Fhe16TernaryOpRequested` 이벤트 처리 시

**채널**: `channel:user:{owner}`

**페이로드 구조**:
```typescript
{
  operation: string;              // 연산 타입 (ADD, SUB, AND, OR, ADD3 등)
  operationType: 'unary' | 'binary' | 'ternary'; // 연산 종류
  inputHandles: string[];         // 입력 핸들 배열 (hex)
  resultHandle: string;           // 결과 핸들 (hex)
  owner: string;                  // 지갑 주소 (caller)
  signature: string;              // 트랜잭션 서명
  slot: number;                  // Solana slot
  blockTime: number | null;       // 블록 타임스탬프
}
```

**예시 (Binary Operation)**:
```json
{
  "eventId": "12345678-abc12345-1704067200000",
  "eventType": "operation.completed",
  "targetOwner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "payload": {
    "operation": "ADD",
    "operationType": "binary",
    "inputHandles": [
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40"
    ],
    "resultHandle": "4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60",
    "owner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "signature": "5VERv8NMvzbJMEkV8xnrLkEaWRt6p5jXK6NxTzQ3rHu8fM5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "slot": 123456789,
    "blockTime": 1704067200
  },
  "publishedAt": 1704067200000
}
```

**예시 (Unary Operation)**:
```json
{
  "eventId": "12345678-abc12345-1704067200000",
  "eventType": "operation.completed",
  "targetOwner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "payload": {
    "operation": "NOT",
    "operationType": "unary",
    "inputHandles": [
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
    ],
    "resultHandle": "4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60",
    "owner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "signature": "5VERv8NMvzbJMEkV8xnrLkEaWRt6p5jXK6NxTzQ3rHu8fM5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "slot": 123456789,
    "blockTime": 1704067200
  },
  "publishedAt": 1704067200000
}
```

**예시 (Ternary Operation)**:
```json
{
  "eventId": "12345678-abc12345-1704067200000",
  "eventType": "operation.completed",
  "targetOwner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "payload": {
    "operation": "ADD3",
    "operationType": "ternary",
    "inputHandles": [
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      "2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40",
      "3132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f50"
    ],
    "resultHandle": "4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60",
    "owner": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "signature": "5VERv8NMvzbJMEkV8xnrLkEaWRt6p5jXK6NxTzQ3rHu8fM5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "slot": 123456789,
    "blockTime": 1704067200
  },
  "publishedAt": 1704067200000
}
```

---

### 3. `indexer.status`

**발행 시점**: 인덱서 상태가 변경될 때 (시작, 중지 등)

**채널**: `channel:global_events`

**페이로드 구조**:
```typescript
{
  indexerStatus: 'running' | 'stopped' | 'error';
  lastSlot?: number;        // 마지막 처리된 슬롯
  lastSignature?: string;  // 마지막 처리된 트랜잭션 서명
}
```

**예시**:
```json
{
  "eventId": "1704067200000-abc123",
  "eventType": "indexer.status",
  "payload": {
    "indexerStatus": "running",
    "lastSlot": 123456789,
    "lastSignature": "5VERv8NMvzbJMEkV8xnrLkEaWRt6p5jXK6NxTzQ3rHu8fM5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  },
  "publishedAt": 1704067200000
}
```

---

### 4. `indexer.error`

**발행 시점**: 인덱서에서 에러가 발생할 때

**채널**: `channel:global_events`

**페이로드 구조**:
```typescript
{
  error: string;           // 에러 메시지
  lastSlot?: number;       // 마지막 처리된 슬롯
  lastSignature?: string;  // 마지막 처리된 트랜잭션 서명
}
```

**예시**:
```json
{
  "eventId": "1704067200000-abc123",
  "eventType": "indexer.error",
  "payload": {
    "error": "Failed to process transaction: Connection timeout",
    "lastSlot": 123456789,
    "lastSignature": "5VERv8NMvzbJMEkV8xnrLkEaWRt6p5jXK6NxTzQ3rHu8fM5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  },
  "publishedAt": 1704067200000
}
```

---

## 공통 메시지 구조

모든 Pub/Sub 메시지는 다음 구조를 따릅니다:

```typescript
interface PubSubMessage {
  eventId: string;         // 고유 이벤트 ID (timestamp-based UUID)
  eventType: EventType;    // 이벤트 타입
  targetOwner?: string;    // 대상 지갑 주소 (user 채널용)
  payload: PubSubPayload; // 이벤트별 페이로드
  publishedAt: number;     // Unix timestamp (ms)
}
```

## 이벤트 발행 함수

각 이벤트는 다음 헬퍼 함수를 통해 발행됩니다:

- `publishCiphertextConfirmed(event: InputHandleRegisteredEvent)` - 암호문 확정 이벤트
- `publishOperationCompletedUnary(event: Fhe16UnaryOpRequestedEvent)` - 단항 연산 완료
- `publishOperationCompletedBinary(event: Fhe16BinaryOpRequestedEvent)` - 이항 연산 완료
- `publishOperationCompletedTernary(event: Fhe16TernaryOpRequestedEvent)` - 삼항 연산 완료
- `publishIndexerStatus(status, lastSlot?, lastSignature?, error?)` - 인덱서 상태 변경

## 사용 예시

```typescript
import { getPubSubClient, CHANNELS } from '@/lib/redis/pubsub';

// 구독
const client = getPubSubClient();
const unsubscribe = await client.subscribe(
  CHANNELS.USER('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'),
  (message) => {
    console.log('Received event:', message.eventType, message.payload);
  }
);

// 나중에 구독 해제
await unsubscribe();
```

