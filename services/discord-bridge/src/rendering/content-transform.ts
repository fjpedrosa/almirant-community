// ---------------------------------------------------------------------------
// Content transformation — pure functions
//
// Text transformations applied to content before sending to Discord.
// No framework or infrastructure dependencies.
// ---------------------------------------------------------------------------

// Discord message limits
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_EMBED_DESCRIPTION = 4096;
export const TEXT_SPLIT_THRESHOLD = 1900;

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}\u{2026}` : text;

export const formatElapsed = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

/**
 * Convert markdown tables to code blocks since Discord doesn't support GFM tables.
 * Detects consecutive lines starting with `|` and wraps them in ``` code blocks.
 */
export const convertTablesToCodeBlocks = (text: string): string => {
  const lines = text.split("\n");
  const result: string[] = [];
  let tableLines: string[] = [];

  const flushTable = (): void => {
    if (tableLines.length >= 2) {
      result.push("```");
      result.push(...tableLines);
      result.push("```");
    } else {
      result.push(...tableLines);
    }
    tableLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      tableLines.push(line);
    } else {
      if (tableLines.length > 0) {
        flushTable();
      }
      result.push(line);
    }
  }

  if (tableLines.length > 0) {
    flushTable();
  }

  return result.join("\n");
};
