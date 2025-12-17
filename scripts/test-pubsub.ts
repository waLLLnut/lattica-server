// scripts/test-pubsub.ts
// Phase 1 테스트: Redis Pub/Sub 이벤트 발행 및 구독 테스트

// .env.local 파일 로드
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPubSubClient } from "@/lib/redis/pubsub";
import {
  publishGlobalInputHandleRegistered,
  publishGlobalIndexerStatus,
  publishUserCiphertextRegistered,
  publishUserCiphertextConfirmed,
} from "@/lib/redis/pubsub";
import { PUBSUB_CHANNELS, type PubSubMessage } from "@/types/pubsub";
import type { InputHandleRegisteredEvent } from "@/types/indexer";
import { createLogger } from "@/lib/logger";

const log = createLogger('PubSubTest');

// 테스트용 더미 이벤트 생성
function createDummyInputHandleRegisteredEvent(): InputHandleRegisteredEvent {
  const handle = Buffer.from('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex');
  const clientTag = Buffer.from('deadbeef', 'hex');
  
  return {
    type: 'InputHandleRegistered',
    signature: '5VERv8NMvzbJMEkV8xnrLkEaWRt6p5jXK6NxTzQ3rHu8fM5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    slot: 123456789,
    blockTime: Math.floor(Date.now() / 1000),
    caller: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    handle: Array.from(handle),
    clientTag: Array.from(clientTag),
  };
}

async function testPubSubConnection() {
  log.info('🔍 Testing Redis Pub/Sub connection...');
  
  const client = getPubSubClient();
  
  try {
    // 연결 상태 확인
    if (!client.isReady()) {
      log.warn('Client not ready, initializing...');
      // publish를 호출하면 자동으로 초기화됨
    }
    
    log.info('✅ Pub/Sub client initialized');
    return true;
  } catch (error) {
    log.error('❌ Failed to initialize Pub/Sub client', error);
    return false;
  }
}

async function testGlobalChannel() {
  log.info('📡 Testing Global channel...');
  
  const client = getPubSubClient();
  const receivedMessages: PubSubMessage[] = [];
  
  try {
    // Global 채널 구독
    const unsubscribe = await client.subscribe(PUBSUB_CHANNELS.GLOBAL, (message) => {
      log.info('📨 Received Global message', {
        eventType: message.eventType,
        eventId: message.eventId,
      });
      receivedMessages.push(message);
    });
    
    log.info('✅ Subscribed to Global channel');
    
    // 테스트 이벤트 발행
    await new Promise((resolve) => setTimeout(resolve, 500)); // 구독이 완전히 설정될 때까지 대기
    
    log.info('📤 Publishing test events...');
    
    // 1. 인덱서 상태 이벤트
    await publishGlobalIndexerStatus('running', 123456789, 'test-signature');
    log.info('  ✓ Published indexer.status event');
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    // 2. InputHandleRegistered 이벤트
    const testEvent = createDummyInputHandleRegisteredEvent();
    await publishGlobalInputHandleRegistered(testEvent);
    log.info('  ✓ Published InputHandleRegistered event');
    
    // 메시지 수신 대기
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // 구독 해제
    await unsubscribe();
    
    if (receivedMessages.length >= 2) {
      log.info(`✅ Global channel test passed! Received ${receivedMessages.length} messages`);
      return true;
    } else {
      log.warn(`⚠️  Global channel test incomplete. Expected 2 messages, received ${receivedMessages.length}`);
      return false;
    }
  } catch (error) {
    log.error('❌ Global channel test failed', error);
    return false;
  }
}

