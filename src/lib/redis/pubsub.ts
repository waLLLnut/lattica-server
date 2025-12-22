// src/lib/redis/pubsub.ts
// Redis Pub/Sub 클라이언트 - Indexer와 API 서버 간 이벤트 버스

import Redis from 'ioredis';
import { createLogger } from '@/lib/logger';
import type {
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
} from '@/types/indexer';
import {
  PUBSUB_CHANNELS,
  type GlobalPubSubMessage,
  type UserPubSubMessage,
  type PubSubMessage,
} from '@/types/pubsub';

const log = createLogger('RedisPubSub');

/**
 * Redis Pub/Sub 클라이언트 싱글톤
 * 
 * Pub/Sub는 별도의 연결이 필요하므로:
 * - Publisher: 일반 Redis 인스턴스 사용
 * - Subscriber: 별도 Redis 인스턴스 사용 (Pub/Sub 전용)
 */
class RedisPubSubClient {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private redisUrl: string;
  private isConnected = false;

  constructor() {
    this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  }

  /**
   * Publisher 연결 초기화
   */
  private async initPublisher(): Promise<void> {
    if (this.publisher) return;

    this.publisher = new Redis(this.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        log.warn(`Publisher reconnecting... (attempt ${times}, delay ${delay}ms)`);
        return delay;
      },
    });

    this.publisher.on('connect', () => {
      log.info('Redis Publisher connected');
    });

    this.publisher.on('error', (error) => {
      log.error('Redis Publisher error', error);
    });

    this.publisher.on('close', () => {
      log.warn('Redis Publisher connection closed');
      this.isConnected = false;
    });

    // 연결 확인
    await this.publisher.ping();
    this.isConnected = true;
  }

  /**
   * Subscriber 연결 초기화
   */
  private async initSubscriber(): Promise<void> {
    if (this.subscriber) return;

    this.subscriber = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null, // Pub/Sub는 null이어야 함
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        log.warn(`Subscriber reconnecting... (attempt ${times}, delay ${delay}ms)`);
        return delay;
      },
    });

    this.subscriber.on('connect', () => {
      log.info('Redis Subscriber connected');
    });

    this.subscriber.on('error', (error) => {
      log.error('Redis Subscriber error', error);
    });

    this.subscriber.on('close', () => {
      log.warn('Redis Subscriber connection closed');
    });

    // 연결 확인
    await this.subscriber.ping();
  }

  /**
   * 이벤트 발행 (Publish)
   * 
   * @param channel 채널명 (PUBSUB_CHANNELS 상수 사용 권장)
   * @param message 발행할 메시지 (Global 또는 User)
   */
  async publish(channel: string, message: PubSubMessage): Promise<void> {
    try {
      await this.initPublisher();

      if (!this.publisher || !this.isConnected) {
        throw new Error('Publisher not connected');
      }

      const messageStr = JSON.stringify(message);
      const subscribers = await this.publisher.publish(channel, messageStr);

      log.info('Event published', {
        channel,
        eventType: message.eventType,
        eventId: message.eventId,
        subscribers,
      });
    } catch (error) {
      log.error('Failed to publish event', error, {
        channel,
        eventType: message.eventType,
      });
      throw error;
    }
  }

  /**
   * 채널 구독 (Subscribe)
   * 
   * @param channel 구독할 채널명
   * @param handler 메시지 수신 핸들러
   * @returns 구독 해제 함수
   */
  async subscribe(
    channel: string,
    handler: (message: PubSubMessage) => void | Promise<void>
  ): Promise<() => Promise<void>> {
    try {
      await this.initSubscriber();

      if (!this.subscriber) {
        throw new Error('Subscriber not initialized');
      }

      // 채널 구독
      await this.subscriber.subscribe(channel);
      log.info('Subscribed to channel', { channel });

      // 메시지 수신 핸들러 등록
      const messageHandler = async (ch: string, messageStr: string) => {
        log.debug('Redis message received', { channel: ch, subscribedChannel: channel });
        
        if (ch !== channel) {
          log.debug('Channel mismatch, ignoring', { received: ch, expected: channel });
          return;
        }

        try {
          const message: PubSubMessage = JSON.parse(messageStr);
          log.info('Processing Redis message', {
            channel: ch,
            eventId: message.eventId,
            eventType: message.eventType,
          });
          await handler(message);
        } catch (error) {
          log.error('Failed to parse or handle message', error, {
            channel: ch,
            message: messageStr.substring(0, 100), // 첫 100자만 로깅
          });
        }
      };

      this.subscriber.on('message', messageHandler);

      // 구독 해제 함수 반환
      return async () => {
        await this.subscriber?.unsubscribe(channel);
        this.subscriber?.off('message', messageHandler);
        log.info('Unsubscribed from channel', { channel });
      };
    } catch (error) {
      log.error('Failed to subscribe to channel', error, { channel });
      throw error;
    }
  }

  /**
   * 여러 채널 동시 구독 (Pattern Subscribe)
   * 
   * @param pattern 채널 패턴 (예: 'channel:user:*')
   * @param handler 메시지 수신 핸들러
   * @returns 구독 해제 함수
   */
  async psubscribe(
    pattern: string,
    handler: (channel: string, message: PubSubMessage) => void | Promise<void>
  ): Promise<() => Promise<void>> {
    try {
      await this.initSubscriber();

      if (!this.subscriber) {
        throw new Error('Subscriber not initialized');
      }

      // 패턴 구독
      await this.subscriber.psubscribe(pattern);
      log.info('Subscribed to pattern', { pattern });

      // 메시지 수신 핸들러 등록
      const messageHandler = async (matchedPattern: string, ch: string, messageStr: string) => {
        if (matchedPattern !== pattern) return;

        try {
          const message: PubSubMessage = JSON.parse(messageStr);
          await handler(ch, message);
        } catch (error) {
          log.error('Failed to parse or handle pattern message', error, {
            pattern: matchedPattern,
            channel: ch,
            message: messageStr.substring(0, 100),
          });
        }
      };

      this.subscriber.on('pmessage', messageHandler);

      // 구독 해제 함수 반환
      return async () => {
        await this.subscriber?.punsubscribe(pattern);
        this.subscriber?.off('pmessage', messageHandler);
        log.info('Unsubscribed from pattern', { pattern });
      };
    } catch (error) {
      log.error('Failed to subscribe to pattern', error, { pattern });
      throw error;
    }
  }

  /**
   * 연결 종료
   */
  async disconnect(): Promise<void> {
    log.info('Disconnecting Redis Pub/Sub clients...');

    if (this.publisher) {
      await this.publisher.quit();
      this.publisher = null;
    }

    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }

    this.isConnected = false;
    log.info('Redis Pub/Sub clients disconnected');
  }

  /**
   * 연결 상태 확인
   */
  isReady(): boolean {
    return this.isConnected && this.publisher !== null;
  }
}

