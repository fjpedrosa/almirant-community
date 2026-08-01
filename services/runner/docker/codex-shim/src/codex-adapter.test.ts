import { describe, expect, it } from "bun:test";
import type { NativeRuntimeEvent } from "@almirant/shim-server";
import {
  CodexAdapter,
  normalizeCodexReasoningEffort,
  TOOL_CANONICAL_KINDS,
} from "./codex-adapter";

describe("TOOL_CANONICAL_KINDS", () => {
  it("includes the existing tool/file/bash kinds", () => {
    expect(TOOL_CANONICAL_KINDS.has("agent.tool_call.start")).toBe(true);
    expect(TOOL_CANONICAL_KINDS.has("agent.tool_call.result")).toBe(true);
    expect(TOOL_CANONICAL_KINDS.has("agent.bash.execute")).toBe(true);
    expect(TOOL_CANONICAL_KINDS.has("agent.bash.output")).toBe(true);
    expect(TOOL_CANONICAL_KINDS.has("agent.file.read")).toBe(true);
    expect(TOOL_CANONICAL_KINDS.has("agent.file.write")).toBe(true);
    expect(TOOL_CANONICAL_KINDS.has("agent.file.edit")).toBe(true);
  });

  it("includes subagent kinds defensively so future SDK surfacings are not dropped", () => {
    expect(TOOL_CANONICAL_KINDS.has("agent.subagent.spawn")).toBe(true);
    expect(TOOL_CANONICAL_KINDS.has("agent.subagent.complete")).toBe(true);
  });

  it("does not include text/thinking/lifecycle kinds (those flow through the SSE path)", () => {
    expect(TOOL_CANONICAL_KINDS.has("agent.text")).toBe(false);
    expect(TOOL_CANONICAL_KINDS.has("agent.text.complete")).toBe(false);
    expect(TOOL_CANONICAL_KINDS.has("agent.thinking")).toBe(false);
    expect(TOOL_CANONICAL_KINDS.has("session.idle")).toBe(false);
  });
});

describe("normalizeCodexReasoningEffort", () => {
  it("accepts exactly the ModelReasoningEffort values from codex-sdk 0.144.4", () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh"] as const) {
      expect(normalizeCodexReasoningEffort(effort)).toBe(effort);
    }
  });

  it("does not silently translate unsupported none or max values", () => {
    expect(normalizeCodexReasoningEffort("none")).toBeUndefined();
    expect(normalizeCodexReasoningEffort("max")).toBeUndefined();
    expect(normalizeCodexReasoningEffort("min")).toBeUndefined();
  });
});

describe("CodexAdapter native event subscription", () => {
  // The Codex client constructor reads ~/.codex/auth.json or OPENAI_API_KEY.
  // Set a stub so instantiation doesn't reject (the promise is lazy: it is
  // awaited only when sendPrompt is called, which we don't test here).
  process.env.OPENAI_API_KEY ??= "test-stub-key";

  it("exposes onNativeEvent and lets listeners subscribe and unsubscribe", () => {
    const adapter = new CodexAdapter();

    const received: NativeRuntimeEvent[] = [];
    const unsubscribe = adapter.onNativeEvent!((event) => {
      received.push(event);
    });

    expect(typeof unsubscribe).toBe("function");

    // Sanity: unsubscribe really removes the listener (no throw, idempotent).
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("declares onNativeEvent as part of the RuntimeAdapter contract", () => {
    const adapter = new CodexAdapter();
    expect(typeof adapter.onNativeEvent).toBe("function");
    expect(typeof adapter.onCanonicalEvent).toBe("function");
    expect(typeof adapter.onEvent).toBe("function");
  });
});
