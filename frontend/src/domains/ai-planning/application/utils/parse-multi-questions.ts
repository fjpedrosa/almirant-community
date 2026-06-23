/**
 * Parses a flat questionText + options array into structured multi-question format.
 *
 * The AI sometimes sends multiple questions concatenated:
 *   questionText: "Q1?\nQ2?\nQ3?"
 *   options: ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]
 *
 * This parser splits them into individual questions with their respective options.
 */

export interface ParsedQuestion {
  text: string;
  options: string[];
}

/**
 * Parse questionText (newline-separated) and flat options into structured questions.
 * Options are distributed evenly across questions. If uneven, extras go to last question.
 * Falls back to single question if parsing fails.
 */
export const parseMultiQuestions = (
  questionText: string,
  options: string[],
  questions?: ParsedQuestion[],
): ParsedQuestion[] => {
  if (Array.isArray(questions) && questions.length > 0) {
    return questions.map((question) => ({
      text: question.text.trim(),
      options: question.options,
    }));
  }

  // Split by pilcrow separator (¶) or newlines, keep only non-empty lines
  // The runner collapses multiline questions with " ¶ " separator
  const lines = questionText
    .split(/\s*¶\s*|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // If only one line (or none), return single question
  if (lines.length <= 1) {
    return [{ text: questionText.trim(), options }];
  }

  // If no options, return all questions without options
  if (options.length === 0) {
    return lines.map((text) => ({ text, options: [] }));
  }

  // With flat options AND no structured `questions` array, we cannot safely
  // map options to specific questions. Arithmetically-even splits (e.g. 4
  // options / 2 lines = 2) silently mis-attribute when the runner emitted
  // uneven distributions like Q1=3 + Q2=1 — the third Q1 option leaks into
  // Q2. Fall back to a single combined question; runners must provide a
  // structured `questions` array when per-question mapping matters.
  return [{ text: questionText.trim(), options }];
};
