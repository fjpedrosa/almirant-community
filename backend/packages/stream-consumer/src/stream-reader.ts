import Redis from "ioredis";
import type {
  AgentOutputEvent,
  StreamReaderConfig,
  RetryConfig,
  StreamConsumerMetrics,
} from "./types";
import { DEFAULT_STREAM_NAME } from "./types";
import { createRetryTracker } from "./retry-tracker";
import { createDeadLetterHandler } from "./dead-letter-handler";
import { createIdempotencyGuard } from "./idempotency-guard";
import { createStreamCleaner } from "./stream-cleaner";
import { createHealthReporter } from "./health-reporter";

// ---------------------------------------------------------------------------
// StreamReader — main consumer that reads from a Redis Stream with
// retry, DLQ, idempotency, and health reporting
// ---------------------------------------------------------------------------

export type StreamReaderHandler = (
  event: AgentOutputEvent,
  ack: () => Promise<void>
) => Promise<void>;

export type StreamReader = {
  start: (handler: StreamReaderHandler) => void;
  stop: () => Promise<void>;
  getMetrics: () => Promise<StreamConsumerMetrics>;
};

// Fields that are JSON-serialized objects/arrays
const JSON_FIELDS = new Set(["options", "agents", "payload"]);

// Fields that are numeric
const NUMERIC_FIELDS = new Set([
  "timestamp",
  "sequenceNumber",
  "successCount",
  "totalCount",
  "elapsedMs",
]);

/**
 * Deserialize a flat Redis hash (string key-value pairs) back into a typed
 * AgentOutputEvent. Inverse of `flattenEvent` in stream-publisher.ts.
 */
export const parseEvent = (
  fields: string[]
): AgentOutputEvent => {
  const obj: Record<string, unknown> = {};

  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === undefined || value === undefined) {
      continue;
    }

    if (JSON_FIELDS.has(key)) {
      try {
        obj[key] = JSON.parse(value);
      } catch {
        obj[key] = value;
      }
    } else if (NUMERIC_FIELDS.has(key)) {
      const num = Number(value);
      obj[key] = isNaN(num) ? value : num;
    } else {
      obj[key] = value;
    }
  }

  return obj as AgentOutputEvent;
};

const DEFAULT_BLOCK_MS = 5_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_RECOVERY_INTERVAL_MS = 1_000;

