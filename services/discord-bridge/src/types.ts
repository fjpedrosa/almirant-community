import type { AgentOutputEvent } from "@almirant/stream-consumer";

// Re-export the canonical type so consumers within this service can import locally.
export type { AgentOutputEvent };

export type ProcessingStats = {
  totalProcessed: number;
  totalFailed: number;
  /** Count of events successfully routed to the renderer. */
  totalPublished: number;
  lastProcessedAt: string | null;
  uptimeSeconds: number;
};
