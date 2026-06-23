import { describe, expect, it } from "bun:test";
import { buildPlanningPrompt, shouldInlinePlanningSkillContent } from "./planning-prompt";

describe("buildPlanningPrompt", () => {
  it("inlines the Claude planning skill when user input or recovery context exists", () => {
    const prompt = buildPlanningPrompt({
      runtimeType: "claude-shim",
      skillName: "ideate",
      skillContent: "# Ideate skill\nFollow the ideation workflow.",
      userMessage: "Fix the sessions tab websocket issues\n\n1) Keep feedback chip visible",
      promptLocale: "en",
      seedIds: ["seed-1", "seed-2"],
      sessionRecoveryContext: "Resume from the last ideation checkpoint.",
      previousJobRecoveryContext: "Previous attempt failed after the initial questionnaire.",
      conversationHistory: [
        { role: "user", content: "The session page has multiple regressions." },
        { role: "assistant", content: "I can help break those into work items." },
      ],
    });

    expect(shouldInlinePlanningSkillContent("claude-shim", {
      userMessage: "Fix the sessions tab websocket issues",
      seedIds: ["seed-1", "seed-2"],
      sessionRecoveryContext: "Resume from the last ideation checkpoint.",
      previousJobRecoveryContext: "Previous attempt failed after the initial questionnaire.",
      conversationHistory: [
        { role: "user", content: "The session page has multiple regressions." },
      ],
    })).toBe(true);
    expect(prompt.startsWith("/ideate")).toBe(false);
    expect(prompt).toContain('<skill name="ideate">');
    expect(prompt).toContain("IMPORTANT: You MUST respond in English.");
    expect(prompt).toContain("Start the ideate session using the following user request.");
    expect(prompt).toContain("<user_request>\nFix the sessions tab websocket issues");
    expect(prompt).toContain("Seed IDs for context (use get_seeds_for_ideation to fetch details): seed-1, seed-2");
    expect(prompt).toContain("<previous_job_recovery>");
    expect(prompt).toContain("<session_recovery>");
    expect(prompt).toContain("<previous_conversation>");
  });

  it("keeps the latest user request after the previous conversation block", () => {
    const prompt = buildPlanningPrompt({
      runtimeType: "claude-shim",
      skillName: "ideate",
      skillContent: "# Ideate skill\nFollow the ideation workflow.",
      userMessage: "Ahora sí, céntrate en feature flags.",
      promptLocale: "es",
      conversationHistory: [
        { role: "user", content: "Primero revisa los problemas de navegación." },
        { role: "assistant", content: "Perfecto, revisaré la navegación." },
      ],
    });

    const previousConversationIndex = prompt.indexOf("<previous_conversation>");
    const userRequestIndex = prompt.indexOf("<user_request>");

    expect(previousConversationIndex).toBeGreaterThan(-1);
    expect(userRequestIndex).toBeGreaterThan(previousConversationIndex);
  });

  it("builds a Codex planning prompt with inline skill content and natural-language activation", () => {
    const prompt = buildPlanningPrompt({
      runtimeType: "codex-shim",
      skillName: "ideate",
      skillContent: "# Ideate skill\nFollow the ideation workflow.",
      userMessage: "Plan improvements for the sessions detail panel.",
      promptLocale: "es",
    });

    expect(prompt).toContain('<skill name="ideate">');
    expect(prompt).toContain("Start the ideate session using the following user request.");
    expect(prompt).toContain("<user_request>\nPlan improvements for the sessions detail panel.\n</user_request>");
    expect(prompt).toContain("IMPORTANT: You MUST respond in Spanish.");
    expect(prompt.startsWith("/ideate")).toBe(false);
  });

  it("builds the same natural-language planning prompt for OpenCode", () => {
    const prompt = buildPlanningPrompt({
      runtimeType: "opencode",
      skillName: "ideate",
      skillContent: "# Ideate skill\nUse the research workflow.",
      userMessage: "Investigate session detail regressions.",
      promptLocale: "en",
    });

    expect(prompt).toContain('<skill name="ideate">');
    expect(prompt).toContain("Start the ideate session using the following user request.");
    expect(prompt).toContain("Investigate session detail regressions.");
    expect(prompt.startsWith("/ideate")).toBe(false);
  });

  it("keeps the Claude slash command valid when no prompt context is present", () => {
    const prompt = buildPlanningPrompt({
      runtimeType: "claude-shim",
      skillName: "ideate",
      userMessage: "",
      promptLocale: "en",
    });

    expect(shouldInlinePlanningSkillContent("claude-shim", {
      userMessage: "",
      seedIds: [],
      conversationHistory: [],
    })).toBe(false);
    expect(prompt.startsWith("/ideate")).toBe(true);
    expect(prompt.startsWith("/ideate ")).toBe(false);
    expect(prompt).not.toContain("<user_request>");
    expect(prompt).not.toContain("Start the ideate session using the following user request.");
  });
});
