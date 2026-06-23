import type {
  AgentOutputEvent,
  AgentOutputEventType,
  CanonicalEventKind,
} from "@almirant/stream-consumer";

// Re-export the canonical type so consumers within this service can import locally.
export type { AgentOutputEvent, AgentOutputEventType };

/**
 * Terminal event types that should flush the coalescer immediately.
 * Used only for the old-format (AgentOutputEvent) path. When the runner
 * has CANONICAL_EVENTS_ENABLED, these events are suppressed and the
 * canonical terminal kinds below take over.
 */
export const TERMINAL_EVENT_TYPES: ReadonlySet<AgentOutputEventType> = new Set([
  "done",
  "error",
]);

/**
 * Coalesceable event types that can be batched together.
 * Old-format path only — see CANONICAL_COALESCEABLE_KINDS for the v2 equivalent.
 */
export const COALESCEABLE_EVENT_TYPES: ReadonlySet<AgentOutputEventType> = new Set([
  "step",
]);

/** Terminal canonical event kinds (flush immediately). */
export const CANONICAL_TERMINAL_KINDS: ReadonlySet<CanonicalEventKind> = new Set([
  "job.completed",
  "job.incomplete",
  "job.failed",
  "job.cancelled",
  "job.timeout",
  "session.error",
  "session.closed",
]);

/** Coalesceable canonical event kinds (can be batched). */
export const CANONICAL_COALESCEABLE_KINDS: ReadonlySet<CanonicalEventKind> = new Set([
  "agent.step",
  "heartbeat",
]);

export type ProcessingStats = {
  totalProcessed: number;
  totalFailed: number;
  totalCoalesced: number;
  totalPublished: number;
  lastProcessedAt: string | null;
  uptimeSeconds: number;
};
