const MAX_SUMMARY_LENGTH = 140;
const HUMAN_SUMMARY_KEYS = [
  "summary",
  "message",
  "title",
  "name",
  "result",
] as const;

const compactText = (value: string): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_SUMMARY_LENGTH) return compact;
  return `${compact.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Builds the one-line label shown while a validated job result is collapsed.
 *
 * This deliberately summarizes shape instead of serializing arbitrary output:
 * the complete payload remains available in the expanded panel, while arrays,
 * objects and long strings cannot turn the collapsed header into another
 * transcript.
 */
export const summarizeResultPayload = (payload: unknown): string => {
  if (Array.isArray(payload)) {
    return `${payload.length.toLocaleString("es-ES")} ${
      payload.length === 1 ? "elemento" : "elementos"
    }`;
  }

  const record = asRecord(payload);
  if (record) {
    for (const key of HUMAN_SUMMARY_KEYS) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return compactText(candidate);
      }
    }

    const keys = Object.keys(record);
    const keyPreview = keys.slice(0, 3).join(", ");
    return `${keys.length.toLocaleString("es-ES")} ${
      keys.length === 1 ? "campo" : "campos"
    }${keyPreview ? ` · ${keyPreview}` : ""}`;
  }

  if (typeof payload === "string") {
    return compactText(payload) || "Texto vacío";
  }

  return String(payload);
};
