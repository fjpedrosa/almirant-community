import { describe, expect, it } from "bun:test";
import {
  assertValidScheduledAgentRuntime,
  canonicalizeAiModelForStorage,
  normalizePersistedScheduledAgentRuntime,
} from "./scheduled-agent-runtime-validation";

describe("assertValidScheduledAgentRuntime", () => {
  it("rejects Z.ai models under the Codex/OpenAI provider", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "codex",
        aiProvider: "zai",
        aiModel: "glm-5.1",
      }),
    ).toThrow(/aiProvider 'zai' requires provider 'zipu'/);
  });

  it("rejects inferred GLM models when aiProvider is omitted but provider is OpenAI", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "codex",
        aiModel: "glm-5.1",
      }),
    ).toThrow(/model 'glm-5.1' belongs to aiProvider 'zai'/);
  });

  it("accepts a coherent Z.ai/OpenCode runtime", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "glm-5.1",
      }),
    ).not.toThrow();
  });

  it("rejects coding-agent/provider combinations outside the runtime matrix", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "zipu",
        codingAgent: "codex",
        aiProvider: "zai",
        aiModel: "glm-5.2",
      }),
    ).toThrow(/codingAgent 'codex' is not compatible with provider 'zipu'/);
  });

  it("accepts every documented provider/coding-agent combination", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-opus-4-8",
    })).not.toThrow();
    expect(() => assertValidScheduledAgentRuntime({
      provider: "codex",
      codingAgent: "opencode",
      aiProvider: "openai",
      aiModel: "gpt-5.6-sol",
    })).not.toThrow();
    expect(() => assertValidScheduledAgentRuntime({
      provider: "grok",
      codingAgent: "opencode",
      aiProvider: "xai",
      aiModel: "grok-4.3",
    })).not.toThrow();
  });

  it("validates reasoning effort against the effective OpenAI model", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      reasoningLevel: "high",
    })).toThrow(/reasoningLevel 'high' is not supported by model 'gpt-4.1'/);

    expect(() => assertValidScheduledAgentRuntime({
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-5.5-pro",
      reasoningLevel: "low",
    })).toThrow(/reasoningLevel 'low' is not supported by model 'gpt-5.5-pro'/);

    expect(() => assertValidScheduledAgentRuntime({
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-5.5-pro",
      reasoningLevel: "high",
    })).not.toThrow();
  });

  it("continues to reject a newly submitted Haiku reasoning level", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-haiku-4-5",
      reasoningLevel: "low",
    })).toThrow(/reasoningLevel 'low' is not supported by model 'claude-haiku-4-5'/);
  });

  it("does not reinterpret none or minimal for current Codex models", () => {
    for (const reasoningLevel of ["none", "minimal"]) {
      expect(() => assertValidScheduledAgentRuntime({
        provider: "codex",
        codingAgent: "codex",
        aiProvider: "openai",
        aiModel: "gpt-5.6-sol",
        reasoningLevel,
      })).toThrow(new RegExp(`reasoningLevel '${reasoningLevel}' is not supported`));
    }
  });

  it("validates reasoning for Z.AI Coding Plan models", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: "glm-5.2",
      reasoningLevel: "max",
    })).not.toThrow();

    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: "glm-5.1",
      reasoningLevel: "high",
    })).toThrow(/reasoningLevel 'high' is not supported by model 'glm-5.1'/);
  });

  it("validates every possible inherited connection model and fails closed", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      effectiveAiModels: ["glm-5.2", "glm-5v-turbo"],
    })).toThrow(/model 'glm-5v-turbo' is not available through the Z\.AI Coding Plan/);

    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      effectiveAiModels: [],
    })).toThrow(/could not resolve an effective model/i);
  });

  it("accepts GLM-5.2 from the Z.AI Coding Plan", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "zipu",
        aiProvider: "zai",
        aiModel: "glm-5.2",
      }),
    ).not.toThrow();
  });

  it("rejects GLM-5V-Turbo because it is a general API model, not a Coding Plan entitlement", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "zipu",
        aiProvider: "zai",
        aiModel: "glm-5v-turbo",
      }),
    ).toThrow(/not available through the Z\.AI Coding Plan/);
  });

  it("fails closed for an explicit model slug absent from the provider entitlement", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "totally-not-a-model",
      }),
    ).toThrow(/unknown|not available|unsupported/i);
  });

  it("validates backlog-style project rule model overrides against the top-level provider", () => {
    expect(() =>
      assertValidScheduledAgentRuntime({
        provider: "codex",
        targetConfig: {
          dodRemediation: {
            enabled: true,
            projects: [
              {
                projectId: "project-1",
                model: "glm-5.1",
              },
            ],
          },
        },
      }),
    ).toThrow(/targetConfig\.dodRemediation\.projects\[0\]/);
  });

  it("validates coding agent and reasoning in backlog-style project overrides", () => {
    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      aiProvider: "zai",
      aiModel: "glm-5.2",
      targetConfig: {
        backlogDrain: {
          enabled: true,
          projects: [{
            projectId: "project-1",
            codingAgent: "codex",
            aiProvider: "zai",
            model: "glm-5.2",
          }],
        },
      },
    })).toThrow(/targetConfig\.backlogDrain\.projects\[0\].*codingAgent 'codex'/);

    expect(() => assertValidScheduledAgentRuntime({
      provider: "zipu",
      aiProvider: "zai",
      aiModel: "glm-5.2",
      targetConfig: {
        backlogDrain: {
          enabled: true,
          projects: [{
            projectId: "project-1",
            codingAgent: "opencode",
            aiProvider: "zai",
            model: "glm-5.1",
            reasoningLevel: "max",
          }],
        },
      },
    })).toThrow(/targetConfig\.backlogDrain\.projects\[0\].*reasoningLevel 'max'/);
  });
});

describe("canonicalizeAiModelForStorage", () => {
  it("lowercases a model stored with display-name casing (the GLM-5.2 bug)", () => {
    expect(canonicalizeAiModelForStorage("GLM-5.2")).toBe("glm-5.2");
    expect(canonicalizeAiModelForStorage("GPT-5.4")).toBe("gpt-5.4");
  });

  it("trims surrounding whitespace", () => {
    expect(canonicalizeAiModelForStorage("  glm-5.2  ")).toBe("glm-5.2");
  });

  it("leaves an already-canonical id unchanged", () => {
    expect(canonicalizeAiModelForStorage("glm-5.2")).toBe("glm-5.2");
  });

  it("returns null for empty or nullish values", () => {
    expect(canonicalizeAiModelForStorage("")).toBeNull();
    expect(canonicalizeAiModelForStorage("   ")).toBeNull();
    expect(canonicalizeAiModelForStorage(null)).toBeNull();
    expect(canonicalizeAiModelForStorage(undefined)).toBeNull();
  });
});

describe("normalizePersistedScheduledAgentRuntime", () => {
  it("omits a legacy Haiku reasoning level while retaining the selected runtime", () => {
    expect(normalizePersistedScheduledAgentRuntime({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-haiku-4-5",
      reasoningLevel: "low",
    })).toEqual({
      runtime: {
        provider: "claude-code",
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        aiModel: "claude-haiku-4-5",
        reasoningLevel: undefined,
      },
      omittedReasoningLevels: [{
        model: "claude-haiku-4-5",
        aiProvider: "anthropic",
        reasoningLevel: "low",
      }],
    });
  });

  it("keeps a supported effort unchanged", () => {
    expect(normalizePersistedScheduledAgentRuntime({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-sonnet-5",
      reasoningLevel: "low",
    }).runtime.reasoningLevel).toBe("low");
  });
});
