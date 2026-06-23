import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createSseCanonicalAdapter } from "../src/session/sse-canonical-adapter";
import type { SseEvent } from "../src/session/adapter-types";
import {
  serializeCanonicalEnvelope,
  deserializeCanonicalEnvelope,
  isCanonicalFormat,
  createCanonicalRouter,
  type CanonicalEvent,
  type CanonicalEventEnvelope,
  type CanonicalEventKind,
  type BridgeRenderer,
  type BridgeRendererContext,
} from "@almirant/stream-consumer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a .jsonl fixture and parse each line into an SseEvent. */
const loadFixture = (filename: string): SseEvent[] => {
  const filepath = join(import.meta.dir, "fixtures", filename);
  const raw = readFileSync(filepath, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SseEvent);
};

/** Feed all SSE events through the adapter and collect canonical events. */
const processFixture = (sseEvents: SseEvent[]): CanonicalEvent[] => {
  const adapter = createSseCanonicalAdapter();
  const result: CanonicalEvent[] = [];
  for (const sseEvent of sseEvents) {
    result.push(...adapter.processEvent(sseEvent));
  }
  result.push(...adapter.flush());
  return result;
};

/** Wrap a canonical event in an envelope with test metadata. */
const wrapInEnvelope = (
  event: CanonicalEvent,
  seq: number,
): CanonicalEventEnvelope => ({
  jobId: "test-job-001",
  sessionId: "test-session-001",
  organizationId: "test-org-001",
  threadId: "test-thread-001",
  timestamp: 1700000000000 + seq * 100,
  sequenceNumber: seq,
  event,
});

/** Extract all event kinds from a canonical event list. */
const extractKinds = (events: CanonicalEvent[]): CanonicalEventKind[] =>
  events.map((e) => e.kind);

/** Find the first event matching a kind. */
const findEvent = <K extends CanonicalEventKind>(
  events: CanonicalEvent[],
  kind: K,
): Extract<CanonicalEvent, { kind: K }> | undefined =>
  events.find((e) => e.kind === kind) as
    | Extract<CanonicalEvent, { kind: K }>
    | undefined;

/** Find all events matching a kind. */
const findEvents = <K extends CanonicalEventKind>(
  events: CanonicalEvent[],
  kind: K,
): Extract<CanonicalEvent, { kind: K }>[] =>
  events.filter((e) => e.kind === kind) as Extract<
    CanonicalEvent,
    { kind: K }
  >[];

// ===========================================================================
// Test Suite 1: SSE → Canonical Adapter (text-and-tool fixture)
// ===========================================================================

