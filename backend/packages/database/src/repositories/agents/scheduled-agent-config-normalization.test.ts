import { describe, expect, test } from "bun:test";
import {
  normalizeScheduledAgentConfig,
  normalizeScheduledAgentConfigInput,
  normalizeScheduledCodingAgent,
} from "./scheduled-agent-config-normalization";

describe("scheduled-agent-config-normalization", () => {
  test("normalizes legacy codex-cli aliases to codex", () => {
    expect(normalizeScheduledCodingAgent("codex-cli")).toBe("codex");
  });

  test("preserves opencode coding agent values", () => {
    expect(normalizeScheduledCodingAgent("opencode")).toBe("opencode");
  });

  test("normalizes persisted config rows", () => {
    expect(
      normalizeScheduledAgentConfig({
        id: "cfg-1",
        codingAgent: "codex-cli",
      }),
    ).toEqual({
      id: "cfg-1",
      codingAgent: "codex",
    });
  });

  test("normalizes write payloads without touching missing codingAgent fields", () => {
    expect(
      normalizeScheduledAgentConfigInput({
        name: "Autofix bug tickets",
        codingAgent: "codex-cli",
      }),
    ).toEqual({
      name: "Autofix bug tickets",
      codingAgent: "codex",
    });

    const unchanged = { name: "No coding agent" };
    expect(normalizeScheduledAgentConfigInput(unchanged)).toBe(unchanged);
  });
});
