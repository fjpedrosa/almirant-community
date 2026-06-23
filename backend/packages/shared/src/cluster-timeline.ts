// ──────────────────────────────────────────────
// Cluster Timeline Event — Discriminated Union
// ──────────────────────────────────────────────
//
// Unified event type shared between the backend (timeline builder) and the
// frontend (selectors + stepper component). The modal stepper renders a
// heterogeneous array of events: tickets created, status transitions,
// attempts launched, PRs (opened/merged), regressions detected, and
// presentation-side aggregated ticket bursts.
//
// Each variant is discriminated by `kind` and carries an ISO `at` timestamp
// for chronological ordering.

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
  fromStatus: string | null; // initial open has no fromStatus
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

/**
 * Helper to enforce exhaustive switch over event.kind. Throws at runtime if a
 * new variant is added without handling.
 *
 * @example
 * ```ts
 * switch (event.kind) {
 *   case "ticket_created":     return renderTicketCreated(event);
 *   case "status_transition":  return renderStatusTransition(event);
 *   case "attempt_launched":   return renderAttemptLaunched(event);
 *   case "pr_opened":          return renderPrOpened(event);
 *   case "pr_merged":          return renderPrMerged(event);
 *   case "regression_detected":return renderRegressionDetected(event);
 *   case "ticket_burst":       return renderTicketBurst(event);
 *   default:                   return assertNeverEvent(event);
 * }
 * ```
 */
export const assertNeverEvent = (event: never): never => {
  throw new Error(
    `Unhandled cluster timeline event kind: ${JSON.stringify(event)}`,
  );
};

// ──────────────────────────────────────────────
// Compile-time exhaustiveness check
// ──────────────────────────────────────────────
//
// This block is stripped at runtime by the TS compiler's dead-code elimination
// but validates at compile time that every variant of ClusterTimelineEvent is
// handled. If a new variant is added to the union without updating the switch
// below, TypeScript will error on `assertNeverEvent(event)`.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _exhaustiveCheck = (event: ClusterTimelineEvent): string => {
  switch (event.kind) {
    case "ticket_created":
      return event.ticketId;
    case "status_transition":
      return event.toStatus;
    case "attempt_launched":
      return event.attemptId;
    case "pr_opened":
      return event.prUrl;
    case "pr_merged":
      return event.prUrl;
    case "regression_detected":
      return event.newItemIds.join(",");
    case "ticket_burst":
      return event.ticketIds.join(",");
    default:
      return assertNeverEvent(event);
  }
};
