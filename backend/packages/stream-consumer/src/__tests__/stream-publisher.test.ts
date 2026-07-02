import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import Redis from "ioredis";
import { createStreamPublisher } from "../stream-publisher";
import type { AgentOutputEvent } from "../types";

const REDIS_URL = process.env.REDIS_URL;
const TEST_STREAM = `test:stream-publisher:${Date.now()}`;

// Skip all tests if REDIS_URL is not set
const describeWithRedis = REDIS_URL ? describe : describe.skip;

const makeEvent = (overrides: Partial<AgentOutputEvent> = {}): AgentOutputEvent => ({
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

describeWithRedis("StreamPublisher", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(REDIS_URL!);
  });

  afterAll(async () => {
    // Clean up test stream
    await redis.del(TEST_STREAM);
    redis.disconnect();
  });

  beforeEach(async () => {
    // Ensure clean stream for each test
    await redis.del(TEST_STREAM);
  });

  test("publish increases XLEN", async () => {
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    await publisher.publish(makeEvent());
    await publisher.publish(makeEvent({ sequenceNumber: 2 }));

    const len = await redis.xlen(TEST_STREAM);
    expect(len).toBe(2);

    await publisher.close();
  });

  test("published fields are correctly serialized", async () => {
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    const event = makeEvent({
      type: "step",
      description: "Running analysis",
      contentType: "text",
    });
    const entryId = await publisher.publish(event);

    // XRANGE to read the entry back
    const entries = await redis.xrange(TEST_STREAM, entryId, entryId);
    expect(entries).toHaveLength(1);

    const [, fields] = entries[0];
    // fields is a flat array: [key1, val1, key2, val2, ...]
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }

    expect(fieldMap.get("jobId")).toBe("job-1");
    expect(fieldMap.get("sessionId")).toBe("session-1");
    expect(fieldMap.get("workspaceId")).toBe("org-1");
    expect(fieldMap.get("threadId")).toBe("thread-1");
    expect(fieldMap.get("type")).toBe("step");
    expect(fieldMap.get("description")).toBe("Running analysis");
    expect(fieldMap.get("contentType")).toBe("text");
    expect(fieldMap.get("sequenceNumber")).toBe("1");

    await publisher.close();
  });

  test("nested objects are JSON-stringified", async () => {
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    const agents = [
      { agent: "researcher", taskId: "t-1", title: "Research" },
      { agent: "coder", taskId: "t-2", title: "Implement" },
    ];
    const options = ["option-a", "option-b"];
    const payload = { key: "value", nested: { deep: true } };

    const event = makeEvent({
      type: "wave_start",
      agents,
      options,
      payload,
    });
    const entryId = await publisher.publish(event);

    const entries = await redis.xrange(TEST_STREAM, entryId, entryId);
    const [, fields] = entries[0];
    const fieldMap = new Map<string, string>();
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap.set(fields[i], fields[i + 1]);
    }

    expect(JSON.parse(fieldMap.get("agents")!)).toEqual(agents);
    expect(JSON.parse(fieldMap.get("options")!)).toEqual(options);
    expect(JSON.parse(fieldMap.get("payload")!)).toEqual(payload);

    await publisher.close();
  });

  test("undefined fields are not included in stream entry", async () => {
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
    });

    // Event with only required fields + type — no optional fields
    const event = makeEvent({
      content: undefined,
      contentType: undefined,
      description: undefined,
      summary: undefined,
      reason: undefined,
      text: undefined,
      options: undefined,
      agents: undefined,
      agent: undefined,
      taskId: undefined,
      status: undefined,
      successCount: undefined,
      totalCount: undefined,
      elapsedMs: undefined,
      payload: undefined,
    });
    const entryId = await publisher.publish(event);

    const entries = await redis.xrange(TEST_STREAM, entryId, entryId);
    const [, fields] = entries[0];
    const fieldKeys: string[] = [];
    for (let i = 0; i < fields.length; i += 2) {
      fieldKeys.push(fields[i]);
    }

    // Should have identity + type fields only
    expect(fieldKeys).toContain("jobId");
    expect(fieldKeys).toContain("sessionId");
    expect(fieldKeys).toContain("workspaceId");
    expect(fieldKeys).toContain("threadId");
    expect(fieldKeys).toContain("timestamp");
    expect(fieldKeys).toContain("sequenceNumber");
    expect(fieldKeys).toContain("type");

    // Should NOT have optional fields that were undefined
    expect(fieldKeys).not.toContain("content");
    expect(fieldKeys).not.toContain("contentType");
    expect(fieldKeys).not.toContain("description");
    expect(fieldKeys).not.toContain("summary");
    expect(fieldKeys).not.toContain("agents");
    expect(fieldKeys).not.toContain("payload");

    await publisher.close();
  });

  test("MAXLEN trimming prevents unbounded growth", async () => {
    const maxLen = 50;
    const totalPublished = 200;
    const publisher = createStreamPublisher({
      redisUrl: REDIS_URL!,
      streamName: TEST_STREAM,
      maxLen,
    });

    // Publish significantly more events than maxLen
    const promises: Promise<string>[] = [];
    for (let i = 0; i < totalPublished; i++) {
      promises.push(publisher.publish(makeEvent({ sequenceNumber: i })));
    }
    await Promise.all(promises);

    const len = await redis.xlen(TEST_STREAM);
    // With MAXLEN ~ (approximate), Redis trims at the radix tree node level
    // so it may keep somewhat more than maxLen, but far fewer than totalPublished
    expect(len).toBeLessThan(totalPublished);
    expect(len).toBeGreaterThan(0);

    await publisher.close();
  }, 30_000);
});
