import { describe, expect, it } from "bun:test";
import {
  collapseReasoningRuns,
  deriveReasoningHeadline,
} from "./reasoning-run-utils";
import type { StreamingBlock } from "../../domain/streaming-block-types";

const thinking = (content: string): StreamingBlock => ({
  type: "thinking",
  content,
});

const text = (content: string): StreamingBlock => ({ type: "text", content });

const tool = (toolName: string): StreamingBlock => ({
  type: "tool_call",
  toolName,
  toolCallId: `id-${toolName}`,
  status: "success",
});

const bash = (command: string): StreamingBlock => ({ type: "bash", command });

describe("collapseReasoningRuns", () => {
  it("merges reasoning blocks separated only by tool activity into one", () => {
    const blocks = [
      thinking("Checking the platform."),
      tool("scraper_fetch_document"),
      thinking("It answered, so it is Shopify."),
      bash("jq keys out.json"),
      thinking("Paginating to page 2."),
    ];

    const result = collapseReasoningRuns(blocks);

    expect(result).toEqual([
      thinking(
        "Checking the platform.\n\nIt answered, so it is Shopify.\n\nPaginating to page 2.",
      ),
      tool("scraper_fetch_document"),
      bash("jq keys out.json"),
    ]);
  });

  it("starts a new reasoning run after the agent speaks", () => {
    const blocks = [
      thinking("First thought."),
      tool("Read"),
      text("Here is what I found."),
      thinking("Second thought."),
      tool("Edit"),
    ];

    const result = collapseReasoningRuns(blocks);

    expect(result).toEqual([
      thinking("First thought."),
      tool("Read"),
      text("Here is what I found."),
      thinking("Second thought."),
      tool("Edit"),
    ]);
  });

  it("keeps the ordering of the surrounding activity untouched", () => {
    const blocks = [
      tool("Read"),
      thinking("A"),
      bash("ls"),
      thinking("B"),
      tool("Edit"),
    ];

    const result = collapseReasoningRuns(blocks);

    expect(result.map((block) => block.type)).toEqual([
      "tool_call",
      "thinking",
      "bash",
      "tool_call",
    ]);
  });

  it("leaves the trailing reasoning on its own while it is still streaming", () => {
    const blocks = [
      thinking("Earlier thought."),
      tool("Read"),
      thinking("Live thought…"),
    ];

    const result = collapseReasoningRuns(blocks, {
      preserveTrailingReasoning: true,
    });

    expect(result).toEqual([
      thinking("Earlier thought."),
      tool("Read"),
      thinking("Live thought…"),
    ]);
  });

  it("does not duplicate identical reasoning emitted twice", () => {
    const blocks = [
      thinking("Same thought."),
      tool("Read"),
      thinking("Same thought."),
    ];

    expect(collapseReasoningRuns(blocks)).toEqual([
      thinking("Same thought."),
      tool("Read"),
    ]);
  });

  it("returns the input untouched when there is nothing to merge", () => {
    const blocks = [text("Hello"), tool("Read")];
    expect(collapseReasoningRuns(blocks)).toEqual(blocks);
  });
});

describe("deriveReasoningHeadline", () => {
  it("uses the first sentence of the reasoning", () => {
    expect(
      deriveReasoningHeadline(
        "El endpoint respondió. La homepage falló con 502.",
      ),
    ).toBe("El endpoint respondió");
  });

  it("strips markdown emphasis and heading markers", () => {
    expect(deriveReasoningHeadline("## **Checking the platform**")).toBe(
      "Checking the platform",
    );
  });

  it("truncates long openings on a word boundary", () => {
    const headline = deriveReasoningHeadline(
      "I am going to verify the production deployment and the source code before touching anything at all",
    );

    expect(headline).not.toBeNull();
    expect(headline!.length).toBeLessThanOrEqual(73);
    expect(headline!.endsWith("…")).toBe(true);
    expect(headline!.startsWith("I am going to verify")).toBe(true);
  });

  it("skips leading blank lines", () => {
    expect(deriveReasoningHeadline("\n\n  Evaluating font size")).toBe(
      "Evaluating font size",
    );
  });

  it("returns null when there is no usable content", () => {
    expect(deriveReasoningHeadline("   \n  ")).toBeNull();
    expect(deriveReasoningHeadline("")).toBeNull();
  });

  it("ignores a fenced code block opening", () => {
    expect(deriveReasoningHeadline("```json\n{\"a\": 1}\n```")).toBeNull();
  });
});
