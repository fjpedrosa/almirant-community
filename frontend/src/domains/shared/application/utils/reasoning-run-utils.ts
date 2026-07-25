import type { StreamingBlock } from "../../domain/streaming-block-types";

type ThinkingBlock = StreamingBlock & { type: "thinking" };

/**
 * Blocks that end a reasoning run. The agent speaking (or a lifecycle notice)
 * closes the chapter; tool calls, shell commands and file operations do not —
 * they are the *actions* the reasoning is about, so reasoning interleaved with
 * them belongs to a single train of thought.
 */
const RUN_BOUNDARY_TYPES = new Set<StreamingBlock["type"]>([
  "text",
  "info",
  "summary",
  "session-reconnect",
]);

const REASONING_SEPARATOR = "\n\n";

export interface CollapseReasoningRunsOptions {
  /**
   * Keep the final reasoning block separate. While a turn is streaming the last
   * block is the live one, and merging it into an earlier anchor would move the
   * "Thinking…" indicator up the transcript.
   */
  preserveTrailingReasoning?: boolean;
}

const mergeReasoning = (existing: string, addition: string): string => {
  const trimmedExisting = existing.trimEnd();
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return trimmedExisting;
  if (!trimmedExisting) return trimmedAddition;
  // Providers routinely re-emit the same reasoning chunk across deltas.
  if (trimmedExisting.endsWith(trimmedAddition)) return trimmedExisting;
  return `${trimmedExisting}${REASONING_SEPARATOR}${trimmedAddition}`;
};

/**
 * Collapses every reasoning block of a run into the first one, so a turn shows
 * one "Reasoning" disclosure followed by the actions it produced instead of a
 * ladder of identical collapsed rows. Non-reasoning blocks keep their order and
 * their position relative to each other.
 */
export const collapseReasoningRuns = (
  blocks: StreamingBlock[],
  options: CollapseReasoningRunsOptions = {},
): StreamingBlock[] => {
  const { preserveTrailingReasoning = false } = options;

  const lastIndex = blocks.length - 1;
  const result: StreamingBlock[] = [];
  let anchorIndex: number | null = null;

  blocks.forEach((block, index) => {
    if (block.type === "thinking") {
      const isLiveTrailingReasoning =
        preserveTrailingReasoning && index === lastIndex;

      if (anchorIndex !== null && !isLiveTrailingReasoning) {
        const anchor = result[anchorIndex] as ThinkingBlock;
        result[anchorIndex] = {
          ...anchor,
          content: mergeReasoning(anchor.content, block.content),
        };
        return;
      }

      result.push(block);
      anchorIndex = isLiveTrailingReasoning ? null : result.length - 1;
      return;
    }

    if (RUN_BOUNDARY_TYPES.has(block.type)) {
      anchorIndex = null;
    }

    result.push(block);
  });

  return result;
};

/** Longest headline we will show before eliding. */
const HEADLINE_MAX_LENGTH = 72;

/**
 * Turns the opening of a reasoning block into a one-line headline, so the
 * collapsed row says what the agent was working out instead of repeating the
 * word "Reasoning". Returns null when the opening carries no readable prose.
 */
export const deriveReasoningHeadline = (content: string): string | null => {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return null;
  // A fenced block or a bare separator says nothing on its own.
  if (firstLine.startsWith("```") || /^[-*_=]{3,}$/.test(firstLine)) return null;

  const plain = firstLine
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/\*\*|__|\*|`/g, "")
    .trim();

  if (!plain) return null;

  // Prefer a complete first sentence when it comfortably fits.
  const sentenceEnd = plain.search(/[.!?](\s|$)/);
  const sentence =
    sentenceEnd > 0 && sentenceEnd <= HEADLINE_MAX_LENGTH
      ? plain.slice(0, sentenceEnd)
      : plain;

  if (sentence.length <= HEADLINE_MAX_LENGTH) return sentence;

  const clipped = sentence.slice(0, HEADLINE_MAX_LENGTH);
  const lastSpace = clipped.lastIndexOf(" ");
  const truncated = lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped;
  return `${truncated.trimEnd()}…`;
};
