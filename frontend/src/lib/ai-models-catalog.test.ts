import { describe, expect, it } from "bun:test";

import {
  reconcileModelWithAvailable,
  resolveCanonicalModelId,
} from "./ai-models-catalog";

describe("resolveCanonicalModelId", () => {
  it("returns the id unchanged when it already matches a catalog id", () => {
    expect(resolveCanonicalModelId("glm-5.2")).toBe("glm-5.2");
    expect(resolveCanonicalModelId("gpt-5.4")).toBe("gpt-5.4");
  });

  it("resolves a value stored with the display-name casing (the GLM-5.2 bug)", () => {
    // Agents saved via MCP/label persisted the uppercase display name.
    expect(resolveCanonicalModelId("GLM-5.2")).toBe("glm-5.2");
    expect(resolveCanonicalModelId("GPT-5.4")).toBe("gpt-5.4");
  });

  it("resolves the human display name with spaces to its canonical id", () => {
    expect(resolveCanonicalModelId("Claude Opus 4.8")).toBe("claude-opus-4-8");
  });

  it("resolves a dated snapshot id to its base model via prefix", () => {
    expect(resolveCanonicalModelId("glm-5.2-250828")).toBe("glm-5.2");
    expect(resolveCanonicalModelId("GLM-5.2-250828")).toBe("glm-5.2");
  });

  it("prefers the most specific (longest) prefix match", () => {
    // "glm-5-turbo" must win over the shorter "glm-5".
    expect(resolveCanonicalModelId("glm-5-turbo-preview")).toBe("glm-5-turbo");
  });

  it("returns null for unknown, empty or nullish values", () => {
    expect(resolveCanonicalModelId("totally-made-up-model")).toBeNull();
    expect(resolveCanonicalModelId("")).toBeNull();
    expect(resolveCanonicalModelId(null)).toBeNull();
    expect(resolveCanonicalModelId(undefined)).toBeNull();
  });
});

describe("reconcileModelWithAvailable", () => {
  it("keeps a value that is already available", () => {
    expect(reconcileModelWithAvailable("glm-5.2", ["glm-5.2", "glm-5.1"])).toBe(
      "glm-5.2",
    );
  });

  it("canonicalizes a case-mismatched value into an available id", () => {
    expect(reconcileModelWithAvailable("GLM-5.2", ["glm-5.2", "glm-5.1"])).toBe(
      "glm-5.2",
    );
  });

  it("canonicalizes a dated snapshot into an available base id", () => {
    expect(
      reconcileModelWithAvailable("glm-5.2-250828", ["glm-5.2"]),
    ).toBe("glm-5.2");
  });

  it("clears the value when the model does not belong to the available set", () => {
    // e.g. the provider changed and the old model no longer applies.
    expect(reconcileModelWithAvailable("gpt-5.4", ["glm-5.2", "glm-5.1"])).toBe(
      "",
    );
  });

  it("clears empty or nullish values", () => {
    expect(reconcileModelWithAvailable("", ["glm-5.2"])).toBe("");
    expect(reconcileModelWithAvailable(null, ["glm-5.2"])).toBe("");
    expect(reconcileModelWithAvailable(undefined, ["glm-5.2"])).toBe("");
  });
});
