// ─────────────────────────────────────────────────────────────────────────────
// Cluster Reason Labels (A-1953)
// ─────────────────────────────────────────────────────────────────────────────
//
// The backend persists `cluster_status_history.reason` as a raw short-code
// (e.g. `pr_merged`, `pr_closed`, `regression_detected`, `manual`). The
// cluster detail hero used to render that raw snake_case string inline, which
// looked technical and untranslated in the UX.
//
// `formatReasonLabel` is a pure helper that maps the known reason codes to
// human-friendly Spanish labels. Unknown codes fall back to a best-effort
// snake_case → Sentence case conversion so the UI never leaks the raw token.
// ─────────────────────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  pr_merged: "PR mergeado",
  pr_closed: "PR cerrado",
  regression_detected: "Regresión detectada",
  manual: "Cambio manual",
};

/**
 * Map a raw reason code coming from `cluster_status_history.reason` to a
 * human-readable label. Returns an empty string when the input is nullish or
 * empty, so callers can safely guard their render with `reason && label`.
 */
export const formatReasonLabel = (
  reason: string | null | undefined,
): string => {
  if (!reason) return "";
  const mapped = REASON_LABELS[reason];
  if (mapped) return mapped;
  // Fallback: snake_case → Sentence case, e.g. `pr_review_completed` →
  // `Pr review completed`. Keeps the UI usable even for reason codes that
  // were added on the backend without a corresponding frontend label.
  const humanized = reason.replace(/_/g, " ");
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
};
