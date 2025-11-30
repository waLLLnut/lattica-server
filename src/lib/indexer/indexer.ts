// src/lib/indexer/indexer.ts
// Host Programs 인덱서 메인 클래스

import { Connection, PublicKey, Finality } from "@solana/web3.js";
import { EventParser, BorshCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";

// 타입 및 설정 import
import type {
  IndexedEvent,
  IndexerConfig,
  EventHandlers,
  IndexerMode,
} from "@/types/indexer";
import { createDefaultConfig } from "./config";

// 타입 재export (외부에서 사용)
export type {
  IndexedEvent,
  InputHandleRegisteredEvent,
  Fhe16UnaryOpRequestedEvent,
  Fhe16BinaryOpRequestedEvent,
  Fhe16TernaryOpRequestedEvent,
  IndexerConfig,
  EventHandlers,
  IndexerMode,
  Network,
  Idl,
} from "@/types/indexer";

export class HostProgramsIndexer {
  private connection: Connection;
  private programId: PublicKey;
  private eventParser: EventParser;
  private subscriptionId: number | null = null;
  private config: Required<IndexerConfig>;
  private handlers: EventHandlers = {};
  private lastProcessedSlot = 0;
  private lastProcessedSignature: string | null = null; // 순차 조회를 위한 마지막 signature
  private isPolling = false;
  private pollIntervalId: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private currentMode: IndexerMode | null = null;
  private isRunning = false;

  constructor(config: IndexerConfig, idl: Idl) {
    // 설정 병합 및 기본값 적용
    this.config = createDefaultConfig(config.network, config.programId, config);

    this.connection = new Connection(this.config.rpcEndpoint, {
      commitment: this.config.commitment,
      wsEndpoint: this.config.wsEndpoint,
    });

    this.programId = new PublicKey(this.config.programId);
    
    // Anchor EventParser 사용
    const coder = new BorshCoder(idl);
    this.eventParser = new EventParser(this.programId, coder);
  }

  public on(handlers: EventHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * 인덱서 시작 (실행 모드 선택)
   * @param mode - 'websocket' 또는 'polling'
   */
  public async start(mode: IndexerMode = "websocket"): Promise<void> {
    if (this.isRunning) {
      console.warn(`[WARN] Indexer already running (mode: ${this.currentMode})`);
      return;
    }

    this.currentMode = mode;
    this.isRunning = true;

    if (mode === "websocket") {
      await this.startWebSocketSubscription();
    } else {
      await this.startPolling();
    }
  }

  /**
   * WebSocket 구독 시작 (중복 구독 방지)
   */
  public async startWebSocketSubscription(): Promise<void> {
    // 기존 구독이 있으면 제거
    if (this.subscriptionId !== null) {
      console.warn("[WARN] Existing WebSocket subscription found, removing before re-subscribing");
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }

    // 폴링이 실행 중이면 중지
    if (this.isPolling) {
      console.warn("[WARN] Polling mode is active, stopping before switching to WebSocket mode");
      await this.stopPolling();
    }

    try {
      console.log(`[INFO] Starting WebSocket subscription for program: ${this.programId.toString()}`);

      this.subscriptionId = this.connection.onLogs(
        this.programId,
        async (logs, ctx) => {
          try {
            await this.processLogs(logs.logs, logs.signature, ctx.slot);
          } catch (error) {
            this.handleError(error as Error);
          }
        },
        this.config.commitment
      );

      console.log(`[INFO] WebSocket subscription established (id: ${this.subscriptionId})`);
      this.reconnectAttempts = 0;
      this.currentMode = "websocket";
    } catch (error) {
      this.handleError(error as Error);
      await this.attemptReconnect();
    }
  }

  /**
   * 폴링 모드 시작 (WebSocket 구독이 있으면 중지)
   */
  public async startPolling(): Promise<void> {
    if (this.isPolling) {
      console.warn("[WARN] Polling is already active");
      return;
    }

    // WebSocket 구독이 있으면 제거
    if (this.subscriptionId !== null) {
      console.warn("[WARN] WebSocket subscription found, removing before switching to polling mode");
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }

    this.isPolling = true;
    this.currentMode = "polling";
    console.log(`[INFO] Starting polling mode (interval: ${this.config.pollInterval}ms)`);

    if (this.lastProcessedSlot === 0) {
      // 초기 슬롯 설정: 현재 슬롯에서 시작 (과거 트랜잭션은 제외)
      // 재시도 로직 추가
      let retries = 3;
      while (retries > 0) {
        try {
          this.lastProcessedSlot = await this.connection.getSlot(
            this.config.commitment
          );
          console.log(`[INFO] Initial slot set: ${this.lastProcessedSlot}`);
          break;
        } catch (error) {
          retries--;
          if (retries === 0) {
            console.error(`[ERROR] Failed to get initial slot after 3 attempts: ${error}`);
            throw error;
          }
          console.warn(`[WARN] Failed to get initial slot, retrying... (${3 - retries}/3)`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    this.pollIntervalId = setInterval(async () => {
      try {
        await this.pollForNewTransactions();
      } catch (error) {
        this.handleError(error as Error);
      }
    }, this.config.pollInterval);
  }

  /**
   * 폴링 중지 (내부 메서드)
   */
  private async stopPolling(): Promise<void> {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
      this.isPolling = false;
    }
  }

  /**
   * 누락 없이 순서대로 트랜잭션을 조회하고 처리
   */
  private async pollForNewTransactions(): Promise<void> {
    try {
      const currentSlot = await this.connection.getSlot(this.config.commitment);

      if (currentSlot <= this.lastProcessedSlot) {
        return;
      }

      // 모든 새 트랜잭션을 순차적으로 가져오기
      const allNewSignatures = await this.fetchAllNewTransactions();

      if (allNewSignatures.length === 0) {
        return;
      }

      console.log(`[INFO] Found ${allNewSignatures.length} new transaction(s)`);

      // 슬롯 순서대로 정렬 (중요: 순서 보장)
      allNewSignatures.sort((a, b) => {
        // 먼저 슬롯으로 정렬
        if (a.slot !== b.slot) {
          return a.slot - b.slot;
        }
        // 같은 슬롯이면 blockTime으로 정렬 (있다면)
        if (a.blockTime && b.blockTime) {
          return a.blockTime - b.blockTime;
        }
        return 0;
      });

      // 슬롯 간격 감지
      this.detectSlotGaps(allNewSignatures);

      // 순차 처리 (순서 보장)
      for (const sigInfo of allNewSignatures) {
        try {
          const tx = await this.connection.getTransaction(sigInfo.signature, {
            commitment: this.config.commitment as Finality,
            maxSupportedTransactionVersion: 0,
          });

          if (!tx) {
            console.warn(`[WARN] Transaction not found: ${sigInfo.signature}`);
            continue;
          }

          if (!tx.meta?.logMessages) {
            console.warn(`[WARN] Transaction has no log messages: ${sigInfo.signature}`);
            continue;
          }

          await this.processLogs(
            tx.meta.logMessages,
            sigInfo.signature,
            sigInfo.slot,
            tx.blockTime || null,
            tx
          );

          // 처리 완료 후 마지막 상태 업데이트
          this.lastProcessedSlot = sigInfo.slot;
          this.lastProcessedSignature = sigInfo.signature;
        } catch (error) {
          console.error(`[ERROR] Failed to process transaction: ${sigInfo.signature}`, error);
          this.handleError(error as Error);
          // 에러가 발생해도 다음 트랜잭션 계속 처리
        }
      }

      if (allNewSignatures.length > 0) {
        const lastSig = allNewSignatures[allNewSignatures.length - 1];
        console.log(
          `[INFO] Processing complete: slot ${this.lastProcessedSlot} → ${lastSig.slot} (${allNewSignatures.length} transaction(s))`
        );
      }
    } catch (error) {
      console.error("[ERROR] Polling error:", error);
      this.handleError(error as Error);
    }
  }

  /**
   * 모든 새 트랜잭션을 순차적으로 가져오기
   * 최신 트랜잭션부터 가져와서 lastProcessedSlot 이후의 것만 필터링
   */
  private async fetchAllNewTransactions(): Promise<
    Array<{ signature: string; slot: number; blockTime: number | null }>
  > {
    const allSignatures: Array<{
      signature: string;
      slot: number;
      blockTime: number | null;
    }> = [];

    let before: string | undefined = undefined; // 최신부터 시작
    let hasMore = true;
    let batchCount = 0;
    const maxBatches = this.config.maxBatches;

    while (hasMore && batchCount < maxBatches) {
      try {
        const signatures = await this.connection.getSignaturesForAddress(
          this.programId,
          {
            limit: 1000, // 최대값 사용
            before: before,
          },
          this.config.commitment as Finality
        );

        if (signatures.length === 0) {
          hasMore = false;
          break;
        }

        // lastProcessedSlot 이후의 트랜잭션만 필터링
        const newSigs = signatures.filter((sig) => sig.slot > this.lastProcessedSlot);

        // 새 트랜잭션이 있으면 추가
        if (newSigs.length > 0) {
          const sigsWithBlockTime = newSigs.map((sig) => ({
            signature: sig.signature,
            slot: sig.slot,
            blockTime: sig.blockTime || null,
          }));

          allSignatures.push(...sigsWithBlockTime);
        }

        // 마지막 트랜잭션의 슬롯 확인
        const lastSlot = signatures[signatures.length - 1].slot;

        // 마지막 트랜잭션이 lastProcessedSlot 이하이면 더 이상 조회할 필요 없음
        if (lastSlot <= this.lastProcessedSlot) {
          hasMore = false;
          break;
        }

        // 마지막 signature를 before로 설정 (다음 배치 조회 - 과거 방향)
        before = signatures[signatures.length - 1].signature;

        batchCount++;

        // 배치가 1000개 미만이면 더 이상 조회할 필요 없음 (모든 트랜잭션 조회 완료)
        if (signatures.length < 1000) {
          hasMore = false;
          break;
        }
      } catch (error) {
        console.error("[ERROR] Failed to fetch transactions:", error);
        this.handleError(error as Error);
        hasMore = false;
        break;
      }
    }

    if (batchCount >= maxBatches) {
      console.warn(
        `[WARN] Reached maximum batch count (${maxBatches}), some transactions may be missing`
      );
    }

    if (process.env.NODE_ENV === "development" && batchCount > 0) {
      console.log(`[DEBUG] Found ${allSignatures.length} new transaction(s) across ${batchCount} batch(es)`);
    }

    return allSignatures;
  }

  /**
   * 슬롯 간격 감지 및 경고
   */
  private detectSlotGaps(
    signatures: Array<{ signature: string; slot: number; blockTime: number | null }>
  ): void {
    if (signatures.length === 0) return;

    // 이전 슬롯과의 간격 체크
    if (this.lastProcessedSlot > 0) {
      const firstSlot = signatures[0].slot;
      const gap = firstSlot - this.lastProcessedSlot;
      if (gap > 1) {
        console.warn(
          `[WARN] Slot gap detected: ${this.lastProcessedSlot} → ${firstSlot} (gap: ${gap} slot(s))`
        );
        console.warn(
          `[WARN] Transactions in intermediate slots may be missing, manual verification may be required`
        );
      }
    }

    // 내부 간격 체크
    for (let i = 1; i < signatures.length; i++) {
      const gap = signatures[i].slot - signatures[i - 1].slot;
      if (gap > 1) {
        console.warn(
          `[WARN] Transaction slot gap detected: ${signatures[i - 1].slot} → ${signatures[i].slot} (gap: ${gap} slot(s))`
        );
        console.warn(
          `[WARN] Signatures: ${signatures[i - 1].signature} → ${signatures[i].signature}`
        );
      }
    }
  }

  /**
   * 로그 처리 및 이벤트 파싱
   * @param logs - 트랜잭션 로그 배열
   * @param signature - 트랜잭션 서명
   * @param slot - 슬롯 번호
   * @param blockTime - 블록 타임스탬프 (선택적, 이미 조회한 경우)
   * @param tx - 트랜잭션 객체 (선택적, 이미 조회한 경우)
   */
  private async processLogs(
    logs: string[],
    signature: string,
    slot: number,
    blockTime?: number | null,
    tx?: {
      blockTime?: number | null;
      transaction?: {
        message?: {
          staticAccountKeys?: PublicKey[];
          getAccountKeys?: () => { staticAccountKeys?: PublicKey[] };
        };
      };
    }
  ): Promise<void> {
    try {
      // 디버깅: 원본 로그 출력 (개발 환경에서만)
      if (process.env.NODE_ENV === "development") {
        console.log(`[DEBUG] Parsing logs for transaction: ${signature}`);
        console.log(`[DEBUG] Log count: ${logs.length}`);
      }

      // Anchor EventParser로 이벤트 파싱
      const eventsIter = this.eventParser.parseLogs(logs);
      // Generator를 배열로 변환
      const events = Array.from(eventsIter);

      if (process.env.NODE_ENV === "development") {
        console.log(`[DEBUG] Parsed event count: ${events.length}`);
        if (events.length === 0) {
          console.warn(`[DEBUG] No events parsed, check logs`);
          console.warn(`[DEBUG] Log sample:`, logs.slice(0, 5));
        }
      }

      // 트랜잭션 정보가 없으면 조회 (중복 조회 방지)
      let finalBlockTime = blockTime ?? null;
      let finalTx: typeof tx = tx;
      let caller = "unknown";

      if (!finalTx) {
        const fetchedTx = await this.connection.getTransaction(signature, {
          commitment: this.config.commitment as Finality,
          maxSupportedTransactionVersion: 0,
        });

        if (!fetchedTx) {
          console.warn(`⚠️  트랜잭션을 찾을 수 없습니다: ${signature}`);
          return;
        }

        finalTx = fetchedTx as typeof tx;
        finalBlockTime = fetchedTx.blockTime ?? null;
      }

      caller = this.extractCaller(finalTx);

      // 각 이벤트 처리
      for (const event of events) {
        if (process.env.NODE_ENV === "development") {
          console.log(`🔍 [DEBUG] 이벤트 처리:`, {
            name: event.name,
            dataKeys: Object.keys(event.data || {}),
          });
        }

        const indexedEvent = this.createIndexedEvent(
          event,
          signature,
          slot,
          finalBlockTime ?? null,
          caller
        );

        if (indexedEvent) {
          await this.dispatchEvent(indexedEvent);
        } else {
          console.warn(`⚠️  이벤트 변환 실패: ${event.name}`);
        }
      }
    } catch (error) {
      console.error(`❌ 로그 처리 중 오류 (${signature}):`, error);
      this.handleError(error as Error);
    }
  }

  private extractCaller(
    tx:
      | {
          transaction?: {
            message?: {
              staticAccountKeys?: PublicKey[];
              getAccountKeys?: () => { staticAccountKeys?: PublicKey[] };
            };
          };
        }
      | null
      | undefined
  ): string {
    if (!tx || !tx.transaction?.message) {
      return "unknown";
    }

    const accountKeys =
      tx.transaction.message.staticAccountKeys ||
      tx.transaction.message.getAccountKeys?.()?.staticAccountKeys;
    return accountKeys?.[0]?.toString() || "unknown";
  }

  /**
   * 이벤트 이름 정규화 (PascalCase로 통일)
   */
  private normalizeEventName(name: string): string {
    // PascalCase로 변환 (첫 글자 대문자)
    if (name.length === 0) return name;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * 필드 값 가져오기 (snake_case 우선, camelCase 대체)
   */
  private getFieldValue(
    obj: Record<string, unknown> | null | undefined,
    ...keys: string[]
  ): unknown {
    if (!obj || typeof obj !== "object") return undefined;

    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) {
        return obj[key];
      }
    }
    return undefined;
  }

  /**
   * 인덱싱된 이벤트 생성
   */
  private createIndexedEvent(
    event: { name: string; data: Record<string, unknown> },
    signature: string,
    slot: number,
    blockTime: number | null,
    caller: string
  ): IndexedEvent | null {
    if (!event || !event.data) {
      console.warn("[WARN] Event data is missing");
      return null;
    }

    // 이벤트 이름 정규화
    const normalizedName = this.normalizeEventName(event.name);

    const baseEvent = {
      signature,
      slot,
      blockTime,
      // caller는 snake_case 우선, 없으면 fallback
      caller:
        this.getFieldValue(event.data, "caller")?.toString() || caller,
    };

    const extractOpName = (op: unknown): string => {
      if (typeof op === "string") return op;
      if (typeof op === "object" && op !== null) {
        const keys = Object.keys(op);
        return keys.length > 0 ? keys[0] : "unknown";
      }
      return "unknown";
    };

    const safeArrayFrom = (data: unknown): number[] => {
      if (data === undefined || data === null) return [];
      if (Array.isArray(data)) return data;
      if (data instanceof Uint8Array) return Array.from(data);
      if (typeof data === "object") {
        // 객체인 경우 값들을 배열로 변환
        const values = Object.values(data);
        if (values.every((v) => typeof v === "number")) {
          return values as number[];
        }
      }
      return [];
    };

    // 이벤트 타입별 처리 (PascalCase로 통일)
    switch (normalizedName) {
      case "InputHandleRegistered": {
        const handle = safeArrayFrom(
          this.getFieldValue(event.data, "handle")
        );
        const clientTag = safeArrayFrom(
          this.getFieldValue(event.data, "client_tag", "clientTag")
        );

        if (handle.length === 0 || clientTag.length === 0) {
          console.warn("[WARN] InputHandleRegistered event fields are empty");
          return null;
        }

        return {
          ...baseEvent,
          type: "InputHandleRegistered",
          handle,
          clientTag,
        };
      }

      case "Fhe16UnaryOpRequested": {
        const op = extractOpName(
          this.getFieldValue(event.data, "op")
        );
        const inputHandle = safeArrayFrom(
          this.getFieldValue(event.data, "input_handle", "inputHandle")
        );
        const resultHandle = safeArrayFrom(
          this.getFieldValue(event.data, "result_handle", "resultHandle")
        );

        if (inputHandle.length === 0 || resultHandle.length === 0) {
          console.warn("[WARN] Fhe16UnaryOpRequested event fields are empty");
          return null;
        }

        return {
          ...baseEvent,
          type: "Fhe16UnaryOpRequested",
          op,
          inputHandle,
          resultHandle,
        };
      }

      case "Fhe16BinaryOpRequested": {
        const op = extractOpName(
          this.getFieldValue(event.data, "op")
        );
        const lhsHandle = safeArrayFrom(
          this.getFieldValue(event.data, "lhs_handle", "lhsHandle")
        );
        const rhsHandle = safeArrayFrom(
          this.getFieldValue(event.data, "rhs_handle", "rhsHandle")
        );
        const resultHandle = safeArrayFrom(
          this.getFieldValue(event.data, "result_handle", "resultHandle")
        );

        if (lhsHandle.length === 0 || rhsHandle.length === 0 || resultHandle.length === 0) {
          console.warn("[WARN] Fhe16BinaryOpRequested event fields are empty");
          return null;
        }

        return {
          ...baseEvent,
          type: "Fhe16BinaryOpRequested",
          op,
          lhsHandle,
          rhsHandle,
          resultHandle,
        };
      }

      case "Fhe16TernaryOpRequested": {
        const op = extractOpName(
          this.getFieldValue(event.data, "op")
        );
        const aHandle = safeArrayFrom(
          this.getFieldValue(event.data, "a_handle", "aHandle")
        );
        const bHandle = safeArrayFrom(
          this.getFieldValue(event.data, "b_handle", "bHandle")
        );
        const cHandle = safeArrayFrom(
          this.getFieldValue(event.data, "c_handle", "cHandle")
        );
        const resultHandle = safeArrayFrom(
          this.getFieldValue(event.data, "result_handle", "resultHandle")
        );

        if (
          aHandle.length === 0 ||
          bHandle.length === 0 ||
          cHandle.length === 0 ||
          resultHandle.length === 0
        ) {
          console.warn("[WARN] Fhe16TernaryOpRequested event fields are empty");
          return null;
        }

        return {
          ...baseEvent,
          type: "Fhe16TernaryOpRequested",
          op,
          aHandle,
          bHandle,
          cHandle,
          resultHandle,
        };
      }

      default:
        console.warn(`[WARN] Unknown event type: ${event.name} (normalized: ${normalizedName})`);
        return null;
    }
  }

  private async dispatchEvent(event: IndexedEvent): Promise<void> {
    console.log(`[INFO] Event received: ${event.type} (slot: ${event.slot}, signature: ${event.signature})`);

    try {
      switch (event.type) {
        case "InputHandleRegistered":
          await this.handlers.onInputHandleRegistered?.(event);
          break;
        case "Fhe16UnaryOpRequested":
          await this.handlers.onFhe16UnaryOpRequested?.(event);
          break;
        case "Fhe16BinaryOpRequested":
          await this.handlers.onFhe16BinaryOpRequested?.(event);
          break;
        case "Fhe16TernaryOpRequested":
          await this.handlers.onFhe16TernaryOpRequested?.(event);
          break;
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  private handleError(error: Error): void {
    console.error(`[ERROR] Indexer error: ${error.message}`);
    this.handlers.onError?.(error);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[ERROR] Maximum reconnection attempts exceeded, switching to polling mode");
      await this.startPolling();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(
      `[INFO] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(async () => {
      this.handlers.onReconnect?.();
      await this.startWebSocketSubscription();
    }, delay);
  }

  /**
   * 인덱서 중지
   */
  public async stop(): Promise<void> {
    console.log("[INFO] Stopping indexer...");

    if (this.subscriptionId !== null) {
      try {
        await this.connection.removeOnLogsListener(this.subscriptionId);
        this.subscriptionId = null;
        console.log("[INFO] WebSocket subscription removed");
      } catch (error) {
        console.error("[ERROR] Failed to remove WebSocket subscription:", error);
      }
    }

    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
      this.isPolling = false;
      console.log("[INFO] Polling stopped");
    }

    this.isRunning = false;
    this.currentMode = null;
    console.log("[INFO] Indexer stopped");
  }

  /**
   * 인덱서 통계 정보
   */
  public getStats() {
    return {
      programId: this.programId.toString(),
      network: this.config.network,
      lastProcessedSlot: this.lastProcessedSlot,
      lastProcessedSignature: this.lastProcessedSignature,
      isPolling: this.isPolling,
      subscriptionId: this.subscriptionId,
      reconnectAttempts: this.reconnectAttempts,
      currentMode: this.currentMode,
      isRunning: this.isRunning,
    };
  }
}