/**
 * Cluster Summary Builder
 *
 * Pure helper (zero I/O) that derives an explicit, UX-oriented summary from
 * the three inputs `getFeedbackClusterDetail` already loads:
 *
 *   - `cluster`       — raw `feedback_clusters` row (lifecycle fields,
 *                       `regressionCount`, `lastRegressionAt`, etc.)
 *   - `activeAttempt` — in-flight `bug_fix_attempts` row (or null)
 *   - `statusHistory` — audit rows ordered ASC by `changedAt` (oldest first)
 *
 * Before this helper, the frontend had to re-derive the "real" cluster state
 * by inspecting multiple raw fields (status, activeAttempt, bugFixAttempts,
 * timelineEvents) and reconstructing a narrative. The summary centralises
 * that derivation on the backend so the UI can render the three layers of
 * the model directly:
 *
 *   1. Lifecycle phase        — where the cluster is in its lifecycle
 *   2. Active attempt         — whether an agent is working on it right now
 *   3. Incident context       — is this the first incident or a regression?
 *   4. Last meaningful change — when/why the last status transition happened
 *
 * Keep this module in `src/lib` (sibling of `cluster-timeline-builder.ts`)
 * so the repository can import it without a reverse dependency on the api
 * package. The type aliases are re-exported from the repository file so
 * downstream consumers see a single surface.
 */
import type { FeedbackCluster, ClusterStatusHistory } from "../schema";
import type { BugFixAttemptWithPr } from "../repositories/agents/bug-fix-attempt-repository";

/**
 * UX-oriented grouping over the raw `feedback_cluster_status` enum. Kept as a
 * separate alias (rather than `= ClusterStatusEnum`) because the UI may want
 * to collapse future statuses into fewer phases without touching the DB enum
 * shape (e.g. a `verifying` state could map to `fix_ready` for the UX).
 *
 * Today the mapping is 1:1; divergence is intentional future-proofing.
 */
export type ClusterLifecyclePhase =
  | "open"
  | "investigating"
  | "fix_ready"
  | "resolved"
  | "regression"
  | "dismissed"
  | "promoted";

/**
 * Narrowed snapshot of the in-flight bug-fix attempt. Only the fields the UI
 * needs to render the "an agent is working on this" card are surfaced — no
 * timestamps beyond `startedAt`, no root-cause text (that lives on the full
 * attempt list already returned by the detail endpoint).
 */
export interface ClusterActiveAttemptSummary {
  attemptId: string;
  attemptNumber: number;
  status: "analyzing" | "proposed" | "implementing" | "merged" | "failed";
  startedAt: string; // ISO 8601
  prUrl: string | null;
  prNumber: number | null;
}

/**
 * Is this the first time the cluster is being worked on, or is it a
 * regression of a previously-resolved cluster?
 */
export type ClusterIncidentKind = "first_incident" | "regression";

/**
 * Aggregated incident context. `regressionCount` is 0 for a first incident
 * and strictly positive for a regression; `lastRegressionAt` is `null` unless
 * the cluster has flipped from resolved → regression at least once.
 */
export interface ClusterIncidentContext {
  kind: ClusterIncidentKind;
  regressionCount: number;
  lastRegressionAt: string | null;
}

/**
 * Raw `feedback_cluster_status` enum values. Mirrors the `ClusterStatusEnum`
 * type defined alongside the state-machine in `feedback-cluster-repository`.
 * Duplicated locally as a plain union so this builder has no circular import
 * with the repository file.
 */
export type ClusterStatusValue =
  | "open"
  | "investigating"
  | "fix_ready"
  | "resolved"
  | "regression"
  | "dismissed"
  | "promoted";

/**
 * Last meaningful change = tail of `clusterStatusHistory` (ordered ASC), so
 * `toStatus` is the cluster's current status. `fromStatus` is null for the
 * very first history row. `triggeredByKind` mirrors the audit column.
 */
