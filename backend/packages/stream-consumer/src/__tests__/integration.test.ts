import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import Redis from "ioredis";
import {
  createStreamPublisher,
  createStreamReader,
  type AgentOutputEvent,
} from "../index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;

const makeEvent = (
  overrides?: Partial<AgentOutputEvent>
): AgentOutputEvent => ({
  jobId: "test-job",
  sessionId: "test-session",
  organizationId: "test-org",
  threadId: "test-thread",
  timestamp: Date.now(),
  sequenceNumber: 1,
  type: "message",
  content: "test content",
  ...overrides,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Skip the entire suite when no Redis is available
const describeWithRedis = REDIS_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Integration test suite
// ---------------------------------------------------------------------------

describeWithRedis("Integration — End-to-End Streaming Fan-out", () => {
  let redis: Redis;

  // Collect all stream/key names created by tests so afterEach can clean them
  let streamsToClean: string[] = [];
  let keysToClean: string[] = [];
  let groupsToClean: Array<{ stream: string; group: string }> = [];

  beforeAll(() => {
    redis = new Redis(REDIS_URL!);
  });

  afterAll(async () => {
    redis.disconnect();
  });

  afterEach(async () => {
    // Delete streams
    if (streamsToClean.length > 0) {
      await redis.del(...streamsToClean);
      streamsToClean = [];
    }
    // Delete idempotency keys
    for (const pattern of keysToClean) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    keysToClean = [];
    // Destroy consumer groups (ignore errors — stream may already be deleted)
    for (const { stream, group } of groupsToClean) {
      try {
        await redis.xgroup("DESTROY", stream, group);
      } catch {
        // ok
      }
    }
    groupsToClean = [];
  });

  // -------------------------------------------------------------------------
  // 1. Fan-out to multiple consumer groups
  // -------------------------------------------------------------------------

  test(
    "fan-out — both consumer groups receive all 5 events",
    async () => {
      const streamName = `test:integration:fanout:${Date.now()}`;
      const dlqA = `${streamName}:dlq-a`;
      const dlqB = `${streamName}:dlq-b`;
      const groupA = "test-bridge-a";
      const groupB = "test-bridge-b";

      streamsToClean.push(streamName, dlqA, dlqB);
      keysToClean.push(
        `agent-output:processed:${groupA}:*`,
        `agent-output:processed:${groupB}:*`
      );
      groupsToClean.push(
        { stream: streamName, group: groupA },
        { stream: streamName, group: groupB }
      );

      // Publish 5 events
      const publisher = createStreamPublisher({
        redisUrl: REDIS_URL!,
        streamName,
      });

      for (let i = 0; i < 5; i++) {
        await publisher.publish(
          makeEvent({ sequenceNumber: i + 1, content: `event-${i + 1}` })
        );
      }

      // Set up two readers
      let countA = 0;
      let countB = 0;
      const receivedA: AgentOutputEvent[] = [];
      const receivedB: AgentOutputEvent[] = [];

      const doneA = new Promise<void>((resolve) => {
        const readerA = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqA,
          consumerGroup: groupA,
          consumerId: "consumer-a-1",
          blockMs: 100,
        });

        readerA.start(async (event, ack) => {
          receivedA.push(event);
          countA++;
          await ack();
          if (countA === 5) {
            // Small delay to let ack propagate before resolving
            await wait(50);
            resolve();
            await readerA.stop();
          }
        });

        // Safety: stop after timeout
        setTimeout(async () => {
          await readerA.stop();
          resolve(); // resolve even if we timed out
        }, 15_000);
      });

      const doneB = new Promise<void>((resolve) => {
        const readerB = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqB,
          consumerGroup: groupB,
          consumerId: "consumer-b-1",
          blockMs: 100,
        });

        readerB.start(async (event, ack) => {
          receivedB.push(event);
          countB++;
          await ack();
          if (countB === 5) {
            await wait(50);
            resolve();
            await readerB.stop();
          }
        });

        setTimeout(async () => {
          await readerB.stop();
          resolve();
        }, 15_000);
      });

      await Promise.all([doneA, doneB]);

      // Both groups received all 5 events
      expect(receivedA).toHaveLength(5);
      expect(receivedB).toHaveLength(5);

      // Verify content (order may vary due to async, so just check contents)
      const contentsA = receivedA.map((e) => e.content).sort();
      const contentsB = receivedB.map((e) => e.content).sort();
      expect(contentsA).toEqual([
        "event-1",
        "event-2",
        "event-3",
        "event-4",
        "event-5",
      ]);
      expect(contentsB).toEqual([
        "event-1",
        "event-2",
        "event-3",
        "event-4",
        "event-5",
      ]);

      await publisher.close();
    },
    30_000
  );

  // -------------------------------------------------------------------------
  // 2. XACK cleanup — zero pending after both groups process all events
  // -------------------------------------------------------------------------

  test(
    "XACK cleanup — XPENDING shows 0 pending after processing",
    async () => {
      const streamName = `test:integration:xack:${Date.now()}`;
      const dlqA = `${streamName}:dlq-a`;
      const dlqB = `${streamName}:dlq-b`;
      const groupA = "test-ack-group-a";
      const groupB = "test-ack-group-b";

      streamsToClean.push(streamName, dlqA, dlqB);
      keysToClean.push(
        `agent-output:processed:${groupA}:*`,
        `agent-output:processed:${groupB}:*`
      );
      groupsToClean.push(
        { stream: streamName, group: groupA },
        { stream: streamName, group: groupB }
      );

      const publisher = createStreamPublisher({
        redisUrl: REDIS_URL!,
        streamName,
      });

      // Publish 3 events
      for (let i = 0; i < 3; i++) {
        await publisher.publish(makeEvent({ sequenceNumber: i + 1 }));
      }

      // Process all with group A
      let countA = 0;
      const doneA = new Promise<void>((resolve) => {
        const readerA = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqA,
          consumerGroup: groupA,
          consumerId: "consumer-ack-a",
          blockMs: 100,
        });

        readerA.start(async (_event, ack) => {
          await ack();
          countA++;
          if (countA === 3) {
            await wait(50);
            resolve();
            await readerA.stop();
          }
        });

        setTimeout(async () => {
          await readerA.stop();
          resolve();
        }, 10_000);
      });

      // Process all with group B
      let countB = 0;
      const doneB = new Promise<void>((resolve) => {
        const readerB = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqB,
          consumerGroup: groupB,
          consumerId: "consumer-ack-b",
          blockMs: 100,
        });

        readerB.start(async (_event, ack) => {
          await ack();
          countB++;
          if (countB === 3) {
            await wait(50);
            resolve();
            await readerB.stop();
          }
        });

        setTimeout(async () => {
          await readerB.stop();
          resolve();
        }, 10_000);
      });

      await Promise.all([doneA, doneB]);

      // Give Redis a moment to finalize ack processing
      await wait(200);

      // XPENDING returns [totalPending, smallestId, largestId, [[consumer, count]]]
      const pendingA = (await redis.xpending(streamName, groupA)) as [
        number,
        ...unknown[],
      ];
      const pendingB = (await redis.xpending(streamName, groupB)) as [
        number,
        ...unknown[],
      ];

      expect(pendingA[0]).toBe(0);
      expect(pendingB[0]).toBe(0);

      await publisher.close();
    },
    30_000
  );

  // -------------------------------------------------------------------------
  // 3. Idempotency — handler called only once per event per consumer group
  // -------------------------------------------------------------------------

  test(
    "idempotency — handler is called only once even if event is re-delivered",
    async () => {
      const streamName = `test:integration:idempotency:${Date.now()}`;
      const dlqName = `${streamName}:dlq`;
      const group = "test-idempotency-group";

      streamsToClean.push(streamName, dlqName);
      keysToClean.push(`agent-output:processed:${group}:*`);
      groupsToClean.push({ stream: streamName, group });

      const publisher = createStreamPublisher({
        redisUrl: REDIS_URL!,
        streamName,
      });

      // Publish one event
      await publisher.publish(makeEvent({ content: "unique-event" }));

      // First reader — processes the event successfully
      let handlerCallCount = 0;
      const firstDone = new Promise<void>((resolve) => {
        const reader1 = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqName,
          consumerGroup: group,
          consumerId: "consumer-idem-1",
          blockMs: 100,
        });

        reader1.start(async (_event, ack) => {
          handlerCallCount++;
          await ack();
          await wait(50);
          resolve();
          await reader1.stop();
        });

        setTimeout(async () => {
          await reader1.stop();
          resolve();
        }, 10_000);
      });

      await firstDone;
      expect(handlerCallCount).toBe(1);

      // Second reader with the SAME consumer group — should NOT re-process
      // because the idempotency guard has already marked the entry as processed.
      // We read from "0" (beginning) by starting a new consumer that picks up
      // any pending entries. The idempotency check will skip them.
      const secondDone = new Promise<void>((resolve) => {
        const reader2 = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqName,
          consumerGroup: group,
          consumerId: "consumer-idem-2",
          blockMs: 100,
          retry: {
            recoveryIntervalMs: 200,
          },
        });

        reader2.start(async (_event, ack) => {
          handlerCallCount++;
          await ack();
        });

        // Give it time to attempt reading pending/new entries
        setTimeout(async () => {
          await reader2.stop();
          resolve();
        }, 2000);
      });

      await secondDone;

      // Handler should still have been called only once
      expect(handlerCallCount).toBe(1);

      await publisher.close();
    },
    30_000
  );

  // -------------------------------------------------------------------------
  // 4. DLQ after max retries — event moved to DLQ stream
  // -------------------------------------------------------------------------

  test(
    "DLQ after max retries — permanently failing event ends up in DLQ",
    async () => {
      const streamName = `test:integration:dlq:${Date.now()}`;
      const dlqName = `${streamName}:dlq`;
      const group = "test-dlq-group";

      streamsToClean.push(streamName, dlqName);
      keysToClean.push(`agent-output:processed:${group}:*`);
      groupsToClean.push({ stream: streamName, group });

      const publisher = createStreamPublisher({
        redisUrl: REDIS_URL!,
        streamName,
      });

      await publisher.publish(
        makeEvent({ content: "permanent-failure-event" })
      );

      const reader = createStreamReader({
        redisUrl: REDIS_URL!,
        streamName,
        dlqStreamName: dlqName,
        consumerGroup: group,
        consumerId: "consumer-dlq-1",
        blockMs: 100,
        retry: {
          maxRetries: 2,
          baseDelayMs: 50,
          maxDelayMs: 100,
          recoveryIntervalMs: 200,
        },
      });

      reader.start(async () => {
        throw new Error("Permanent failure");
      });

      // Wait for: initial fail + 2 retries + DLQ move
      // With baseDelayMs=50 and recoveryIntervalMs=200, this should be well within 8s
      await wait(8000);
      await reader.stop();
      await publisher.close();

      // Verify the DLQ stream has the event
      const dlqLen = await redis.xlen(dlqName);
      expect(dlqLen).toBeGreaterThanOrEqual(1);

      // Read DLQ entries and verify contents
      const dlqEntries = await redis.xrange(dlqName, "-", "+");
      expect(dlqEntries.length).toBeGreaterThanOrEqual(1);

      const [, fields] = dlqEntries[0];
      const fieldMap = new Map<string, string>();
      for (let i = 0; i < fields.length; i += 2) {
        fieldMap.set(fields[i], fields[i + 1]);
      }

      expect(fieldMap.get("error")).toBe("Max retries exhausted");
      expect(fieldMap.get("consumerGroup")).toBe(group);
      expect(fieldMap.has("originalEvent")).toBe(true);
      expect(fieldMap.has("failedAt")).toBe(true);

      const originalEvent = JSON.parse(fieldMap.get("originalEvent")!);
      expect(originalEvent.content).toBe("permanent-failure-event");
    },
    30_000
  );

  // -------------------------------------------------------------------------
  // 5. Event serialization round-trip — all fields survive publish + read
  // -------------------------------------------------------------------------

  test(
    "event serialization round-trip — all fields match after publish and read",
    async () => {
      const streamName = `test:integration:roundtrip:${Date.now()}`;
      const dlqName = `${streamName}:dlq`;
      const group = "test-roundtrip-group";

      streamsToClean.push(streamName, dlqName);
      keysToClean.push(`agent-output:processed:${group}:*`);
      groupsToClean.push({ stream: streamName, group });

      const fullEvent: AgentOutputEvent = {
        // Identity
        jobId: "rt-job-123",
        sessionId: "rt-session-456",
        organizationId: "rt-org-789",
        threadId: "rt-thread-abc",
        timestamp: 1700000000000,
        sequenceNumber: 42,

        // Content
        type: "wave_start",
        content: "Starting analysis wave",
        contentType: "text",

        // Type-specific payloads
        description: "Detailed description of the step",
        summary: "Brief summary",
        reason: "User requested analysis",
        text: "Additional text field",
        options: ["option-alpha", "option-beta", "option-gamma"],
        agents: [
          { agent: "researcher", taskId: "task-r1", title: "Deep Research" },
          { agent: "coder", taskId: "task-c1", title: "Implementation" },
          { agent: "reviewer", taskId: "task-v1", title: "Code Review" },
        ],
        agent: "orchestrator",
        taskId: "task-main",
        status: "SUCCESS",
        successCount: 7,
        totalCount: 10,
        elapsedMs: 5432,
        payload: {
          customKey: "customValue",
          nested: { deep: true, count: 3 },
          array: [1, 2, 3],
        },

        // Discord-specific fields
        name: "renamed-thread",
        messageId: "msg-12345",
        emoji: "thumbsup",
      };

      const publisher = createStreamPublisher({
        redisUrl: REDIS_URL!,
        streamName,
      });

      await publisher.publish(fullEvent);

      const received: AgentOutputEvent[] = [];
      const done = new Promise<void>((resolve) => {
        const reader = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqName,
          consumerGroup: group,
          consumerId: "consumer-roundtrip-1",
          blockMs: 100,
        });

        reader.start(async (event, ack) => {
          received.push(event);
          await ack();
          await wait(50);
          resolve();
          await reader.stop();
        });

        setTimeout(async () => {
          await reader.stop();
          resolve();
        }, 10_000);
      });

      await done;
      await publisher.close();

      expect(received).toHaveLength(1);
      const event = received[0];

      // Identity fields
      expect(event.jobId).toBe(fullEvent.jobId);
      expect(event.sessionId).toBe(fullEvent.sessionId);
      expect(event.organizationId).toBe(fullEvent.organizationId);
      expect(event.threadId).toBe(fullEvent.threadId);
      expect(event.timestamp).toBe(fullEvent.timestamp);
      expect(event.sequenceNumber).toBe(fullEvent.sequenceNumber);

      // Content fields
      expect(event.type).toBe(fullEvent.type);
      expect(event.content).toBe(fullEvent.content);
      expect(event.contentType).toBe(fullEvent.contentType);

      // Type-specific payloads
      expect(event.description).toBe(fullEvent.description);
      expect(event.summary).toBe(fullEvent.summary);
      expect(event.reason).toBe(fullEvent.reason);
      expect(event.text).toBe(fullEvent.text);
      expect(event.options).toEqual(fullEvent.options);
      expect(event.agents).toEqual(fullEvent.agents);
      expect(event.agent).toBe(fullEvent.agent);
      expect(event.taskId).toBe(fullEvent.taskId);
      expect(event.status).toBe(fullEvent.status);
      expect(event.successCount).toBe(fullEvent.successCount);
      expect(event.totalCount).toBe(fullEvent.totalCount);
      expect(event.elapsedMs).toBe(fullEvent.elapsedMs);
      expect(event.payload).toEqual(fullEvent.payload);

      // Discord-specific fields
      expect(event.name).toBe(fullEvent.name);
      expect(event.messageId).toBe(fullEvent.messageId);
      expect(event.emoji).toBe(fullEvent.emoji);
    },
    30_000
  );

  // -------------------------------------------------------------------------
  // A-1756: Strengthened idempotency integration tests
  // -------------------------------------------------------------------------

  // 6. Concurrent readers in the same consumer group — no double processing
  test(
    "concurrent readers in same group don't double-process",
    async () => {
      const streamName = `test:integration:concurrent:${Date.now()}`;
      const dlqName = `${streamName}:dlq`;
      const group = "test-concurrent-group";

      streamsToClean.push(streamName, dlqName);
      keysToClean.push(`agent-output:processed:${group}:*`);
      groupsToClean.push({ stream: streamName, group });

      const publisher = createStreamPublisher({
        redisUrl: REDIS_URL!,
        streamName,
      });

      // Publish 5 events
      for (let i = 0; i < 5; i++) {
        await publisher.publish(
          makeEvent({ sequenceNumber: i + 1, content: `concurrent-${i + 1}` })
        );
      }

      // Track which events each reader processes
      const processedEvents: string[] = [];
      let totalHandlerCalls = 0;

      const createConcurrentReader = (consumerId: string) => {
        const reader = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqName,
          consumerGroup: group,
          consumerId,
          blockMs: 100,
          batchSize: 1, // Small batch to increase interleaving
        });
        return reader;
      };

      const reader1 = createConcurrentReader("concurrent-c1");
      const reader2 = createConcurrentReader("concurrent-c2");

      const done = new Promise<void>((resolve) => {
        const handler = async (event: AgentOutputEvent, ack: () => Promise<void>) => {
          totalHandlerCalls++;
          if (event.content) {
            processedEvents.push(event.content);
          }
          await ack();
          // Once we have all 5 unique events, resolve
          const unique = new Set(processedEvents);
          if (unique.size === 5) {
            await wait(200); // Let any in-flight duplicate checks settle
            resolve();
          }
        };

        reader1.start(handler);
        reader2.start(handler);

        // Safety timeout
        setTimeout(() => resolve(), 15_000);
      });

      await done;
      await reader1.stop();
      await reader2.stop();
      await publisher.close();

      // Each event processed exactly once — total handler calls = 5
      const uniqueProcessed = new Set(processedEvents);
      expect(uniqueProcessed.size).toBe(5);

      // Handler should be called exactly 5 times. Due to the XREADGROUP ">"
      // delivery semantics, Redis only delivers each entry to ONE consumer
      // within the same group.
      expect(totalHandlerCalls).toBe(5);
    },
    30_000
  );

  // 7. Consumer group isolation under high throughput
  test(
    "consumer group isolation under high throughput",
    async () => {
      const streamName = `test:integration:isolation:${Date.now()}`;
      const dlqA = `${streamName}:dlq-a`;
      const dlqB = `${streamName}:dlq-b`;
      const groupA = "test-isolation-a";
      const groupB = "test-isolation-b";

      streamsToClean.push(streamName, dlqA, dlqB);
      keysToClean.push(
        `agent-output:processed:${groupA}:*`,
        `agent-output:processed:${groupB}:*`
      );
      groupsToClean.push(
        { stream: streamName, group: groupA },
        { stream: streamName, group: groupB }
      );

      const publisher = createStreamPublisher({
        redisUrl: REDIS_URL!,
        streamName,
      });

      // Publish 10 events rapidly
      const publishPromises: Promise<string>[] = [];
      for (let i = 0; i < 10; i++) {
        publishPromises.push(
          publisher.publish(
            makeEvent({ sequenceNumber: i + 1, content: `rapid-${i + 1}` })
          )
        );
      }
      await Promise.all(publishPromises);

      const receivedA: string[] = [];
      const receivedB: string[] = [];

      const doneA = new Promise<void>((resolve) => {
        const readerA = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqA,
          consumerGroup: groupA,
          consumerId: "isolation-a-1",
          blockMs: 100,
          batchSize: 5,
        });

        readerA.start(async (event, ack) => {
          if (event.content) receivedA.push(event.content);
          await ack();
          if (receivedA.length === 10) {
            await wait(50);
            resolve();
            await readerA.stop();
          }
        });

        setTimeout(async () => {
          await readerA.stop();
          resolve();
        }, 15_000);
      });

      const doneB = new Promise<void>((resolve) => {
        const readerB = createStreamReader({
          redisUrl: REDIS_URL!,
          streamName,
          dlqStreamName: dlqB,
          consumerGroup: groupB,
          consumerId: "isolation-b-1",
          blockMs: 100,
          batchSize: 5,
        });

        readerB.start(async (event, ack) => {
          if (event.content) receivedB.push(event.content);
          await ack();
          if (receivedB.length === 10) {
            await wait(50);
            resolve();
            await readerB.stop();
          }
        });

        setTimeout(async () => {
          await readerB.stop();
          resolve();
        }, 15_000);
      });

      await Promise.all([doneA, doneB]);
      await publisher.close();

      // Both groups received all 10 events independently
      expect(receivedA).toHaveLength(10);
      expect(receivedB).toHaveLength(10);

      // Verify all contents present in each group
      const contentsA = receivedA.sort();
      const contentsB = receivedB.sort();
      const expected = Array.from({ length: 10 }, (_, i) => `rapid-${i + 1}`).sort();
      expect(contentsA).toEqual(expected);
      expect(contentsB).toEqual(expected);

      // Verify idempotency keys are scoped per group (no cross-contamination)
      const keysA = await redis.keys(`agent-output:processed:${groupA}:*`);
      const keysB = await redis.keys(`agent-output:processed:${groupB}:*`);
      expect(keysA.length).toBe(10);
      expect(keysB.length).toBe(10);

      // No keys from groupA should overlap with groupB
      const setA = new Set(keysA);
      for (const key of keysB) {
        expect(setA.has(key)).toBe(false);
      }
    },
    30_000
  );
});
