import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import Redis from "ioredis";
import { createStreamPublisher } from "../stream-publisher";
import { createStreamReader, parseEvent } from "../stream-reader";
import type { AgentOutputEvent } from "../types";

const REDIS_URL = process.env.REDIS_URL;

// Skip all tests if REDIS_URL is not set
const describeWithRedis = REDIS_URL ? describe : describe.skip;

const makeEvent = (
  overrides: Partial<AgentOutputEvent> = {}
): AgentOutputEvent => ({
  jobId: "job-1",
  sessionId: "session-1",
  workspaceId: "org-1",
  threadId: "thread-1",
  timestamp: Date.now(),
  sequenceNumber: 1,
  type: "message",
  content: "Hello, world!",
  ...overrides,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeWithRedis("StreamReader", () => {
  let redis: Redis;

  // Per-test unique names to avoid collisions
  let TEST_STREAM: string;
  let TEST_DLQ: string;
  let TEST_GROUP: string;

  // Track resources for cleanup
  let streamsToClean: string[] = [];
  let keyPatternsToClean: string[] = [];
  let groupsToClean: Array<{ stream: string; group: string }> = [];

  beforeAll(() => {
    redis = new Redis(REDIS_URL!);
  });

  afterAll(async () => {
    redis.disconnect();
  });

  // Each test gets unique stream/group names via a counter
  let testCounter = 0;
  const nextTestNames = () => {
    testCounter++;
    const suffix = `${Date.now()}-${testCounter}`;
    TEST_STREAM = `test:sr:${suffix}`;
    TEST_DLQ = `${TEST_STREAM}:dlq`;
    TEST_GROUP = `test-group-${suffix}`;
    streamsToClean.push(TEST_STREAM, TEST_DLQ);
    keyPatternsToClean.push(`agent-output:processed:${TEST_GROUP}:*`);
    groupsToClean.push({ stream: TEST_STREAM, group: TEST_GROUP });
  };

  afterEach(async () => {
    // Delete streams
    if (streamsToClean.length > 0) {
      await redis.del(...streamsToClean);
      streamsToClean = [];
    }
    // Delete idempotency keys
    for (const pattern of keyPatternsToClean) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    }
    keyPatternsToClean = [];
    // Destroy consumer groups
    for (const { stream, group } of groupsToClean) {
      try {
        await redis.xgroup("DESTROY", stream, group);
      } catch { /* ok */ }
    }
    groupsToClean = [];
  });

  test("consumer group auto-creation — XINFO GROUPS shows the group", async () => {
    nextTestNames();
    const reader = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
    });

    // Publish an event to ensure the stream exists
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });
    await publisher.publish(makeEvent());

    const received: AgentOutputEvent[] = [];
    reader.start(async (event, ack) => {
      received.push(event);
      await ack();
    });

    // Give time for the reader to create the group and start reading
    await wait(500);

    // Verify group exists
    const groups = (await redis.xinfo("GROUPS", TEST_STREAM)) as Array<
      string[]
    >;
    const groupNames = [];
    for (const group of groups) {
      // XINFO GROUPS returns flat arrays: ["name", "groupName", "consumers", ...]
      if (Array.isArray(group)) {
        for (let i = 0; i < group.length; i++) {
          if (group[i] === "name" && i + 1 < group.length) {
            groupNames.push(group[i + 1]);
          }
        }
      }
    }
    expect(groupNames).toContain(TEST_GROUP);

    await reader.stop();
    await publisher.close();
  }, 10_000);

  test("event deserialization — all fields match", async () => {
    nextTestNames();
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    const sourceEvent = makeEvent({
      type: "wave_start",
      description: "Starting wave",
      agents: [
        { agent: "researcher", taskId: "t-1", title: "Research" },
        { agent: "coder", taskId: "t-2", title: "Implement" },
      ],
      options: ["option-a", "option-b"],
      payload: { key: "value", nested: { deep: true } },
      successCount: 5,
      totalCount: 10,
      elapsedMs: 1234,
    });

    await publisher.publish(sourceEvent);

    const received: AgentOutputEvent[] = [];
    const reader = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
    });

    reader.start(async (event, ack) => {
      received.push(event);
      await ack();
    });

    await wait(1000);
    await reader.stop();
    await publisher.close();

    expect(received).toHaveLength(1);
    const event = received[0];

    expect(event.jobId).toBe(sourceEvent.jobId);
    expect(event.sessionId).toBe(sourceEvent.sessionId);
    expect(event.workspaceId).toBe(sourceEvent.workspaceId);
    expect(event.threadId).toBe(sourceEvent.threadId);
    expect(event.type).toBe("wave_start");
    expect(event.description).toBe("Starting wave");
    expect(event.timestamp).toBe(sourceEvent.timestamp);
    expect(event.sequenceNumber).toBe(sourceEvent.sequenceNumber);
    expect(event.agents).toEqual(sourceEvent.agents);
    expect(event.options).toEqual(sourceEvent.options);
    expect(event.payload).toEqual(sourceEvent.payload);
    expect(event.successCount).toBe(5);
    expect(event.totalCount).toBe(10);
    expect(event.elapsedMs).toBe(1234);
  }, 10_000);

  test("idempotency — handler called only once for duplicate processing", async () => {
    nextTestNames();
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent());

    let callCount = 0;

    // First reader — processes the event
    const reader1 = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
    });

    reader1.start(async (_event, ack) => {
      callCount++;
      await ack();
    });

    await wait(1000);
    await reader1.stop();

    expect(callCount).toBe(1);

    // Publish same event ID won't happen (Redis auto-generates IDs),
    // but we can verify that the idempotency guard is working by
    // checking the processed key exists
    const keys = await redis.keys(`agent-output:processed:${TEST_GROUP}:*`);
    expect(keys.length).toBeGreaterThan(0);

    await publisher.close();
  }, 10_000);

  test("retry on handler failure — eventually succeeds", async () => {
    nextTestNames();
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent());

    let callCount = 0;
    const reader = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
      batchSize: 10,
      retry: {
        maxRetries: 5,
        baseDelayMs: 50,
        maxDelayMs: 200,
        recoveryIntervalMs: 200,
      },
    });

    reader.start(async (_event, ack) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Transient failure");
      }
      // Succeeds on second call
      await ack();
    });

    // Wait for initial failure + recovery cycle
    await wait(3000);
    await reader.stop();
    await publisher.close();

    // Handler should have been called at least 2 times (1 fail + 1 success via recovery)
    expect(callCount).toBeGreaterThanOrEqual(2);
  }, 15_000);

  test("DLQ after max retries — event ends up in DLQ stream", async () => {
    nextTestNames();
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent({ content: "will-fail-permanently" }));

    const reader = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
      retry: {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 50,
        recoveryIntervalMs: 100,
      },
    });

    reader.start(async () => {
      throw new Error("Permanent failure");
    });

    // Wait for initial failure + enough recovery cycles to exhaust retries + DLQ
    await wait(5000);
    await reader.stop();
    await publisher.close();

    // Check DLQ has the event
    const dlqLen = await redis.xlen(TEST_DLQ);
    expect(dlqLen).toBeGreaterThanOrEqual(1);

    // Verify DLQ entry contents
    const dlqEntries = await redis.xrange(TEST_DLQ, "-", "+");
    expect(dlqEntries.length).toBeGreaterThanOrEqual(1);

    const [, fields] = dlqEntries[0];
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }

    expect(fieldMap.get("error")).toBe("Permanent failure");
    expect(fieldMap.get("consumerGroup")).toBe(TEST_GROUP);
    expect(fieldMap.has("originalEvent")).toBe(true);
    expect(fieldMap.has("failedAt")).toBe(true);

    const originalEvent = JSON.parse(fieldMap.get("originalEvent")!);
    expect(originalEvent.content).toBe("will-fail-permanently");
  }, 15_000);

  // ---------------------------------------------------------------------------
  // A-1756: Strengthened idempotency tests
  // ---------------------------------------------------------------------------

  test("redelivery after ACK — same consumer group skips handler", async () => {
    nextTestNames();

    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent({ content: "redelivery-test" }));

    let callCount = 0;

    // First reader processes the event
    const reader1 = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: TEST_DLQ,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
    });

    const firstDone = new Promise<void>((resolve) => {
      reader1.start(async (_event, ack) => {
        callCount++;
        await ack();
        await wait(50);
        resolve();
      });
      setTimeout(() => resolve(), 5_000);
    });

    await firstDone;
    await reader1.stop();
    expect(callCount).toBe(1);

    // Verify idempotency key was set
    const keys = await redis.keys(`agent-output:processed:${TEST_GROUP}:*`);
    expect(keys.length).toBe(1);

    // Second reader in same group — simulate redelivery.
    // The entry is already ACK'd, but if somehow redelivered (e.g., via
    // XCLAIM or PEL scan), idempotency guard should block reprocessing.
    // We verify by starting a new consumer that reads pending (recovery loop).
    const reader2 = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: TEST_DLQ,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-2",
      blockMs: 100,
      retry: { recoveryIntervalMs: 200 },
    });

    reader2.start(async (_event, ack) => {
      callCount++;
      await ack();
    });

    // Give the second reader time to scan for pending entries
    await wait(2000);
    await reader2.stop();
    await publisher.close();

    // Handler must still only have been called once
    expect(callCount).toBe(1);
  }, 15_000);

  test("redelivery to different consumer group processes independently", async () => {
    nextTestNames();

    const groupA = TEST_GROUP;
    const groupB = `${TEST_GROUP}-alt`;
    keyPatternsToClean.push(`agent-output:processed:${groupB}:*`);
    groupsToClean.push({ stream: TEST_STREAM, group: groupB });

    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent({ content: "cross-group-event" }));

    let callCountA = 0;
    let callCountB = 0;

    // Reader in group A
    const readerA = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: TEST_DLQ,
      consumerGroup: groupA,
      consumerId: "consumer-a",
      blockMs: 100,
    });

    const doneA = new Promise<void>((resolve) => {
      readerA.start(async (_event, ack) => {
        callCountA++;
        await ack();
        await wait(50);
        resolve();
      });
      setTimeout(() => resolve(), 5_000);
    });

    await doneA;
    await readerA.stop();

    // Reader in group B — independent group, must process the same event
    const readerB = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: `${TEST_DLQ}-b`,
      consumerGroup: groupB,
      consumerId: "consumer-b",
      blockMs: 100,
    });
    streamsToClean.push(`${TEST_DLQ}-b`);

    const doneB = new Promise<void>((resolve) => {
      readerB.start(async (_event, ack) => {
        callCountB++;
        await ack();
        await wait(50);
        resolve();
      });
      setTimeout(() => resolve(), 5_000);
    });

    await doneB;
    await readerB.stop();
    await publisher.close();

    expect(callCountA).toBe(1);
    expect(callCountB).toBe(1);

    // Each group has its own idempotency key
    const keysA = await redis.keys(`agent-output:processed:${groupA}:*`);
    const keysB = await redis.keys(`agent-output:processed:${groupB}:*`);
    expect(keysA.length).toBe(1);
    expect(keysB.length).toBe(1);

    // Keys must be different (different group prefix)
    expect(keysA[0]).not.toBe(keysB[0]);
  }, 15_000);

  test("retry after handler failure respects idempotency on eventual success", async () => {
    nextTestNames();

    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent({ content: "retry-idem-test" }));

    let callCount = 0;

    // Handler: fail once, succeed on second call
    const reader = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: TEST_DLQ,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
      retry: {
        maxRetries: 5,
        baseDelayMs: 50,
        maxDelayMs: 200,
        recoveryIntervalMs: 200,
      },
    });

    reader.start(async (_event, ack) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Transient failure");
      }
      await ack();
    });

    // Wait for the retry cycle to succeed
    await wait(3000);
    await reader.stop();

    // Handler called at least twice (1 fail + 1 success)
    expect(callCount).toBeGreaterThanOrEqual(2);

    // Idempotency key must be set after success
    const keys = await redis.keys(`agent-output:processed:${TEST_GROUP}:*`);
    expect(keys.length).toBe(1);

    // Now start another reader in the same group — the event must NOT be
    // re-processed because idempotency guard blocks it.
    const previousCallCount = callCount;

    const reader2 = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: TEST_DLQ,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-2",
      blockMs: 100,
      retry: { recoveryIntervalMs: 200 },
    });

    reader2.start(async (_event, ack) => {
      callCount++;
      await ack();
    });

    await wait(2000);
    await reader2.stop();
    await publisher.close();

    // No additional handler calls
    expect(callCount).toBe(previousCallCount);
  }, 15_000);

  test("DLQ entry preserves original event and does not set idempotency key", async () => {
    nextTestNames();

    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent({ content: "dlq-preserve-test" }));

    const reader = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: TEST_DLQ,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
      retry: {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 50,
        recoveryIntervalMs: 100,
      },
    });

    reader.start(async () => {
      throw new Error("Always fails");
    });

    await wait(5000);
    await reader.stop();
    await publisher.close();

    // DLQ must have the event with original data
    const dlqEntries = await redis.xrange(TEST_DLQ, "-", "+");
    expect(dlqEntries.length).toBeGreaterThanOrEqual(1);

    const [, fields] = dlqEntries[0];
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }

    expect(fieldMap.get("consumerGroup")).toBe(TEST_GROUP);
    expect(fieldMap.get("error")).toBe("Max retries exhausted");
    const originalEvent = JSON.parse(fieldMap.get("originalEvent")!);
    expect(originalEvent.content).toBe("dlq-preserve-test");

    // Idempotency key must NOT be set — handler never succeeded
    const keys = await redis.keys(`agent-output:processed:${TEST_GROUP}:*`);
    expect(keys.length).toBe(0);
  }, 15_000);

  test("metrics remain consistent with actual processing", async () => {
    nextTestNames();

    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    // Publish 4 events: 2 will succeed, 1 will fail-then-succeed, 1 will DLQ
    await publisher.publish(makeEvent({ content: "success-1" }));
    await publisher.publish(makeEvent({ content: "success-2", sequenceNumber: 2 }));
    await publisher.publish(makeEvent({ content: "retry-then-ok", sequenceNumber: 3 }));
    await publisher.publish(makeEvent({ content: "permanent-fail", sequenceNumber: 4 }));

    let retryableCallCount = 0;

    const reader = createStreamReader({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      dlqStreamName: TEST_DLQ,
      consumerGroup: TEST_GROUP,
      consumerId: "consumer-1",
      blockMs: 100,
      retry: {
        maxRetries: 2,
        baseDelayMs: 50,
        maxDelayMs: 100,
        recoveryIntervalMs: 200,
      },
    });

    reader.start(async (event, ack) => {
      if (event.content === "permanent-fail") {
        throw new Error("Always fails");
      }
      if (event.content === "retry-then-ok") {
        retryableCallCount++;
        if (retryableCallCount === 1) {
          throw new Error("Transient");
        }
      }
      await ack();
    });

    // Wait enough for: initial processing + retries + DLQ
    await wait(8000);

    const metrics = await reader.getMetrics();
    await reader.stop();
    await publisher.close();

    // 3 events processed successfully (success-1, success-2, retry-then-ok after retry)
    expect(metrics.totalProcessed).toBeGreaterThanOrEqual(3);

    // DLQ'd events (permanent-fail)
    expect(metrics.totalDlq).toBeGreaterThanOrEqual(1);

    // Retried count: recovery loop retried at least 1 event (retry-then-ok)
    // plus the permanent-fail had retries before DLQ
    expect(metrics.totalRetried).toBeGreaterThanOrEqual(1);

    // totalFailed counts every handler failure (including retries that
    // eventually succeed or DLQ). Must be >= number of thrown errors:
    // permanent-fail threw at least 3 times (initial + 2 retries),
    // retry-then-ok threw 1 time.
    expect(metrics.totalFailed).toBeGreaterThanOrEqual(2);
  }, 20_000);
});

