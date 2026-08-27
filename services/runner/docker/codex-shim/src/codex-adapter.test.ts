import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import os from "node:os";
import type { NativeRuntimeEvent } from "@almirant/shim-server";

// The duplicate legacy shim is intentionally outside the root workspace, so a
// focused source-tree contract must not read a developer credential store or
// require an installer. Runtime execution is not exercised in this unit: mock
// only the SDK constructor boundary before loading the adapter.
const isolatedHome = "/nonexistent/almirant-codex-adapter-test-home";
const isolatedHomedir = (): string => isolatedHome;
mock.module("node:os", () => ({
  ...os,
  default: { ...os, homedir: isolatedHomedir },
  homedir: isolatedHomedir,
}));
mock.module("@openai/codex-sdk", () => ({
  Codex: class CodexStub {
    public startThread(): never {
      throw new Error("Codex SDK execution is outside this legacy contract test");
    }
  },
}));

const {
  CodexAdapter,
  normalizeCodexReasoningEffort,
  TOOL_CANONICAL_KINDS,
} = await import("./codex-adapter.js");

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
  it("accepts exactly the ModelReasoningEffort values from codex-sdk 0.145.0", () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh"] as const) {
      expect(normalizeCodexReasoningEffort(effort)).toBe(effort);
    }
  });

  it("fails closed for unsupported Pi-only reasoning selections", () => {
    expect(normalizeCodexReasoningEffort("off")).toBeUndefined();
    expect(normalizeCodexReasoningEffort("none")).toBeUndefined();
    expect(normalizeCodexReasoningEffort("max")).toBeUndefined();
    expect(normalizeCodexReasoningEffort("min")).toBeUndefined();
    expect(normalizeCodexReasoningEffort("arbitrary")).toBeUndefined();
  });
});

const restoreEnv = (
  name: "HOME" | "OPENAI_API_KEY" | "OPENAI_BASE_URL",
  value: string | undefined,
): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

describe("CodexAdapter native event subscription", () => {
  let originalHome: string | undefined;
  let originalOpenAiApiKey: string | undefined;
  let originalOpenAiBaseUrl: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    originalOpenAiBaseUrl = process.env.OPENAI_BASE_URL;

    // Never read a developer's Codex credential store. The loopback-only stub
    // also makes any accidental future provider call fail closed.
    process.env.HOME = isolatedHome;
    process.env.OPENAI_API_KEY = "test-stub-key";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:9";
  });

  afterEach(() => {
    restoreEnv("HOME", originalHome);
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey);
    restoreEnv("OPENAI_BASE_URL", originalOpenAiBaseUrl);
  });

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
