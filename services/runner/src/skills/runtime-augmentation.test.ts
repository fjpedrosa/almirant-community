import { describe, expect, it } from "bun:test";
import {
  augmentSkillContentForRuntime,
  buildRuntimeSkillAugmentation,
  RUNTIME_SKILL_MCP_FALLBACK_MARKER,
} from "./runtime-augmentation";

describe("buildRuntimeSkillAugmentation", () => {
  it("adds the Claude MCP fallback note for runner-implement", () => {
    const note = buildRuntimeSkillAugmentation({
      skillName: "runner-implement",
      runtimeType: "claude-shim",
    });

    expect(note).not.toBeNull();
    expect(note).toContain("Almirant MCP may be configured in `.mcp.json`");
    expect(note).toContain("\"name\":\"list_work_items\"");
  });

  it("does not add the fallback note for non-Claude runtimes", () => {
    const note = buildRuntimeSkillAugmentation({
      skillName: "runner-implement",
      runtimeType: "codex-shim",
    });

    expect(note).toBeNull();
  });
});

describe("augmentSkillContentForRuntime", () => {
  it("appends the runtime note once for Claude skills", () => {
    const augmented = augmentSkillContentForRuntime({
      skillName: "validate",
      runtimeType: "claude-shim",
      content: "# Validate skill",
    });

    expect(augmented.applied).toBe(true);
    expect(augmented.content).toContain(RUNTIME_SKILL_MCP_FALLBACK_MARKER);
    expect(augmented.content).toContain("Claude Runner Model Override");
    expect(augmented.content).toContain("Ignore any earlier instruction in the skill that says `model: \"opus\"`");
  });

  it("does not duplicate the runtime note when it is already present", () => {
    const content = `# Skill\n\n${RUNTIME_SKILL_MCP_FALLBACK_MARKER}`;
    const augmented = augmentSkillContentForRuntime({
      skillName: "ideate",
      runtimeType: "claude-shim",
      content,
    });

    expect(augmented.applied).toBe(false);
    expect(augmented.content).toBe(content);
  });
});
