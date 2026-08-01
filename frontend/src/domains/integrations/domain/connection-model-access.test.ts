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

  test("keeps selectable models for other AI providers", () => {
    expect(normalizeAiConnectionModel("anthropic", "claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(normalizeAiConnectionModel("openai", "gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });
});
