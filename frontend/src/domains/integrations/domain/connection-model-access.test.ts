import { describe, expect, test } from "bun:test";
import {
  getModelsForAiConnection,
  normalizeAiConnectionModel,
} from "./connection-model-access";

describe("AI connection model access", () => {
  test("limits Z.AI Coding Plan connections to agent-runtime models", () => {
    const ids = getModelsForAiConnection("zai").map((model) => model.id);

    expect(ids).toContain("glm-5.2");
    expect(ids).not.toContain("glm-5v-turbo");
    expect(ids).not.toContain("glm-4.6v");
  });

  test("rejects general-API-only Z.AI models before connection persistence", () => {
    expect(normalizeAiConnectionModel("zai", "glm-5v-turbo")).toBeUndefined();
    expect(normalizeAiConnectionModel("zai", "glm-5.2")).toBe("glm-5.2");
  });

  test("limits OpenAI API connections to general-API models", () => {
    const ids = getModelsForAiConnection("openai").map((model) => model.id);

    expect(ids).toContain("gpt-5.6-sol");
    expect(ids).not.toContain("gpt-5.3-codex-spark");
    expect(
      normalizeAiConnectionModel("openai", "gpt-5.3-codex-spark"),
    ).toBeUndefined();
  });

  test("keeps selectable models for other AI providers", () => {
    expect(normalizeAiConnectionModel("anthropic", "claude-opus-4-8")).toBe(
      "claude-opus-4-8",
    );
  });
});
