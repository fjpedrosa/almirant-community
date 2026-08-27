import { describe, expect, test } from "bun:test";
import {
  normalizeScheduledAgentConfig,
  normalizeScheduledAgentConfigInput,
  normalizeScheduledCodingAgent,
} from "./scheduled-agent-config-normalization";

describe("scheduled-agent-config-normalization", () => {
  test("normalizes legacy codex-cli aliases to codex through the shared adapter", () => {
    expect(normalizeScheduledCodingAgent("codex-cli")).toBe("codex");
    expect(normalizeScheduledCodingAgent("CODEX-CLI")).toBe("codex");
  });

  test("preserves nullable varchar/default behavior", () => {
    expect(normalizeScheduledCodingAgent(null)).toBeNull();
    expect(normalizeScheduledCodingAgent(undefined)).toBeUndefined();
    expect(normalizeScheduledCodingAgent("opencode")).toBe("opencode");
    expect(normalizeScheduledCodingAgent("future-agent")).toBe("future-agent");
  });

  test("normalizes persisted config rows without changing unrelated fields", () => {
    expect(
      normalizeScheduledAgentConfig({
        id: "cfg-1",
        name: "Nightly analysis",
        provider: "runner-primary",
        settings: { aiProvider: "openai", model: "GPT-Exact" },
        codingAgent: "codex-cli",
      }),
    ).toEqual({
      id: "cfg-1",
      name: "Nightly analysis",
      provider: "runner-primary",
      settings: { aiProvider: "openai", model: "GPT-Exact" },
      codingAgent: "codex",
    });
  });

  test("normalizes write payloads without touching unrelated or missing fields", () => {
    expect(
      normalizeScheduledAgentConfigInput({
        name: "Autofix bug tickets",
        provider: "Runner-Lane-A",
        aiProvider: "OpenAI",
        model: "GPT-Exact",
        codingAgent: "codex-cli",
      }),
    ).toEqual({
      name: "Autofix bug tickets",
      provider: "Runner-Lane-A",
      aiProvider: "OpenAI",
      model: "GPT-Exact",
      codingAgent: "codex",
    });

    const unchanged = { name: "No coding agent" };
    expect(normalizeScheduledAgentConfigInput(unchanged)).toBe(unchanged);
  });
});
