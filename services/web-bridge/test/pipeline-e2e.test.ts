/**
 * E2E smoke test for the canonical event pipeline, against a REAL Redis:
 *
 *   CanonicalEventEnvelope
 *     → Redis Stream (XADD via the real createStreamPublisher)
 *     → REAL web-bridge consumer (createWebBridgeConsumer: StreamReader with
 *       consumer group + idempotency guard, sequence-guard dedup/reassignment,
 *       canonical router, WebRenderer)
 *     → Redis Pub/Sub (planning:* WS messages)
 *
 * The test publishes a realistic planning-session event sequence, INJECTING
 * exact duplicates and an out-of-order (stale) envelope, and asserts that:
 *   1. The expected planning:* messages arrive in order.
 *   2. Duplicates and out-of-order envelopes are dropped by the sequence
 *      guard (never reach Pub/Sub).
 *   3. Outbound sequenceNum is reassigned monotonically (contiguous from 0).
 *
 * Isolation: STREAM_NAME, CONSUMER_GROUP, CONSUMER_ID and PUBSUB_CHANNEL are
 * unique per run, so the test never interferes with a locally running
 * web-bridge or with concurrent test runs sharing the same Redis.
 *
 * Skip behaviour: if Redis is not reachable within a short timeout (or
 * SKIP_REDIS_E2E=1 is set), the whole suite is skipped cleanly so CI
 * without a Redis service does not break. Override the target instance
 * with REDIS_URL (default redis://localhost:6379).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import Redis from "ioredis";
import {
  createStreamPublisher,
  type StreamPublisher,
  type CanonicalEvent,
  type CanonicalEventEnvelope,
} from "@almirant/stream-consumer";
import { createWebBridgeConsumer, type WebBridgeConsumer } from "../src/consumer";
import { loadBridgeEnv } from "../src/config";

// ---------------------------------------------------------------------------
// Redis availability probe (short timeout — never hangs CI)
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const probeRedis = async (): Promise<boolean> => {
  if (process.env.SKIP_REDIS_E2E === "1") return false;

  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
};

const redisAvailable = await probeRedis();

if (!redisAvailable) {
  console.warn(
    `[pipeline-e2e] Redis not reachable at ${REDIS_URL} — skipping e2e pipeline suite.`,
  );
}

// ---------------------------------------------------------------------------
// Unique-per-run identifiers (no interference with running services)
// ---------------------------------------------------------------------------

const RUN_ID = crypto.randomUUID().slice(0, 8);
const STREAM_NAME = `e2e-agent-output-${RUN_ID}`;
const CONSUMER_GROUP = `e2e-web-bridge-${RUN_ID}`;
const CONSUMER_ID = `e2e-consumer-${RUN_ID}`;
const PUBSUB_CHANNEL = `e2e-ws-broadcast-${RUN_ID}`;
const JOB_ID = `e2e-job-${RUN_ID}`;
const SESSION_ID = `e2e-session-${RUN_ID}`;
const ORG_ID = `e2e-org-${RUN_ID}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ReceivedMessage = {
  organizationId: string;
  message: { type: string; payload: Record<string, unknown> };
};

const envelope = (
  producerSeq: number,
  event: CanonicalEvent,
): CanonicalEventEnvelope => ({
  jobId: JOB_ID,
  sessionId: SESSION_ID,
  organizationId: ORG_ID,
  threadId: JOB_ID,
  timestamp: 1_700_000_000_000 + producerSeq * 100,
  sequenceNumber: producerSeq,
  event,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!redisAvailable)("Pipeline e2e: stream → real consumer → pub/sub", () => {
  const received: ReceivedMessage[] = [];
  const droppedLogs: Array<Record<string, unknown>> = [];

  let subscriber: Redis;
  let publisher: StreamPublisher;
  let consumer: WebBridgeConsumer;

  beforeAll(async () => {
    // 1. Subscribe FIRST so no published message can be missed.
    subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    subscriber.on("message", (_channel: string, raw: string) => {
      received.push(JSON.parse(raw) as ReceivedMessage);
    });
    await subscriber.subscribe(PUBSUB_CHANNEL);

    // 2. Start the REAL web-bridge consumer against the real Redis.
    //    No BACKEND_API_URL/BRIDGE_API_KEY → persistence path disabled,
    //    which matches a minimal self-hosted deployment.
    const env = loadBridgeEnv({
      NODE_ENV: "test",
      REDIS_URL,
      STREAM_NAME,
      CONSUMER_GROUP,
      CONSUMER_ID,
      PUBSUB_CHANNEL,
    });

    consumer = createWebBridgeConsumer({
      env,
      redisConnectionString: REDIS_URL,
      log: (level, message, meta) => {
        if (level === "warn" && message.includes("Dropping")) {
          droppedLogs.push({ message, ...(meta ?? {}) });
        }
      },
    });
    consumer.start();

    // 3. Real producer path (same XADD serialization the runner uses).
    publisher = createStreamPublisher({
      redisUrl: REDIS_URL,
      streamName: STREAM_NAME,
    });
  });

  afterAll(async () => {
    // Wake the blocking XREADGROUP so stop() returns promptly.
    try {
      await publisher.publishCanonicalEnvelope(
        envelope(999, { kind: "heartbeat", elapsedMs: 0 } as CanonicalEvent),
      );
    } catch {
      // best-effort
    }

    await consumer.stop();
    await publisher.close();
    subscriber.disconnect();

    // Remove per-run keys (stream + idempotency markers).
    const cleanup = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
    try {
      await cleanup.del(STREAM_NAME);
      const keys = await cleanup.keys(
        `agent-output:processed:${CONSUMER_GROUP}:*`,
      );
      if (keys.length > 0) await cleanup.del(...keys);
    } finally {
      cleanup.disconnect();
    }
  });

  it(
    "delivers planning:* messages in order, drops duplicates/out-of-order, reassigns monotonic sequenceNum",
    async () => {
      // -- Realistic scenario with injected anomalies ---------------------
      const toolCallStart = envelope(3, {
        kind: "agent.tool_call.start",
        toolName: "Read",
        toolCallId: "tc-1",
        inputPreview: "file_path: /src/index.ts",
      });
      const subagentSpawn = envelope(5, {
        kind: "agent.subagent.spawn",
        subagentId: "sa-1",
        description: "Explore codebase",
        isBackground: false,
        subagentType: "code-explorer",
      });
      const staleThinking = envelope(2, {
        kind: "agent.thinking",
        content: "stale redelivery — must be dropped",
      });

      const publications: CanonicalEventEnvelope[] = [
        envelope(1, { kind: "agent.text", content: "Hello from the pipeline" }),
        envelope(2, { kind: "agent.thinking", content: "Reasoning about the prompt" }),
        toolCallStart,
        toolCallStart, // exact duplicate → must be dropped
        envelope(4, {
          kind: "agent.tool_call.result",
          toolCallId: "tc-1",
          toolName: "Read",
          success: true,
        }),
        subagentSpawn,
        subagentSpawn, // exact duplicate → must be dropped
        staleThinking, // out-of-order (seq 2 after seq 5) → must be dropped
        envelope(6, {
          kind: "agent.subagent.complete",
          subagentId: "sa-1",
          success: true,
        }),
        envelope(7, {
          kind: "agent.question",
          questionText: "Which option should we take?",
          options: ["A", "B"],
          questionType: "single_choice",
        }),
        envelope(8, {
          kind: "session.idle",
          hasBackgroundAgents: false,
          isPlanningJob: true,
        }),
      ];

      for (const env of publications) {
        await publisher.publishCanonicalEnvelope(env);
      }

      // -- Wait until the terminal WS message arrives ----------------------
      const done = await waitFor(
        () =>
          received.some(
            (m) => m.message.type === "planning:response-complete",
          ),
        15_000,
      );
      expect(done).toBe(true);

      // Small grace period: any late (would-be duplicate) message published
      // after response-complete would land here and fail the assertions.
      await sleep(300);

      // -- 1. Expected planning:* messages, in order, no duplicates --------
      const types = received.map((m) => m.message.type);
      expect(types).toEqual([
        "planning:text",
        "planning:thinking",
        "planning:tool-call-start",
        "planning:tool-call-result",
        "planning:subagent-spawn",
        "planning:subagent-complete",
        "planning:question",
        "planning:response-complete",
      ]);

      // -- 2. Duplicates and out-of-order envelopes were dropped -----------
      expect(types.filter((t) => t === "planning:tool-call-start").length).toBe(1);
      expect(types.filter((t) => t === "planning:subagent-spawn").length).toBe(1);
      expect(types.filter((t) => t === "planning:thinking").length).toBe(1);
      // The consumer logged exactly 3 dropped envelopes for this job.
      expect(
        droppedLogs.filter((entry) => entry.jobId === JOB_ID).length,
      ).toBe(3);

      // -- 3. Outbound sequenceNum is monotonic and contiguous from 0 ------
      const sequenceNums = received
        .map((m) => m.message.payload.sequenceNum)
        .filter((seq): seq is number => typeof seq === "number");
      expect(sequenceNums).toEqual([0, 1, 2, 3, 4, 5]);
      // planning:question derives its questionId from the reassigned sequence.
      const question = received.find((m) => m.message.type === "planning:question");
      expect(question?.message.payload.questionId).toBe("question-6");

      // -- 4. Envelope routing metadata survives the pipeline ---------------
      for (const m of received) {
        expect(m.organizationId).toBe(ORG_ID);
        expect(m.message.payload.sessionId).toBe(SESSION_ID);
      }
    },
    30_000,
  );
});
