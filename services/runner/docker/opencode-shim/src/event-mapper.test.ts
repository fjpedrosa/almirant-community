import { describe, test, expect } from "bun:test";
import {
  mapOpenCodeEventToSse,
  createMappingContext,
  type OpenCodeMappingContext,
} from "./event-mapper.js";

const SESSION = "test-session";

const extractDeltas = (
  result: ReturnType<typeof mapOpenCodeEventToSse>,
): string[] =>
  result.events
    .filter(
      (e) =>
        e.type === "message.part.delta" &&
        (e.properties as Record<string, unknown>).contentType === "text",
    )
    .map((e) => (e.properties as Record<string, unknown>).delta as string);

const extractThinkingDeltas = (
  result: ReturnType<typeof mapOpenCodeEventToSse>,
): string[] =>
  result.events
    .filter(
      (e) =>
        e.type === "message.part.delta" &&
        (e.properties as Record<string, unknown>).contentType === "thinking",
    )
    .map((e) => (e.properties as Record<string, unknown>).delta as string);

describe("mapOpenCodeEventToSse", () => {
  // ---- Text dedup ----

  describe("text dedup", () => {
    test("emits incremental delta when text grows from previous snapshot", () => {
      const ctx = createMappingContext();
      const r1 = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello",
        partType: "text",
        partID: "p1",
      }, ctx);
      expect(extractDeltas(r1)).toEqual(["Hello"]);

      const r2 = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello world",
        partType: "text",
        partID: "p1",
      }, ctx);
      expect(extractDeltas(r2)).toEqual([" world"]);
    });

    test("emits message.part.updated when text is not a prefix of previous (reset)", () => {
      const ctx = createMappingContext();
      ctx.partSnapshots.set("p1", "Hello");

      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Goodbye",
        partType: "text",
        partID: "p1",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("message.part.updated");
      expect((r.events[0].properties as Record<string, unknown>).part).toEqual({ text: "Goodbye" });
    });

    test("does NOT emit when delta is unchanged (snapshot same as previous)", () => {
      const ctx = createMappingContext();
      ctx.partSnapshots.set("p1", "Hello");

      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello",
        partType: "text",
        partID: "p1",
      }, ctx);

      expect(r.events).toHaveLength(0);
    });

    test("handles first delta correctly (no previous snapshot)", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "First message",
        partType: "text",
        partID: "p1",
      }, ctx);

      expect(extractDeltas(r)).toEqual(["First message"]);
    });

    test("tracks snapshots per partId independently", () => {
      const ctx = createMappingContext();

      // Part 1: "Hello"
      mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello",
        partID: "p1",
        partType: "text",
      }, ctx);

      // Part 2: "World"
      mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "World",
        partID: "p2",
        partType: "text",
      }, ctx);

      // Part 1 grows: "Hello there" — should emit " there", not " thereWorld"
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello there",
        partID: "p1",
        partType: "text",
      }, ctx);

      expect(extractDeltas(r)).toEqual([" there"]);
    });

    test("multi-turn: resets snapshots on session.idle", () => {
      const ctx = createMappingContext();

      // Turn 1
      mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Turn 1 text",
        partID: "p1",
        partType: "text",
      }, ctx);

      expect(ctx.partSnapshots.size).toBe(1);

      // Session idle resets
      mapOpenCodeEventToSse(SESSION, "session.idle", {}, ctx);
      expect(ctx.partSnapshots.size).toBe(0);

      // Turn 2: fresh start
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Turn 2 text",
        partID: "p1",
        partType: "text",
      }, ctx);

      expect(extractDeltas(r)).toEqual(["Turn 2 text"]);
    });

    test("handles incremental deltas that are true incrementals (not snapshots)", () => {
      const ctx = createMappingContext();

      // If OpenCode sends true incremental deltas (not snapshots),
      // each delta is new content that doesn't start with the previous
      // snapshot. The mapper should emit it via message.part.updated.
      const r1 = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello",
        partID: "p1",
        partType: "text",
      }, ctx);
      expect(extractDeltas(r1)).toEqual(["Hello"]);

      // Second delta is " world" — does NOT start with "Hello"
      const r2 = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: " world",
        partID: "p1",
        partType: "text",
      }, ctx);

      // Falls through to message.part.updated (reset path)
      expect(r2.events).toHaveLength(1);
      expect(r2.events[0].type).toBe("message.part.updated");
    });
  });

  // ---- Thinking/reasoning ----

  describe("thinking/reasoning", () => {
    test("converts partType:'reasoning' to contentType:'thinking'", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Let me think...",
        partType: "reasoning",
        partID: "t1",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("message.part.delta");
      expect((r.events[0].properties as Record<string, unknown>).contentType).toBe("thinking");
    });

    test("applies snapshot dedup same as text", () => {
      const ctx = createMappingContext();

      mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Thinking step 1",
        partType: "reasoning",
        partID: "t1",
      }, ctx);

      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Thinking step 1. Now step 2.",
        partType: "reasoning",
        partID: "t1",
      }, ctx);

      expect(extractThinkingDeltas(r)).toEqual([". Now step 2."]);
    });
  });

  // ---- Normalization ----

  describe("normalization", () => {
    test("converts partType → contentType in all delta events", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "test",
        partType: "text",
        partID: "p1",
      }, ctx);

      const props = r.events[0].properties as Record<string, unknown>;
      expect(props.contentType).toBe("text");
      expect(props.partType).toBeUndefined();
    });

    test("normalizes sessionID → sessionId", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "test",
        partType: "text",
        partID: "p1",
        sessionID: "original-id",
      }, ctx);

      // The function uses the sessionId parameter, not the one from props
      const props = r.events[0].properties as Record<string, unknown>;
      expect(props.sessionId).toBe(SESSION);
    });

    test("passes session.idle as session.idle unchanged", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "session.idle", {}, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("session.idle");
    });

    test("passes question.asked with options correctly", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "question.asked", {
        text: "Choose a scope",
        options: [
          { label: "Small", description: "Quick fix" },
          "Custom",
        ],
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("question.asked");
      const props = r.events[0].properties as Record<string, unknown>;
      expect(props.text).toBe("Choose a scope");
      expect(props.options).toEqual(["Small::Quick fix", "Custom"]);
    });
  });

  // ---- Tool events ----

  describe("tool events", () => {
    test("converts tool_use partType to contentType:'tool_use'", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: '{"name":"Read","id":"tc-1"}',
        partType: "tool_use",
        partID: "tool1",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect((r.events[0].properties as Record<string, unknown>).contentType).toBe("tool_use");
    });

    test("emits message.part.updated for tool completion", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.updated", {
        part: { text: '{"name":"Read","id":"tc-1","input":{"file_path":"test.ts"}}' },
        partType: "tool_use",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("message.part.updated");
      expect((r.events[0].properties as Record<string, unknown>).contentType).toBe("tool_use");
    });
  });

  // ---- Edge cases ----

  describe("edge cases", () => {
    test("ignores events with empty delta", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "",
        partType: "text",
        partID: "p1",
      }, ctx);

      expect(r.events).toHaveLength(0);
    });

    test("does not crash with unknown event types", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "some.unknown.event", {
        foo: "bar",
      }, ctx);

      expect(r.events).toHaveLength(0);
    });

    test("handles missing partType gracefully (defaults to text)", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "no part type",
        partID: "p1",
      }, ctx);

      expect(extractDeltas(r)).toEqual(["no part type"]);
    });

    test("uses field as fallback for partType", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "reasoning text",
        field: "reasoning",
        partID: "p1",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect((r.events[0].properties as Record<string, unknown>).contentType).toBe("thinking");
    });

    test("resolves partId from messageID:field composite when partID missing", () => {
      const ctx = createMappingContext();

      // First event for msg1:text
      mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello",
        messageID: "msg1",
        field: "text",
      }, ctx);

      // Second event for same composite key — should diff
      const r = mapOpenCodeEventToSse(SESSION, "message.part.delta", {
        delta: "Hello world",
        messageID: "msg1",
        field: "text",
      }, ctx);

      expect(extractDeltas(r)).toEqual([" world"]);
    });

    test("session.status with type:'idle' triggers reset like session.idle", () => {
      const ctx = createMappingContext();
      ctx.partSnapshots.set("p1", "some content");

      const r = mapOpenCodeEventToSse(SESSION, "session.status", {
        type: "idle",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("session.idle");
      expect(ctx.partSnapshots.size).toBe(0);
    });

    test("session.status with type:'busy' passes through as status", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "session.status", {
        type: "busy",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("session.status");
      expect((r.events[0].properties as Record<string, unknown>).status).toBe("busy");
    });

    test("session.error maps to session.status with error", () => {
      const ctx = createMappingContext();
      const r = mapOpenCodeEventToSse(SESSION, "session.error", {
        message: "API rate limited",
      }, ctx);

      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe("session.status");
      expect((r.events[0].properties as Record<string, unknown>).status).toBe("error");
      expect((r.events[0].properties as Record<string, unknown>).message).toBe("API rate limited");
    });
  });
});
