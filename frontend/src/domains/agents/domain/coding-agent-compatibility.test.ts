import { describe, expect, test } from "bun:test";
import {
  agentProviderToAiProvider,
  defaultCodingAgentForProvider,
  getModelsForAgentProvider,
  getProvidersForAgent,
  isSingleProviderAgent,
} from "./coding-agent-compatibility";
import { getModelsForProvider } from "@/lib/ai-models-catalog";

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
    expect(modelIds).toContain("claude-sonnet-5");
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

  test("Codex exposes the GPT-5.6 family and defaults to Sol", () => {
    const models = getModelsForAgentProvider("codex");
    expect(models.slice(0, 3).map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
  });

  test("z.ai agent runtimes expose the Coding Plan entitlement, not API-only VLMs", () => {
    const codingPlanModelIds = getModelsForAgentProvider("zipu").map((model) => model.id);

    expect(codingPlanModelIds).toEqual([
      "glm-5.2",
      "glm-5.1",
      "glm-5",
      "glm-5-turbo",
      "glm-4.7",
      "glm-4.6",
      "glm-4.5",
      "glm-4.5-air",
    ]);
    expect(codingPlanModelIds).not.toContain("glm-5v-turbo");

    const generalApiVlm = getModelsForProvider("zai").find(
      (model) => model.id === "glm-5v-turbo",
    );
    expect(generalApiVlm?.accessChannels).toEqual(["general-api"]);
  });
});
