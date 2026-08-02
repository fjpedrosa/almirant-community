import { describe, expect, test } from "bun:test";
import type Redis from "ioredis";
import type { DeadLetterHandler } from "../dead-letter-handler";
import type { HealthReporter } from "../health-reporter";
import type { IdempotencyGuard } from "../idempotency-guard";
import { createRetryTracker } from "../retry-tracker";
import { createStreamEntryProcessor } from "../stream-reader";

const fields = [
  "jobId", "job-transport",
  "sessionId", "session-transport",
  "workspaceId", "workspace-transport",
  "threadId", "thread-transport",
  "timestamp", "1",
  "sequenceNumber", "1",
  "sequenceProtocolVersion", "durable.v2",
  "claimAttemptId", "attempt-transport",
  "type", "message",
  "content", "persist",
];

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

type PendingEntry = {
  id: string;
  fields: string[];
  consumer: string;
  idleMs: number;
  deliveries: number;
};

const createHarness = (initial?: PendingEntry) => {
  let pending = initial;
  const acked: string[] = [];
  const processed = new Set<string>();
  const cleared: string[] = [];
  const dlq: string[] = [];

  const redis = {
    xack: async (_stream: string, _group: string, entryId: string) => {
      acked.push(entryId);
      if (pending?.id === entryId) pending = undefined;
      return 1;
    },
    xpending: async () => pending
      ? [[pending.id, pending.consumer, pending.idleMs, pending.deliveries]]
      : [],
    xclaim: async (
      _stream: string,
      _group: string,
      consumerId: string,
      minIdleMs: number,
      entryId: string,
    ) => {
      if (!pending || pending.id !== entryId || pending.idleMs < minIdleMs) {
        return [];
      }
      pending.consumer = consumerId;
      pending.idleMs = 0;
      pending.deliveries += 1;
      return [[pending.id, pending.fields]];
    },
  } as unknown as Redis;

  const idempotency: IdempotencyGuard = {
    isProcessed: async (group, entryId) => processed.has(`${group}:${entryId}`),
    markProcessed: async (group, entryId) => {
      processed.add(`${group}:${entryId}`);
    },
    clearProcessed: async (group, entryId) => {
      processed.delete(`${group}:${entryId}`);
      cleared.push(`${group}:${entryId}`);
    },
  };
  const deadLetterHandler: DeadLetterHandler = {
    moveToDlq: async (_event, _error, _retryCount, group, source) => {
      dlq.push(`${group}:${source.entryId}`);
      await redis.xack(source.sourceStream, group, source.entryId);
      return { dlqEntryId: "1-0", inserted: true, acknowledged: 1 };
    },
    trim: async () => undefined,
  };
  const health: HealthReporter = {
    recordProcessed: () => undefined,
    recordFailed: () => undefined,
    recordRetried: () => undefined,
    recordDlq: () => undefined,
    getHealthStatus: async () => "healthy",
    getMetrics: async () => ({
      totalProcessed: 0,
      totalFailed: 0,
      totalRetried: 0,
      totalDlq: 0,
      processingRate: 0,
      lastProcessedAt: null,
      pendingCount: 0,
      streamLag: 0,
      oldestPendingMs: 0,
      status: "healthy" as const,
    }),
  };

  return {
    redis,
    idempotency,
    deadLetterHandler,
    health,
    acked,
    processed,
    cleared,
    dlq,
    getPending: () => pending,
  };
};

const createProcessor = (harness: ReturnType<typeof createHarness>) =>
  createStreamEntryProcessor({
    redis: harness.redis,
    streamName: "durable-stream",
    consumerGroup: "web",
    consumerId: "consumer-new",
    retryTracker: createRetryTracker({
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
    }),
    dlqHandler: harness.deadLetterHandler,
    idempotency: harness.idempotency,
    health: harness.health,
    maxRetries: 2,
    recoveryClaimIdleMs: 1,
  });

