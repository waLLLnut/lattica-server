// instrumentation.ts
// Next.js 서버 시작 시 자동으로 실행됩니다 (서버 사이드에서만)
// 이 파일은 Next.js 13+ App Router에서 서버 초기화 로직을 실행하는 표준 방법입니다
// 프로젝트 루트에 위치해야 합니다 (src/ 안에 있으면 인식 안 될 수 있음)

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 서버 사이드에서만 실행
    // const { startIndexerInNextJs } = await import("./src/server/start-indexer");
    // const { createLogger } = await import("./src/lib/logger");
    
    // const log = createLogger("Instrumentation");
    
    // // 인덱서 시작 (싱글톤 보장)
    // // 에러가 발생해도 Next.js 서버는 계속 실행
    // startIndexerInNextJs().catch((error) => {
    //   log.error("Failed to start indexer", error);
    // });
  }
}

