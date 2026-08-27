import { describe, expect, it } from "bun:test";
import {
  AI_PROVIDER_OPTIONS,
  CODING_AGENT_OPTIONS,
  getAiProvidersForScheduledRuntime,
  getModelsForScheduledRuntime,
  normalizeScheduledCodingAgent,
  type AIProvider,
} from "./types";

describe("getAiProvidersForScheduledRuntime", () => {
  it("derives canonical selection options from admitted tuples only", () => {
    const google: AIProvider = "google";

    expect(CODING_AGENT_OPTIONS.map((option) => option.value)).toEqual([
      "claude-code",
      "codex",
      "opencode",
      "pi",
    ]);
    expect(CODING_AGENT_OPTIONS.map((option) => option.value)).not.toContain("codex-cli");
    expect(AI_PROVIDER_OPTIONS.map((option) => option.value)).toEqual([
      "anthropic",
      "openai",
      "zai",
      "xai",
    ]);
    expect(AI_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain(google);
  });

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

  it("offers only Z.AI for Pi and keeps Google unavailable", () => {
    expect(normalizeScheduledCodingAgent("pi")).toBe("pi");
    expect(getAiProvidersForScheduledRuntime(undefined, "pi")).toEqual(["zai"]);
    expect(
      getModelsForScheduledRuntime("pi", "zai").map((model) => model.value),
    ).toEqual(["glm-5.3"]);
    expect(getModelsForScheduledRuntime("pi", "google")).toEqual([]);
  });

  it("keeps codex-cli as legacy normalization rather than a canonical option", () => {
    expect(normalizeScheduledCodingAgent("codex-cli")).toBe("codex");
    expect(getAiProvidersForScheduledRuntime(undefined, "codex-cli")).toEqual([]);
  });
});

describe("getModelsForScheduledRuntime", () => {
  it("preserves the Claude catalog ordering and default", () => {
    expect(
      getModelsForScheduledRuntime("claude-code", "anthropic").map(
        (model) => model.value,
      ),
    ).toEqual([
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-opus-4-7",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
  });

  it("preserves the Codex and OpenCode model ordering and defaults", () => {
    const openAiModels = [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.3-codex",
      "gpt-4.1",
      "gpt-4.1-mini",
    ];

    expect(
      getModelsForScheduledRuntime("codex", "openai").map((model) => model.value),
    ).toEqual(openAiModels);
    expect(
      getModelsForScheduledRuntime("opencode", "openai").map(
        (model) => model.value,
      ),
    ).toEqual(openAiModels);
  });
});
