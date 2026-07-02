import { describe, expect, test } from "bun:test";
import {
  agentProviderToAiProvider,
  defaultCodingAgentForProvider,
  getModelsForAgentProvider,
  getProvidersForAgent,
  isSingleProviderAgent,
} from "./coding-agent-compatibility";

describe("coding agent compatibility", () => {
  test("Claude Code accepts Anthropic and z.ai", () => {
    const providers = getProvidersForAgent("claude-code");
    expect(providers).toEqual(["claude-code", "zipu"]);
  });

  test("Codex is locked to OpenAI", () => {
    expect(getProvidersForAgent("codex")).toEqual(["codex"]);
    expect(isSingleProviderAgent("codex")).toBe(true);
  });

  test("OpenCode accepts OpenAI, z.ai and xAI", () => {
    expect(getProvidersForAgent("opencode")).toEqual(["codex", "zipu", "grok"]);
  });

  test("xAI-backed provider routes through OpenCode and resolves to xAI", () => {
    expect(defaultCodingAgentForProvider("grok")).toBe("opencode");
    expect(agentProviderToAiProvider("grok")).toBe("xai");
    expect(getProvidersForAgent("opencode")).toContain("grok");
  });

  test("Claude Code exposes the Claude 5 wave models in its catalog", () => {
    const modelIds = getModelsForAgentProvider("claude-code").map((m) => m.id);
    expect(modelIds).toContain("claude-opus-4-8");
    expect(modelIds).toContain("claude-fable-5");
    expect(modelIds).toContain("claude-sonnet-5");
    // Previous generation stays selectable for existing configs.
    expect(modelIds).toContain("claude-opus-4-7");
    expect(modelIds).toContain("claude-sonnet-4-6");
    expect(modelIds).toContain("claude-haiku-4-5");
  });

  test("Claude Code defaults to Opus 4.8 (first catalog entry), with Fable 5 selectable but not default", () => {
    const models = getModelsForAgentProvider("claude-code");
    // use-model-selector picks availableModels[0] as the default selection.
    expect(models[0]?.id).toBe("claude-opus-4-8");
    expect(models[0]?.category).toBe("best");

    const fable = models.find((m) => m.id === "claude-fable-5");
    expect(fable?.category).toBe("best");
    expect(models.findIndex((m) => m.id === "claude-fable-5")).toBeGreaterThan(0);
  });
});
