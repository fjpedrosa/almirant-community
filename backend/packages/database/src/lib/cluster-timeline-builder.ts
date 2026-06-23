/**
 * Cluster Timeline Builder
 *
 * Pure function (zero I/O, zero DB) that transforms the raw inputs returned
 * by `getFeedbackClusterDetail` (items, bug-fix attempts with PR data, status
 * history) into a chronologically-sorted array of `ClusterTimelineEvent`s
 * ready to feed the frontend cluster-detail modal stepper.
 *
 * Note: the `ticket_burst` variant is a frontend aggregation concern and is
 * intentionally NOT emitted here — the selector layer collapses dense
 * `ticket_created` runs into bursts at render time.
 *
 * Lives in the `@almirant/database` package so that `getFeedbackClusterDetail`
 * can call it without pulling an api-package dependency. A thin re-export in
 * `backend/api/src/domains/feedback/services/cluster-timeline-builder.ts`
 * preserves the pre-A-F-434 import path.
 */
import type {
  ClusterTimelineEvent,
  TicketCreatedEvent,
  StatusTransitionEvent,
  AttemptLaunchedEvent,
  PrOpenedEvent,
  PrMergedEvent,
  RegressionDetectedEvent,
} from "@almirant/shared";
import type { ClusterStatusHistory } from "../schema";
import type { BugFixAttemptWithPr } from "../repositories/agents/bug-fix-attempt-repository";
import type { FeedbackClusterDetailItem } from "../repositories/feedback/feedback-cluster-repository";

export interface BuildClusterTimelineInput {
  items: FeedbackClusterDetailItem[];
  attempts: BugFixAttemptWithPr[];
  statusHistory: ClusterStatusHistory[];
}

const REGRESSION_STATUS = "regression";

/**
 * Best-effort coercion: accepts `Date` or ISO string inputs (the DB layer
 * returns `Date`, but tests and in-memory fixtures may pass either).
 */
const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

/**
 * Narrow an unknown value to `string[]`. Returns `[]` when the input is
 * missing, not an array, or contains non-string entries mixed with nulls —
 * defensive because `metadata` is `Record<string, unknown>` at rest.
 */
const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
};

/**
 * Pulls the ids embedded in a regression status-history row's metadata blob.
 * Defaults to empty arrays when metadata is missing, malformed, or the
 * specific keys are absent.
 */
const extractRegressionIds = (
  metadata: ClusterStatusHistory["metadata"],
): { newItemIds: string[]; previousAttemptIds: string[] } => {
  if (metadata == null || typeof metadata !== "object") {
    return { newItemIds: [], previousAttemptIds: [] };
  }
  const bag = metadata as Record<string, unknown>;
  return {
    newItemIds: asStringArray(bag.newItemIds),
    previousAttemptIds: asStringArray(bag.previousAttemptIds),
  };
};

/**
 * The current `BugFixAttemptPr` type does not expose an `openedAt` column,
 * but the GitHub sync layer may add one in the future. We read it
 * defensively so we can fall back to the attempt's `createdAt` without a
 * type error today.
 */
const readPrOpenedAt = (pr: BugFixAttemptWithPr["pr"]): Date | string | null => {
  if (pr == null) return null;
  const maybe = (pr as { openedAt?: Date | string | null }).openedAt;
  return maybe ?? null;
};

/**
 * Builds a flat, chronologically-sorted timeline of cluster events from the
 * repository payload. Pure — the function never performs I/O.
 */
export function buildClusterTimeline(
  input: BuildClusterTimelineInput,
): ClusterTimelineEvent[] {
  const { items, attempts, statusHistory } = input;
  const events: ClusterTimelineEvent[] = [];

  // 1. Ticket creation events — one per feedback item in the cluster.
  for (const item of items) {
    const event: TicketCreatedEvent = {
      kind: "ticket_created",
      at: toIso(item.createdAt),
      ticketId: item.id,
      ticketTitle: item.title,
      authorName: item.author?.name ?? item.authorName ?? null,
      authorUserId: item.author?.userId ?? null,
    };
    events.push(event);
  }

  // 2. Status history — `regression` rows become `regression_detected`
  //    events (hydrated from metadata), everything else becomes
  //    `status_transition`.
  for (const row of statusHistory) {
    if (row.toStatus === REGRESSION_STATUS) {
      const { newItemIds, previousAttemptIds } = extractRegressionIds(
        row.metadata,
      );
      const event: RegressionDetectedEvent = {
        kind: "regression_detected",
        at: toIso(row.changedAt),
        newItemIds,
        previousAttemptIds,
      };
      events.push(event);
      continue;
    }

    const event: StatusTransitionEvent = {
      kind: "status_transition",
      at: toIso(row.changedAt),
      fromStatus: row.fromStatus ?? null,
      toStatus: row.toStatus,
      triggeredByKind:
        row.triggeredByKind as StatusTransitionEvent["triggeredByKind"],
      triggeredByUserId: row.triggeredByUserId ?? null,
      triggeredByAttemptId: row.triggeredByAttemptId ?? null,
      triggeredByAgentJobId: row.triggeredByAgentJobId ?? null,
      reason: row.reason ?? null,
    };
    events.push(event);
  }

  // 3. Bug-fix attempts — always emit `attempt_launched`; emit `pr_opened`
  //    and `pr_merged` only when PR data is present.
  for (const attempt of attempts) {
    const launched: AttemptLaunchedEvent = {
      kind: "attempt_launched",
      at: toIso(attempt.createdAt),
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
    };
    events.push(launched);

    if (attempt.pr == null) continue;
    if (attempt.fixPrUrl == null) continue;

    const openedAtRaw = readPrOpenedAt(attempt.pr) ?? attempt.createdAt;
    const opened: PrOpenedEvent = {
      kind: "pr_opened",
      at: toIso(openedAtRaw),
      attemptId: attempt.id,
      prUrl: attempt.fixPrUrl,
      prNumber: attempt.fixPrNumber ?? null,
    };
    events.push(opened);

    if (attempt.pr.mergedAt != null) {
      const merged: PrMergedEvent = {
        kind: "pr_merged",
        at: toIso(attempt.pr.mergedAt),
        attemptId: attempt.id,
        prUrl: attempt.fixPrUrl,
        prNumber: attempt.fixPrNumber ?? null,
      };
      events.push(merged);
    }
  }

  // 4. Global chronological sort. ISO 8601 strings compare lexicographically
  //    in wall-clock order, so a stable localeCompare works.
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return events;
}
