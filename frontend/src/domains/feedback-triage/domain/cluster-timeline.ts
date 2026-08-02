// TODO(A-F-434): migrate to @almirant/shared once frontend is part of the workspace. Keep in sync with backend/packages/shared/src/cluster-timeline.ts.

// ──────────────────────────────────────────────
// Cluster Timeline Event — Discriminated Union
// ──────────────────────────────────────────────

export interface TicketCreatedEvent {
  kind: "ticket_created";
  at: string; // ISO date
  ticketId: string;
  ticketTitle: string;
  authorName: string | null;
  authorUserId: string | null;
}

export interface StatusTransitionEvent {
  kind: "status_transition";
  at: string;
  fromStatus: string | null;
  toStatus: string;
  triggeredByKind: "user" | "system" | "agent" | "webhook";
  triggeredByUserId: string | null;
  triggeredByAttemptId: string | null;
  triggeredByAgentJobId: string | null;
  reason: string | null;
}

export interface AttemptLaunchedEvent {
  kind: "attempt_launched";
  at: string;
  attemptId: string;
  attemptNumber: number;
  status: string;
}

export interface PrOpenedEvent {
  kind: "pr_opened";
  at: string;
  attemptId: string;
  prUrl: string;
  prNumber: number | null;
}

export interface PrMergedEvent {
  kind: "pr_merged";
  at: string;
  attemptId: string;
  prUrl: string;
  prNumber: number | null;
}

export interface RegressionDetectedEvent {
  kind: "regression_detected";
  at: string;
  newItemIds: string[];
  previousAttemptIds: string[];
}

/**
 * Presentation-side aggregation of many `ticket_created` events within a short
 * window. NOT produced by the backend builder — only by the frontend selector
 * layer when collapsing dense ticket bursts in the stepper.
 */
export interface TicketBurstEvent {
  kind: "ticket_burst";
  at: string; // = startAt for sort
  count: number;
  ticketIds: string[];
  startAt: string;
  endAt: string;
}

export type ClusterTimelineEvent =
  | TicketCreatedEvent
  | StatusTransitionEvent
  | AttemptLaunchedEvent
  | PrOpenedEvent
  | PrMergedEvent
  | RegressionDetectedEvent
  | TicketBurstEvent;

export type ClusterTimelineEventKind = ClusterTimelineEvent["kind"];

// ──────────────────────────────────────────────
// Type guards
// ──────────────────────────────────────────────

export const isTicketCreated = (
  e: ClusterTimelineEvent,
): e is TicketCreatedEvent => e.kind === "ticket_created";

export const isStatusTransition = (
  e: ClusterTimelineEvent,
): e is StatusTransitionEvent => e.kind === "status_transition";

export const isAttemptLaunched = (
  e: ClusterTimelineEvent,
): e is AttemptLaunchedEvent => e.kind === "attempt_launched";

export const isPrOpened = (e: ClusterTimelineEvent): e is PrOpenedEvent =>
  e.kind === "pr_opened";

export const isPrMerged = (e: ClusterTimelineEvent): e is PrMergedEvent =>
  e.kind === "pr_merged";

export const isRegressionDetected = (
  e: ClusterTimelineEvent,
): e is RegressionDetectedEvent => e.kind === "regression_detected";

export const isTicketBurst = (e: ClusterTimelineEvent): e is TicketBurstEvent =>
  e.kind === "ticket_burst";

// ──────────────────────────────────────────────
// Exhaustiveness helper
// ──────────────────────────────────────────────

export const assertNeverEvent = (event: never): never => {
  throw new Error(
    `Unhandled cluster timeline event kind: ${JSON.stringify(event)}`,
  );
};

// ──────────────────────────────────────────────
// Event ID helper (for selection tracking)
// ──────────────────────────────────────────────

/**
 * Generates a unique ID for an event to use for selection tracking.
 * The ID is stable and deterministic based on the event kind and its
 * variant-specific properties.
 */
