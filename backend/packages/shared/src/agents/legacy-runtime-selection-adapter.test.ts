import { describe, expect, it } from "bun:test";
import {
  normalizeLegacyCodingAgentAlias,
  resolveLegacyRunnerCodingAgent,
  resolveLegacyRuntimeSelection,
} from "./legacy-runtime-selection-adapter";

describe("legacy runtime selection adapter", () => {
  it("owns coding-agent lowercasing and the codex-cli alias", () => {
    expect(normalizeLegacyCodingAgentAlias("CODEX-CLI")).toBe("codex");
    expect(normalizeLegacyCodingAgentAlias("OpenCode")).toBe("opencode");
  });

  it("keeps the Community Zipu legacy selection on OpenCode and GLM-5.2", () => {
    expect(resolveLegacyRuntimeSelection({ provider: "ZAI" })).toEqual({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
    });
  });

  it("preserves the runner's independent provider-only dispatch history", () => {
    const cases = [
      ["claude-code", "claude-code"],
      ["anthropic", "claude-code"],
      ["zipu", "claude-code"],
      [" ZAI ", "claude-code"],
      ["codex", "codex"],
      ["openai", "codex"],
      ["grok", "opencode"],
      ["xai", "opencode"],
    ] as const;

    for (const [provider, codingAgent] of cases) {
      expect(resolveLegacyRunnerCodingAgent(provider)).toBe(codingAgent);
    }
  });

  it("returns no runner coding agent for unknown provider-only history", () => {
    expect(resolveLegacyRunnerCodingAgent("future-provider")).toBeNull();
    expect(resolveLegacyRunnerCodingAgent("")).toBeNull();
  });

  it("infers a provider only when the legacy provider is genuinely missing", () => {
    expect(resolveLegacyRuntimeSelection({ codingAgent: "codex" })).toEqual({
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
    });

    expect(
      resolveLegacyRuntimeSelection({ provider: "grok", codingAgent: "opencode" }),
    ).toEqual({
      provider: "grok",
      codingAgent: "opencode",
      aiProvider: "xai",
      model: "grok-4.3",
    });
  });
});
