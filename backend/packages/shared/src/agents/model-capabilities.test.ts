import { describe, expect, it } from "bun:test";
import {
  getAgentModelReasoningEfforts,
  getDefaultAgentModel,
  normalizeAgentModel,
} from "./model-capabilities";

describe("agent model capabilities", () => {
  it("canonicalizes exact entitled model slugs and rejects unknown models", () => {
    expect(normalizeAgentModel("zai", "  GLM-5.2 ")).toBe("glm-5.2");
    expect(normalizeAgentModel("openai", "GPT-5.6-SOL")).toBe("gpt-5.6-sol");
    expect(normalizeAgentModel("zai", "glm-5v-turbo")).toBeNull();
    expect(normalizeAgentModel("zai", "totally-not-a-model")).toBeNull();
  });

  it("keeps defaults and reasoning efforts model-specific", () => {
    expect(getDefaultAgentModel("zai")).toBe("glm-5.2");
    expect(getAgentModelReasoningEfforts("zai", "glm-5.2")).toEqual(["high", "max"]);
    expect(getAgentModelReasoningEfforts("zai", "glm-5.1")).toEqual([]);
    expect(getAgentModelReasoningEfforts("openai", "gpt-5.5-pro")).toEqual([
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getAgentModelReasoningEfforts("anthropic", "claude-haiku-4-5")).toEqual([]);
    expect(getAgentModelReasoningEfforts("zai", "unknown")).toBeNull();
  });
});
