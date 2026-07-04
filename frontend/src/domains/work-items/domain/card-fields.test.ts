import { describe, expect, it } from "bun:test";
import {
  getCardDescriptionPreview,
  hasDefinitionOfDone,
  hasSavedPrompt,
} from "./card-fields";

// Phase 5 (board perf): the card must render correctly off BOTH the slim board
// DTO (?view=board — description text + prompt/DoD blobs omitted, cheap derived
// fields present) and the full DTO. These selectors bridge both shapes so no
// card affordance disappears under the slim payload.

describe("getCardDescriptionPreview", () => {
  it("prefers the slim descriptionPreview when present", () => {
    expect(
      getCardDescriptionPreview({
        descriptionPreview: "slim preview",
        description: null,
      }),
    ).toBe("slim preview");
  });

  it("falls back to description when no preview (full DTO)", () => {
    expect(
      getCardDescriptionPreview({
        description: "full description",
        descriptionPreview: undefined,
      }),
    ).toBe("full description");
  });

  it("returns null when neither is present", () => {
    expect(
      getCardDescriptionPreview({ description: null, descriptionPreview: null }),
    ).toBeNull();
  });
});

describe("hasSavedPrompt", () => {
  it("uses the slim hasGeneratedPrompt flag (authoritative) when present", () => {
    expect(hasSavedPrompt({ hasGeneratedPrompt: true, metadata: {} })).toBe(true);
    // Flag wins over the (stripped) metadata content.
    expect(
      hasSavedPrompt({ hasGeneratedPrompt: false, metadata: { generatedPrompt: "x" } }),
    ).toBe(false);
  });

  it("falls back to metadata.generatedPrompt in the full DTO", () => {
    expect(hasSavedPrompt({ metadata: { generatedPrompt: "a prompt" } })).toBe(true);
    expect(hasSavedPrompt({ metadata: {} })).toBe(false);
    expect(hasSavedPrompt({ metadata: { generatedPrompt: "" } })).toBe(false);
  });
});

describe("hasDefinitionOfDone", () => {
  it("uses the slim hasDefinitionOfDone flag when present", () => {
    expect(hasDefinitionOfDone({ hasDefinitionOfDone: true, metadata: {} })).toBe(true);
    expect(hasDefinitionOfDone({ hasDefinitionOfDone: false, metadata: {} })).toBe(false);
  });

  it("falls back to metadata.definitionOfDone in the full DTO", () => {
    expect(
      hasDefinitionOfDone({ metadata: { definitionOfDone: "done when merged" } }),
    ).toBe(true);
    expect(hasDefinitionOfDone({ metadata: {} })).toBe(false);
  });
});
