import { describe, expect, it } from "bun:test";
import {
  getAgentModelReasoningEfforts,
  getAgentModels,
  getDefaultAgentModel,
  normalizeAgentModel,
} from "./model-capabilities";

const expectedModels = {
  anthropic: [
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-fable-5",
    "claude-opus-4-7",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-5",
  ],
  openai: [
    "gpt-5.6",
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
  ],
  google: [
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
  zai: [
    "glm-5.3",
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "glm-5-turbo",
    "glm-4.7",
    "glm-4.6",
    "glm-4.5",
    "glm-4.5-air",
  ],
  xai: [
    "grok-4.3",
    "grok-4.20-reasoning",
    "grok-4.20-multi-agent",
    "grok-4.20",
    "grok-build-0.1",
  ],
} as const;

const expectedDefaults = {
  anthropic: "claude-opus-5",
  openai: "gpt-5.6-sol",
  google: "gemini-3.1-pro-preview",
  zai: "glm-5.2",
  xai: "grok-4.3",
} as const;

const expectedReasoningEfforts = (
  provider: keyof typeof expectedModels,
  model: string,
): readonly string[] => {
  if (provider === "openai") {
    if (model === "gpt-5.5-pro" || model === "gpt-5.4-pro") {
      return ["medium", "high", "xhigh"];
    }
    if (
      [
        "gpt-5.6",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5.3-codex",
      ].includes(model)
    ) {
      return ["low", "medium", "high", "xhigh"];
    }
  }

  if (provider === "anthropic") {
    if (model === "claude-opus-4-6" || model === "claude-sonnet-4-6") {
      return ["low", "medium", "high", "max"];
    }
    if (
      [
        "claude-fable-5",
        "claude-opus-5",
        "claude-opus-4-7",
        "claude-opus-4-8",
        "claude-sonnet-5",
      ].includes(model)
    ) {
      return ["low", "medium", "high", "xhigh", "max"];
    }
  }

  if (provider === "zai" && (model === "glm-5.3" || model === "glm-5.2")) {
    return ["high", "max"];
  }

  return [];
};

describe("agent model capabilities legacy facade", () => {
  it("preserves every Community provider catalog and default while adding GLM-5.3", () => {
    for (const provider of Object.keys(expectedModels) as Array<
      keyof typeof expectedModels
    >) {
      expect(getAgentModels(provider)).toEqual(expectedModels[provider]);
      expect(getDefaultAgentModel(provider)).toBe(expectedDefaults[provider]);
    }
  });

  it("preserves reasoning behavior for every provider/model pair", () => {
    for (const provider of Object.keys(expectedModels) as Array<
      keyof typeof expectedModels
    >) {
      for (const model of expectedModels[provider]) {
        expect(getAgentModelReasoningEfforts(provider, model)).toEqual(
          expectedReasoningEfforts(provider, model),
        );
      }
    }
  });

  it("keeps lowercasing and provider aliases only for legacy callers", () => {
    expect(normalizeAgentModel("zai", "  GLM-5.3 ")).toBe("glm-5.3");
    expect(normalizeAgentModel("zipu", "  GLM-5.2 ")).toBe("glm-5.2");
    expect(normalizeAgentModel("openai", "GPT-5.6-SOL")).toBe("gpt-5.6-sol");
    expect(normalizeAgentModel("grok", "GROK-4.3")).toBe("grok-4.3");
    expect(normalizeAgentModel("zai", "glm-5v-turbo")).toBeNull();
    expect(normalizeAgentModel("zai", "totally-not-a-model")).toBeNull();
  });

  it("returns null or an empty catalog for unknown legacy values", () => {
    expect(getDefaultAgentModel("unknown")).toBeNull();
    expect(getAgentModels("unknown")).toEqual([]);
    expect(getAgentModelReasoningEfforts("zai", "unknown")).toBeNull();
  });
});
