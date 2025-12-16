# Confidential State 확장 및 이벤트 구독 시스템 요구사항

## 개요
현재 `use-demo-state.ts`에서 관리하는 confidential state를 더 범용적으로 확장하고, 서버 측 이벤트 구독 시스템을 구축하여 클라이언트에 실시간으로 이벤트를 푸시하는 기능을 구현해야 합니다.

---

## 1. 클라이언트 측 요구사항

### 1.1 Confidential State 확장 (`use-demo-state.ts`)

#### 현재 상태
- 하드코딩된 상태 관리 (confidentialSOL, confidentialUSDC 등)
- 고정된 연산 플로우 (deposit, borrow, withdraw)
- 수동으로 입력한 ciphertext만 관리

#### 목표
- **유저가 본인이 등록한 ciphertext와 온체인 핸들을 직접 조회하여 aggregate할 수 있어야 함**
- 동적으로 ciphertext와 handle을 조회하고 관리
- 결정적 핸들 연산을 통해 결과 핸들을 미리 계산
- 클라이언트 측 캐싱으로 성능 최적화

#### 필요한 기능

**1.1.1 Ciphertext 조회 및 캐싱**
- 유저의 PublicKey로 본인이 등록한 모든 ciphertext 조회
- API: `/api/ciphertext/by-owner/[owner]` (구현 필요)
- React Query를 통한 자동 캐싱 및 폴링
- 로컬 상태와 동기화

**1.1.2 Handle 조회 및 캐싱**
- 온체인에서 유저가 생성한 모든 handle 조회
- OperationLog를 통해 연산 이력 추적
- 결과 handle을 결정적 연산으로 미리 계산 (`handle-utils.ts` 활용)
- API: `/api/operation-logs/by-caller/[caller]` (이미 존재할 수 있음)

**1.1.3 결정적 핸들 연산 통합**
- `handle-utils.ts`의 함수들을 활용:
  - `deriveUnaryHandle(op, inputHandle, programId)`
  - `deriveBinaryHandle(op, lhsHandle, rhsHandle, programId)`
  - `deriveTernaryHandle(op, aHandle, bHandle, cHandle, programId)`
- 연산 요청 전에 결과 handle을 미리 계산하여 UI에 표시
- 계산된 handle로 ciphertext 조회 가능 여부 확인

**1.1.4 동적 State 관리**
- 고정된 confidentialSOL/USDC 대신, 동적으로 ciphertext/handle 관리
- Map/Record 구조로 여러 ciphertext를 동시에 관리
- 각 ciphertext의 상태: `initial | encrypted | decrypted | pending`
- Handle 간 의존성 그래프 관리 (어떤 handle이 어떤 연산의 결과인지)

#### 구현 방향
```typescript
// 확장된 use-demo-state.ts 구조
interface ConfidentialState {
  // 동적 ciphertext 관리
  ciphertexts: Map<string, {
    handle: string;
    data: string | null;
    owner: string;
    status: 'initial' | 'encrypted' | 'decrypted' | 'pending';
    createdAt: number;
  }>;
  
  // 동적 handle 관리
  handles: Map<string, {
    handle: string;
    type: 'input' | 'unary' | 'binary' | 'ternary';
    operation?: string;
    inputHandles: string[];
    resultHandle?: string;
    status: 'pending' | 'confirmed';
    slot?: number;
  }>;
  
  // 결정적 연산 결과 (미리 계산된 handle)
  predictedHandles: Map<string, {
    handle: string;
    operation: string;
    inputHandles: string[];
    isConfirmed: boolean;
  }>;
}
```

---

## 2. 서버 측 요구사항

### 2.1 이벤트 구독 및 클라이언트 푸시 시스템

#### 현재 상태
- Indexer가 Next.js에 붙어있음 (`src/server/start-indexer.ts`)
- 이벤트를 받아서 DB에 저장만 함
- 클라이언트에 실시간 푸시 기능 없음

#### 목표
- **각 클라이언트에 맞는 이벤트가 오면 구독하고 해당 클라이언트에 push**
- SSE (Server-Sent Events) 또는 WebSocket을 통한 실시간 이벤트 전송
- 클라이언트별 필터링 (owner/caller 기반)

#### 필요한 기능

**2.1.1 SSE 브로드캐스터 구현**
- 파일: `src/lib/events/sse-broadcaster.ts` (신규 생성)
- 클라이언트 연결 관리 (Map<clientId, Response>)
- 이벤트 브로드캐스팅 기능
- 연결 해제 처리

**2.1.2 SSE 엔드포인트 구현**
- 파일: `src/app/api/events/stream/route.ts` (신규 생성)
- 클라이언트가 구독할 수 있는 SSE 엔드포인트
- Query parameter로 필터링 옵션 (owner, caller 등)
- 인증/인가 처리 (선택적)

**2.1.3 Indexer와 SSE 브로드캐스터 연동**
- `src/server/start-indexer.ts` 수정
- 이벤트 핸들러에서 SSE 브로드캐스터로 이벤트 전송
- 필터링 로직 (특정 owner/caller의 이벤트만 전송)

**2.1.4 클라이언트 측 이벤트 구독 훅**
- 파일: `src/hooks/use-event-subscription.ts` (신규 생성)
- EventSource를 사용한 SSE 구독
- 자동 재연결 로직
- React Query와 통합하여 상태 업데이트

#### 구현 방향

**SSE 브로드캐스터 구조:**
```typescript
// src/lib/events/sse-broadcaster.ts
export class SSEBroadcaster {
  private clients: Map<string, {
    response: Response;
    filters: { owner?: string; caller?: string };
  }>;
  
  subscribe(clientId: string, response: Response, filters?: FilterOptions): void;
  unsubscribe(clientId: string): void;
  broadcast(event: IndexedEvent): void;
  broadcastToClient(clientId: string, event: IndexedEvent): void;
}
```

