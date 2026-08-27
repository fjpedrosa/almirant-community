import { describe, expect, test } from "bun:test";
import {
  getDefaultProjectRuntimeSelection,
  getProjectRuntimeAiProviders,
  getProjectRuntimeCodingAgents,
  getProjectRuntimeModels,
  getRetainedProjectRuntimeFields,
  isAiConfigProvider,
  resolveProjectRuntimeAdmission,
} from "./project-runtime-selection";

describe("project runtime selection", () => {
  test("recognizes only the four legacy project provider lanes", () => {
    expect(["claude-code", "codex", "zipu", "grok"].every(isAiConfigProvider)).toBe(true);
    expect(isAiConfigProvider("pi")).toBe(false);
    expect(isAiConfigProvider("future-provider")).toBe(false);
    expect(isAiConfigProvider(null)).toBe(false);
  });

  test("offers Pi for implementation and mutable automations, but not read-only scopes", () => {
    expect(getProjectRuntimeCodingAgents("implementation")).toContain("pi");
    expect(getProjectRuntimeCodingAgents("backlog-drain")).toContain("pi");
    expect(getProjectRuntimeCodingAgents("dev-flow-default")).not.toContain("pi");
    expect(getProjectRuntimeCodingAgents("dod-review")).not.toContain("pi");
  });

  test("derives Pi's exact admitted provider, model, and default tuple from the projection", () => {
    expect(getProjectRuntimeAiProviders("implementation", "pi")).toEqual(["zai"]);
    expect(
      getProjectRuntimeModels("implementation", "pi", "zai").map((model) => model.id),
    ).toEqual(["glm-5.3"]);
    expect(getDefaultProjectRuntimeSelection("implementation", "pi")).toEqual({
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      reasoningLevel: null,
    });
  });

  test("keeps Community's OpenCode default on the admitted Z.AI lane", () => {
    expect(getDefaultProjectRuntimeSelection("implementation", "opencode")).toMatchObject({
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
    });
  });

  test("admits the exact Pi implementation tuple and explains the read-only rejection", () => {
    const selection = {
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      reasoningLevel: null,
    };

    expect(resolveProjectRuntimeAdmission("implementation", selection)).toMatchObject({
      admitted: true,
    });
    expect(resolveProjectRuntimeAdmission("dod-review", selection)).toMatchObject({
      admitted: false,
      code: "PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED",
      dimension: "capability",
    });
  });

  test("does not manufacture a default for a coding agent excluded by scope policy", () => {
    expect(() => getDefaultProjectRuntimeSelection("dev-flow-default", "pi")).toThrow(
      "No admitted project runtime provider for pi in dev-flow-default",
    );
  });

  test("returns no retained fields for an admitted tuple and supported effort", () => {
    expect(getRetainedProjectRuntimeFields("implementation", {
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-5",
      reasoningLevel: "high",
    })).toEqual([]);
  });

  test("reports every raw future value as retained without rewriting it", () => {
    expect(getRetainedProjectRuntimeFields("implementation", {
      codingAgent: "future-agent",
      aiProvider: "future-provider",
      model: "future-model",
      reasoningLevel: "future-effort",
    })).toEqual([
      { field: "codingAgent", value: "future-agent" },
      { field: "aiProvider", value: "future-provider" },
      { field: "model", value: "future-model" },
      { field: "reasoningLevel", value: "future-effort" },
    ]);
  });

  test("retains only invalid descendants when the coding agent itself is supported", () => {
    expect(getRetainedProjectRuntimeFields("implementation", {
      codingAgent: "pi",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
      reasoningLevel: null,
    })).toEqual([
      { field: "aiProvider", value: "openai" },
      { field: "model", value: "gpt-5.6-sol" },
    ]);
  });
});
