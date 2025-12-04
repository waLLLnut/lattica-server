// scripts/redis-worker.ts
// Redis 연결 테스트 및 워커 스크립트

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import Redis from "ioredis";

// Next.js 환경에서 실행되는지 체크 (import 이후에 실행)
if (process.env.NEXT_PHASE || process.env.NEXT_RUNTIME) {
  console.error("[ERROR] This script should not be run with Next.js");
  console.error("[ERROR] This is a standalone worker script");
  process.exit(1);
}

async function main() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  console.log("[INFO] Redis Worker starting...");
  console.log(`[INFO] Redis URL: ${redisUrl}`);

  const redis = new Redis(redisUrl);

  // Redis 연결 이벤트 처리
  redis.on("connect", () => {
    console.log("[INFO] Redis connection established");
  });

  redis.on("error", (error) => {
    console.error(`[ERROR] Redis connection error: ${error.message}`);
  });

  redis.on("close", () => {
    console.log("[INFO] Redis connection closed");
  });

  try {
    // Redis 연결 테스트
    await redis.set("indexer_status", "running");
    const status = await redis.get("indexer_status");
    console.log(`[INFO] Redis connection successful: status = ${status}`);
  } catch (error) {
    console.error("[ERROR] Redis connection failed:", error);
    await redis.quit();
    process.exit(1);
  }

  // 3초마다 로그 출력 (블록체인 감시 시뮬레이션)
  const watchInterval = setInterval(() => {
    const timestamp = new Date().toISOString();
    console.log(`[INFO] [Watcher] 블록체인 감시 중... ${timestamp}`);
  }, 3000);

  // 종료 처리
  const shutdown = async () => {
    console.log("[INFO] Shutting down Redis worker...");
    clearInterval(watchInterval);
    await redis.quit();
    console.log("[INFO] Redis worker stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(`[ERROR] Failed to start Redis worker: ${error.message}`);
  process.exit(1);
});