// 싱글톤 인스턴스
let pubSubClient: RedisPubSubClient | null = null;

/**
 * Redis Pub/Sub 클라이언트 싱글톤 가져오기
 */
export function getPubSubClient(): RedisPubSubClient {
  if (!pubSubClient) {
    pubSubClient = new RedisPubSubClient();
  }
  return pubSubClient;
}

/**
 * Handle 배열을 Hex 문자열로 변환
 */
function toHex(handle: number[] | Uint8Array): string {
  if (handle instanceof Uint8Array) {
    return Buffer.from(handle).toString('hex');
  }
  return Buffer.from(handle).toString('hex');
}

/**
 * Event ID 생성 헬퍼
 */
function generateEventId(slot: number, signature: string): string {
  return `${slot}-${signature.substring(0, 8)}-${Date.now()}`;
}

// ============================================================================
// Global 채널 이벤트 발행 함수
// ============================================================================

/**
 * Global 채널: InputHandleRegistered 이벤트 발행
 * 기존 indexer가 구독하는 모든 온체인 이벤트를 그대로 전달
 */
export async function publishGlobalInputHandleRegistered(
  event: InputHandleRegisteredEvent
): Promise<void> {
  const client = getPubSubClient();
  
  const message: GlobalPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'indexer.InputHandleRegistered',
    payload: {
      type: 'indexer.InputHandleRegistered',
      event,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.GLOBAL, message);
  log.info('Published Global InputHandleRegistered event', {
    eventId: message.eventId,
    slot: event.slot,
    caller: event.caller,
  });
}