describe("Pipeline: SSE → Canonical (text-and-tool fixture)", () => {
  const sseEvents = loadFixture("claude-code-text-and-tool.jsonl");
  const canonicalEvents = processFixture(sseEvents);

  it("produces canonical events from fixture", () => {
    expect(canonicalEvents.length).toBeGreaterThan(0);
  });

  it("starts with session.connected from server.connected", () => {
    expect(canonicalEvents[0].kind).toBe("session.connected");
  });

  it("emits agent.text events for text content", () => {
    const textEvents = findEvents(canonicalEvents, "agent.text");
    expect(textEvents.length).toBeGreaterThanOrEqual(3);

    // First text should be the initial message
    expect(textEvents[0].content).toContain(
      "Let me read the file to understand the structure.",
    );
  });

  it("preserves text content across all text events", () => {
    const textEvents = findEvents(canonicalEvents, "agent.text");
    const allText = textEvents.map((e) => e.content).join("");
    expect(allText).toContain("Let me read the file");
    expect(allText).toContain("updated the port configuration");
    expect(allText).toContain("Type check passed");
  });

  it("emits agent.tool_call.start for Read tool", () => {
    const toolStarts = findEvents(canonicalEvents, "agent.tool_call.start");
    const readTool = toolStarts.find((e) => e.toolName === "Read");
    expect(readTool).toBeDefined();
    expect(readTool!.toolCallId).toBe("tc-read-001");
  });

  it("emits agent.file.read for the Read tool", () => {
    const fileReads = findEvents(canonicalEvents, "agent.file.read");
    expect(fileReads.length).toBeGreaterThanOrEqual(1);
    expect(fileReads[0].filePath).toBe("/src/index.ts");
    expect(fileReads[0].toolCallId).toBe("tc-read-001");
  });

  it("emits agent.tool_call.start for Edit tool", () => {
    const toolStarts = findEvents(canonicalEvents, "agent.tool_call.start");
    const editTool = toolStarts.find((e) => e.toolName === "Edit");
    expect(editTool).toBeDefined();
    expect(editTool!.toolCallId).toBe("tc-edit-002");
  });

  it("emits agent.file.edit for the Edit tool", () => {
    const fileEdits = findEvents(canonicalEvents, "agent.file.edit");
    expect(fileEdits.length).toBeGreaterThanOrEqual(1);
    expect(fileEdits[0].filePath).toBe("/src/index.ts");
    expect(fileEdits[0].toolCallId).toBe("tc-edit-002");
  });

  it("emits agent.tool_call.start for Bash tool", () => {
    const toolStarts = findEvents(canonicalEvents, "agent.tool_call.start");
    const bashTool = toolStarts.find((e) => e.toolName === "Bash");
    expect(bashTool).toBeDefined();
    expect(bashTool!.toolCallId).toBe("tc-bash-003");
  });

  it("emits agent.bash.execute for the Bash tool", () => {
    const bashExecs = findEvents(canonicalEvents, "agent.bash.execute");
    expect(bashExecs.length).toBeGreaterThanOrEqual(1);
    expect(bashExecs[0].command).toBe("bun run type-check");
    expect(bashExecs[0].description).toBe("Run type checker");
  });

  it("emits agent.tool_call.result for each tool", () => {
    const results = findEvents(canonicalEvents, "agent.tool_call.result");
    // At least one result per tool — Read, Edit, Bash
    expect(results.length).toBeGreaterThanOrEqual(3);
    const toolNames = results.map((e) => e.toolName);
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Edit");
    expect(toolNames).toContain("Bash");
  });

  it("ends with session.idle", () => {
    const lastEvent = canonicalEvents[canonicalEvents.length - 1];
    expect(lastEvent.kind).toBe("session.idle");
  });

  it("session.idle reports no background agents", () => {
    const idle = findEvent(canonicalEvents, "session.idle");
    expect(idle).toBeDefined();
    expect(idle!.hasBackgroundAgents).toBe(false);
  });

  it("produces events in correct lifecycle order", () => {
    const kinds = extractKinds(canonicalEvents);

    // session.connected should come first
    const connectedIdx = kinds.indexOf("session.connected");
    expect(connectedIdx).toBe(0);

    // session.idle should come last
    const idleIdx = kinds.lastIndexOf("session.idle");
    expect(idleIdx).toBe(kinds.length - 1);

    // First text should come after connected
    const firstTextIdx = kinds.indexOf("agent.text");
    expect(firstTextIdx).toBeGreaterThan(connectedIdx);

    // First tool_call.start should come after first text
    const firstToolIdx = kinds.indexOf("agent.tool_call.start");
    expect(firstToolIdx).toBeGreaterThan(firstTextIdx);
  });
});

// ===========================================================================
// Test Suite 2: SSE → Canonical Adapter (subagent fixture)
// ===========================================================================

