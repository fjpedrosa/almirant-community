import { describe, expect, it } from "bun:test";
import { resolveScheduledRuntimePrecedence } from "./scheduled-runtime-precedence";

describe("resolveScheduledRuntimePrecedence", () => {
  it("uses rule, schedule, work-item, project and connection sources in execution order", () => {
    expect(resolveScheduledRuntimePrecedence({
      rule: { model: "glm-5.2" },
      schedule: { aiProvider: "zai", model: "glm-5.1", reasoningLevel: "high" },
      workItem: { model: "claude-sonnet-5" },
      project: { model: "gpt-5.5" },
      connection: { model: "gpt-5.6-terra" },
    })).toMatchObject({ model: "glm-5.2", aiProvider: "zai", reasoningLevel: "high" });

    expect(resolveScheduledRuntimePrecedence({
      workItem: { model: "claude-sonnet-5" },
      project: { codingAgent: "codex", aiProvider: "openai", model: "gpt-5.5" },
      connection: { aiProvider: "zai", model: "glm-5.1" },
    })).toMatchObject({ model: "claude-sonnet-5" });

    expect(resolveScheduledRuntimePrecedence({
      project: { codingAgent: "codex", aiProvider: "openai", model: "gpt-5.5", reasoningLevel: "high" },
      connection: { codingAgent: "opencode", aiProvider: "zai", model: "glm-5.1", reasoningLevel: "max" },
    })).toMatchObject({
      codingAgent: "codex",
      aiProvider: "openai",
      provider: "codex",
      model: "gpt-5.5",
      reasoningLevel: "high",
    });
  });

  it("inherits the job-stage connection model and reasoning when no higher source exists", () => {
    expect(resolveScheduledRuntimePrecedence({
      schedule: { codingAgent: "opencode", aiProvider: "zai" },
      connection: { model: "glm-5.1", reasoningLevel: null },
    })).toEqual({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.1",
      reasoningLevel: null,
    });
  });
});
