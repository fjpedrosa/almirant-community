/**
 * Tells prose apart from a data dump, so the latter never reaches Markdown.
 *
 * A subagent that answers with 19,837 characters of raw JSON is not writing
 * prose, but the transcript rendered it as if it were: GFM turned every URL
 * inside a JSON string into a real link, `remarkBreaks` flattened the structure,
 * and `break-all` split identifiers mid-word. The fix is not a smarter Markdown
 * pipeline — it is not sending data through Markdown at all.
 *
 * The signals are deliberately dumb and agent-agnostic: nothing here knows what
 * a product is, or which agent produced the text. Guessing semantics is how a
 * viewer shared by every agent starts breaking for the next one.
 *
 * Both failure directions are harmless by construction. A false positive shows
 * long technical prose in a collapsed block that still expands and reads fine; a
 * false negative renders exactly as it does today. Nothing parses, so nothing
 * can throw.
 */

/** Below this, even dense text is small enough to read inline. */
const MIN_DATA_LENGTH = 1_500;
/** Share of structural punctuation that prose essentially never reaches. */
const MIN_STRUCTURAL_DENSITY = 0.12;
/** Prose wraps; serialized data runs on for hundreds of characters. */
const MIN_LONGEST_LINE = 400;

const STRUCTURAL_CHARACTERS = new Set(["{", "}", "[", "]", '"', ":", ","]);

export type TextPayloadKind = "prose" | "data";

export interface TextPayloadClassification {
  kind: TextPayloadKind;
  /** "json" only claims it looks like JSON, never that it parses. */
  format: "json" | "text";
  byteLength: number;
  lineCount: number;
  /** Which signals fired, so the UI can explain itself and tests can be exact. */
  signals: {
    long: boolean;
    dense: boolean;
    unwrapped: boolean;
  };
}

const structuralDensity = (value: string): number => {
  if (value.length === 0) return 0;
  let structural = 0;
  for (const character of value) {
    if (STRUCTURAL_CHARACTERS.has(character)) structural += 1;
  }
  return structural / value.length;
};

const longestLineLength = (lines: readonly string[]): number =>
  lines.reduce((longest, line) => Math.max(longest, line.length), 0);

const looksLikeJson = (trimmed: string): boolean =>
  (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
  (trimmed.startsWith("[") && trimmed.endsWith("]"));

export const classifyTextPayload = (
  content: string,
): TextPayloadClassification => {
  const trimmed = content.trim();
  const lines = content.split("\n");
  const signals = {
    long: trimmed.length >= MIN_DATA_LENGTH,
    dense: structuralDensity(trimmed) >= MIN_STRUCTURAL_DENSITY,
    unwrapped: longestLineLength(lines) >= MIN_LONGEST_LINE,
  };
  // Two of three. Any single signal on its own has honest false positives: a
  // long design document, a prose paragraph full of quotes, one pasted URL.
  const firedSignals = Object.values(signals).filter(Boolean).length;

  return {
    kind: firedSignals >= 2 ? "data" : "prose",
    format: looksLikeJson(trimmed) ? "json" : "text",
    byteLength: new TextEncoder().encode(content).length,
    lineCount: lines.length,
    signals,
  };
};