describe("Pipeline: SSE → Canonical (subagent fixture)", () => {
  const sseEvents = loadFixture("claude-code-subagent.jsonl");
  const canonicalEvents = processFixture(sseEvents);

  it("produces canonical events from fixture", () => {
    expect(canonicalEvents.length).toBeGreaterThan(0);
  });

  it("emits agent.text for initial text output", () => {
    const textEvents = findEvents(canonicalEvents, "agent.text");
    expect(textEvents.length).toBeGreaterThanOrEqual(1);
    expect(textEvents[0].content).toContain("spawn a subagent");
  });

  it("emits agent.subagent.spawn for Agent tool", () => {
    const spawns = findEvents(canonicalEvents, "agent.subagent.spawn");
    const agentSpawn = spawns.find((e) => e.subagentId === "tc-agent-001");
    expect(agentSpawn).toBeDefined();
    expect(agentSpawn!.description).toContain("Update React components");
    expect(agentSpawn!.isBackground).toBe(false);
  });

  it("emits agent.subagent.spawn for Task tool (background)", () => {
    const spawns = findEvents(canonicalEvents, "agent.subagent.spawn");
    const taskSpawn = spawns.find((e) => e.subagentId === "tc-task-003");
    expect(taskSpawn).toBeDefined();
    expect(taskSpawn!.description).toContain("Generate API docs");
    expect(taskSpawn!.isBackground).toBe(true);
  });

  it("emits agent.file.read for Grep tool", () => {
    const fileReads = findEvents(canonicalEvents, "agent.file.read");
    const grepRead = fileReads.find((e) => e.toolCallId === "tc-grep-002");
    expect(grepRead).toBeDefined();
  });

  it("emits agent.tool_call.start for all tools", () => {
    const toolStarts = findEvents(canonicalEvents, "agent.tool_call.start");
    const toolNames = toolStarts.map((e) => e.toolName);
    expect(toolNames).toContain("Agent");
    expect(toolNames).toContain("Grep");
    expect(toolNames).toContain("Task");
  });

  it("completes foreground Agent subagent at session.idle", () => {
    const completes = findEvents(canonicalEvents, "agent.subagent.complete");
    const agentComplete = completes.find(
      (e) => e.subagentId === "tc-agent-001",
    );
    expect(agentComplete).toBeDefined();
    expect(agentComplete!.success).toBe(true);
  });

  it("does NOT complete background Task subagent at session.idle", () => {
    const completes = findEvents(canonicalEvents, "agent.subagent.complete");
    const taskComplete = completes.find(
      (e) => e.subagentId === "tc-task-003",
    );
    // Background subagents only complete on explicit completion event,
    // not at session.idle
    expect(taskComplete).toBeUndefined();
  });

  it("session.idle reports active background agents", () => {
    const idle = findEvent(canonicalEvents, "session.idle");
    expect(idle).toBeDefined();
    expect(idle!.hasBackgroundAgents).toBe(true);
  });

  it("adapter correctly reports hasActiveBackgroundAgents", () => {
    const adapter = createSseCanonicalAdapter();
    for (const sseEvent of sseEvents) {
      adapter.processEvent(sseEvent);
    }
    adapter.flush();
    expect(adapter.hasActiveBackgroundAgents()).toBe(true);
  });
});

// ===========================================================================
// Test Suite 3: Canonical Event Serialization Round-trip
// ===========================================================================

