import { describe, expect, it } from "bun:test";
import {
  buildSessionControlComponents,
  formatContextEmbed,
  formatQuestionPrompt,
  formatWaveTree,
  stripAnsiForDiscord,
  truncateToRelevantLines,
} from "./formatter";

describe("discord formatter", () => {
  it("strips ansi escape sequences", () => {
    const text = "\u001b[31mERROR\u001b[0m line";
    expect(stripAnsiForDiscord(text)).toBe("ERROR line");
  });

  it("truncates long logs while preserving relevant tail", () => {
    const input = Array.from({ length: 120 }, (_, index) => `line-${index + 1}`).join("\n");
    const output = truncateToRelevantLines(input, {
      maxLines: 20,
      maxChars: 500,
      preserveHeadLines: 4,
    });

    expect(output).toContain("line-1");
    expect(output).toContain("line-120");
    expect(output).toContain("omitted");
  });

  it("formats wave tree with status icons", () => {
    const tree = formatWaveTree([
      { agent: "frontend-developer", taskId: "A-1", title: "Build UI", status: "success" },
      { agent: "backend-architect", taskId: "A-2", title: "Create API", status: "running" },
    ]);

    expect(tree).toContain("[ok]");
    expect(tree).toContain("[~]");
    expect(tree).toContain("A-2");
  });

  it("creates question prompts with options", () => {
    const payload = formatQuestionPrompt({
      question: "Which approach should we use?",
      options: ["Option A", "Option B"],
      jobId: "job-1",
    });

    expect(payload.embeds?.[0]?.title).toBe("User input required");
    expect(payload.embeds?.[0]?.description).toContain("1. Option A");
    expect(payload.components?.[0]?.components?.[0]).toMatchObject({
      type: 2,
      custom_id: "answer:job-1:0",
    });
  });

  it("creates select menu components for 3+ options", () => {
    const payload = formatQuestionPrompt({
      question: "Pick one option",
      options: ["A", "B", "C"],
      jobId: "job-2",
    });

    expect(payload.components?.[0]?.components?.[0]).toMatchObject({
      type: 3,
      custom_id: "answer:job-2",
    });
  });

  it("builds running session control buttons", () => {
    const rows = buildSessionControlComponents("job-3", "running");
    const labels = rows[0]?.components.map((component) =>
      "label" in component ? component.label : ""
    );
    expect(labels).toContain("🟢 Running");
    expect(labels).toContain("⏹ Stop");
    expect(labels).toContain("🔌 Shutdown");
  });

  it("does not offer fake controls once a session is stopped", () => {
    expect(buildSessionControlComponents("job-4", "stopped")).toEqual([]);
    expect(buildSessionControlComponents("job-4", "shutdown")).toEqual([]);
  });

  it("creates context embed with tokens and cost", () => {
    const embed = formatContextEmbed({
      branch: "feature/A-E-22",
      model: "gpt-5",
      status: "running",
      tokensIn: 1200,
      tokensOut: 4300,
      costUsd: 0.1234,
    });

    const tokensField = embed.fields?.find((field) => field.name === "Tokens");
    const costField = embed.fields?.find((field) => field.name === "Estimated Cost");

    expect(tokensField?.value).toContain("1,200");
    expect(costField?.value).toContain("$0.1234");
  });
});