export const getEventId = (event: ClusterTimelineEvent): string => {
  switch (event.kind) {
    case "ticket_created":
      return `ticket_created:${event.ticketId}`;
    case "status_transition":
      return `status_transition:${event.at}:${event.toStatus}`;
    case "attempt_launched":
      return `attempt_launched:${event.attemptId}`;
    case "pr_opened":
      return `pr_opened:${event.attemptId}:${event.prNumber ?? "null"}`;
    case "pr_merged":
      return `pr_merged:${event.attemptId}:${event.prNumber ?? "null"}`;
    case "regression_detected":
      return `regression_detected:${event.at}`;
    case "ticket_burst":
      return `ticket_burst:${event.startAt}:${event.endAt}`;
    default:
      return assertNeverEvent(event);
  }
};

// ──────────────────────────────────────────────
// Burst grouping configuration
// ──────────────────────────────────────────────

export interface GroupTimelineEventsConfig {
  /** Minimum number of consecutive ticket_created events to form a burst. Default: 3 */
  burstMinCount?: number;
  /** Maximum time window (ms) from the first ticket to the last in a burst. Default: 24 hours */
  burstWindowMs?: number;
}

const DEFAULT_BURST_MIN_COUNT = 3;
const DEFAULT_BURST_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ──────────────────────────────────────────────
// groupTimelineEvents selector
// ──────────────────────────────────────────────

/**
 * Collapses runs of consecutive `ticket_created` events within a time window
 * into a single `ticket_burst` event when the run contains >= burstMinCount tickets.
 *
 * Algorithm:
 * - Walk events in chronological order
 * - Accumulate consecutive `ticket_created` events where each is within
 *   `burstWindowMs` of the FIRST event in the run (greedy grouping)
 * - When a non-ticket_created event is encountered or the window expires,
 *   flush the run: emit a `ticket_burst` if >= burstMinCount, else emit individually
 * - Non-ticket_created events pass through unchanged
 *
 * Pure function: no side effects, no Date.now() calls.
 *
 * @param events - Array of ClusterTimelineEvent in chronological order
 * @param config - Optional thresholds for burst detection
 * @returns Array of ClusterTimelineEvent with qualifying runs collapsed to ticket_burst
 *
 * @example
 * const collapsed = groupTimelineEvents(events);
 * const customCollapsed = groupTimelineEvents(events, { burstMinCount: 5, burstWindowMs: 12 * 60 * 60 * 1000 });
 */
export const groupTimelineEvents = (
  events: ClusterTimelineEvent[],
  config?: GroupTimelineEventsConfig,
): ClusterTimelineEvent[] => {
  const burstMinCount = config?.burstMinCount ?? DEFAULT_BURST_MIN_COUNT;
  const burstWindowMs = config?.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS;

  const result: ClusterTimelineEvent[] = [];
  let currentRun: TicketCreatedEvent[] = [];

  const flushRun = (): void => {
    if (currentRun.length === 0) return;

    if (currentRun.length >= burstMinCount) {
      // Emit a single burst event
      const burst: TicketBurstEvent = {
        kind: "ticket_burst",
        at: currentRun[0]!.at,
        count: currentRun.length,
        ticketIds: currentRun.map((e) => e.ticketId),
        startAt: currentRun[0]!.at,
        endAt: currentRun[currentRun.length - 1]!.at,
      };
      result.push(burst);
    } else {
      // Emit tickets individually
      for (const ticket of currentRun) {
        result.push(ticket);
      }
    }

    currentRun = [];
  };

  for (const event of events) {
    if (event.kind === "ticket_created") {
      if (currentRun.length === 0) {
        // Start a new run
        currentRun.push(event);
      } else {
        // Check if this ticket is within the window of the FIRST ticket in the run
        const runStartMs = Date.parse(currentRun[0]!.at);
        const eventMs = Date.parse(event.at);
        const delta = eventMs - runStartMs;

        if (delta <= burstWindowMs) {
          // Extend the run
          currentRun.push(event);
        } else {
          // Window expired: flush and start a new run with this ticket
          flushRun();
          currentRun.push(event);
        }
      }
    } else {
      // Non-ticket event: flush any open run, then pass through
      flushRun();
      result.push(event);
    }
  }

  // Flush any remaining run at the end
  flushRun();

  return result;
};
