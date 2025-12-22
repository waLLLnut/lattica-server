// src/types/index.ts
// 모든 타입을 한 곳에서 export
// DB, Indexer 등 모든 도메인 타입을 여기서 관리

// Indexer 타입
export type {
  BaseEvent,
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
  IndexedEvent,
  Network,
  Commitment,
  IndexerConfig,
  EventHandlers,
  IndexerMode,
  Idl,
} from "./indexer";

// Pub/Sub 타입
export {
  PUBSUB_CHANNELS,
  isGlobalEvent,
  isUserEvent,
} from "./pubsub";
export type {
  GlobalEventType,
  UserEventType,
  GlobalEventPayload,
  UserEventPayload,
  GlobalPubSubMessage,
  UserPubSubMessage,
  PubSubMessage,
} from "./pubsub";

// Local Storage 타입
export {
  LOCAL_STORAGE_KEYS,
  INDEXED_DB_KEYS,
  mapToRecord,
  recordToMap,
  extractMetadata,
  serializeConfidentialStateStore,
  deserializeConfidentialStateStore,
} from "./local-storage";
export type {
  MachineStatus,
  ClientStateItemMeta,
  ClientStateItem,
  DependencyEntry,
  ConfidentialStateStoreSerialized,
  BlobEntry,
} from "./local-storage";

