import { describe, it, expect } from "bun:test";
import { createWebRenderer } from "../src/web-renderer";
import {
  createCanonicalRouter,
  buildCanonicalSessionProjection,
  type CanonicalEvent,
  type CanonicalEventEnvelope,
  type NativeEventEnvelope,
  type BridgeRendererContext,
} from "@almirant/stream-consumer";
import { createSequenceGuard } from "../src/sequence-guard";
import {
  buildNativeEventPersistencePayload,
  buildOutboundCanonicalEnvelope,
} from "../src/consumer";

// ---------------------------------------------------------------------------
// Mock Redis Pub/Sub — records publish calls instead of connecting to Redis
// ---------------------------------------------------------------------------

type PublishedMessage = {
  channel: string;
  payload: {
    workspaceId: string;
    message: { type: string; payload: Record<string, unknown> };
  };
};

const createMockRedis = () => {
  const published: PublishedMessage[] = [];
  return {
    published,
    redis: {
      publish: async (channel: string, data: string) => {
        published.push({
          channel,
          payload: JSON.parse(data),
        });
        return 1;
      },
    } as unknown as import("ioredis").default,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHANNEL = "test-ws-channel";

const wrapInEnvelope = (
  event: CanonicalEvent,
  seq: number,
): CanonicalEventEnvelope => ({
  jobId: "job-001",
  sessionId: "session-001",
  workspaceId: "org-001",
  threadId: "thread-001",
  timestamp: 1700000000000 + seq * 100,
  sequenceNumber: seq,
  event,
});

const noop = () => {};

// ===========================================================================
// Test Suite: native persistence transport
// ===========================================================================

describe("Web Bridge: native persistence transport", () => {
  it("preserves the separated Pi runtime tuple through the consumer boundary", () => {
    const envelope: NativeEventEnvelope = {
      jobId: "job-pi",
      sessionId: "session-pi",
      workspaceId: "org-pi",
      threadId: "thread-pi",
      timestamp: 1_710_000_000_500,
      sequenceNumber: 47,
      sequenceProtocolVersion: "durable.v2",
      claimAttemptId: "attempt-pi",
      nativeEventType: "message_end",
      sourceFormat: "pi-rpc",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      runtimeSessionId: "runtime-pi",
      emittedAt: "2026-08-21T12:00:02.000Z",
      payload: { type: "message_end" },
    };

    const payload = buildNativeEventPersistencePayload(envelope);

    expect(payload).toEqual({
      sequenceNum: 47,
      sequenceProtocolVersion: "durable.v2",
      claimAttemptId: "attempt-pi",
      nativeEventType: "message_end",
      sourceFormat: "pi-rpc",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      runtimeSessionId: "runtime-pi",
      emittedAt: "2026-08-21T12:00:02.000Z",
      payload: { type: "message_end" },
    });
    expect(payload.provider).not.toBe(payload.aiProvider);
  });

  it("does not add runtime-selection keys to existing producer payloads", () => {
    const payload = buildNativeEventPersistencePayload({
      jobId: "job-existing",
      sessionId: "session-existing",
      workspaceId: "org-existing",
      threadId: "thread-existing",
      timestamp: 1_710_000_000_600,
      sequenceNumber: 48,
      nativeEventType: "message.part.updated",
      sourceFormat: "opencode-sse",
      provider: "zipu",
      codingAgent: "opencode",
      payload: { type: "message.part.updated" },
    });

    expect(Object.hasOwn(payload, "aiProvider")).toBe(false);
    expect(Object.hasOwn(payload, "model")).toBe(false);
  });
});

// ===========================================================================
// Test Suite: WebRenderer WS message mapping
// ===========================================================================

describe("Web Bridge: Canonical → WS message mapping", () => {
  it("maps agent.text to planning:text", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope({ kind: "agent.text", content: "Hello world" }, 0),
    );

    expect(published.length).toBe(1);
    expect(published[0].channel).toBe(TEST_CHANNEL);
    expect(published[0].payload.workspaceId).toBe("org-001");
    expect(published[0].payload.message.type).toBe("planning:text");
    expect(published[0].payload.message.payload.content).toBe("Hello world");
    expect(published[0].payload.message.payload.sessionId).toBe("session-001");
  });

  it("maps agent.thinking to planning:thinking", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        { kind: "agent.thinking", content: "reasoning about the problem" },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:thinking");
    expect(published[0].payload.message.payload.content).toBe(
      "reasoning about the problem",
    );
  });

  it("maps agent.tool_call.start to planning:tool-call-start", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.tool_call.start",
          toolName: "Read",
          toolCallId: "tc-001",
          inputPreview: "file_path: /src/index.ts",
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:tool-call-start");
    expect(published[0].payload.message.payload.toolName).toBe("Read");
    expect(published[0].payload.message.payload.toolCallId).toBe("tc-001");
    expect(published[0].payload.message.payload.inputPreview).toBe(
      "file_path: /src/index.ts",
    );
  });

  it("maps agent.tool_call.result to planning:tool-call-result", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.tool_call.result",
          toolCallId: "tc-001",
          toolName: "Read",
          success: true,
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe(
      "planning:tool-call-result",
    );
    expect(published[0].payload.message.payload.success).toBe(true);
  });

  it("maps agent.file.read to planning:file-read", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.file.read",
          toolCallId: "tc-001",
          filePath: "/src/app.ts",
          lineRange: "10-50",
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:file-read");
    expect(published[0].payload.message.payload.filePath).toBe("/src/app.ts");
    expect(published[0].payload.message.payload.lineRange).toBe("10-50");
  });

  it("maps agent.file.write to planning:file-change with operation=write", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.file.write",
          toolCallId: "tc-001",
          filePath: "/src/new.ts",
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:file-change");
    expect(published[0].payload.message.payload.operation).toBe("write");
    expect(published[0].payload.message.payload.filePath).toBe("/src/new.ts");
  });

  it("maps agent.file.edit to planning:file-change with operation=edit", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.file.edit",
          toolCallId: "tc-001",
          filePath: "/src/edit.ts",
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:file-change");
    expect(published[0].payload.message.payload.operation).toBe("edit");
  });

  it("maps agent.bash.execute to planning:bash-execute", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.bash.execute",
          toolCallId: "tc-001",
          command: "bun test",
          description: "Run tests",
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:bash-execute");
    expect(published[0].payload.message.payload.command).toBe("bun test");
    expect(published[0].payload.message.payload.description).toBe("Run tests");
  });

  it("maps agent.subagent.spawn to planning:subagent-spawn", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.subagent.spawn",
          subagentId: "sa-001",
          description: "Explore codebase",
          isBackground: true,
          subagentType: "code-explorer",
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:subagent-spawn");
    expect(published[0].payload.message.payload.subagentId).toBe("sa-001");
    expect(published[0].payload.message.payload.isBackground).toBe(true);
    expect(published[0].payload.message.payload.subagentType).toBe(
      "code-explorer",
    );
  });

  it("maps agent.subagent.complete to planning:subagent-complete", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.subagent.complete",
          subagentId: "sa-001",
          success: true,
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe(
      "planning:subagent-complete",
    );
    expect(published[0].payload.message.payload.success).toBe(true);
  });

  it("maps agent.question to planning:question", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.question",
          questionText: "Pick an option",
          options: ["A", "B", "C"],
          questionType: "single_choice",
        },
        5,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:question");
    expect(published[0].payload.message.payload.questionText).toBe(
      "Pick an option",
    );
    expect(published[0].payload.message.payload.options).toEqual([
      "A",
      "B",
      "C",
    ]);
    // questionId is derived from sequenceNumber
    expect(published[0].payload.message.payload.questionId).toBe("question-5");
  });

  it("preserves canonical v2 question identity, expiration and runtime source", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router({
      ...wrapInEnvelope(
        {
          kind: "agent.question",
          questionId: "q-turn-001",
          questionText: "¿Continuamos?",
          options: ["Sí", "No"],
          expiresAt: "2026-04-28T01:30:00.000Z",
        },
        7,
      ),
      sourceRuntime: "claude-code",
    });

    expect(published).toHaveLength(1);
    expect(published[0].payload.message.type).toBe("planning:question");
    expect(published[0].payload.message.payload.questionId).toBe("q-turn-001");
    expect(published[0].payload.message.payload.expiresAt).toBe(
      "2026-04-28T01:30:00.000Z",
    );
    expect(published[0].payload.message.payload.source).toBe("claude-code");
  });

  it("silences turn lifecycle events in the legacy WS renderer", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        { kind: "turn.started", turnId: "turn-001", reason: "user_prompt" },
        8,
      ),
    );

    expect(published).toHaveLength(0);
  });

  it("preserves structured questions on planning:question payloads", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.question",
          questionText: "Question 2?\nQuestion 3?",
          options: ["Option A", "Option B", "Option C", "Option D"],
          questions: [
            { text: "Question 2?", options: ["Option A", "Option B", "Option C"] },
            { text: "Question 3?", options: ["Option D"] },
          ],
          questionType: "single_choice",
        },
        6,
      ),
    );

    expect(published).toHaveLength(1);
    expect(published[0].payload.message.type).toBe("planning:question");
    expect(published[0].payload.message.payload.questions).toEqual([
      { text: "Question 2?", options: ["Option A", "Option B", "Option C"] },
      { text: "Question 3?", options: ["Option D"] },
    ]);
  });

  it("maps session.idle to planning:response-complete", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "session.idle",
          hasBackgroundAgents: false,
          isPlanningJob: false,
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe(
      "planning:response-complete",
    );
  });

  it("maps session.error to planning:error", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "session.error",
          message: "Context window exhausted",
          recoverable: false,
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:error");
    expect(published[0].payload.message.payload.message).toBe(
      "Context window exhausted",
    );
  });

  it("maps job.completed to planning:done", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        { kind: "job.completed", summary: "All tasks done" },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:done");
    expect(published[0].payload.message.payload.summary).toBe(
      "All tasks done",
    );
  });

  it("maps job.incomplete to planning:done with incomplete summary", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        { kind: "job.incomplete", summary: "2 tasks still need reconciliation" },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:done");
    expect(published[0].payload.message.payload.summary).toBe(
      "2 tasks still need reconciliation",
    );
  });

  it("maps job.failed to planning:error", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        { kind: "job.failed", errorMessage: "Container crashed" },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:error");
    expect(published[0].payload.message.payload.message).toBe(
      "Container crashed",
    );
  });

  it("maps heartbeat silently (no publish)", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(wrapInEnvelope({ kind: "heartbeat", elapsedMs: 5000 }, 0));

    // Heartbeat is a no-op in the web renderer
    expect(published.length).toBe(0);
  });

  it("maps agent.wave.start to planning:wave-start", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "agent.wave.start",
          agents: [
            { agent: "frontend-dev", taskId: "t1", title: "Update UI" },
            { agent: "backend-dev", taskId: "t2", title: "Fix API" },
          ],
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:wave-start");
    const agents = published[0].payload.message.payload.agents as Array<{
      id: string;
      name: string;
      role: string;
    }>;
    expect(agents.length).toBe(2);
    expect(agents[0].id).toBe("frontend-dev");
    expect(agents[0].role).toBe("Update UI");
  });

  it("maps message.queued to planning:message-queued", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope(
        {
          kind: "message.queued",
          messageId: "msg-001",
          position: 3,
          queueDepth: 7,
        },
        0,
      ),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.type).toBe("planning:message-queued");
    expect(published[0].payload.message.payload.position).toBe(3);
    expect(published[0].payload.message.payload.queueDepth).toBe(7);
  });

  it("calls onPublish callback for each message", async () => {
    const { redis, published } = createMockRedis();
    let publishCount = 0;
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
      onPublish: () => {
        publishCount++;
      },
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope({ kind: "agent.text", content: "text 1" }, 0),
    );
    await router(
      wrapInEnvelope({ kind: "agent.text", content: "text 2" }, 1),
    );

    expect(publishCount).toBe(2);
    expect(published.length).toBe(2);
  });

  it("includes sequenceNum in planning:text payload", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope({ kind: "agent.text", content: "hello" }, 42),
    );

    expect(published.length).toBe(1);
    expect(published[0].payload.message.payload.sequenceNum).toBe(42);
  });

  it("includes jobId in sequenced planning payloads so the frontend can scope dedup per run", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);

    await router(
      wrapInEnvelope({ kind: "agent.text", content: "hello" }, 0),
    );
    await router(
      wrapInEnvelope({ kind: "agent.thinking", content: "hmm" }, 1),
    );
    await router(
      wrapInEnvelope(
        {
          kind: "agent.tool_call.start",
          toolName: "Read",
          toolCallId: "tc-1",
          inputPreview: "file.ts",
        },
        2,
      ),
    );
    await router(
      wrapInEnvelope(
        {
          kind: "agent.subagent.spawn",
          subagentId: "sa-1",
          description: "explore",
          isBackground: false,
        },
        3,
      ),
    );

    expect(published.length).toBe(4);
    for (const entry of published) {
      expect(entry.payload.message.payload.jobId).toBe("job-001");
    }
  });
});

