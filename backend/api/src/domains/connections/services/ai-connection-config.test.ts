import { describe, expect, it } from "bun:test";
import {
  normalizeAiConnectionConfig,
  ZAI_CODING_PLAN_BASE_URL,
} from "./ai-connection-config";

describe("normalizeAiConnectionConfig", () => {
  it("canonicalizes a Z.AI Coding Plan connection and its entitled models", () => {
    expect(normalizeAiConnectionConfig({
      provider: "zai",
      category: "ai",
      config: {
        zaiPlan: "coding",
        baseUrl: `${ZAI_CODING_PLAN_BASE_URL}/`,
        planningModel: " GLM-5.2 ",
        implementationModel: "glm-5.1",
        planningReasoningBudget: "MAX",
      },
    })).toMatchObject({
      zaiPlan: "coding",
      baseUrl: ZAI_CODING_PLAN_BASE_URL,
      planningModel: "glm-5.2",
      implementationModel: "glm-5.1",
      planningReasoningBudget: "max",
    });
  });

  it.each([
    ["API-only VLM", { implementationModel: "glm-5v-turbo" }],
    ["unknown slug", { implementationModel: "totally-not-a-model" }],
    ["wrong plan", { zaiPlan: "general", implementationModel: "glm-5.2" }],
    ["wrong endpoint", { baseUrl: "https://api.z.ai/v1", implementationModel: "glm-5.2" }],
    ["unsupported effort", { implementationModel: "glm-5.1", implementationReasoningBudget: "max" }],
  ])("rejects %s even for a direct API client", (_label, config) => {
    expect(() => normalizeAiConnectionConfig({
      provider: "zai",
      category: "ai",
      config,
    })).toThrow(/invalid ai connection config/i);
  });

  it("rejects incompatible GPT and Haiku reasoning values", () => {
    expect(() => normalizeAiConnectionConfig({
      provider: "openai",
      category: "ai",
      config: {
        implementationModel: "gpt-5.5-pro",
        implementationReasoningBudget: "low",
      },
    })).toThrow(/reasoning/i);

    expect(() => normalizeAiConnectionConfig({
      provider: "anthropic",
      category: "ai",
      config: {
        validationModel: "claude-haiku-4-5",
        validationReasoningBudget: "high",
      },
    })).toThrow(/reasoning/i);
  });

  it("leaves non-AI connection metadata untouched", () => {
    expect(normalizeAiConnectionConfig({
      provider: "github",
      category: "code",
      config: { arbitrary: true },
    })).toEqual({ arbitrary: true });
  });
});
