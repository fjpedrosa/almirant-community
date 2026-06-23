import { describe, expect, it } from "bun:test";
import { repairDanglingMarkdownFences } from "./markdown-fence-repair";

describe("repairDanglingMarkdownFences", () => {
  it("closes an unterminated execution-plan fence before a final summary heading", () => {
    const content = [
      "## Execution Plan",
      "```markdown",
      "- inspect the project",
      "- apply the fix",
      "## Summary",
      "Job completed successfully.",
    ].join("\n");

    expect(repairDanglingMarkdownFences(content)).toBe([
      "## Execution Plan",
      "```markdown",
      "- inspect the project",
      "- apply the fix",
      "```",
      "",
      "## Summary",
      "Job completed successfully.",
    ].join("\n"));
  });

  it("appends a closing fence when the content ends while still inside code", () => {
    const content = [
      "Here is the command:",
      "```bash",
      "pnpm test",
    ].join("\n");

    expect(repairDanglingMarkdownFences(content)).toBe([
      "Here is the command:",
      "```bash",
      "pnpm test",
      "```",
    ].join("\n"));
  });

  it("does not alter balanced fences", () => {
    const content = [
      "```ts",
      "const title = '# Summary';",
      "```",
      "## Summary",
      "Done.",
    ].join("\n");

    expect(repairDanglingMarkdownFences(content)).toBe(content);
  });

  it("does not treat a fenced-code-looking line with info text as a closing fence", () => {
    const content = [
      "```md",
      "```ts",
      "const value = 1;",
    ].join("\n");

    expect(repairDanglingMarkdownFences(content)).toBe([
      "```md",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n"));
  });
});