export const createStreamReader = (
  config: StreamReaderConfig & { retry?: RetryConfig }
): StreamReader => {
  const streamName = config.streamName ?? DEFAULT_STREAM_NAME;
  const consumerGroup = config.consumerGroup;
  const consumerId = config.consumerId;
  const blockMs = config.blockMs ?? DEFAULT_BLOCK_MS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const recoveryIntervalMs =
    config.retry?.recoveryIntervalMs ?? DEFAULT_RECOVERY_INTERVAL_MS;

  let running = false;
  let redis: Redis;
  let recoveryInterval: ReturnType<typeof setInterval> | null = null;

  // Sub-components (initialized in start())
  let retryTracker: ReturnType<typeof createRetryTracker>;
  let dlqHandler: ReturnType<typeof createDeadLetterHandler>;
  let idempotency: ReturnType<typeof createIdempotencyGuard>;
  let cleaner: ReturnType<typeof createStreamCleaner>;
  let health: ReturnType<typeof createHealthReporter>;

  const ensureConsumerGroup = async (): Promise<void> => {
    try {
      await redis.xgroup("CREATE", streamName, consumerGroup, "0", "MKSTREAM");
    } catch (err: unknown) {
      // Ignore BUSYGROUP — group already exists
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("BUSYGROUP")) {
        throw err;
      }
    }
  };

  const processEntry = async (
    entryId: string,
    fields: string[],
    handler: StreamReaderHandler
  ): Promise<void> => {
    const event = parseEvent(fields);

    // Idempotency check
    const alreadyProcessed = await idempotency.isProcessed(
      consumerGroup,
      entryId
    );
    if (alreadyProcessed) {
      // Already processed — just acknowledge and skip
      await redis.xack(streamName, consumerGroup, entryId);
      return;
    }

    try {
      // The ack callback for the handler
      const ack = async (): Promise<void> => {
        await redis.xack(streamName, consumerGroup, entryId);
      };

      await handler(event, ack);

      // Handler succeeded — mark processed, ack, record metric
      await idempotency.markProcessed(consumerGroup, entryId);
      await redis.xack(streamName, consumerGroup, entryId);
      health.recordProcessed();
      retryTracker.remove(entryId);
    } catch {
      // Handler failed — record failure for retry, do NOT ack
      retryTracker.recordFailure(entryId);
      health.recordFailed();
    }
  };

  const mainLoop = async (handler: StreamReaderHandler): Promise<void> => {
    while (running) {
      try {
        // XREADGROUP GROUP consumerGroup consumerId COUNT batchSize BLOCK blockMs STREAMS streamName >
        const results = await redis.xreadgroup(
          "GROUP",
          consumerGroup,
          consumerId,
          "COUNT",
          batchSize,
          "BLOCK",
          blockMs,
          "STREAMS",
          streamName,
          ">"
        );

        if (!results) continue;

        // results: [[streamName, [[entryId, [field, value, ...]], ...]]]
        for (const streamResult of results) {
          const entries = (streamResult as [string, [string, string[]][]])[1];
          for (const entry of entries) {
            const [entryId, fields] = entry;
            await processEntry(entryId, fields, handler);
          }
        }
      } catch (err: unknown) {
        // If we're shutting down, break cleanly
        if (!running) break;

        // Log and continue on transient errors
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes("Connection is closed") ||
          message.includes("Stream isn't readable")
        ) {
          break;
        }
        // Brief pause before retrying the read loop
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  const recoveryLoop = async (handler: StreamReaderHandler): Promise<void> => {
    try {
      // Get pending entries
      const pendingEntries = await redis.xpending(
        streamName,
        consumerGroup,
        "-",
        "+",
        100
      );

      if (!Array.isArray(pendingEntries) || pendingEntries.length === 0) return;

      const now = Date.now();
      const retryableIds = new Set(retryTracker.getRetryableEventIds(now));

      for (const entry of pendingEntries) {
        // Each entry: [entryId, consumer, idleTime, deliveryCount]
        if (!Array.isArray(entry)) continue;
        const entryId = String(entry[0]);

        const isRetryable = retryableIds.has(entryId);
        const isExhausted =
          !isRetryable && !retryTracker.shouldRetry(entryId);

        // Skip entries that are tracked but not yet due for retry
        if (!isRetryable && !isExhausted) continue;

        try {
          // Claim the entry
          const claimed = await redis.xclaim(
            streamName,
            consumerGroup,
            consumerId,
            0,
            entryId
          );

          if (!claimed || claimed.length === 0) continue;

          // claimed: [[entryId, [field, value, ...]]]
          const [claimedId, fields] = claimed[0] as [string, string[]];
          if (!fields) continue;

          const event = parseEvent(fields);

          // Exhausted retries — move directly to DLQ without retrying handler
          if (isExhausted) {
            await dlqHandler.moveToDlq(
              event,
              "Max retries exhausted",
              retryTracker.getRetryCount(claimedId),
              consumerGroup
            );
            await redis.xack(streamName, consumerGroup, claimedId);
            retryTracker.remove(claimedId);
            health.recordDlq();
            continue;
          }

          // Idempotency check before retrying — guards against race
          // between the main loop processing the entry and the recovery
          // loop claiming it simultaneously.
          const alreadyDone = await idempotency.isProcessed(
            consumerGroup,
            claimedId
          );
          if (alreadyDone) {
            await redis.xack(streamName, consumerGroup, claimedId);
            retryTracker.remove(claimedId);
            continue;
          }

          health.recordRetried();

          try {
            const ack = async (): Promise<void> => {
              await redis.xack(streamName, consumerGroup, claimedId);
            };
            await handler(event, ack);

            // Success after retry
            await redis.xack(streamName, consumerGroup, claimedId);
            await idempotency.markProcessed(consumerGroup, claimedId);
            retryTracker.remove(claimedId);
            health.recordProcessed();
          } catch (handlerErr: unknown) {
            // Retry failed — record and let next recovery loop handle it
            retryTracker.recordFailure(claimedId);
            health.recordFailed();
          }
        } catch {
          // XCLAIM or processing error — skip this entry for now
        }
      }
    } catch {
      // Transient error in recovery loop — will retry next interval
    }
  };

  const start = (handler: StreamReaderHandler): void => {
    if (running) return;
    running = true;

    redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

    retryTracker = createRetryTracker(config.retry);
    dlqHandler = createDeadLetterHandler(redis, config.dlqStreamName);
    idempotency = createIdempotencyGuard(redis);
    cleaner = createStreamCleaner(redis, { streamName });
    health = createHealthReporter(redis, streamName, consumerGroup);

    // Start async operations without awaiting in start()
    (async () => {
      await ensureConsumerGroup();
      cleaner.start();

      // Start recovery loop
      recoveryInterval = setInterval(() => {
        recoveryLoop(handler).catch(() => {
          /* swallow errors */
        });
      }, recoveryIntervalMs);

      // Run main loop (blocks until stop)
      await mainLoop(handler);
    })().catch(() => {
      /* swallow top-level errors */
    });
  };

  const stop = async (): Promise<void> => {
    running = false;

    // Clear recovery interval
    if (recoveryInterval) {
      clearInterval(recoveryInterval);
      recoveryInterval = null;
    }

    // Stop cleaner
    if (cleaner) {
      cleaner.stop();
    }

    // Wait for current XREADGROUP to return (next BLOCK timeout)
    // then close Redis
    if (redis) {
      try {
        await redis.quit();
      } catch {
        // Force disconnect if quit fails
        redis.disconnect();
      }
    }
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
