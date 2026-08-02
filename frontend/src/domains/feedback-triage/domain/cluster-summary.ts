import type {
  BugFixAttemptSummary,
  ClusterActiveAttemptSummary,
  ClusterIncidentContext,
  ClusterLastChangeSummary,
  ClusterLifecyclePhase,
  ClusterStatus,
  ClusterStatusEvent,
  ClusterSummary,
  ClusterTicketItem,
} from "./types";

/**
 * Aggregated statistics for a cluster's tickets.
 */
export interface ClusterSummaryStats {
  ticketCount: number;
  uniqueAuthors: number;
  firstTicketAt: string | null;
  lastTicketAt: string | null;
}

/**
 * Computes summary statistics from an array of cluster tickets.
 * Pure function with no React or external dependencies.
 *
 * - `uniqueAuthors`: counts distinct buckets using `author.userId ?? author.email ?? '__anonymous__'`
 *   All anonymous tickets collapse into a single bucket.
 * - `firstTicketAt` / `lastTicketAt`: min/max of `createdAt` strings (ISO 8601 compares lexicographically).
 *   Returns null if the tickets array is empty.
 *
 * @param tickets - Array of ClusterTicketItem to aggregate
 * @returns ClusterSummaryStats with ticket count, unique authors, and date range
 *
 * @example
 * const stats = computeClusterSummaryStats(detail.tickets);
 * // { ticketCount: 5, uniqueAuthors: 3, firstTicketAt: "2026-04-01T...", lastTicketAt: "2026-04-15T..." }
 */
export const computeClusterSummaryStats = (
  tickets: ClusterTicketItem[],
): ClusterSummaryStats => {
  if (tickets.length === 0) {
    return {
      ticketCount: 0,
      uniqueAuthors: 0,
      firstTicketAt: null,
      lastTicketAt: null,
    };
  }

  // Count unique authors by bucketing userId > email > anonymous
  const authorBuckets = new Set<string>();
  for (const ticket of tickets) {
    const bucket =
      ticket.author.userId ?? ticket.author.email ?? "__anonymous__";
    authorBuckets.add(bucket);
  }

  // Find min/max dates using lexicographic comparison (ISO 8601 strings)
  let firstTicketAt = tickets[0]!.createdAt;
  let lastTicketAt = tickets[0]!.createdAt;

  for (const ticket of tickets) {
    if (ticket.createdAt < firstTicketAt) {
      firstTicketAt = ticket.createdAt;
    }
    if (ticket.createdAt > lastTicketAt) {
      lastTicketAt = ticket.createdAt;
    }
  }

  return {
    ticketCount: tickets.length,
    uniqueAuthors: authorBuckets.size,
    firstTicketAt,
    lastTicketAt,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// ClusterSummary client-side fallback (A-1876)
// ─────────────────────────────────────────────────────────────────────────────
//
// When the backend response is missing the `summary` field (older deployment),
// the mapper calls `deriveClusterSummary` to synthesise an equivalent payload
// from the raw inputs the backend has always shipped: `cluster.status`,
// `activeAttempt`, and `statusHistory`.
//
// Keeping this derivation as a pure, typed function makes the fallback path
// trivially testable and guarantees the UI layer receives a `ClusterSummary`
// regardless of the backend version.

/**
 * Input for the client-side derivation fallback. Mirrors the three backend
 * inputs consumed by `buildClusterSummary`.
 */
export interface DeriveClusterSummaryInput {
  status: ClusterStatus;
  /** Count of `resolved → regression` flips observed. `0` means first incident. */
  regressionCount: number;
  /** Most recent regression flip timestamp (ISO). `null` when never regressed. */
  lastRegressionAt: string | null;
  activeAttempt: BugFixAttemptSummary | null;
  statusHistory: ClusterStatusEvent[];
}

/**
 * Map an in-flight `BugFixAttemptSummary` to the narrow
 * `ClusterActiveAttemptSummary` shape used by `ClusterSummary`. Returns null
 * when no attempt is active so consumers can render a "no agent working"
 * state without an extra guard.
 */
const deriveActiveAttemptSummary = (
  attempt: BugFixAttemptSummary | null,
): ClusterActiveAttemptSummary | null => {
  if (!attempt) return null;
  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.createdAt,
    prUrl: attempt.fixPrUrl,
    prNumber: attempt.fixPrNumber,
  };
};

/**
 * Derive the incident context from regression counters already attached to
 * the cluster row. `regressionCount > 0` is the canonical signal of a
 * regression — we do NOT inspect `statusHistory` because the counter is the
 * authoritative source (updated atomically on every regression flip).
 */
const deriveIncidentContext = (input: {
  regressionCount: number;
  lastRegressionAt: string | null;
}): ClusterIncidentContext => {
  const regressionCount = input.regressionCount ?? 0;
  return {
    kind: regressionCount > 0 ? "regression" : "first_incident",
    regressionCount,
    lastRegressionAt: input.lastRegressionAt ?? null,
  };
};

/**
 * Pick the tail of the ASC-ordered status history as the last meaningful
 * change. Returns null when the cluster has no recorded transitions (a brand
 * new cluster whose status is still the enum default).
 */
const deriveLastChange = (
  statusHistory: ClusterStatusEvent[],
): ClusterLastChangeSummary | null => {
  if (statusHistory.length === 0) return null;
  const latest = statusHistory[statusHistory.length - 1];
  if (!latest) return null;
  return {
    changedAt: latest.changedAt,
    fromStatus: latest.fromStatus,
    toStatus: latest.toStatus,
    triggeredByKind: latest.triggeredByKind,
    reason: latest.reason,
  };
};

/**
 * Pure, client-side fallback for `ClusterSummary`. Used by the cluster
 * detail mapper whenever the raw response does not carry `summary` (older
 * backend deployment) so the UI keeps rendering without crashing.
 *
 * Logic matches the backend `buildClusterSummary` rules 1:1.
 */
export const deriveClusterSummary = (
  input: DeriveClusterSummaryInput,
): ClusterSummary => {
  const lifecyclePhase = input.status as ClusterLifecyclePhase;
  return {
    lifecyclePhase,
    status: input.status,
    activeAttempt: deriveActiveAttemptSummary(input.activeAttempt),
    incident: deriveIncidentContext({
      regressionCount: input.regressionCount,
      lastRegressionAt: input.lastRegressionAt,
    }),
    lastChange: deriveLastChange(input.statusHistory),
  };
};
