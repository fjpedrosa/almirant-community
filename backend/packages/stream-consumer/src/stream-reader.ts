import { AsyncLocalStorage } from "node:async_hooks";
import Redis from "ioredis";
import type {
  AgentOutputEvent,
  StreamReaderConfig,
  RetryConfig,
  StreamConsumerMetrics,
} from "./types";
import { DEFAULT_STREAM_NAME } from "./types";
import { createRetryTracker, type RetryTracker } from "./retry-tracker";
import {
  createDeadLetterHandler,
  type DeadLetterHandler,
} from "./dead-letter-handler";
import {
  createIdempotencyGuard,
  type IdempotencyGuard,
} from "./idempotency-guard";
import { createStreamCleaner } from "./stream-cleaner";
import {
  createHealthReporter,
  type HealthReporter,
} from "./health-reporter";

// ---------------------------------------------------------------------------
// StreamReader — Redis PEL is the durable retry ledger; ACK follows persistence
// ---------------------------------------------------------------------------

export type StreamReaderHandler = (
  event: AgentOutputEvent,
  /** Compatibility callback. ACK is reader-owned and occurs after success. */
  ack: () => Promise<void>,
) => Promise<void>;

export type StreamReader = {
  start: (handler: StreamReaderHandler) => void;
  stop: () => Promise<void>;
  getMetrics: () => Promise<StreamConsumerMetrics>;
};

const JSON_FIELDS = new Set(["options", "agents", "payload"]);
const NUMERIC_FIELDS = new Set([
  "timestamp",
  "sequenceNumber",
  "successCount",
  "totalCount",
  "elapsedMs",
]);

export const parseEvent = (fields: string[]): AgentOutputEvent => {
  const obj: Record<string, unknown> = {};

  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === undefined || value === undefined) continue;

    if (JSON_FIELDS.has(key)) {
      try {
        obj[key] = JSON.parse(value);
      } catch {
        obj[key] = value;
      }
    } else if (NUMERIC_FIELDS.has(key)) {
      const num = Number(value);
      obj[key] = Number.isNaN(num) ? value : num;
    } else {
      obj[key] = value;
    }
  }

  return obj as AgentOutputEvent;
};

type PendingError = [entryId: string, error: unknown];

export type StreamEntryProcessorConfig = {
  redis: Redis;
  streamName: string;
  consumerGroup: string;
  consumerId: string;
  retryTracker: RetryTracker;
  dlqHandler: DeadLetterHandler;
  idempotency: IdempotencyGuard;
  health: HealthReporter;
  maxRetries: number;
  recoveryClaimIdleMs: number;
};

export type StreamEntryProcessor = {
  /**
   * Records every entry returned by the current process' XREADGROUP batch
   * before sequential handler work begins. Recovery must not mistake that
   * local queue for a stranded PEL after its idle timer advances.
   */
  registerReadEntries: (entryIds: string[]) => void;
  process: (
    entryId: string,
    fields: string[],
    handler: StreamReaderHandler,
  ) => Promise<void>;
  recover: (handler: StreamReaderHandler) => Promise<void>;
  /** Waits every current persistence and rejects while an error remains PEL-backed. */
  drain: () => Promise<void>;
  getPendingErrors: () => PendingError[];
};