describe("durable DB-before-ACK transport", () => {
  test("persistence pending means no XACK; success ACKs afterwards", async () => {
    const harness = createHarness();
    const processor = createProcessor(harness);
    const gate = deferred();

    const processing = processor.process("1710000000000-0", fields, async () => {
      await gate.promise;
    });
    await Promise.resolve();
    expect(harness.acked).toEqual([]);

    gate.resolve();
    await processing;
    expect(harness.acked).toEqual(["1710000000000-0"]);
    expect(harness.cleared).toEqual(["web:1710000000000-0"]);
    expect(harness.processed.size).toBe(0);
  });

  test("recovery never reclaims an entry that this process is still persisting", async () => {
    const entryId = "1710000000000-1";
    const harness = createHarness({
      id: entryId,
      fields,
      consumer: "consumer-new",
      idleMs: 10_000,
      deliveries: 1,
    });
    const processor = createProcessor(harness);
    const gate = deferred();
    let handlerCalls = 0;
    const handler = async () => {
      handlerCalls += 1;
      if (handlerCalls === 1) await gate.promise;
    };

    const processing = processor.process(entryId, fields, handler);
    await Promise.resolve();
    expect(handlerCalls).toBe(1);

    await processor.recover(handler);
    expect(handlerCalls).toBe(1);
    expect(harness.acked).toEqual([]);

    gate.resolve();
    await processing;
    expect(harness.acked).toEqual([entryId]);
  });

  test("recovery does not reclaim a later entry from the current local batch", async () => {
    const entryId = "1710000000000-2";
    const harness = createHarness({
      id: entryId,
      fields,
      consumer: "consumer-new",
      idleMs: 10_000,
      deliveries: 1,
    });
    const processor = createProcessor(harness);
    let handlerCalls = 0;
    const handler = async () => {
      handlerCalls += 1;
    };

    processor.registerReadEntries([entryId]);
    await processor.recover(handler);
    expect(handlerCalls).toBe(0);
    expect(harness.acked).toEqual([]);

    await processor.process(entryId, fields, handler);
    expect(handlerCalls).toBe(1);
    expect(harness.acked).toEqual([entryId]);
  });

  test("API 503/network failure remains pending and is not ACKed", async () => {
    const harness = createHarness({
      id: "1710000000001-0",
      fields,
      consumer: "consumer-old",
      idleMs: 0,
      deliveries: 1,
    });
    const processor = createProcessor(harness);
    const error = Object.assign(new Error("API 503"), {
      retryable: true,
      status: 503,
    });

    await processor.process("1710000000001-0", fields, async () => {
      throw error;
    });

    expect(harness.acked).toEqual([]);
    expect(harness.getPending()?.id).toBe("1710000000001-0");
    expect(processor.getPendingErrors()).toEqual([
      ["1710000000001-0", error],
    ]);
  });

  test("restart with an empty RetryTracker reclaims a Redis PEL entry", async () => {
    const harness = createHarness({
      id: "1710000000002-0",
      fields,
      consumer: "dead-consumer",
      idleMs: 10_000,
      deliveries: 1,
    });
    const restarted = createProcessor(harness);
    let calls = 0;

    await restarted.recover(async () => {
      calls += 1;
    });

    expect(calls).toBe(1);
    expect(harness.acked).toEqual(["1710000000002-0"]);
    expect(harness.getPending()).toBeUndefined();
  });

  test("restart quarantines an exhausted PEL delivery even with empty local state", async () => {
    const entryId = "1710000000002-1";
    const harness = createHarness({
      id: entryId,
      fields,
      consumer: "dead-consumer",
      idleMs: 10_000,
      deliveries: 2,
    });
    const restarted = createProcessor(harness);
    let handlerCalls = 0;

    await restarted.recover(async () => {
      handlerCalls += 1;
    });

    expect(handlerCalls).toBe(0);
    expect(harness.dlq).toEqual([`web:${entryId}`]);
    expect(harness.acked).toEqual([entryId]);
  });

  test("DB success then crash-before-XACK redelivers idempotently", async () => {
    const entryId = "1710000000003-0";
    const harness = createHarness({
      id: entryId,
      fields,
      consumer: "crashed-consumer",
      idleMs: 10_000,
      deliveries: 1,
    });
    const logicalRows = new Set<string>();
    let apiCalls = 0;
    const crashed = createProcessor(harness);

    await crashed.process(entryId, fields, async (event) => {
      apiCalls += 1;
      logicalRows.add(`${event.jobId}:${event.sequenceNumber}`);
      throw new Error("crash after durable insert");
    });
    expect(harness.acked).toEqual([]);

    const restarted = createProcessor(harness);
    await restarted.recover(async (event) => {
      apiCalls += 1;
      // The API treats the duplicate durable unique key as success.
      logicalRows.add(`${event.jobId}:${event.sequenceNumber}`);
    });

    expect(apiCalls).toBe(2);
    expect(logicalRows.size).toBe(1);
    expect(harness.acked).toEqual([entryId]);
  });

  test("shutdown state reports an in-flight persistence rejection", async () => {
    const harness = createHarness();
    const processor = createProcessor(harness);
    const gate = deferred();
    const failure = new Error("persistence failed during shutdown");
    const processing = processor.process("1710000000004-0", fields, async () => {
      await gate.promise;
    });

    const drained = processor.drain();
    let drainSettled = false;
    void drained.finally(() => {
      drainSettled = true;
    }).catch(() => undefined);
    await Promise.resolve();
    expect(drainSettled).toBe(false);

    gate.reject(failure);
    await processing;
    await expect(drained).rejects.toThrow(
      "persistence failed during shutdown",
    );
    expect(harness.acked).toEqual([]);
  });
});
