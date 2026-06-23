import { stripAnsiForDiscord } from "./formatter";

// ---------------------------------------------------------------------------
// Stage 2: Chain-of-Thought Filtering
// ---------------------------------------------------------------------------

const COT_BLOCK_REGEX = /<think>[\s\S]*?<\/think>/g;
const COT_UNCLOSED_REGEX = /<think>[\s\S]*$/;

const filterChainOfThought = (text: string): string => {
  return text.replace(COT_BLOCK_REGEX, "").replace(COT_UNCLOSED_REGEX, "");
};

// ---------------------------------------------------------------------------
// Stage 3: Table Detection -> Code Blocks
// ---------------------------------------------------------------------------

const TABLE_LINE_REGEX = /^\s*\|.*\|\s*$/;

const convertTablesToCodeBlocks = (text: string): string => {
  const lines = text.split("\n");
  const result: string[] = [];
  let insideCodeBlock = false;
  let tableBuffer: string[] = [];

  const flushTable = (): void => {
    if (tableBuffer.length >= 2) {
      result.push("```text");
      result.push(...tableBuffer);
      result.push("```");
    } else {
      result.push(...tableBuffer);
    }
    tableBuffer = [];
  };

  for (const line of lines) {
    // Track code-block parity
    if (line.trimStart().startsWith("```")) {
      insideCodeBlock = !insideCodeBlock;

      // If we were accumulating a table, flush it first
      if (tableBuffer.length > 0) {
        flushTable();
      }

      result.push(line);
      continue;
    }

    if (!insideCodeBlock && TABLE_LINE_REGEX.test(line)) {
      tableBuffer.push(line);
    } else {
      if (tableBuffer.length > 0) {
        flushTable();
      }
      result.push(line);
    }
  }

  // Flush any remaining table at end of input
  if (tableBuffer.length > 0) {
    flushTable();
  }

  return result.join("\n");
};

// ---------------------------------------------------------------------------
// Stage 4: Spacing Normalization
// ---------------------------------------------------------------------------

const normalizeSpacing = (text: string): string => {
  return text.replace(/\n{3,}/g, "\n\n");
};

// ---------------------------------------------------------------------------
// Stage 5: Smart Truncation
// ---------------------------------------------------------------------------

const smartTruncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const prefix = "... (truncated)\n";
  const fenceOverhead = 4; // "```\n"
  if (maxLength <= prefix.length + fenceOverhead) {
    return text.slice(0, maxLength);
  }

  // Reserve space for prefix + possible code fence repair
  const budget = maxLength - prefix.length - fenceOverhead;

  // Truncate from the start, keeping the tail
  const cutPoint = text.length - budget;
  const firstNewline = text.indexOf("\n", cutPoint);
  const sliceStart = firstNewline !== -1 ? firstNewline + 1 : cutPoint;

  const tail = text.slice(sliceStart);

  // Detect unclosed code blocks by counting ``` parity
  const backtickMatches = tail.match(/^```/gm);
  const backtickCount = backtickMatches ? backtickMatches.length : 0;
  const unclosed = backtickCount % 2 !== 0;

  if (unclosed) {
    return `${prefix}\`\`\`\n${tail}`;
  }

  return `${prefix}${tail}`;
};

// ---------------------------------------------------------------------------
// Public API: Composed sanitizer pipeline
// ---------------------------------------------------------------------------

export const sanitizeActivityBuffer = (
  buffer: string,
  maxLength = 1800
): string => {
  const stripped = stripAnsiForDiscord(buffer);
  const filtered = filterChainOfThought(stripped);
  const tablesConverted = convertTablesToCodeBlocks(filtered);
  const spaced = normalizeSpacing(tablesConverted);
  return smartTruncate(spaced, maxLength);
};
