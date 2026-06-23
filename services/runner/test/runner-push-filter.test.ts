import { describe, expect, it } from "bun:test";
import {
  filterUserModifiedPaths,
  isRunnerManagedRepoPath,
  isSafeRepoPath,
} from "../src/delivery/runner-push";

describe("isRunnerManagedRepoPath", () => {
  it("matches runner-injected root files", () => {
    expect(isRunnerManagedRepoPath("CLAUDE.md")).toBe(true);
    expect(isRunnerManagedRepoPath("AGENTS.md")).toBe(true);
    expect(isRunnerManagedRepoPath(".mcp.json")).toBe(true);
    expect(isRunnerManagedRepoPath("opencode.json")).toBe(true);
  });

  it("matches injected skills and runtime config directories", () => {
    expect(isRunnerManagedRepoPath(".claude/skills/implement/SKILL.md")).toBe(true);
    expect(isRunnerManagedRepoPath(".agents/skills/review/SKILL.md")).toBe(true);
    expect(isRunnerManagedRepoPath(".claude/settings.json")).toBe(true);
  });

  it("does not match regular repo files", () => {
    expect(isRunnerManagedRepoPath("frontend/src/app/page.tsx")).toBe(false);
    expect(isRunnerManagedRepoPath("backend/api/src/index.ts")).toBe(false);
    expect(isRunnerManagedRepoPath("docs/CLAUDE.md.notes")).toBe(false);
  });
});

describe("filterUserModifiedPaths", () => {
  it("keeps only user-modified repo files", () => {
    expect(
      filterUserModifiedPaths([
        "frontend/src/app/page.tsx",
        "./backend/api/src/index.ts",
        "CLAUDE.md",
        ".agents/skills/implement/SKILL.md",
        ".mcp.json",
        "frontend/src/app/page.tsx",
      ]),
    ).toEqual([
      "frontend/src/app/page.tsx",
      "backend/api/src/index.ts",
    ]);
  });

  it("rejects unsafe repo paths before staging", () => {
    expect(
      filterUserModifiedPaths([
        "/tmp/escape.txt",
        "../escape.txt",
        "safe/file.ts",
        "dir/../escape.txt",
        ".git/config",
        "nested/.git/config",
      ]),
    ).toEqual(["safe/file.ts"]);
  });
});

describe("isSafeRepoPath", () => {
  it("allows only repo-relative paths that cannot traverse into .git or outside the repo", () => {
    expect(isSafeRepoPath("src/app.ts")).toBe(true);
    expect(isSafeRepoPath("./src/app.ts")).toBe(true);
    expect(isSafeRepoPath("/src/app.ts")).toBe(false);
    expect(isSafeRepoPath("../src/app.ts")).toBe(false);
    expect(isSafeRepoPath("src/../app.ts")).toBe(false);
    expect(isSafeRepoPath(".git/config")).toBe(false);
    expect(isSafeRepoPath("src/.git/config")).toBe(false);
  });
});
