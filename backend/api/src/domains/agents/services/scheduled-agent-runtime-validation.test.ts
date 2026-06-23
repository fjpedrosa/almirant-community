import { describe, expect, it } from "bun:test";
import { assertValidScheduledAgentRuntime } from "./scheduled-agent-runtime-validation";

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
        aiProvider: "zai",
        aiModel: "glm-5.1",
      }),
    ).not.toThrow();
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
});