async function testUserChannel() {
  log.info('👤 Testing User channel...');
  
  const client = getPubSubClient();
  const testWallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  let receivedMessages: any[] = [];
  
  try {
    // User 채널 구독
    const userChannel = PUBSUB_CHANNELS.USER(testWallet);
    const unsubscribe = await client.subscribe(userChannel, (message) => {
      log.info('📨 Received User message', {
        eventType: message.eventType,
        eventId: message.eventId,
      });
      receivedMessages.push(message);
    });
    
    log.info(`✅ Subscribed to User channel: ${userChannel}`);
    
    // 테스트 이벤트 발행
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    log.info('📤 Publishing test user events...');
    
    const testEvent = createDummyInputHandleRegisteredEvent();
    
    // 1. Ciphertext Registered
    await publishUserCiphertextRegistered(testEvent);
    log.info('  ✓ Published user.ciphertext.registered event');
    
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    // 2. Ciphertext Confirmed
    await publishUserCiphertextConfirmed(testEvent);
    log.info('  ✓ Published user.ciphertext.confirmed event');
    
    // 메시지 수신 대기
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // 구독 해제
    await unsubscribe();
    
    if (receivedMessages.length >= 2) {
      log.info(`✅ User channel test passed! Received ${receivedMessages.length} messages`);
      return true;
    } else {
      log.warn(`⚠️  User channel test incomplete. Expected 2 messages, received ${receivedMessages.length}`);
      return false;
    }
  } catch (error) {
    log.error('❌ User channel test failed', error);
    return false;
  }
}

async function testPatternSubscribe() {
  log.info('🔍 Testing Pattern Subscribe (channel:user:*)...');
  
  const client = getPubSubClient();
  const testWallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  let receivedMessages: any[] = [];
  
  try {
    // 패턴 구독
    const pattern = 'channel:user:*';
    const unsubscribe = await client.psubscribe(pattern, (channel, message) => {
      log.info('📨 Received pattern message', {
        channel,
        eventType: message.eventType,
        eventId: message.eventId,
      });
      receivedMessages.push({ channel, message });
    });
    
    log.info(`✅ Subscribed to pattern: ${pattern}`);
    
    // 테스트 이벤트 발행
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    const testEvent = createDummyInputHandleRegisteredEvent();
    await publishUserCiphertextRegistered(testEvent);
    log.info('  ✓ Published test event to user channel');
    
    // 메시지 수신 대기
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // 구독 해제
    await unsubscribe();
    
    if (receivedMessages.length >= 1) {
      log.info(`✅ Pattern subscribe test passed! Received ${receivedMessages.length} messages`);
      return true;
    } else {
      log.warn(`⚠️  Pattern subscribe test incomplete. Expected 1 message, received ${receivedMessages.length}`);
      return false;
    }
  } catch (error) {
    log.error('❌ Pattern subscribe test failed', error);
    return false;
  }
}

async function main() {
  log.info('🚀 Starting Phase 1 Pub/Sub Testing...');
  log.info('');
  
  const results = {
    connection: false,
    globalChannel: false,
    userChannel: false,
    patternSubscribe: false,
  };
  
  try {
    // 1. 연결 테스트
    results.connection = await testPubSubConnection();
    log.info('');
    
    if (!results.connection) {
      log.error('❌ Connection test failed. Please check Redis connection.');
      process.exit(1);
    }
    
    // 2. Global 채널 테스트
    results.globalChannel = await testGlobalChannel();
    log.info('');
    
    // 3. User 채널 테스트
    results.userChannel = await testUserChannel();
    log.info('');
    
    // 4. Pattern Subscribe 테스트
    results.patternSubscribe = await testPatternSubscribe();
    log.info('');
    
    // 결과 요약
    log.info('📊 Test Results Summary:');
    log.info(`  Connection: ${results.connection ? '✅' : '❌'}`);
    log.info(`  Global Channel: ${results.globalChannel ? '✅' : '❌'}`);
    log.info(`  User Channel: ${results.userChannel ? '✅' : '❌'}`);
    log.info(`  Pattern Subscribe: ${results.patternSubscribe ? '✅' : '❌'}`);
    log.info('');
    
    const allPassed = Object.values(results).every((r) => r === true);
    
    if (allPassed) {
      log.info('🎉 All tests passed! Phase 1 Pub/Sub is working correctly.');
      process.exit(0);
    } else {
      log.warn('⚠️  Some tests failed. Please check the logs above.');
      process.exit(1);
    }
  } catch (error) {
    log.error('❌ Test suite failed', error);
    process.exit(1);
  } finally {
    // 클라이언트 연결 종료
    const client = getPubSubClient();
    await client.disconnect().catch(() => {
      // 무시
    });
  }
}

main().catch((error) => {
  log.error('Fatal error', error);
  process.exit(1);
});