const isNonRetryable = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "retryable" in error &&
  error.retryable === false;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createStreamEntryProcessor = (
  config: StreamEntryProcessorConfig,
): StreamEntryProcessor => {
  const {
    redis,
    streamName,
    consumerGroup,
    consumerId,
    retryTracker,
    dlqHandler,
    idempotency,
    health,
    maxRetries,
    recoveryClaimIdleMs,
  } = config;
  const pendingErrors = new Map<string, unknown>();
  const inFlight = new Set<Promise<void>>();
  const locallyReadEntries = new Set<string>();
  const activeEntryIds = new Set<string>();

  const acknowledgeProcessed = async (entryId: string): Promise<void> => {
    await redis.xack(streamName, consumerGroup, entryId);
    // The marker only protects the crash window between the durable side
    // effect and XACK. Once ACK succeeds, retaining it adds memory but no
    // idempotency protection. Cleanup is best-effort because the ACK is final.
    try {
      await idempotency.clearProcessed(consumerGroup, entryId);
    } catch {
      // The TTL remains the fallback cleanup path.
    }
  };

  const quarantine = async (
    entryId: string,
    fields: string[],
    event: AgentOutputEvent,
    error: unknown,
    retryCount: number,
  ): Promise<void> => {
    await dlqHandler.moveToDlq(
      event,
      errorMessage(error),
      retryCount,
      consumerGroup,
      { sourceStream: streamName, entryId, originalFields: fields },
    );
    retryTracker.remove(entryId);
    pendingErrors.delete(entryId);
    locallyReadEntries.delete(entryId);
    health.recordDlq();
  };

  const runProcess = async (
    entryId: string,
    fields: string[],
    handler: StreamReaderHandler,
  ): Promise<void> => {
    const event = parseEvent(fields);

    try {
      if (await idempotency.isProcessed(consumerGroup, entryId)) {
        await acknowledgeProcessed(entryId);
        retryTracker.remove(entryId);
        pendingErrors.delete(entryId);
        locallyReadEntries.delete(entryId);
        return;
      }

      // ACK is deliberately reader-owned. Legacy handlers may still call this
      // callback, but it is a no-op so they cannot ACK before DB persistence.
      await handler(event, async () => undefined);

      // The handler's durable side effect (the API insert) completed first.
      await idempotency.markProcessed(consumerGroup, entryId);
      await acknowledgeProcessed(entryId);
      retryTracker.remove(entryId);
      pendingErrors.delete(entryId);
      locallyReadEntries.delete(entryId);
      health.recordProcessed();
    } catch (error) {
      health.recordFailed();

      if (isNonRetryable(error)) {
        try {
          await quarantine(
            entryId,
            fields,
            event,
            error,
            retryTracker.getRetryCount(entryId),
          );
          return;
        } catch (quarantineError) {
          // A failed Lua transaction leaves the source in PEL. Retry the whole
          // quarantine boundary rather than acknowledging partial work.
          error = quarantineError;
        }
      }

      retryTracker.recordFailure(entryId);
      pendingErrors.set(entryId, error);
    }
  };

  const process = (
    entryId: string,
    fields: string[],
    handler: StreamReaderHandler,
  ): Promise<void> => {
    locallyReadEntries.add(entryId);
    activeEntryIds.add(entryId);
    const operation = runProcess(entryId, fields, handler).finally(() => {
      activeEntryIds.delete(entryId);
    });
    inFlight.add(operation);
    void operation.finally(() => {
      inFlight.delete(operation);
    }).catch(() => undefined);
    return operation;
  };

  const recover = async (handler: StreamReaderHandler): Promise<void> => {
    const pendingEntries = await redis.xpending(
      streamName,
      consumerGroup,
      "-",
      "+",
      100,
    );
    if (!Array.isArray(pendingEntries)) return;

    const retryableIds = new Set(
      retryTracker.getRetryableEventIds(Date.now()),
    );
    // Preserve the historical RetryTracker contract: maxRetries is the total
    // number of failed deliveries recorded before quarantine (the initial
    // delivery counts as the first failure).
    const maxDeliveries = Math.max(1, maxRetries);

    for (const pendingEntry of pendingEntries) {
      if (!Array.isArray(pendingEntry)) continue;
      const entryId = String(pendingEntry[0]);
      const idleMs = Number(pendingEntry[2]);
      const deliveries = Number(pendingEntry[3]);
      if (!Number.isFinite(idleMs) || !Number.isFinite(deliveries)) continue;

      const exhausted = deliveries >= maxDeliveries;
      const localRetryCount = retryTracker.getRetryCount(entryId);
      // XREADGROUP assigns the full batch to the PEL before this process works
      // through it sequentially. Its idle time is therefore not evidence of a
      // crash while the entry is active or still queued locally. Failed local
      // entries have a retry count and remain eligible for scheduled recovery.
      if (activeEntryIds.has(entryId)) continue;
      if (locallyReadEntries.has(entryId) && localRetryCount === 0) continue;
      if (!exhausted) {
        if (localRetryCount > 0 && !retryableIds.has(entryId)) continue;
        // After restart the in-memory tracker is empty. Redis idle time and PEL
        // delivery count are sufficient to reclaim the stranded message.
        if (localRetryCount === 0 && idleMs < recoveryClaimIdleMs) continue;
      } else if (idleMs < recoveryClaimIdleMs) {
        continue;
      }

      let claimed: unknown;
      try {
        claimed = await redis.xclaim(
          streamName,
          consumerGroup,
          consumerId,
          recoveryClaimIdleMs,
          entryId,
        );
      } catch {
        continue;
      }
      if (!Array.isArray(claimed) || claimed.length === 0) continue;

      const claimedEntry = claimed[0];
      if (!Array.isArray(claimedEntry)) continue;
      const claimedId = String(claimedEntry[0]);
      const claimedFields = claimedEntry[1];
      if (!Array.isArray(claimedFields)) continue;
      const exactFields = claimedFields.map(String);

      if (exhausted) {
        try {
          await quarantine(
            claimedId,
            exactFields,
            parseEvent(exactFields),
            new Error("Max retries exhausted"),
            Math.max(0, deliveries - 1),
          );
        } catch (error) {
          retryTracker.recordFailure(claimedId);
          pendingErrors.set(claimedId, error);
          health.recordFailed();
        }
        continue;
      }

      health.recordRetried();
      await process(claimedId, exactFields, handler);
    }
  };

  const drain = async (): Promise<void> => {
    while (inFlight.size > 0) {
      await Promise.all([...inFlight]);
    }
    if (pendingErrors.size === 1) {
      const only = pendingErrors.values().next().value;
      if (only instanceof Error) throw only;
      throw new Error(String(only));
    }
    if (pendingErrors.size > 1) {
      throw new AggregateError(
        [...pendingErrors.values()],
        `${pendingErrors.size} stream entries remain pending after persistence errors`,
      );
    }
  };

  return {
    registerReadEntries: (entryIds) => {
      for (const entryId of entryIds) locallyReadEntries.add(entryId);
    },
    process,
    recover,
    drain,
    getPendingErrors: () => [...pendingErrors.entries()],
  };
};