describe("Pipeline: Serialization round-trip", () => {
  const sseEvents = loadFixture("claude-code-text-and-tool.jsonl");
  const canonicalEvents = processFixture(sseEvents);

  it("serializes and deserializes every canonical event losslessly", () => {
    for (let i = 0; i < canonicalEvents.length; i++) {
      const envelope = wrapInEnvelope(canonicalEvents[i], i);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);

      expect(deserialized).not.toBeNull();
      expect(deserialized!.jobId).toBe(envelope.jobId);
      expect(deserialized!.sessionId).toBe(envelope.sessionId);
      expect(deserialized!.organizationId).toBe(envelope.organizationId);
      expect(deserialized!.threadId).toBe(envelope.threadId);
      expect(deserialized!.timestamp).toBe(envelope.timestamp);
      expect(deserialized!.sequenceNumber).toBe(envelope.sequenceNumber);
      expect(deserialized!.event.kind).toBe(envelope.event.kind);
      // Deep equality of the event payload
      expect(deserialized!.event).toEqual(envelope.event);
    }
  });

  it("serialized format contains _format=canonical marker", () => {
    const envelope = wrapInEnvelope(canonicalEvents[0], 0);
    const serialized = serializeCanonicalEnvelope(envelope);
    expect(isCanonicalFormat(serialized)).toBe(true);
  });

  it("serialized output is a flat string array for Redis XADD", () => {
    const envelope = wrapInEnvelope(canonicalEvents[0], 0);
    const serialized = serializeCanonicalEnvelope(envelope);
    expect(Array.isArray(serialized)).toBe(true);
    // Every element must be a string
    for (const item of serialized) {
      expect(typeof item).toBe("string");
    }
    // Must have even length (key-value pairs)
    expect(serialized.length % 2).toBe(0);
  });

  it("preserves event kind through serialization round-trip", () => {
    const kindsBeforeRoundTrip = canonicalEvents.map((e) => e.kind);
    const kindsAfterRoundTrip = canonicalEvents.map((e, i) => {
      const envelope = wrapInEnvelope(e, i);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      return deserialized!.event.kind;
    });
    expect(kindsAfterRoundTrip).toEqual(kindsBeforeRoundTrip);
  });

  it("preserves text content through serialization", () => {
    const textEvents = canonicalEvents.filter((e) => e.kind === "agent.text");
    for (let i = 0; i < textEvents.length; i++) {
      const envelope = wrapInEnvelope(textEvents[i], i);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      const original = textEvents[i] as Extract<
        CanonicalEvent,
        { kind: "agent.text" }
      >;
      const restored = deserialized!.event as Extract<
        CanonicalEvent,
        { kind: "agent.text" }
      >;
      expect(restored.content).toBe(original.content);
    }
  });

  it("preserves tool call fields through serialization", () => {
    const toolStarts = canonicalEvents.filter(
      (e) => e.kind === "agent.tool_call.start",
    );
    for (let i = 0; i < toolStarts.length; i++) {
      const envelope = wrapInEnvelope(toolStarts[i], i);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      const original = toolStarts[i] as Extract<
        CanonicalEvent,
        { kind: "agent.tool_call.start" }
      >;
      const restored = deserialized!.event as Extract<
        CanonicalEvent,
        { kind: "agent.tool_call.start" }
      >;
      expect(restored.toolName).toBe(original.toolName);
      expect(restored.toolCallId).toBe(original.toolCallId);
    }
  });

  it("returns null for non-canonical format arrays", () => {
    const nonCanonical = ["key1", "value1", "key2", "value2"];
    expect(deserializeCanonicalEnvelope(nonCanonical)).toBeNull();
  });
});

// ===========================================================================
// Test Suite 4: Canonical Router dispatches to correct BridgeRenderer methods
// ===========================================================================