export interface ClusterLastChangeSummary {
  changedAt: string; // ISO 8601
  fromStatus: ClusterStatusValue | null;
  toStatus: ClusterStatusValue;
  triggeredByKind: "user" | "system" | "agent" | "webhook";
  reason: string | null;
}

/**
 * Aggregate summary surfaced alongside the raw cluster detail. The frontend
 * reads this directly instead of re-deriving each layer from scattered
 * fields.
 */
export interface ClusterSummary {
  lifecyclePhase: ClusterLifecyclePhase;
  status: ClusterStatusValue;
  activeAttempt: ClusterActiveAttemptSummary | null;
  incident: ClusterIncidentContext;
  lastChange: ClusterLastChangeSummary | null;
}

export interface BuildClusterSummaryInput {
  cluster: FeedbackCluster;
  activeAttempt: BugFixAttemptWithPr | null;
  statusHistory: ClusterStatusHistory[];
}

/**
 * Best-effort ISO coercion. DB layer hands us `Date`; tests and in-memory
 * fixtures may pass a pre-formatted string. We never parse — we only format.
 */
const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

/**
 * Map an in-flight attempt row to the narrow summary shape. Falls back to
 * `null` when no attempt exists. Uses the attempt's `fixPrUrl` / `fixPrNumber`
 * columns directly (not the PR join) because the PR link lives on the
 * attempt row itself; the `pr` join only carries CI/merge metadata which the
 * detail endpoint exposes elsewhere.
 */
const mapActiveAttempt = (
  attempt: BugFixAttemptWithPr | null,
): ClusterActiveAttemptSummary | null => {
  if (!attempt) return null;
  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: toIso(attempt.createdAt),
    prUrl: attempt.fixPrUrl ?? null,
    prNumber: attempt.fixPrNumber ?? null,
  };
};

/**
 * Derive incident context from the cluster row. `regressionCount > 0` is the
 * canonical signal of a regression (the column is incremented atomically
 * inside `transitionCluster` whenever we flip resolved → regression), so we
 * do not need to peek into status history.
 */
const buildIncidentContext = (
  cluster: FeedbackCluster,
): ClusterIncidentContext => {
  const regressionCount = cluster.regressionCount ?? 0;
  return {
    kind: regressionCount > 0 ? "regression" : "first_incident",
    regressionCount,
    lastRegressionAt:
      cluster.lastRegressionAt == null ? null : toIso(cluster.lastRegressionAt),
  };
};

/**
 * Extract the last meaningful change from the ordered status history. Returns
 * `null` when the cluster has no history yet (brand new clusters created via
 * a seed). Trusts the caller's ordering (ASC by `changedAt`).
 */
const buildLastChange = (
  statusHistory: ClusterStatusHistory[],
): ClusterLastChangeSummary | null => {
  if (statusHistory.length === 0) return null;
  const latest = statusHistory[statusHistory.length - 1];
  if (!latest) return null;
  return {
    changedAt: toIso(latest.changedAt),
    fromStatus: (latest.fromStatus ?? null) as ClusterStatusValue | null,
    toStatus: latest.toStatus as ClusterStatusValue,
    triggeredByKind: latest.triggeredByKind as ClusterLastChangeSummary["triggeredByKind"],
    reason: latest.reason ?? null,
  };
};

/**
 * Compose the aggregate summary. Pure — no I/O, no global state. Safe to
 * call inside `getFeedbackClusterDetail` without adding a query.
 */
export const buildClusterSummary = (
  input: BuildClusterSummaryInput,
): ClusterSummary => {
  const { cluster, activeAttempt, statusHistory } = input;
  const status = cluster.status as ClusterStatusValue;
  return {
    lifecyclePhase: status as ClusterLifecyclePhase,
    status,
    activeAttempt: mapActiveAttempt(activeAttempt),
    incident: buildIncidentContext(cluster),
    lastChange: buildLastChange(statusHistory),
  };
};
