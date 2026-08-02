/**
 * Recognises the envelope a payload arrives in, by shape alone.
 *
 * Every check is a structural fact about the string — a delimiter, a set of
 * keys — never a guess about meaning. That matters because this viewer is shared
 * by every agent: a renderer chosen from semantics works beautifully for the
 * agent it was written against and misfires for the next one.
 *
 * Detection never throws and never trusts itself. `parsed` is only present when
 * `JSON.parse` actually succeeded, so a caller that needs structure can tell the
 * difference between "looks like JSON" and "is JSON", and fall back to showing
 * the raw text whenever it cannot. The payload that prompted all of this looks
 * exactly like JSON and does not parse.
 */

/**
 * Above this, parsing costs more than the nicer rendering is worth, and the
 * result would be too large to render as a tree anyway. Callers show the raw
 * block instead.
 */
const MAX_PARSE_BYTES = 512 * 1024;

const FILE_ENVELOPE_PATTERN = /^<path>[\s\S]*<type>file<\/type>[\s\S]*<content>/;
const TASK_ENVELOPE_PATTERN = /^<task\b[^>]*>[\s\S]*<task_result>/;

export type OutputFormat =
  | "file-envelope"
  | "http-response"
  | "json"
  | "task-envelope"
  | "text";

export interface DetectedOutput {
  format: OutputFormat;
  /** Only set when JSON.parse succeeded. Absent means: render it as text. */
  parsed?: unknown;
}

const tryParse = (value: string): unknown | undefined => {
  if (value.length > MAX_PARSE_BYTES) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};

const isHttpResponse = (parsed: unknown): boolean => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const record = parsed as Record<string, unknown>;
  return (
    typeof record.statusCode === "number" &&
    ("body" in record || "contentType" in record)
  );
};

export const detectOutputFormat = (content: string): DetectedOutput => {
  const trimmed = content.trimStart();

  if (FILE_ENVELOPE_PATTERN.test(trimmed)) return { format: "file-envelope" };
  if (TASK_ENVELOPE_PATTERN.test(trimmed)) return { format: "task-envelope" };

  const parsed = tryParse(content);
  if (parsed === undefined) return { format: "text" };
  if (isHttpResponse(parsed)) return { format: "http-response", parsed };
  return { format: "json", parsed };
};
