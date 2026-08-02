import type { DebugAnalysisStatus, DebugBundleMeta, FeedbackItem } from "./types";

const DEBUG_STATUSES: ReadonlySet<DebugAnalysisStatus> = new Set([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const NON_TERMINAL_DEBUG_STATUSES: ReadonlySet<DebugAnalysisStatus> = new Set([
  "queued",
  "running",
]);

export const isNonTerminalDebugStatus = (
  status: DebugAnalysisStatus | undefined,
): boolean => status !== undefined && NON_TERMINAL_DEBUG_STATUSES.has(status);

/**
 * Extracts debug analysis metadata from a feedback item's metadata object.
 * Keys written by:
 *   - backend/api/src/domains/debug/services/debug-pipeline.ts
 *   - backend/api/src/domains/debug/services/set-analysis-status.ts:35
 *   - backend/api/src/domains/debug/routes/debug.routes.ts
 *
 * Note:
 * - Automatic bundle creation writes `debugBundleId` and clears any stale
 *   analysis status fields.
 * - Manual POST /analyze only writes `debugAnalysisStatus="queued"` when the
 *   backend actually enqueues a real `incident-analyze` job (`jobId` present).
 */
export const extractDebugBundleMeta = (
  metadata: FeedbackItem["metadata"],
): DebugBundleMeta => {
  if (typeof metadata !== "object" || metadata === null) return {};
  const raw = metadata as Record<string, unknown>;
  const bundleId = typeof raw.debugBundleId === "string" ? raw.debugBundleId : undefined;
  const s = typeof raw.debugAnalysisStatus === "string" ? raw.debugAnalysisStatus : undefined;
  const status =
    s && DEBUG_STATUSES.has(s as DebugAnalysisStatus) ? (s as DebugAnalysisStatus) : undefined;
  const startedAt =
    typeof raw.debugAnalysisStartedAt === "string" ? raw.debugAnalysisStartedAt : undefined;
  return { bundleId, status, startedAt };
};
