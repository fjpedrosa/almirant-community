import { describe, expect, test } from "bun:test";
import {
  agentProviderToAiProvider,
  defaultCodingAgentForProvider,
  getProvidersForAgent,
  isSingleProviderAgent,
} from "./coding-agent-compatibility";

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
});