/**
 * Global 채널: Fhe16UnaryOpRequested 이벤트 발행
 */
export async function publishGlobalUnaryOpRequested(
  event: Fhe16UnaryOpRequestedEvent
): Promise<void> {
  const client = getPubSubClient();
  
  const message: GlobalPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'indexer.Fhe16UnaryOpRequested',
    payload: {
      type: 'indexer.Fhe16UnaryOpRequested',
      event,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.GLOBAL, message);
}

/**
 * Global 채널: Fhe16BinaryOpRequested 이벤트 발행
 */
export async function publishGlobalBinaryOpRequested(
  event: Fhe16BinaryOpRequestedEvent
): Promise<void> {
  const client = getPubSubClient();
  
  const message: GlobalPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'indexer.Fhe16BinaryOpRequested',
    payload: {
      type: 'indexer.Fhe16BinaryOpRequested',
      event,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.GLOBAL, message);
}

/**
 * Global 채널: Fhe16TernaryOpRequested 이벤트 발행
 */
export async function publishGlobalTernaryOpRequested(
  event: Fhe16TernaryOpRequestedEvent
): Promise<void> {
  const client = getPubSubClient();
  
  const message: GlobalPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'indexer.Fhe16TernaryOpRequested',
    payload: {
      type: 'indexer.Fhe16TernaryOpRequested',
      event,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.GLOBAL, message);
}

/**
 * Global 채널: 인덱서 상태 이벤트 발행
 */
export async function publishGlobalIndexerStatus(
  status: 'running' | 'stopped' | 'error',
  lastSlot?: number,
  lastSignature?: string,
  error?: string
): Promise<void> {
  const client = getPubSubClient();
  
  const message: GlobalPubSubMessage = {
    eventId: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
    eventType: status === 'error' ? 'indexer.error' : 'indexer.status',
    payload: status === 'error'
      ? {
          type: 'indexer.error',
          error: error || 'Unknown error',
          lastSlot,
          lastSignature,
        }
      : {
          type: 'indexer.status',
          status,
          lastSlot,
          lastSignature,
        },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.GLOBAL, message);
}

// ============================================================================
// User 채널 이벤트 발행 함수
// ============================================================================

/**
 * User 채널: Ciphertext Registered 이벤트 발행
 * 유저가 등록한 ciphertext가 온체인에 등록됨
 */
export async function publishUserCiphertextRegistered(
  event: InputHandleRegisteredEvent
): Promise<UserPubSubMessage> {
  const client = getPubSubClient();
  const handleHex = toHex(event.handle);
  const clientTagHex = event.clientTag ? toHex(event.clientTag) : undefined;

  const message: UserPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'user.ciphertext.registered',
    targetOwner: event.caller,
    payload: {
      type: 'user.ciphertext.registered',
      handle: handleHex,
      owner: event.caller,
      clientTag: clientTagHex,
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.USER(event.caller), message);
  log.info('Published User Ciphertext Registered event', {
    eventId: message.eventId,
    handle: handleHex,
    owner: event.caller,
  });
  
  return message;
}

/**
 * User 채널: Ciphertext Confirmed 이벤트 발행
 * 유저가 등록한 ciphertext가 확정됨
 */
