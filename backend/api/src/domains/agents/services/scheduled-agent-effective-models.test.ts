import { describe, expect, it } from "bun:test";
import {
  collectScheduledAgentConnectionRuntimes,
  collectScheduledAgentEffectiveModels,
} from "./scheduled-agent-effective-models";

const connection = (config: Record<string, unknown>) => ({ config });

describe("collectScheduledAgentEffectiveModels", () => {
  it("collects every model that an organization connection may supply", () => {
    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "zai",
      jobType: "implementation",
      connections: [
        connection({ implementationModel: "glm-5.2" }),
        connection({ implementationModel: "glm-5v-turbo" }),
      ],
    })).toEqual(["glm-5.2", "glm-5v-turbo"]);
  });

  it("uses the same stage fallback order as the runner", () => {
    const connections = [connection({
      planningModel: "claude-opus-4-7",
      implementationModel: "claude-opus-4-8",
      validationModel: "claude-sonnet-5",
    })];

    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "anthropic",
      jobType: "planning",
      connections,
    })).toEqual(["claude-opus-4-7"]);
    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "anthropic",
      jobType: "validation",
      connections,
    })).toEqual(["claude-sonnet-5"]);
  });

  it("falls back to implementation and then the provider default", () => {
    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "zai",
      jobType: "validation",
      connections: [connection({ implementationModel: "glm-5.1" })],
    })).toEqual(["glm-5.1"]);
    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "zai",
      jobType: "implementation",
      connections: [connection({})],
    })).toEqual(["glm-5.2"]);
  });

  it("returns no model when there is no active connection so callers fail closed", () => {
    expect(collectScheduledAgentEffectiveModels({
      aiProvider: "zai",
      jobType: "implementation",
      connections: [],
    })).toEqual([]);
  });

  it("resolves the model and reasoning from the same job-stage connection config", () => {
    expect(collectScheduledAgentConnectionRuntimes({
      aiProvider: "zai",
      jobType: "implementation",
      connections: [connection({
        implementationModel: "glm-5.1",
        implementationReasoningBudget: null,
        planningModel: "glm-5.2",
        planningReasoningBudget: "max",
      })],
    })).toEqual([{ model: "glm-5.1", reasoningLevel: null }]);
    expect(collectScheduledAgentConnectionRuntimes({
      aiProvider: "zai",
      jobType: "planning",
      connections: [connection({
        implementationModel: "glm-5.1",
        planningModel: "glm-5.2",
        planningReasoningBudget: "max",
      })],
    })).toEqual([{ model: "glm-5.2", reasoningLevel: "max" }]);
  });
});
