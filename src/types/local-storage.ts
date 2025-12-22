// src/types/local-storage.ts
// 로컬스토리지 저장을 위한 타입 정의
// FHE Confidential State Architecture (Final) 기반
// Storage Separation: LocalStorage (Metadata) + IndexedDB (Blob)

/**
 * State Machine Status
 * 상태 머신의 상태 전이: OPTIMISTIC → SUBMITTING → CONFIRMED → FAILED
 */
export type MachineStatus = 'OPTIMISTIC' | 'SUBMITTING' | 'CONFIRMED' | 'FAILED';

/**
 * Client State Item (Metadata Only)
 * 로컬스토리지에 저장되는 메타데이터 (암호문 데이터는 제외)
 * 
 * ER Diagram:
 * - handle (PK)
 * - owner
 * - status (OPTIMISTIC | SUBMITTING | CONFIRMED | FAILED)
 * - txSignature (Local Tracking, Recovery용)
 * - predictedHandle (Local Calc Result)
 * - createdAt (timestamp)
 * - confirmedAt (timestamp, optional)
 * - clientTag (optional)
 * - isCached (IndexedDB에 blob이 있는지 여부)
 * 
 * Note:
 * - data 필드는 저장하지 않음 (IndexedDB에서 lazy load)
 * - timeoutId는 저장하지 않음 (타이머는 페이지 로드 시 재생성)
 */
export interface ClientStateItemMeta {
  /** Ciphertext handle (hex, 64 chars) - Primary Key */
  handle: string;
  
  /** 지갑 주소 (owner) */
  owner: string;
  
  /** 상태 머신 상태 */
  status: MachineStatus;
  
  /** 트랜잭션 서명 (Local Tracking, Recovery용) */
  txSignature?: string;
  
  /** 예측된 핸들 (로컬 계산 결과) */
  predictedHandle?: string;
  
  /** 생성 시간 (timestamp, milliseconds) */
  createdAt: number;
  
  /** 확정 시간 (timestamp, milliseconds, optional) */
  confirmedAt?: number;
  
  /** 클라이언트 태그 (optional) */
  clientTag?: string;
  
  /** IndexedDB에 blob이 캐시되어 있는지 여부 */
  isCached?: boolean;
}

/**
 * Client State Item (Runtime)
 * 런타임 메모리에서 사용하는 전체 아이템 (data 포함)
 * 
 * LocalStorage에는 저장하지 않고, 필요시 IndexedDB에서 lazy load
 */
export interface ClientStateItem extends ClientStateItemMeta {
  /** 암호문 데이터 (Base64, 런타임 메모리 또는 IndexedDB에서 lazy load) */
  data?: string | null;
  
  /** 롤백 타이머 ID (런타임 전용, 저장하지 않음) */
  timeoutId?: number;
}

/**
 * Dependency Graph Entry
 * 의존성 그래프: 연산 결과와 입력 핸들 간의 관계
 */
export interface DependencyEntry {
  /** 연산 타입 (ADD, SUB, AND, OR 등) */
  op: string;
  
  /** 입력 핸들 배열 */
  inputs: string[];
}

/**
 * Confidential State Store (Serialized for LocalStorage)
 * 로컬스토리지에 저장되는 전체 스토어 상태 (메타데이터만)
 * 
 * Storage Separation:
 * - LocalStorage: 메타데이터만 저장 (가볍고 빠름)
 * - IndexedDB: 실제 암호문 데이터 저장 (무겁지만 비동기)
 * 
 * Zustand Persist 미들웨어는 JSON.stringify/parse를 사용하므로
 * Map 대신 Record를 사용하면 별도 직렬화 로직이 필요 없음
 */
export interface ConfidentialStateStoreSerialized {
  /** Items 객체 (Record<string, ClientStateItemMeta>) - data 필드 제외 */
  items: Record<string, ClientStateItemMeta>;
  
  /** 의존성 그래프 객체 (Record<string, DependencyEntry>) */
  dependencies: Record<string, DependencyEntry>;
  
  /** 마지막 이벤트 ID (Gap Filling용) */
  lastEventId?: string;
}

/**
 * IndexedDB Blob Entry
 * IndexedDB에 저장되는 암호문 데이터
 */
export interface BlobEntry {
  /** 암호문 데이터 (Base64) */
  data: string;
  
  /** 업데이트 시간 (timestamp, milliseconds) */
  updatedAt: number;
}

/**
 * 로컬스토리지 키
 */
export const LOCAL_STORAGE_KEYS = {
  CONFIDENTIAL_STATE: 'fhe-state-machine-v1',
} as const;

/**
 * IndexedDB 키 (idb-keyval 사용 시)
 */
export const INDEXED_DB_KEYS = {
  BLOB_STORE: 'fhe-blob-store',
} as const;

/**
 * Map을 Record로 변환 (직렬화용)
 * Zustand Persist는 Record를 자동으로 JSON 직렬화하므로 Map → Record 변환 필요
 */
export function mapToRecord<K extends string | number, V>(
  map: Map<K, V>
): Record<K, V> {
  const record = {} as Record<K, V>;
  map.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/**
 * Record를 Map으로 변환 (복원용)
 */
export function recordToMap<K extends string | number, V>(
  record: Record<K, V>
): Map<K, V> {
  return new Map(Object.entries(record) as Array<[K, V]>);
}

/**
 * ClientStateItem에서 메타데이터만 추출 (data 필드 제거)
 * LocalStorage 저장 전 필터링용
 */
export function extractMetadata(item: ClientStateItem): ClientStateItemMeta {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data, timeoutId, ...meta } = item;
  return meta;
}

/**
 * ConfidentialStateStore를 로컬스토리지에 저장 가능한 형태로 변환
 * Map → Record 변환 및 data 필드 제거
 */
export function serializeConfidentialStateStore(
  items: Map<string, ClientStateItem>,
  dependencies: Map<string, DependencyEntry>,
  lastEventId?: string
): ConfidentialStateStoreSerialized {
  // data 필드를 제외한 메타데이터만 추출
  const itemsMeta: Record<string, ClientStateItemMeta> = {};
  items.forEach((value, key) => {
    itemsMeta[key] = extractMetadata(value);
  });

  return {
    items: itemsMeta,
    dependencies: mapToRecord(dependencies),
    lastEventId,
  };
}

/**
 * 로컬스토리지에서 복원한 데이터를 Map으로 변환
 * Record → Map 변환
 * 
 * Note: data 필드는 복원하지 않음 (IndexedDB에서 lazy load 필요)
 */
export function deserializeConfidentialStateStore(
  serialized: ConfidentialStateStoreSerialized
): {
  items: Map<string, ClientStateItemMeta>;
  dependencies: Map<string, DependencyEntry>;
  lastEventId?: string;
} {
  return {
    items: recordToMap(serialized.items),
    dependencies: recordToMap(serialized.dependencies),
    lastEventId: serialized.lastEventId,
  };
}
