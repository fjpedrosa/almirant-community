import { describe, expect, test } from "bun:test";
import {
  getReasoningEffortOptions,
  normalizeReasoningEffort,
} from "./ai-model-reasoning";

const valuesFor = (input: Parameters<typeof getReasoningEffortOptions>[0]) =>
  getReasoningEffortOptions(input).map((option) => option.value);

describe("getReasoningEffortOptions", () => {
  test("exposes only GPT-5.6 efforts that codex-sdk 0.144.4 can serialize", () => {
    expect(valuesFor({ codingAgent: "codex", aiProvider: "openai", model: "gpt-5.6-sol" })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("uses the documented model-specific OpenAI effort sets", () => {
    expect(valuesFor({ codingAgent: "codex", aiProvider: "openai", model: "gpt-5.5-pro" })).toEqual([
      "medium",
      "high",
      "xhigh",
    ]);
    expect(valuesFor({ codingAgent: "codex", aiProvider: "openai", model: "gpt-5.4-pro" })).toEqual([
      "medium",
      "high",
      "xhigh",
    ]);
    expect(valuesFor({ codingAgent: "codex", aiProvider: "openai", model: "gpt-5.3-codex" })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("does not expose reasoning for non-reasoning or unknown OpenAI models", () => {
    expect(valuesFor({ codingAgent: "codex", aiProvider: "openai", model: "gpt-4.1" })).toEqual([]);
    expect(valuesFor({ codingAgent: "codex", aiProvider: "openai", model: "gpt-4.1-mini" })).toEqual([]);
    expect(valuesFor({ codingAgent: "codex", aiProvider: "openai", model: "gpt-future-unknown" })).toEqual([]);
  });

  test("uses model-specific Claude efforts and exposes none for Haiku", () => {
    expect(valuesFor({ codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8" })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(valuesFor({ codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-6" })).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(valuesFor({ codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-haiku-4-5" })).toEqual([]);
  });

  test("only exposes verified GLM-5.2 Coding Plan efforts", () => {
    expect(valuesFor({ codingAgent: "opencode", aiProvider: "zai", model: "glm-5.2" })).toEqual([
      "high",
      "max",
    ]);
    expect(valuesFor({ codingAgent: "opencode", aiProvider: "zai", model: "glm-5.1" })).toEqual([]);
  });

  test("clears stale reasoning when switching to an incompatible model", () => {
    expect(normalizeReasoningEffort(
      { codingAgent: "opencode", aiProvider: "zai", model: "glm-5.1" },
      "max",
    )).toBeUndefined();
    expect(normalizeReasoningEffort(
      { codingAgent: "codex", aiProvider: "openai", model: "gpt-5.5-pro" },
      "low",
    )).toBeUndefined();
    expect(normalizeReasoningEffort(
      { codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-haiku-4-5" },
      "high",
    )).toBeUndefined();
    expect(normalizeReasoningEffort(
      { codingAgent: "opencode", aiProvider: "zai", model: "glm-5.2" },
      "MAX",
    )).toBe("max");
  });
});
