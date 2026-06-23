// ---------------------------------------------------------------------------
// Event adapter interface — translates SSE events to canonical events
// ---------------------------------------------------------------------------

import type { CanonicalEvent } from "@almirant/stream-consumer";

export type SseEvent = {
  event?: string;
  data: string;
};

export type EventAdapter = {
  /** Process a single SSE event, returning zero or more canonical events. */
  processEvent(sseEvent: SseEvent): CanonicalEvent[];
  /** Flush any buffered state (e.g. accumulated tool_use JSON). */
  flush(): CanonicalEvent[];
  /** Whether there are active background agents (suppresses idle termination). */
  hasActiveBackgroundAgents(): boolean;
};
