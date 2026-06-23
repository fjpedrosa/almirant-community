import { describe, expect, it } from "bun:test";
import { resolveRuntime } from "./runtime-selection";

describe("resolveRuntime", () => {
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