const DEFAULT_BLOCK_MS = 5_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_PAGE_CONCURRENCY = 1;
const DEFAULT_RECOVERY_INTERVAL_MS = 1_000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

export const createStreamReader = (
  config: StreamReaderConfig & { retry?: RetryConfig },
): StreamReader => {
  const streamName = config.streamName ?? DEFAULT_STREAM_NAME;
  const consumerGroup = config.consumerGroup;
  const consumerId = config.consumerId;
  const blockMs = config.blockMs ?? DEFAULT_BLOCK_MS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const pageConcurrency = Math.max(
    1,
    config.pageConcurrency ?? DEFAULT_PAGE_CONCURRENCY,
  );
  const recoveryIntervalMs =
    config.retry?.recoveryIntervalMs ?? DEFAULT_RECOVERY_INTERVAL_MS;
  const maxRetries = config.retry?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const recoveryClaimIdleMs = Math.max(
    1,
    config.retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
  );

  let running = false;
  let redis: Redis | null = null;
  let recoveryInterval: ReturnType<typeof setInterval> | null = null;
  let retryTracker: RetryTracker | null = null;
  let cleaner: ReturnType<typeof createStreamCleaner> | null = null;
  let health: HealthReporter | null = null;
  let processor: StreamEntryProcessor | null = null;
  let mainTask: Promise<void> | null = null;
  let shutdownTask: Promise<void> | null = null;
  let startupError: unknown;
  const recoveryTasks = new Set<Promise<void>>();
  const handlerContext = new AsyncLocalStorage<boolean>();

  const ensureConsumerGroup = async (client: Redis): Promise<void> => {
    try {
      await client.xgroup("CREATE", streamName, consumerGroup, "0", "MKSTREAM");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("BUSYGROUP")) throw error;
    }
  };

  const mainLoop = async (
    client: Redis,
    entryProcessor: StreamEntryProcessor,
    handler: StreamReaderHandler,
  ): Promise<void> => {
    while (running) {
      try {
        const results = await client.xreadgroup(
          "GROUP",
          consumerGroup,
          consumerId,
          "COUNT",
          batchSize,
          "BLOCK",
          blockMs,
          "STREAMS",
          streamName,
          ">",
        );
        if (!results) continue;

        for (const streamResult of results) {
          const entries = (streamResult as [string, [string, string[]][]])[1];
          entryProcessor.registerReadEntries(entries.map(([entryId]) => entryId));
          // Entries are dispatched in stream order. `process` never rejects — it
          // records failures in pendingErrors and quarantines non-retryables — so
          // Promise.all cannot swallow one or abandon the rest of the page. Every
          // dispatched entry joins inFlight and activeEntryIds before its first
          // await, so drain() still waits for it and recover() still sees it as
          // locally owned rather than as a stranded PEL entry.
          for (let offset = 0; offset < entries.length; offset += pageConcurrency) {
            if (!running) return;
            await Promise.all(
              entries
                .slice(offset, offset + pageConcurrency)
                .map(([entryId, fields]) =>
                  entryProcessor.process(entryId, fields, handler),
                ),
            );
          }
        }
      } catch (error) {
        if (!running) return;
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("Connection is closed") ||
          message.includes("Stream isn't readable")
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  };

  const start = (handler: StreamReaderHandler): void => {
    if (running) return;
    running = true;
    startupError = undefined;
    shutdownTask = null;

    const client = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
    redis = client;
    retryTracker = createRetryTracker(config.retry);
    const dlqHandler = createDeadLetterHandler(client, config.dlqStreamName);
    const idempotency = createIdempotencyGuard(client);
    cleaner = createStreamCleaner(client, { streamName });
    health = createHealthReporter(client, streamName, consumerGroup);
    processor = createStreamEntryProcessor({
      redis: client,
      streamName,
      consumerGroup,
      consumerId,
      retryTracker,
      dlqHandler,
      idempotency,
      health,
      maxRetries,
      recoveryClaimIdleMs,
    });

    const contextualHandler: StreamReaderHandler = (event, ack) =>
      handlerContext.run(true, () => handler(event, ack));

    mainTask = (async () => {
      await ensureConsumerGroup(client);
      cleaner?.start();

      recoveryInterval = setInterval(() => {
        const currentProcessor = processor;
        if (!running || !currentProcessor) return;
        const task = currentProcessor.recover(contextualHandler);
        recoveryTasks.add(task);
        void task.finally(() => {
          recoveryTasks.delete(task);
        }).catch(() => undefined);
      }, recoveryIntervalMs);

      await mainLoop(client, processor!, contextualHandler);
    })().catch((error) => {
      startupError = error;
    });
  };

  const stop = async (): Promise<void> => {
    running = false;
    if (recoveryInterval) {
      clearInterval(recoveryInterval);
      recoveryInterval = null;
    }
    cleaner?.stop();

    if (!shutdownTask) {
      const client = redis;
      const currentProcessor = processor;
      shutdownTask = (async () => {
        let failure: unknown = startupError;
        try {
          await mainTask;
          await Promise.all([...recoveryTasks]);
          await currentProcessor?.drain();
        } catch (error) {
          failure ??= error;
        }

        if (client) {
          try {
            await client.quit();
          } catch (error) {
            client.disconnect();
            failure ??= error;
          }
        }

        redis = null;
        processor = null;
        retryTracker = null;
        cleaner = null;
        mainTask = null;
        if (failure !== undefined) throw failure;
      })();
    }

    // Some legacy handlers call stop() from inside themselves. Waiting for the
    // current handler there would self-deadlock, so finalization continues in
    // the background; external shutdown callers always await it.
    if (handlerContext.getStore()) {
      void shutdownTask.catch(() => undefined);
      return;
    }
    await shutdownTask;
  };

  const getMetrics = async (): Promise<StreamConsumerMetrics> => {
    if (!health) {
      return {
        totalProcessed: 0,
        totalFailed: 0,
        totalRetried: 0,
        totalDlq: 0,
        processingRate: 0,
        lastProcessedAt: null,
        pendingCount: 0,
        streamLag: 0,
        oldestPendingMs: 0,
        status: "healthy",
      };
    }
    return health.getMetrics();
  };

  return { start, stop, getMetrics };
};