// ===========================================================================
// Test Suite: SequenceGuard — dedup and ordering
// ===========================================================================

describe("SequenceGuard: dedup and ordering", () => {
  it("preserves producer sequences only for the explicit durable v2 protocol", () => {
    const guard = createSequenceGuard();

    expect(guard.resolveOutboundSequence("job-v2", 73, "durable.v2")).toBe(73);
    expect(guard.resolveOutboundSequence("job-v2", undefined, "durable.v2")).toBe(74);

    // A finite number is not sufficient to trust a rolling-deploy producer:
    // old runners used a process-global namespace that can restart per attempt.
    expect(guard.resolveOutboundSequence("legacy-job", 73, undefined)).toBe(0);
    expect(guard.resolveOutboundSequence("legacy-job", 1, undefined)).toBe(1);
  });

  it("keeps legacy output monotonic when an old runner resumes the same job with low sequences", () => {
    const guard = createSequenceGuard();

    expect(guard.resolveOutboundSequence("legacy-job", 100, undefined)).toBe(0);
    expect(guard.resolveOutboundSequence("legacy-job", 101, undefined)).toBe(1);
    guard.resetHighWater("legacy-job");
    expect(guard.resolveOutboundSequence("legacy-job", 1, undefined)).toBe(2);
    expect(guard.resolveOutboundSequence("legacy-job", 2, undefined)).toBe(3);
  });

  it("does not let an old runner's process-global sequence poison a later durable attempt", () => {
    const guard = createSequenceGuard();

    expect(guard.isRegression("mixed-job", 1_000, undefined)).toBe(false);
    expect(guard.isRegression("mixed-job", 3, "durable.v2")).toBe(false);
    expect(guard.isRegression("mixed-job", 3, "durable.v2")).toBe(false);
  });

  it("never drops durable out-of-order sequences because PostgreSQL owns idempotency", () => {
    const guard = createSequenceGuard();

    expect(guard.isRegression("durable-out-of-order", 2, "durable.v2")).toBe(false);
    expect(guard.isRegression("durable-out-of-order", 1, "durable.v2")).toBe(false);
    expect(guard.isRegression("durable-out-of-order", 2, "durable.v2")).toBe(false);
  });

  it("fails closed for invalid durable-v2 producer sequences", () => {
    const invalid = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648];

    for (const sequenceNumber of invalid) {
      const guard = createSequenceGuard();
      expect(() =>
        guard.resolveOutboundSequence(
          "durable-invalid",
          sequenceNumber,
          "durable.v2",
        ),
      ).toThrow("invalid durable.v2 sequence");
      expect(() =>
        guard.isRegression(
          "durable-invalid",
          sequenceNumber,
          "durable.v2",
        ),
      ).toThrow("invalid durable.v2 sequence");
    }
  });

  it("regenerates legacy event identity from the bridge-local sequence across resumes", () => {
    const legacyEnvelope: CanonicalEventEnvelope = {
      jobId: "legacy-resume",
      sessionId: "session-legacy",
      workspaceId: "workspace-legacy",
      threadId: "legacy-resume",
      timestamp: 1_700_000_000_000,
      sequenceNumber: 1,
      eventId: "legacy-resume:1:system.info",
      event: {
        kind: "system.info",
        message: "same producer identity from two old attempts",
        metadata: { eventId: "legacy-resume:1:system.info" },
      },
    };

    const first = buildOutboundCanonicalEnvelope(
      legacyEnvelope,
      0,
      undefined,
    );
    const resumed = buildOutboundCanonicalEnvelope(
      legacyEnvelope,
      1,
      undefined,
    );
    const projection = buildCanonicalSessionProjection([
      first,
      resumed,
    ]);

    expect(first.eventId).toBe("legacy-resume:0:system.info");
    expect(resumed.eventId).toBe("legacy-resume:1:system.info");
    expect(first.event.metadata?.eventId).toBe(first.eventId);
    expect(resumed.event.metadata?.eventId).toBe(resumed.eventId);
    expect(projection.duplicateCount).toBe(0);
  });

  it("rejects duplicate envelopes with same sequenceNumber", () => {
    const guard = createSequenceGuard();

    // First envelope for job-001 at seq=0 is accepted
    expect(guard.isRegression("job-001", 0)).toBe(false);
    // Duplicate at seq=0 is rejected
    expect(guard.isRegression("job-001", 0)).toBe(true);
  });

  it("rejects out-of-order envelopes", () => {
    const guard = createSequenceGuard();

    // Accept seq=5
    expect(guard.isRegression("job-001", 5)).toBe(false);
    // seq=3 is a regression — rejected
    expect(guard.isRegression("job-001", 3)).toBe(true);
  });

  it("accepts sequential envelopes in order", () => {
    const guard = createSequenceGuard();

    expect(guard.isRegression("job-001", 0)).toBe(false);
    expect(guard.isRegression("job-001", 1)).toBe(false);
    expect(guard.isRegression("job-001", 2)).toBe(false);
  });

  it("different jobIds have independent sequence tracking", () => {
    const guard = createSequenceGuard();

    // Both seq=0 should be accepted because they belong to different jobs
    expect(guard.isRegression("job-A", 0)).toBe(false);
    expect(guard.isRegression("job-B", 0)).toBe(false);
  });

  it("generates monotonic sequence numbers per job", () => {
    const guard = createSequenceGuard();

    expect(guard.nextSequence("job-001")).toBe(0);
    expect(guard.nextSequence("job-001")).toBe(1);
    expect(guard.nextSequence("job-001")).toBe(2);

    // Different job starts at 0
    expect(guard.nextSequence("job-002")).toBe(0);
    expect(guard.nextSequence("job-002")).toBe(1);
  });

  it("cleans up tracking state on job completion", () => {
    const guard = createSequenceGuard();

    // Advance a job
    guard.nextSequence("job-001");
    guard.nextSequence("job-001");
    expect(guard.isRegression("job-001", 5)).toBe(false);

    // Clean up
    guard.cleanup("job-001");

    // After cleanup, the job starts fresh
    expect(guard.nextSequence("job-001")).toBe(0);
    // And seq=0 is accepted again (no high water mark)
    expect(guard.isRegression("job-001", 0)).toBe(false);
  });

  it("resetHighWater lets a resumed attempt with a restarted-low sequence through", () => {
    const guard = createSequenceGuard();

    // Attempt A advances the high-water mark WITHOUT ever reaching a terminal
    // event (mimics a quota pause or pre-session-timeout retry: the same jobId
    // is reused on a fresh, ephemeral runner whose producer sequence restarts
    // low).
    expect(guard.isRegression("job-001", 1)).toBe(false);
    expect(guard.isRegression("job-001", 2)).toBe(false);
    expect(guard.isRegression("job-001", 3)).toBe(false);

    // Without a reset, the resumed attempt's low sequence looks like a stale
    // redelivery and is silently (and permanently) dropped — the bug.
    expect(guard.isRegression("job-001", 1)).toBe(true);

    // job.started at the start of the new attempt resets the high-water mark.
    guard.resetHighWater("job-001");

    // The resumed attempt's events are accepted again.
    expect(guard.isRegression("job-001", 1)).toBe(false);
    expect(guard.isRegression("job-001", 2)).toBe(false);
    // ...and dedup still works within the resumed attempt.
    expect(guard.isRegression("job-001", 2)).toBe(true);
  });

  it("resetHighWater preserves the legacy fallback counter", () => {
    const guard = createSequenceGuard();

    // Bridge-local fallback numbering advances during attempt A.
    expect(guard.nextSequence("job-001")).toBe(0);
    expect(guard.nextSequence("job-001")).toBe(1);

    // A reset (unlike cleanup) must NOT restart the fallback counter.
    guard.resetHighWater("job-001");
    expect(guard.nextSequence("job-001")).toBe(2);
  });
});