describe("Pipeline: Canonical Router → BridgeRenderer dispatch", () => {
  /**
   * Creates a mock BridgeRenderer that records each method call.
   * Returns the renderer and the recorded calls array.
   */
  const createMockRenderer = (): {
    renderer: BridgeRenderer;
    calls: Array<{ method: string; event: CanonicalEvent; ctx: BridgeRendererContext }>;
  } => {
    const calls: Array<{
      method: string;
      event: CanonicalEvent;
      ctx: BridgeRendererContext;
    }> = [];

    const makeHandler =
      (method: string) =>
      async (event: CanonicalEvent, ctx: BridgeRendererContext) => {
        calls.push({ method, event, ctx });
      };

    const renderer: BridgeRenderer = {
      renderText: makeHandler("renderText") as BridgeRenderer["renderText"],
      renderThinking: makeHandler("renderThinking") as BridgeRenderer["renderThinking"],
      renderToolCallStart: makeHandler("renderToolCallStart") as BridgeRenderer["renderToolCallStart"],
      renderToolCallResult: makeHandler("renderToolCallResult") as BridgeRenderer["renderToolCallResult"],
      renderFileRead: makeHandler("renderFileRead") as BridgeRenderer["renderFileRead"],
      renderFileWrite: makeHandler("renderFileWrite") as BridgeRenderer["renderFileWrite"],
      renderFileEdit: makeHandler("renderFileEdit") as BridgeRenderer["renderFileEdit"],
      renderBashExecute: makeHandler("renderBashExecute") as BridgeRenderer["renderBashExecute"],
      renderSubagentSpawn: makeHandler("renderSubagentSpawn") as BridgeRenderer["renderSubagentSpawn"],
      renderSubagentComplete: makeHandler("renderSubagentComplete") as BridgeRenderer["renderSubagentComplete"],
      renderWaveStart: makeHandler("renderWaveStart") as BridgeRenderer["renderWaveStart"],
      renderAgentDone: makeHandler("renderAgentDone") as BridgeRenderer["renderAgentDone"],
      renderWaveEnd: makeHandler("renderWaveEnd") as BridgeRenderer["renderWaveEnd"],
      renderQuestion: makeHandler("renderQuestion") as BridgeRenderer["renderQuestion"],
      renderPermissionRequest: makeHandler("renderPermissionRequest") as BridgeRenderer["renderPermissionRequest"],
      renderStep: makeHandler("renderStep") as BridgeRenderer["renderStep"],
      renderSessionIdle: makeHandler("renderSessionIdle") as BridgeRenderer["renderSessionIdle"],
      renderSessionAwaitingUser: makeHandler("renderSessionAwaitingUser") as BridgeRenderer["renderSessionAwaitingUser"],
      renderSessionError: makeHandler("renderSessionError") as BridgeRenderer["renderSessionError"],
      renderJobCompleted: makeHandler("renderJobCompleted") as BridgeRenderer["renderJobCompleted"],
      renderJobIncomplete: makeHandler("renderJobIncomplete") as BridgeRenderer["renderJobIncomplete"],
      renderJobFailed: makeHandler("renderJobFailed") as BridgeRenderer["renderJobFailed"],
      renderHeartbeat: makeHandler("renderHeartbeat") as BridgeRenderer["renderHeartbeat"],
      renderMessageQueued: makeHandler("renderMessageQueued") as BridgeRenderer["renderMessageQueued"],
      renderMessageDequeued: makeHandler("renderMessageDequeued") as BridgeRenderer["renderMessageDequeued"],
      onSilencedEvent: makeHandler("onSilencedEvent") as BridgeRenderer["onSilencedEvent"],
    };

    return { renderer, calls };
  };

  it("routes agent.text to renderText", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      { kind: "agent.text", content: "Hello" },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderText");
  });

  it("routes agent.thinking to renderThinking", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      { kind: "agent.thinking", content: "reasoning..." },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderThinking");
  });

  it("routes agent.tool_call.start to renderToolCallStart", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      {
        kind: "agent.tool_call.start",
        toolName: "Read",
        toolCallId: "tc-001",
      },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderToolCallStart");
  });

  it("routes agent.tool_call.result to renderToolCallResult", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      {
        kind: "agent.tool_call.result",
        toolCallId: "tc-001",
        toolName: "Read",
        success: true,
      },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderToolCallResult");
  });

  it("routes agent.file.read to renderFileRead", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      {
        kind: "agent.file.read",
        toolCallId: "tc-001",
        filePath: "/src/index.ts",
      },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderFileRead");
  });

  it("routes agent.file.edit to renderFileEdit", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      {
        kind: "agent.file.edit",
        toolCallId: "tc-001",
        filePath: "/src/app.ts",
      },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderFileEdit");
  });

  it("routes agent.bash.execute to renderBashExecute", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      {
        kind: "agent.bash.execute",
        toolCallId: "tc-001",
        command: "bun test",
      },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderBashExecute");
  });

  it("routes agent.subagent.spawn to renderSubagentSpawn", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      {
        kind: "agent.subagent.spawn",
        subagentId: "sa-001",
        description: "Test agent",
        isBackground: false,
      },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderSubagentSpawn");
  });

  it("routes session.idle to renderSessionIdle", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      {
        kind: "session.idle",
        hasBackgroundAgents: false,
        isPlanningJob: false,
      },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderSessionIdle");
  });

  it("routes session.error to renderSessionError", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      { kind: "session.error", message: "something broke", recoverable: false },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderSessionError");
  });

  it("routes session.connected to onSilencedEvent", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope({ kind: "session.connected" }, 0);
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("onSilencedEvent");
  });

  it("routes agent.text.complete through renderText with fullText as content", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      { kind: "agent.text.complete", fullText: "Full response text" },
      0,
    );
    await router(envelope);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("renderText");
    // The router converts agent.text.complete → agent.text with fullText → content
    const dispatched = calls[0].event as Extract<
      CanonicalEvent,
      { kind: "agent.text" }
    >;
    expect(dispatched.content).toBe("Full response text");
  });

  it("passes correct context from envelope to renderer", async () => {
    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);
    const envelope = wrapInEnvelope(
      { kind: "agent.text", content: "test" },
      42,
    );
    await router(envelope);
    const ctx = calls[0].ctx;
    expect(ctx.jobId).toBe("test-job-001");
    expect(ctx.sessionId).toBe("test-session-001");
    expect(ctx.organizationId).toBe("test-org-001");
    expect(ctx.threadId).toBe("test-thread-001");
    expect(ctx.sequenceNumber).toBe(42);
  });
});

