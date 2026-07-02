import { describe, expect, it } from "bun:test";
import { resolveRuntime } from "./runtime-selection";

describe("resolveRuntime", () => {
  it("defaults claude-code to Anthropic with claude-opus-4-8 as default model", () => {
    expect(resolveRuntime({})).toEqual({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
    });
  });

  it("accepts anthropic as an alias for the claude-code runtime with the same default model", () => {
    expect(resolveRuntime({ provider: "anthropic" })).toEqual({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
    });
  });

  it("keeps the codex default model untouched", () => {
    expect(resolveRuntime({ provider: "codex" }).model).toBe("gpt-5.5");
  });

  it("keeps the zipu default model untouched", () => {
    expect(resolveRuntime({ provider: "zipu" }).model).toBe("glm-5.1");
  });

  it("maps grok provider to OpenCode over xAI with the current Grok coding default", () => {
    expect(resolveRuntime({ provider: "grok" })).toEqual({
      provider: "grok",
      codingAgent: "opencode",
      aiProvider: "xai",
      model: "grok-4.20-reasoning",
    });
  });

  it("accepts xai as an alias for the grok OpenCode runtime", () => {
    expect(resolveRuntime({ provider: "xai", model: "grok-4.20-reasoning" })).toEqual({
      provider: "grok",
      codingAgent: "opencode",
      aiProvider: "xai",
      model: "grok-4.20-reasoning",
    });
  });
});
