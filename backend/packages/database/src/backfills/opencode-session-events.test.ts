import { describe, expect, test } from "bun:test";
import {
  OPENCODE_SESSION_EVENTS_BACKFILL_KEY,
  buildOpenCodeBackfilledSessionEvents,
  hasRichCanonicalOpenCodeEvents,
  shouldBackfillOpenCodeJob,
  type OpenCodeNativeEventRow,
  type SessionEventProjection,
} from "./opencode-session-events";

const baseNativeRow = (
  overrides: Partial<OpenCodeNativeEventRow>,
): OpenCodeNativeEventRow => ({
  agentJobId: "job-1",
  planningSessionId: "session-1",
  sequenceNum: 1,
  nativeEventType: "message.part.delta",
  provider: "anthropic",
  codingAgent: "opencode",
  runtimeSessionId: "runtime-1",
  payload: { properties: { sessionID: "runtime-1" } },
  emittedAt: new Date("2026-04-30T10:00:00.000Z"),
  receivedAt: new Date("2026-04-30T10:00:01.000Z"),
  ...overrides,
});

describe("OpenCode session-events backfill mapping", () => {
  test("declares a stable backfill key", () => {
    expect(OPENCODE_SESSION_EVENTS_BACKFILL_KEY).toBe("2026-04-opencode-native-session-events");
  });

  test("detects rich canonical OpenCode events that should not be overwritten", () => {
    const legacyPlainText: SessionEventProjection[] = [
      { kind: "agent.text", payload: { content: "Thinking...\nTool: Bash" } },
    ];
    const rich: SessionEventProjection[] = [
      { kind: "agent.thinking", payload: { content: "I need to inspect the repo" } },
      { kind: "agent.tool_call.start", payload: { toolName: "Bash", toolCallId: "t1" } },
    ];

    expect(hasRichCanonicalOpenCodeEvents(legacyPlainText)).toBe(false);
    expect(hasRichCanonicalOpenCodeEvents(rich)).toBe(true);
    expect(shouldBackfillOpenCodeJob({ nativeEventCount: 2, existingSessionEvents: legacyPlainText })).toBe(true);
    expect(shouldBackfillOpenCodeJob({ nativeEventCount: 2, existingSessionEvents: rich })).toBe(false);
    expect(shouldBackfillOpenCodeJob({ nativeEventCount: 0, existingSessionEvents: legacyPlainText })).toBe(false);
  });

  test("rebuilds reasoning and text parts as separate canonical session events", () => {
    const events = buildOpenCodeBackfilledSessionEvents([
      baseNativeRow({
        sequenceNum: 1,
        nativeEventType: "message.part.delta",
        payload: {
          properties: {
            sessionID: "runtime-1",
            partID: "think-1",
            partType: "reasoning",
            delta: "Let me inspect the codebase.",
          },
        },
      }),
      baseNativeRow({
        sequenceNum: 2,
        nativeEventType: "message.part.delta",
        payload: {
          properties: {
            sessionID: "runtime-1",
            partID: "text-1",
            partType: "text",
            delta: "Voy a revisar los tests.",
          },
        },
        emittedAt: new Date("2026-04-30T10:00:02.000Z"),
      }),
    ]);

    expect(events.map((event) => event.kind)).toEqual([
      "agent.thinking",
      "agent.text",
    ]);
    expect(events[0]).toMatchObject({
      agentJobId: "job-1",
      planningSessionId: "session-1",
      sequenceNum: 1,
      provider: "anthropic",
      payload: {
        content: "Let me inspect the codebase.",
        metadata: {
          source: "opencode-native-backfill",
          nativeSequenceNum: 1,
          runtimeSessionId: "runtime-1",
        },
      },
      createdAt: new Date("2026-04-30T10:00:00.000Z"),
    });
    expect(events[1]?.payload).toMatchObject({
      content: "Voy a revisar los tests.",
      metadata: { nativeSequenceNum: 2 },
    });
  });

  test("rebuilds OpenCode ToolPart updates as colorful tool call and specialized bash events", () => {
    const events = buildOpenCodeBackfilledSessionEvents([
      baseNativeRow({
        nativeEventType: "message.part.updated",
        payload: {
          properties: {
            sessionID: "runtime-1",
            partID: "tool-1",
            part: {
              type: "tool",
              callID: "call-1",
              tool: "bash",
              state: {
                status: "running",
                input: {
                  command: "bun test backend/packages/database/src/backfills/opencode-session-events.test.ts",
                  description: "Run focused backfill tests",
                },
              },
            },
          },
        },
      }),
      baseNativeRow({
        sequenceNum: 2,
        nativeEventType: "message.part.updated",
        payload: {
          properties: {
            sessionID: "runtime-1",
            partID: "tool-1",
            part: {
              type: "tool",
              callID: "call-1",
              tool: "bash",
              state: {
                status: "completed",
                output: "ok",
              },
            },
          },
        },
      }),
    ]);

    expect(events.map((event) => event.kind)).toEqual([
      "agent.tool_call.start",
      "agent.bash.execute",
      "agent.tool_call.result",
    ]);
    expect(events[0]?.payload).toMatchObject({
      toolName: "Bash",
      toolCallId: "call-1",
      inputPreview: "command: bun test backend/packages/database/src/backfills/opencode-session-events.test.ts",
    });
    expect(events[1]?.payload).toMatchObject({
      toolCallId: "call-1",
      command: "bun test backend/packages/database/src/backfills/opencode-session-events.test.ts",
      description: "Run focused backfill tests",
    });
    expect(events[2]?.payload).toMatchObject({
      toolCallId: "call-1",
      toolName: "Bash",
      success: true,
      outputPreview: "ok",
    });
  });

  test("coalesces consecutive text and thinking chunks while preserving tool boundaries", () => {
    const events = buildOpenCodeBackfilledSessionEvents([
      baseNativeRow({ sequenceNum: 1, payload: { properties: { partID: "t", partType: "text", delta: "Hola" } } }),
      baseNativeRow({ sequenceNum: 2, payload: { properties: { partID: "t", partType: "text", delta: "Hola mundo" } } }),
      baseNativeRow({ sequenceNum: 3, payload: { properties: { partID: "r", partType: "reasoning", delta: "Pienso" } } }),
      baseNativeRow({ sequenceNum: 4, payload: { properties: { partID: "r", partType: "reasoning", delta: "Pienso bien" } } }),
    ]);

    expect(events.map((event) => [event.kind, event.payload])).toEqual([
      ["agent.text", expect.objectContaining({ content: "Hola mundo" })],
      ["agent.thinking", expect.objectContaining({ content: "Pienso bien" })],
    ]);
    expect(events.map((event) => event.sequenceNum)).toEqual([1, 2]);
  });
});