describe("parseEvent", () => {
  test("parses string fields correctly", () => {
    const fields = [
      "jobId",
      "job-1",
      "sessionId",
      "session-1",
      "workspaceId",
      "org-1",
      "threadId",
      "thread-1",
      "type",
      "message",
      "content",
      "Hello",
    ];

    const event = parseEvent(fields);

    expect(event.jobId).toBe("job-1");
    expect(event.sessionId).toBe("session-1");
    expect(event.workspaceId).toBe("org-1");
    expect(event.threadId).toBe("thread-1");
    expect(event.type).toBe("message");
    expect(event.content).toBe("Hello");
  });

  test("parses numeric fields as numbers", () => {
    const fields = [
      "jobId",
      "job-1",
      "sessionId",
      "session-1",
      "workspaceId",
      "org-1",
      "threadId",
      "thread-1",
      "type",
      "message",
      "timestamp",
      "1700000000000",
      "sequenceNumber",
      "42",
      "successCount",
      "5",
      "totalCount",
      "10",
      "elapsedMs",
      "1234",
    ];

    const event = parseEvent(fields);

    expect(event.timestamp).toBe(1700000000000);
    expect(event.sequenceNumber).toBe(42);
    expect(event.successCount).toBe(5);
    expect(event.totalCount).toBe(10);
    expect(event.elapsedMs).toBe(1234);
  });

  test("parses JSON fields as objects/arrays", () => {
    const agents = [
      { agent: "researcher", taskId: "t-1", title: "Research" },
    ];
    const options = ["a", "b", "c"];
    const payload = { key: "value", nested: { deep: true } };

    const fields = [
      "jobId",
      "job-1",
      "sessionId",
      "session-1",
      "workspaceId",
      "org-1",
      "threadId",
      "thread-1",
      "type",
      "wave_start",
      "timestamp",
      "1700000000000",
      "sequenceNumber",
      "1",
      "agents",
      JSON.stringify(agents),
      "options",
      JSON.stringify(options),
      "payload",
      JSON.stringify(payload),
    ];

    const event = parseEvent(fields);

    expect(event.agents).toEqual(agents);
    expect(event.options).toEqual(options);
    expect(event.payload).toEqual(payload);
  });
});
