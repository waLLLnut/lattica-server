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
import { createDefaultConfig, detectRpcType, getRpcConfig, type RpcType, type RpcConfig } from "./config";
import { createLogger } from "@/lib/logger";

const log = createLogger("Indexer");

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
  
  // Rate limiting 관련 상태
  private rpcType: RpcType;
  private rpcConfig: RpcConfig;
  private currentPollInterval: number;
  private rateLimitBackoffUntil: number | null = null; // Rate limit 해제 시각 (timestamp)
  private consecutiveRateLimitErrors = 0;

  constructor(config: IndexerConfig, idl: Idl) {
    // 설정 병합 및 기본값 적용
    const fullConfig = createDefaultConfig(config.network, config.programId, config);
    this.config = fullConfig;

    // RPC 타입 및 설정 가져오기 (config에서 가져오거나 직접 감지)
    this.rpcType = (fullConfig as Required<IndexerConfig & { rpcType: RpcType; rpcConfig: RpcConfig }>).rpcType || detectRpcType(this.config.rpcEndpoint);
    this.rpcConfig = (fullConfig as Required<IndexerConfig & { rpcType: RpcType; rpcConfig: RpcConfig }>).rpcConfig || getRpcConfig(this.rpcType);
    this.currentPollInterval = this.config.pollInterval;

    log.info('Indexer initialized with RPC configuration', {
      rpcEndpoint: this.config.rpcEndpoint,
      rpcType: this.rpcType,
      pollInterval: this.currentPollInterval,
      maxBatches: this.config.maxBatches,
      requestDelay: this.rpcConfig.requestDelay,
    });

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
   * 마지막 처리된 슬롯 설정 (복구용)
   * @param slot - 마지막 처리된 슬롯 번호
   * @param signature - 마지막 처리된 트랜잭션 signature (선택적)
   */
  public setLastProcessedSlot(slot: number, signature?: string | null): void {
    this.lastProcessedSlot = slot;
    if (signature !== undefined) {
      this.lastProcessedSignature = signature || null;
    }
    log.info('Last processed slot set', { slot, signature });
  }

  /**
   * 인덱서 시작 (실행 모드 선택)
   * @param mode - 'websocket' 또는 'polling'
   */
  public async start(mode: IndexerMode = "websocket"): Promise<void> {
    if (this.isRunning) {
      log.warn("Indexer already running", { mode: this.currentMode });
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
      log.warn("Existing WebSocket subscription found, removing before re-subscribing");
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }

    // 폴링이 실행 중이면 중지
    if (this.isPolling) {
      log.warn("Polling mode is active, stopping before switching to WebSocket mode");
      await this.stopPolling();
    }

    try {
      log.info("Starting WebSocket subscription", { program_id: this.programId.toString() });

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

      log.info("WebSocket subscription established", { subscription_id: this.subscriptionId });
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
      log.warn("Polling is already active");
      return;
    }

    // WebSocket 구독이 있으면 제거
    if (this.subscriptionId !== null) {
      log.warn("WebSocket subscription found, removing before switching to polling mode");
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }

    this.isPolling = true;
    this.currentMode = "polling";
    log.info("Starting polling mode", { 
      interval_ms: this.currentPollInterval,
      rpcType: this.rpcType,
    });

    if (this.lastProcessedSlot === 0) {
      // 초기 슬롯 설정: 현재 슬롯에서 시작 (과거 트랜잭션은 제외)
      // 재시도 로직 추가
      let retries = this.rpcConfig.maxRetries;
      while (retries > 0) {
        try {
          this.lastProcessedSlot = await this.connection.getSlot(
            this.config.commitment
          );
          log.info("Initial slot set", { slot: this.lastProcessedSlot });
          break;
        } catch (error) {
          retries--;
          if (retries === 0) {
            log.error("Failed to get initial slot after retries", error);
            throw error;
          }
          log.warn("Failed to get initial slot, retrying", { 
            attempt: this.rpcConfig.maxRetries - retries,
            max_attempts: this.rpcConfig.maxRetries,
          });
          await this.handleRateLimitError(error as Error, 1000);
        }
      }
    }

    // Polling 시작 (동적 interval 사용)
    this.startPolling();
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
   * Rate limit 에러 처리
   */
  private async handleRateLimitError(error: Error, defaultDelay: number = 1000): Promise<void> {
    const errorMessage = error.message.toLowerCase();
    const isRateLimit = 
      errorMessage.includes('429') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('rate_limit');

    if (isRateLimit) {
      this.consecutiveRateLimitErrors++;
      const backoffMultiplier = this.rpcConfig.rateLimitBackoff;
      const backoffDuration = this.currentPollInterval * backoffMultiplier * this.consecutiveRateLimitErrors;
      
      this.rateLimitBackoffUntil = Date.now() + backoffDuration;
      this.currentPollInterval = Math.min(
        this.currentPollInterval * backoffMultiplier,
        this.config.pollInterval * 10 // 최대 10배까지만
      );

      log.warn("Rate limit detected, applying backoff", {
        consecutiveErrors: this.consecutiveRateLimitErrors,
        backoffDuration,
        newPollInterval: this.currentPollInterval,
        rpcType: this.rpcType,
      });

      await new Promise(resolve => setTimeout(resolve, backoffDuration));
    } else {
      // Rate limit이 아닌 다른 에러는 기본 지연만
      await new Promise(resolve => setTimeout(resolve, defaultDelay));
    }
  }

  /**
   * RPC 요청 실행 (Rate limiting 및 에러 처리 포함)
   */
  private async executeRpcRequest<T>(
    request: () => Promise<T>,
    operation: string
  ): Promise<T> {
    const maxRetries = this.rpcConfig.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 요청 간 지연 (RPC 타입별)
        if (this.rpcConfig.requestDelay > 0 && attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, this.rpcConfig.requestDelay));
        }

        const result = await request();
        
        // 성공 시 연속 에러 카운트 리셋
        if (this.consecutiveRateLimitErrors > 0) {
          this.consecutiveRateLimitErrors = 0;
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        const errorMessage = (error as Error).message.toLowerCase();
        const isRateLimit = 
          errorMessage.includes('429') ||
          errorMessage.includes('too many requests') ||
          errorMessage.includes('rate limit');

        if (isRateLimit) {
          log.warn(`Rate limit error on ${operation}`, {
            attempt,
            maxRetries,
            rpcType: this.rpcType,
          });
          
          if (attempt < maxRetries) {
            const backoffDelay = this.currentPollInterval * this.rpcConfig.rateLimitBackoff * attempt;
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          }
        } else {
          log.warn(`RPC error on ${operation}`, {
            attempt,
            maxRetries,
            error: (error as Error).message,
          });
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
        }
      }
    }

    // 모든 재시도 실패
    throw lastError || new Error(`Failed to execute ${operation} after ${maxRetries} attempts`);
  }

  /**
   * 누락 없이 순서대로 트랜잭션을 조회하고 처리
   */
  private async pollForNewTransactions(): Promise<void> {
    try {
      const currentSlot = await this.executeRpcRequest(
        () => this.connection.getSlot(this.config.commitment),
        'getSlot'
      );

      if (currentSlot <= this.lastProcessedSlot) {
        return;
      }

      // 모든 새 트랜잭션을 순차적으로 가져오기
      const allNewSignatures = await this.fetchAllNewTransactions();

      if (allNewSignatures.length === 0) {
        return;
      }

      log.info("Found new transactions", { count: allNewSignatures.length });

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
          // Rate limiting을 고려한 요청 실행
          const tx = await this.executeRpcRequest(
            () => this.connection.getTransaction(sigInfo.signature, {
              commitment: this.config.commitment as Finality,
              maxSupportedTransactionVersion: 0,
            }),
            `getTransaction(${sigInfo.signature.slice(0, 8)}...)`
          );

          if (!tx) {
            log.warn("Transaction not found", { signature: sigInfo.signature });
            continue;
          }

          if (!tx.meta?.logMessages) {
            log.warn("Transaction has no log messages", { signature: sigInfo.signature });
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
          log.error("Failed to process transaction", error, { signature: sigInfo.signature });
          this.handleError(error as Error);
          // 에러가 발생해도 다음 트랜잭션 계속 처리
        }
      }

      if (allNewSignatures.length > 0) {
        const lastSig = allNewSignatures[allNewSignatures.length - 1];
        log.info("Processing complete", {
          from_slot: this.lastProcessedSlot,
          to_slot: lastSig.slot,
          transaction_count: allNewSignatures.length,
        });
      }
    } catch (error) {
      log.error("Polling error", error);
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
        // Rate limiting을 고려한 요청 실행
        const signatures = await this.executeRpcRequest(
          () => this.connection.getSignaturesForAddress(
            this.programId,
            {
              limit: 1000, // 최대값 사용
              before: before,
            },
            this.config.commitment as Finality
          ),
          `getSignaturesForAddress(batch ${batchCount + 1})`
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
        log.error("Failed to fetch transactions", error);
        this.handleError(error as Error);
        hasMore = false;
        break;
      }
    }

    if (batchCount >= maxBatches) {
      log.warn("Reached maximum batch count", {
        max_batches: maxBatches,
        message: "Some transactions may be missing",
      });
    }

    if (process.env.NODE_ENV === "development" && batchCount > 0) {
      log.debug("Found new transactions across batches", {
        transaction_count: allSignatures.length,
        batch_count: batchCount,
      });
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
        log.warn("Slot gap detected", {
          from_slot: this.lastProcessedSlot,
          to_slot: firstSlot,
          gap_slots: gap,
          message: "Transactions in intermediate slots may be missing, manual verification may be required",
        });
      }
    }

    // 내부 간격 체크
    for (let i = 1; i < signatures.length; i++) {
      const gap = signatures[i].slot - signatures[i - 1].slot;
      if (gap > 1) {
        log.warn("Transaction slot gap detected", {
          from_slot: signatures[i - 1].slot,
          to_slot: signatures[i].slot,
          gap_slots: gap,
          from_signature: signatures[i - 1].signature,
          to_signature: signatures[i].signature,
        });
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
        log.debug("Parsing logs for transaction", { signature, log_count: logs.length });
      }

      // Anchor EventParser로 이벤트 파싱
      const eventsIter = this.eventParser.parseLogs(logs);
      // Generator를 배열로 변환
      const events = Array.from(eventsIter);

      if (process.env.NODE_ENV === "development") {
        log.debug("Parsed events", { 
          event_count: events.length,
          signature,
        });
        if (events.length === 0) {
          log.warn("No events parsed, check logs", { 
            signature,
            log_sample: logs.slice(0, 5),
          });
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
          log.warn("Transaction not found", { signature });
          return;
        }

        finalTx = fetchedTx as typeof tx;
        finalBlockTime = fetchedTx.blockTime ?? null;
      }

      caller = this.extractCaller(finalTx);

      // 각 이벤트 처리
      for (const event of events) {
        if (process.env.NODE_ENV === "development") {
          log.debug("Processing event", {
            event_name: event.name,
            data_keys: Object.keys(event.data || {}),
            signature,
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
          log.warn("Event conversion failed", { event_name: event.name, signature });
        }
      }
    } catch (error) {
      log.error("Error processing logs", error, { signature });
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
      log.warn("Event data is missing", { event_name: event?.name, signature });
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
          log.warn("InputHandleRegistered event fields are empty", { signature });
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
          log.warn("Fhe16UnaryOpRequested event fields are empty", { signature });
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
          log.warn("Fhe16BinaryOpRequested event fields are empty", { signature });
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
          log.warn("Fhe16TernaryOpRequested event fields are empty", { signature });
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
        log.warn("Unknown event type", { 
          event_name: event.name,
          normalized_name: normalizedName,
          signature,
        });
        return null;
    }
  }

  private async dispatchEvent(event: IndexedEvent): Promise<void> {
    log.info("Event received", {
      event_type: event.type,
      slot: event.slot,
      signature: event.signature,
    });

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
    log.error("Indexer error", error);
    this.handlers.onError?.(error);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error("Maximum reconnection attempts exceeded, switching to polling mode", undefined, {
        max_attempts: this.maxReconnectAttempts,
      });
      await this.startPolling();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    log.info("Reconnecting", {
      delay_ms: delay,
      attempt: this.reconnectAttempts,
      max_attempts: this.maxReconnectAttempts,
    });

    setTimeout(async () => {
      this.handlers.onReconnect?.();
      await this.startWebSocketSubscription();
    }, delay);
  }

  /**
   * 인덱서 중지
   */
  public async stop(): Promise<void> {
    log.info("Stopping indexer");

    if (this.subscriptionId !== null) {
      try {
        await this.connection.removeOnLogsListener(this.subscriptionId);
        this.subscriptionId = null;
        log.info("WebSocket subscription removed");
      } catch (error) {
        log.error("Failed to remove WebSocket subscription", error);
      }
    }

    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
      this.isPolling = false;
      log.info("Polling stopped");
    }

    this.isRunning = false;
    this.currentMode = null;
    log.info("Indexer stopped");
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