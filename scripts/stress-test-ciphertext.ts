// scripts/stress-test-ciphertext.ts
// Ciphertext API 스트레스 테스트 스크립트

import { randomBytes } from 'crypto';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT || '10', 10);
const TOTAL_REQUESTS = parseInt(process.env.TOTAL || '100', 10);
const DELAY_MS = parseInt(process.env.DELAY || '0', 10);

// 테스트 데이터 생성 유틸리티
function generateHexHandle(): string {
  return randomBytes(32).toString('hex');
}

function generateBase64Ciphertext(size: number = 100): string {
  return randomBytes(size).toString('base64');
}

function generatePublicKey(): string {
  // 간단한 테스트용 PublicKey (실제로는 더 복잡할 수 있음)
  const bytes = randomBytes(32);
  // Base58은 복잡하므로, 테스트용으로 간단한 문자열 사용
  // 실제로는 Solana PublicKey 형식이어야 함
  return '11111111111111111111111111111111'; // System Program (테스트용)
}

interface TestResult {
  success: boolean;
  status: number;
  duration: number;
  error?: string;
}

async function sendRequest(index: number): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    const handle = generateHexHandle();
    const ciphertext = generateBase64Ciphertext(100);
    const owner = generatePublicKey();
    const clientTag = generateHexHandle();

    const response = await fetch(`${BASE_URL}/api/ciphertext`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        handle,
        ciphertext,
        owner,
        clientTag,
      }),
    });

    const duration = Date.now() - startTime;
    const data = await response.json();

    return {
      success: response.ok,
      status: response.status,
      duration,
      error: response.ok ? undefined : data.error || 'Unknown error',
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      status: 0,
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function runBatch(batchSize: number): Promise<TestResult[]> {
  const promises = Array.from({ length: batchSize }, (_, i) => sendRequest(i));
  return Promise.all(promises);
}

async function main() {
  console.log('🚀 Ciphertext API Stress Test');
  console.log('================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Concurrent Requests: ${CONCURRENT_REQUESTS}`);
  console.log(`Total Requests: ${TOTAL_REQUESTS}`);
  console.log(`Delay between batches: ${DELAY_MS}ms`);
  console.log('');

  const results: TestResult[] = [];
  const startTime = Date.now();

  // 배치 단위로 실행
  const batches = Math.ceil(TOTAL_REQUESTS / CONCURRENT_REQUESTS);
  
  for (let batch = 0; batch < batches; batch++) {
    const remaining = TOTAL_REQUESTS - results.length;
    const batchSize = Math.min(CONCURRENT_REQUESTS, remaining);
    
    console.log(`Batch ${batch + 1}/${batches} (${batchSize} requests)...`);
    
    const batchResults = await runBatch(batchSize);
    results.push(...batchResults);
    
    // 진행 상황 출력
    const successCount = batchResults.filter(r => r.success).length;
    const avgDuration = batchResults.reduce((sum, r) => sum + r.duration, 0) / batchResults.length;
    console.log(`  ✅ Success: ${successCount}/${batchSize}, Avg Duration: ${avgDuration.toFixed(2)}ms`);
    
    // 마지막 배치가 아니면 대기
    if (batch < batches - 1 && DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  const totalDuration = Date.now() - startTime;

  // 결과 분석
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;
  const successRate = (successCount / results.length) * 100;
  
  const durations = results.map(r => r.duration);
  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  
  // 중앙값 계산
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianDuration = sortedDurations[Math.floor(sortedDurations.length / 2)];

  // 상태 코드별 통계
  const statusCounts: Record<number, number> = {};
  results.forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  });

  // 결과 출력
  console.log('');
  console.log('📊 Test Results');
  console.log('================================');
  console.log(`Total Requests: ${results.length}`);
  console.log(`✅ Success: ${successCount} (${successRate.toFixed(2)}%)`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`⏱️  Total Duration: ${totalDuration}ms`);
  console.log(`📈 Requests/sec: ${(results.length / (totalDuration / 1000)).toFixed(2)}`);
  console.log('');
  console.log('⏱️  Response Times:');
  console.log(`  Average: ${avgDuration.toFixed(2)}ms`);
  console.log(`  Median: ${medianDuration.toFixed(2)}ms`);
  console.log(`  Min: ${minDuration}ms`);
  console.log(`  Max: ${maxDuration}ms`);
  console.log('');
  console.log('📋 Status Codes:');
  Object.entries(statusCounts)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

  // 실패한 요청 상세 정보
  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    console.log('');
    console.log('❌ Failed Requests (first 10):');
    failures.slice(0, 10).forEach((failure, i) => {
      console.log(`  ${i + 1}. Status: ${failure.status}, Error: ${failure.error || 'N/A'}, Duration: ${failure.duration}ms`);
    });
  }

  // 종료 코드
  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
