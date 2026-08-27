import { describe, expect, it } from "bun:test";
import {
  collectScheduledAgentConnectionRuntimes,
  collectScheduledAgentEffectiveModels,
  normalizeScheduledAgentModel,
  resolveScheduledAgentAiProvider,
} from "./scheduled-connection-runtime";

const connection = (config: Record<string, unknown>) => ({ config });

describe("scheduled connection runtime", () => {
  it("keeps each stage model/reasoning pair on the connection that supplied it", () => {
    expect(collectScheduledAgentConnectionRuntimes({
      aiProvider: "zai",
      jobType: "implementation",
      connections: [
        connection({
          implementationModel: "glm-5.2",
          implementationReasoningBudget: "max",
        }),
        connection({
          implementationModel: "glm-5.1",
          implementationReasoningBudget: null,
        }),
      ],
    })).toEqual([
      { model: "glm-5.2", reasoningLevel: "max" },
      { model: "glm-5.1", reasoningLevel: null },
    ]);
  });

  it("uses the same validation-to-implementation fallback within one connection", () => {
    expect(collectScheduledAgentConnectionRuntimes({
      aiProvider: "anthropic",
      jobType: "validation",
      connections: [connection({
        implementationModel: "claude-opus-4-8",
        implementationReasoningBudget: "high",
      })],
    })).toEqual([{ model: "claude-opus-4-8", reasoningLevel: "high" }]);
  });

  it("leaves a missing connection model absent so precedence owns Community defaults", () => {
    expect(collectScheduledAgentConnectionRuntimes({
      aiProvider: "openai",
      jobType: "implementation",
      connections: [connection({})],
    })).toEqual([{ reasoningLevel: null }]);

    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "openai",
      jobType: "implementation",
      connections: [connection({})],
    })).toEqual(["gpt-5.6-sol"]);
    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "anthropic",
      jobType: "implementation",
      connections: [connection({})],
    })).toEqual(["claude-opus-4-8"]);
    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "zai",
      jobType: "implementation",
      connections: [connection({})],
    })).toEqual(["glm-5.2"]);
  });

  it("delegates missing provider compatibility to the named legacy adapter", () => {
    expect(resolveScheduledAgentAiProvider({ provider: "codex" })).toBe("openai");
    expect(resolveScheduledAgentAiProvider({ provider: "zipu" })).toBe("zai");
  });

  it("keeps explicit AI providers and model IDs exact", () => {
    expect(resolveScheduledAgentAiProvider({
      provider: "claude-code",
      aiProvider: "Google",
    })).toBe("Google");
    expect(normalizeScheduledAgentModel("GLM-5.2")).toBe("GLM-5.2");
    expect(normalizeScheduledAgentModel("  glm-5.2  ")).toBe("  glm-5.2  ");
    expect(normalizeScheduledAgentModel(" ")).toBeNull();
  });
});