export async function publishUserCiphertextConfirmed(
  event: InputHandleRegisteredEvent
): Promise<UserPubSubMessage> {
  const client = getPubSubClient();
  const handleHex = toHex(event.handle);
  const clientTagHex = event.clientTag ? toHex(event.clientTag) : undefined;

  const message: UserPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'user.ciphertext.confirmed',
    targetOwner: event.caller,
    payload: {
      type: 'user.ciphertext.confirmed',
      handle: handleHex,
      owner: event.caller,
      clientTag: clientTagHex,
      status: 'confirmed',
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.USER(event.caller), message);
  log.info('Published User Ciphertext Confirmed event', {
    eventId: message.eventId,
    handle: handleHex,
    owner: event.caller,
  });
  
  return message;
}

/**
 * User 채널: Operation Completed 이벤트 발행 (Unary)
 * 유저가 요청한 연산이 완료됨
 */
export async function publishUserOperationCompletedUnary(
  event: Fhe16UnaryOpRequestedEvent
): Promise<void> {
  const client = getPubSubClient();
  const inputHandleHex = toHex(event.inputHandle);
  const resultHandleHex = toHex(event.resultHandle);

  const message: UserPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'user.operation.completed',
    targetOwner: event.caller,
    payload: {
      type: 'user.operation.completed',
      operation: event.op,
      operationType: 'unary',
      inputHandles: [inputHandleHex],
      resultHandle: resultHandleHex,
      owner: event.caller,
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.USER(event.caller), message);
}

/**
 * User 채널: Operation Completed 이벤트 발행 (Binary)
 */
export async function publishUserOperationCompletedBinary(
  event: Fhe16BinaryOpRequestedEvent
): Promise<void> {
  const client = getPubSubClient();
  const lhsHandleHex = toHex(event.lhsHandle);
  const rhsHandleHex = toHex(event.rhsHandle);
  const resultHandleHex = toHex(event.resultHandle);

  const message: UserPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'user.operation.completed',
    targetOwner: event.caller,
    payload: {
      type: 'user.operation.completed',
      operation: event.op,
      operationType: 'binary',
      inputHandles: [lhsHandleHex, rhsHandleHex],
      resultHandle: resultHandleHex,
      owner: event.caller,
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.USER(event.caller), message);
}

/**
 * User 채널: Operation Completed 이벤트 발행 (Ternary)
 */
export async function publishUserOperationCompletedTernary(
  event: Fhe16TernaryOpRequestedEvent
): Promise<void> {
  const client = getPubSubClient();
  const aHandleHex = toHex(event.aHandle);
  const bHandleHex = toHex(event.bHandle);
  const cHandleHex = toHex(event.cHandle);
  const resultHandleHex = toHex(event.resultHandle);

  const message: UserPubSubMessage = {
    eventId: generateEventId(event.slot, event.signature),
    eventType: 'user.operation.completed',
    targetOwner: event.caller,
    payload: {
      type: 'user.operation.completed',
      operation: event.op,
      operationType: 'ternary',
      inputHandles: [aHandleHex, bHandleHex, cHandleHex],
      resultHandle: resultHandleHex,
      owner: event.caller,
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.USER(event.caller), message);
}

/**
 * User 채널: Operation Failed 이벤트 발행
 * 유저가 요청한 연산이 실패함
 */
export async function publishUserOperationFailed(
  owner: string,
  signature: string,
  slot: number,
  blockTime: number | null,
  error: string,
  operation?: string,
  operationType?: 'unary' | 'binary' | 'ternary'
): Promise<void> {
  const client = getPubSubClient();

  const message: UserPubSubMessage = {
    eventId: generateEventId(slot, signature),
    eventType: 'user.operation.failed',
    targetOwner: owner,
    payload: {
      type: 'user.operation.failed',
      operation,
      operationType,
      owner,
      signature,
      slot,
      blockTime,
      error,
    },
    publishedAt: Date.now(),
  };

  await client.publish(PUBSUB_CHANNELS.USER(owner), message);
}
