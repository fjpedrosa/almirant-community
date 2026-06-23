import { describe, expect, test } from "bun:test";
import { resolvePersistedJobTemplateFields } from "./job-template-resolution";

describe("resolvePersistedJobTemplateFields", () => {
  test("keeps prompt-only jobs null-safe when promptTemplate is explicitly null", () => {
    expect(
      resolvePersistedJobTemplateFields({
        prompt: "Resuelve un ticket de feedback bug",
        promptTemplate: null,
        skillName: null,
        config: {
          prompt: "Resuelve un ticket de feedback bug",
          skillName: undefined,
        },
      }),
    ).toEqual({
      prompt: "Resuelve un ticket de feedback bug",
      skillName: null,
      promptTemplate: null,
      isPromptOnly: true,
    });
  });

  test("preserves explicit template jobs", () => {
    expect(
      resolvePersistedJobTemplateFields({
        promptTemplate: "runner-implement",
        config: {
          prompt: undefined,
          skillName: undefined,
        },
      }),
    ).toEqual({
      prompt: null,
      skillName: "runner-implement",
      promptTemplate: "runner-implement",
      isPromptOnly: false,
    });
  });

  test("falls back to the legacy default only when there is no prompt-only signal", () => {
    expect(
      resolvePersistedJobTemplateFields({
        config: {
          prompt: undefined,
          skillName: undefined,
        },
      }),
    ).toEqual({
      prompt: null,
      skillName: "implement",
      promptTemplate: "implement",
      isPromptOnly: false,
    });
  });

  test("defaults integration jobs to the release integration runner skill", () => {
    expect(
      resolvePersistedJobTemplateFields({
        jobType: "integration",
        config: {
          prompt: undefined,
          skillName: undefined,
        },
      }),
    ).toEqual({
      prompt: null,
      skillName: "runner-release-integration",
      promptTemplate: "runner-release-integration",
      isPromptOnly: false,
    });
  });

  test("keeps prompt-only jobs null-safe when promptTemplate is omitted (undefined)", () => {
    expect(
      resolvePersistedJobTemplateFields({
        prompt: "Resuelve un ticket de feedback bug",
        // promptTemplate not passed at all — simulates callers that don't set the field
        skillName: null,
        config: {
          prompt: "Resuelve un ticket de feedback bug",
          skillName: undefined,
        },
      }),
    ).toEqual({
      prompt: "Resuelve un ticket de feedback bug",
      skillName: null,
      promptTemplate: null,
      isPromptOnly: true,
    });
  });

  test("treats blank strings as absent when deciding prompt-only jobs", () => {
    expect(
      resolvePersistedJobTemplateFields({
        prompt: "  freeform prompt  ",
        promptTemplate: "   ",
        skillName: " ",
        config: {
          prompt: "  freeform prompt  ",
          skillName: " ",
        },
      }),
    ).toEqual({
      prompt: "freeform prompt",
      skillName: null,
      promptTemplate: null,
      isPromptOnly: true,
    });
  });
});