// ===========================================================================
// Test Suite 5: Full pipeline — Fixture → Adapter → Serialize → Deserialize → Router
// ===========================================================================

describe("Pipeline: Full end-to-end (SSE → Adapter → Serialize → Deserialize → Router)", () => {
  it("every canonical event from text-and-tool fixture survives the full pipeline", async () => {
    const sseEvents = loadFixture("claude-code-text-and-tool.jsonl");
    const canonicalEvents = processFixture(sseEvents);

    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);

    for (let i = 0; i < canonicalEvents.length; i++) {
      const envelope = wrapInEnvelope(canonicalEvents[i], i);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      expect(deserialized).not.toBeNull();
      await router(deserialized!);
    }

    // Router should have dispatched for every canonical event
    expect(calls.length).toBe(canonicalEvents.length);
  });

  it("every canonical event from subagent fixture survives the full pipeline", async () => {
    const sseEvents = loadFixture("claude-code-subagent.jsonl");
    const canonicalEvents = processFixture(sseEvents);

    const { renderer, calls } = createMockRenderer();
    const router = createCanonicalRouter(renderer);

    for (let i = 0; i < canonicalEvents.length; i++) {
      const envelope = wrapInEnvelope(canonicalEvents[i], i);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      expect(deserialized).not.toBeNull();
      await router(deserialized!);
    }

    expect(calls.length).toBe(canonicalEvents.length);
  });

  it("text content is identical at each pipeline stage", () => {
    const sseEvents = loadFixture("claude-code-text-and-tool.jsonl");
    const canonicalEvents = processFixture(sseEvents);

    const textEvents = canonicalEvents.filter(
      (e) => e.kind === "agent.text",
    ) as Extract<CanonicalEvent, { kind: "agent.text" }>[];

    for (const textEvent of textEvents) {
      const envelope = wrapInEnvelope(textEvent, 0);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      const restoredEvent = deserialized!.event as Extract<
        CanonicalEvent,
        { kind: "agent.text" }
      >;
      // Content must be byte-identical through the pipeline
      expect(restoredEvent.content).toBe(textEvent.content);
    }
  });

  it("tool call IDs are stable through the pipeline", () => {
    const sseEvents = loadFixture("claude-code-text-and-tool.jsonl");
    const canonicalEvents = processFixture(sseEvents);

    const toolStarts = canonicalEvents.filter(
      (e) => e.kind === "agent.tool_call.start",
    ) as Extract<CanonicalEvent, { kind: "agent.tool_call.start" }>[];

    for (const toolStart of toolStarts) {
      const envelope = wrapInEnvelope(toolStart, 0);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      const restored = deserialized!.event as Extract<
        CanonicalEvent,
        { kind: "agent.tool_call.start" }
      >;
      expect(restored.toolCallId).toBe(toolStart.toolCallId);
      expect(restored.toolName).toBe(toolStart.toolName);
    }
  });

  it("subagent metadata survives the full pipeline", () => {
    const sseEvents = loadFixture("claude-code-subagent.jsonl");
    const canonicalEvents = processFixture(sseEvents);

    const spawns = canonicalEvents.filter(
      (e) => e.kind === "agent.subagent.spawn",
    ) as Extract<CanonicalEvent, { kind: "agent.subagent.spawn" }>[];

    for (const spawn of spawns) {
      const envelope = wrapInEnvelope(spawn, 0);
      const serialized = serializeCanonicalEnvelope(envelope);
      const deserialized = deserializeCanonicalEnvelope(serialized);
      const restored = deserialized!.event as Extract<
        CanonicalEvent,
        { kind: "agent.subagent.spawn" }
      >;
      expect(restored.subagentId).toBe(spawn.subagentId);
      expect(restored.description).toBe(spawn.description);
      expect(restored.isBackground).toBe(spawn.isBackground);
    }
  });

  /** Helper used in the router dispatch tests above. */
  function createMockRenderer(): {
    renderer: BridgeRenderer;
    calls: Array<{
      method: string;
      event: CanonicalEvent;
      ctx: BridgeRendererContext;
    }>;
  } {
    const calls: Array<{
      method: string;
      event: CanonicalEvent;
      ctx: BridgeRendererContext;
    }> = [];

    const makeHandler =
      (method: string) =>
      async (event: CanonicalEvent, ctx: BridgeRendererContext) => {
        calls.push({ method, event, ctx });
      };

    const renderer: BridgeRenderer = {
      renderText: makeHandler("renderText") as BridgeRenderer["renderText"],
      renderThinking: makeHandler("renderThinking") as BridgeRenderer["renderThinking"],
      renderToolCallStart: makeHandler("renderToolCallStart") as BridgeRenderer["renderToolCallStart"],
      renderToolCallResult: makeHandler("renderToolCallResult") as BridgeRenderer["renderToolCallResult"],
      renderFileRead: makeHandler("renderFileRead") as BridgeRenderer["renderFileRead"],
      renderFileWrite: makeHandler("renderFileWrite") as BridgeRenderer["renderFileWrite"],
      renderFileEdit: makeHandler("renderFileEdit") as BridgeRenderer["renderFileEdit"],
      renderBashExecute: makeHandler("renderBashExecute") as BridgeRenderer["renderBashExecute"],
      renderSubagentSpawn: makeHandler("renderSubagentSpawn") as BridgeRenderer["renderSubagentSpawn"],
      renderSubagentComplete: makeHandler("renderSubagentComplete") as BridgeRenderer["renderSubagentComplete"],
      renderWaveStart: makeHandler("renderWaveStart") as BridgeRenderer["renderWaveStart"],
      renderAgentDone: makeHandler("renderAgentDone") as BridgeRenderer["renderAgentDone"],
      renderWaveEnd: makeHandler("renderWaveEnd") as BridgeRenderer["renderWaveEnd"],
      renderQuestion: makeHandler("renderQuestion") as BridgeRenderer["renderQuestion"],
      renderPermissionRequest: makeHandler("renderPermissionRequest") as BridgeRenderer["renderPermissionRequest"],
      renderStep: makeHandler("renderStep") as BridgeRenderer["renderStep"],
      renderSessionIdle: makeHandler("renderSessionIdle") as BridgeRenderer["renderSessionIdle"],
      renderSessionAwaitingUser: makeHandler("renderSessionAwaitingUser") as BridgeRenderer["renderSessionAwaitingUser"],
      renderSessionError: makeHandler("renderSessionError") as BridgeRenderer["renderSessionError"],
      renderJobCompleted: makeHandler("renderJobCompleted") as BridgeRenderer["renderJobCompleted"],
      renderJobIncomplete: makeHandler("renderJobIncomplete") as BridgeRenderer["renderJobIncomplete"],
      renderJobFailed: makeHandler("renderJobFailed") as BridgeRenderer["renderJobFailed"],
      renderHeartbeat: makeHandler("renderHeartbeat") as BridgeRenderer["renderHeartbeat"],
      renderMessageQueued: makeHandler("renderMessageQueued") as BridgeRenderer["renderMessageQueued"],
      renderMessageDequeued: makeHandler("renderMessageDequeued") as BridgeRenderer["renderMessageDequeued"],
      onSilencedEvent: makeHandler("onSilencedEvent") as BridgeRenderer["onSilencedEvent"],
    };

    return { renderer, calls };
  }
});