// ===========================================================================
// Test Suite: End-to-end dedup through the canonical pipeline
// ===========================================================================

describe("Web Bridge: envelope dedup through canonical pipeline", () => {
  it("publishes sequential envelopes and includes correct sequenceNum", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);
    const guard = createSequenceGuard();

    // Simulate consumer flow: nextSequence → isRegression → route
    for (let i = 0; i < 3; i++) {
      const seq = guard.nextSequence("job-001");
      if (!guard.isRegression("job-001", seq)) {
        await router(
          wrapInEnvelope({ kind: "agent.text", content: `chunk ${i}` }, seq),
        );
      }
    }

    expect(published.length).toBe(3);
    expect(published[0].payload.message.payload.sequenceNum).toBe(0);
    expect(published[1].payload.message.payload.sequenceNum).toBe(1);
    expect(published[2].payload.message.payload.sequenceNum).toBe(2);
  });

  it("drops duplicate and out-of-order envelopes before publishing", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);
    const guard = createSequenceGuard();

    // Simulate: seq=0, seq=1, duplicate seq=0, out-of-order seq=1, seq=2
    const attempts = [0, 1, 0, 1, 2];
    // We need to manually assign sequence numbers (simulating upstream re-delivery)
    for (const seq of attempts) {
      if (!guard.isRegression("job-001", seq)) {
        await router(
          wrapInEnvelope({ kind: "agent.text", content: `seq-${seq}` }, seq),
        );
      }
    }

    // Only seq=0, 1, 2 should be published (3 out of 5 attempts)
    expect(published.length).toBe(3);
    expect(published[0].payload.message.payload.content).toBe("seq-0");
    expect(published[1].payload.message.payload.content).toBe("seq-1");
    expect(published[2].payload.message.payload.content).toBe("seq-2");
  });

  it("does not lose legitimate events with distinct sequenceNum", async () => {
    const { redis, published } = createMockRedis();
    const renderer = createWebRenderer({
      pubsubRedis: redis,
      pubsubChannel: TEST_CHANNEL,
      log: noop as any,
    });
    const router = createCanonicalRouter(renderer);
    const guard = createSequenceGuard();

    // Mix of event types with correct sequencing
    const events: Array<{ event: CanonicalEvent; seq: number }> = [
      { event: { kind: "agent.thinking", content: "hmm" }, seq: 0 },
      { event: { kind: "agent.text", content: "hello" }, seq: 1 },
      { event: { kind: "agent.tool_call.start", toolName: "Read", toolCallId: "tc-1", inputPreview: "foo.ts" }, seq: 2 },
      { event: { kind: "agent.tool_call.result", toolCallId: "tc-1", toolName: "Read", success: true }, seq: 3 },
      { event: { kind: "agent.text", content: " world" }, seq: 4 },
    ];

    for (const { event, seq } of events) {
      if (!guard.isRegression("job-001", seq)) {
        await router(wrapInEnvelope(event, seq));
      }
    }

    // All 5 events should be published (no duplicates)
    expect(published.length).toBe(5);
  });
});