**Indexer 연동:**
```typescript
// src/server/start-indexer.ts 수정
onInputHandleRegistered: async (event) => {
  // 기존 로직 (DB 저장)
  await CiphertextStore.confirm(handleHex);
  
  // SSE 브로드캐스팅 추가
  SSEBroadcaster.broadcast({
    type: 'InputHandleRegistered',
    ...event,
    // owner 필터링하여 해당 클라이언트에만 전송
  });
}
```

---

## 3. 데이터 흐름

### 3.1 Ciphertext 등록 플로우
1. 클라이언트: `registerInputHandle()` 호출
2. 서버: Redis에 임시 저장 → 트랜잭션 생성
3. 클라이언트: 트랜잭션 서명 및 전송
4. 온체인: `InputHandleRegistered` 이벤트 발생
5. Indexer: 이벤트 감지 → DB 저장 → SSE 브로드캐스팅
6. 클라이언트: SSE로 이벤트 수신 → 상태 업데이트

### 3.2 연산 요청 플로우
1. 클라이언트: `requestBinaryOp()` 호출 (lhsHandle, rhsHandle)
2. 클라이언트: `deriveBinaryHandle()`로 결과 handle 미리 계산
3. 서버: 트랜잭션 생성
4. 클라이언트: 트랜잭션 서명 및 전송
5. 온체인: `Fhe16BinaryOpRequested` 이벤트 발생
6. Indexer: 이벤트 감지 → DB 저장 → SSE 브로드캐스팅
7. 클라이언트: SSE로 이벤트 수신 → predicted handle을 confirmed로 전환

### 3.3 Ciphertext 조회 플로우
1. 클라이언트: 유저의 PublicKey로 본인 ciphertext 목록 조회
2. 서버: `/api/ciphertext/by-owner/[owner]` → DB 조회
3. 클라이언트: OperationLog 조회하여 handle 의존성 그래프 구성
4. 클라이언트: 결정적 연산으로 누락된 handle 계산
5. 클라이언트: 모든 handle에 대한 ciphertext 조회 및 캐싱

---

## 4. API 엔드포인트

### 4.1 신규 필요 엔드포인트

**GET `/api/ciphertext/by-owner/[owner]`**
- 특정 owner가 등록한 모든 ciphertext 조회
- Response: `{ ciphertexts: CiphertextRedisPayload[] }`

**GET `/api/events/stream`**
- SSE 스트림 엔드포인트
- Query params: `?owner=<address>&caller=<address>`
- Response: Server-Sent Events 스트림

### 4.2 기존 엔드포인트 활용
- `GET /api/query/ciphertext/[handle]` - 이미 존재
- `GET /api/operation-logs/by-caller/[caller]` - 확인 필요

---

## 5. 구현 우선순위

### Phase 1: 기반 구조
1. ✅ SSE 브로드캐스터 구현 (`src/lib/events/sse-broadcaster.ts`)
2. ✅ SSE 엔드포인트 구현 (`src/app/api/events/stream/route.ts`)
3. ✅ Indexer와 SSE 연동 (`src/server/start-indexer.ts`)

### Phase 2: 클라이언트 확장
4. ✅ `use-demo-state.ts` 확장 (동적 state 관리)
5. ✅ `use-event-subscription.ts` 구현 (SSE 구독 훅)
6. ✅ Ciphertext 조회 API 및 훅 구현

### Phase 3: 통합 및 최적화
7. ✅ 결정적 핸들 연산 통합
8. ✅ 캐싱 전략 최적화
9. ✅ UI 연동 및 테스트

---

## 6. 기술 스택

- **SSE**: Next.js API Routes의 Response 스트리밍
- **상태 관리**: React Query + Local State
- **캐싱**: React Query (클라이언트) + Redis (서버)
- **이벤트 필터링**: 서버 측 필터링 (owner/caller 기반)

---

## 7. 고려사항

### 7.1 성능
- SSE 연결 수 제한 (서버 리소스)
- 이벤트 브로드캐스팅 최적화 (필터링을 서버에서 수행)
- 클라이언트 측 캐싱으로 불필요한 조회 최소화

### 7.2 보안
- SSE 엔드포인트 인증 (선택적, 현재는 PublicKey 기반 필터링)
- 클라이언트가 다른 유저의 이벤트를 구독하지 못하도록 필터링

### 7.3 확장성
- 향후 Indexer를 별도 서비스로 분리 시에도 SSE 브로드캐스터 재사용 가능
- Redis Pub/Sub으로 확장 가능 (다중 서버 환경)

---

## 8. 참고 파일

### 현재 구현된 파일
- `src/lib/handle-utils.ts` - 결정적 핸들 연산
- `src/lib/store/ciphertext-store.ts` - Ciphertext 저장소
- `src/lib/indexer/indexer.ts` - 인덱서 메인 로직
- `src/server/start-indexer.ts` - Next.js 인덱서 시작
- `src/hooks/use-demo-state.ts` - 현재 상태 관리

### 신규 생성 필요 파일
- `src/lib/events/sse-broadcaster.ts` - SSE 브로드캐스터
- `src/app/api/events/stream/route.ts` - SSE 엔드포인트
- `src/app/api/ciphertext/by-owner/[owner]/route.ts` - Owner별 조회
- `src/hooks/use-event-subscription.ts` - 이벤트 구독 훅
- `src/features/fhe/data-access/use-ciphertexts-by-owner.ts` - Ciphertext 조회 훅