// ===========================================================================
// Test Suite 6: Adapter edge cases
// ===========================================================================

describe("Pipeline: Adapter edge cases", () => {
  it("handles non-JSON data gracefully", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: "this is not JSON",
    });
    expect(events).toEqual([]);
  });

  it("handles empty data gracefully", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({ event: "message", data: "" });
    expect(events).toEqual([]);
  });

  it("handles session.error events", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: JSON.stringify({
        type: "session.error",
        properties: {
          error: { data: { message: "Something went wrong" } },
        },
      }),
    });
    const errorEvent = events.find((e) => e.kind === "session.error");
    expect(errorEvent).toBeDefined();
    expect(
      (errorEvent as Extract<CanonicalEvent, { kind: "session.error" }>)
        .message,
    ).toBe("Something went wrong");
  });

  it("handles question.asked events", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: JSON.stringify({
        type: "question.asked",
        properties: {
          text: "Do you want to continue?",
          options: ["Yes", "No"],
          questions: [
            { text: "Do you want to continue?", options: ["Yes", "No"] },
            { text: "Need more detail?", options: ["Later"] },
          ],
        },
      }),
    });
    const questionEvent = events.find((e) => e.kind === "agent.question");
    expect(questionEvent).toBeDefined();
    const q = questionEvent as Extract<
      CanonicalEvent,
      { kind: "agent.question" }
    >;
    expect(q.questionText).toBe("Do you want to continue?");
    expect(q.options).toEqual(["Yes", "No"]);
    expect(q.questions).toEqual([
      { text: "Do you want to continue?", options: ["Yes", "No"] },
      { text: "Need more detail?", options: ["Later"] },
    ]);
    expect(q.questionType).toBe("single_choice");
  });

  it("handles permission.asked events", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: JSON.stringify({
        type: "permission.asked",
        properties: {
          tool: "Write",
          description: "Write to /etc/config",
        },
      }),
    });
    const permEvent = events.find(
      (e) => e.kind === "agent.permission.request",
    );
    expect(permEvent).toBeDefined();
    const p = permEvent as Extract<
      CanonicalEvent,
      { kind: "agent.permission.request" }
    >;
    expect(p.toolName).toBe("Write");
    expect(p.description).toBe("Write to /etc/config");
  });

  it("handles canonical passthrough events", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: JSON.stringify({
        type: "agent.text",
        properties: {
          kind: "agent.text",
          content: "Passthrough text",
        },
      }),
    });
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe("agent.text");
    expect(
      (events[0] as Extract<CanonicalEvent, { kind: "agent.text" }>).content,
    ).toBe("Passthrough text");
  });

  it("handles session.closed events", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: JSON.stringify({
        type: "session.closed",
        properties: { reason: "user_disconnect" },
      }),
    });
    const closedEvent = events.find((e) => e.kind === "session.closed");
    expect(closedEvent).toBeDefined();
    expect(
      (closedEvent as Extract<CanonicalEvent, { kind: "session.closed" }>)
        .reason,
    ).toBe("user_disconnect");
  });

  it("handles message.queued events", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: JSON.stringify({
        type: "message.queued",
        properties: {
          messageId: "msg-001",
          position: 2,
          queueDepth: 5,
        },
      }),
    });
    const queuedEvent = events.find((e) => e.kind === "message.queued");
    expect(queuedEvent).toBeDefined();
    const q = queuedEvent as Extract<
      CanonicalEvent,
      { kind: "message.queued" }
    >;
    expect(q.messageId).toBe("msg-001");
    expect(q.position).toBe(2);
    expect(q.queueDepth).toBe(5);
  });

  it("handles Write tool producing file.write event", () => {
    const adapter = createSseCanonicalAdapter();
    const events = adapter.processEvent({
      event: "message",
      data: JSON.stringify({
        type: "message.part.delta",
        properties: {
          contentType: "tool_use",
          delta: JSON.stringify({
            name: "Write",
            id: "tc-write-001",
            input: { file_path: "/src/new-file.ts", content: "export const x = 1;" },
          }),
        },
      }),
    });
    // Flush to get all events
    events.push(...adapter.flush());

    const fileWrites = events.filter((e) => e.kind === "agent.file.write");
    expect(fileWrites.length).toBeGreaterThanOrEqual(1);
    expect(
      (fileWrites[0] as Extract<CanonicalEvent, { kind: "agent.file.write" }>)
        .filePath,
    ).toBe("/src/new-file.ts");
  });
});
