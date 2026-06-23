import { describe, expect, it } from "bun:test";
import { getAiProvidersForScheduledRuntime } from "./types";

describe("getAiProvidersForScheduledRuntime", () => {
  it("derives providers from the coding agent (Claude Code → Anthropic + z.ai)", () => {
    expect(getAiProvidersForScheduledRuntime(undefined, "claude-code")).toEqual([
      "anthropic",
      "zai",
    ]);
  });

  it("returns OpenAI as the only provider for Codex", () => {
    expect(getAiProvidersForScheduledRuntime(undefined, "codex")).toEqual(["openai"]);
  });

  it("offers OpenAI, z.ai and xAI for OpenCode", () => {
    expect(getAiProvidersForScheduledRuntime(undefined, "opencode")).toEqual([
      "openai",
      "zai",
      "xai",
    ]);
  });

  it("ignores the legacy agent provider field once a coding agent is chosen", () => {
    expect(getAiProvidersForScheduledRuntime("zipu", "opencode")).toEqual([
      "openai",
      "zai",
      "xai",
    ]);
    expect(getAiProvidersForScheduledRuntime("grok", "opencode")).toEqual([
      "openai",
      "zai",
      "xai",
    ]);
  });

  it("returns an empty list when no coding agent is selected", () => {
    expect(getAiProvidersForScheduledRuntime(undefined, undefined)).toEqual([]);
  });
});
