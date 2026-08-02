// ---------------------------------------------------------------------------
// Agent output event — canonical type unifying Discord + Web output events
// ---------------------------------------------------------------------------

export type AgentOutputEventType =
  | "message"
  | "raw"
  | "step"
  | "done"
  | "error"
  | "warn"
  | "question"
  | "waiting"
  | "wave_start"
  | "agent_done"
  | "wave_end"
  | "response_complete"
  | "heartbeat"
  | "rich_message"
  | "thread_rename"
  | "thread_close"
  | "reaction"
  | "edit_message";

export type AgentOutputEvent = {
  // Identity
  jobId: string;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  timestamp: number;
  sequenceNumber: number;
  sequenceProtocolVersion?: "durable.v2";
  claimAttemptId?: string;

  // Content
  type: AgentOutputEventType;
  content?: string;
  contentType?: "thinking" | "text" | "tool_use";

  // Type-specific payloads
  description?: string;
  summary?: string;
  reason?: string;
  text?: string;
  options?: string[];
  agents?: Array<{ agent: string; taskId: string; title: string }>;
  agent?: string;
  taskId?: string;
  status?: "SUCCESS" | "FAILED";
  successCount?: number;
  totalCount?: number;
  elapsedMs?: number;
  payload?: Record<string, unknown>;

  // Discord-specific fields
  name?: string;              // thread_rename
  messageId?: string;         // reaction, edit_message
  emoji?: string;             // reaction
};

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export type StreamPublisherConfig = {
  redisUrl: string;
  streamName?: string; // default: "agent-output"
  maxLen?: number; // MAXLEN for XTRIM, default: 100000
  /** Hard cap for a Redis command even when the socket stays open silently. */
  commandTimeoutMs?: number;
};

export type StreamReaderConfig = {
  redisUrl: string;
  streamName?: string; // default: "agent-output"
  dlqStreamName?: string; // default: "agent-output:dlq"
  consumerGroup: string;
  consumerId: string;
  blockMs?: number; // default: 5000
  batchSize?: number; // default: 10
  /**
   * Handlers dispatched concurrently within one XREADGROUP page.
   *
   * Default 1 reproduces the historical strictly-sequential loop exactly. Values
   * above 1 put several handlers in flight at once, which is the only way a
   * handler-side collector can ever accumulate more than one event per write: a
   * size threshold alone self-deadlocks against a serial loop, because the
   * single in-flight handler is the only thing that could fill the buffer.
   *
   * A consumer whose traffic needs ordering must re-serialize that traffic
   * itself; see the per-job canonical turnstile in the web-bridge consumer.
   */
  pageConcurrency?: number; // default: 1
};

export type RetryConfig = {
  maxRetries?: number; // default: 5
  baseDelayMs?: number; // default: 200
  maxDelayMs?: number; // default: 30000
  recoveryIntervalMs?: number; // default: 1000
};

export type StreamConsumerMetrics = {
  totalProcessed: number;
  totalFailed: number;
  totalRetried: number;
  totalDlq: number;
  processingRate: number;
  lastProcessedAt: string | null;
  pendingCount: number;
  streamLag: number;
  oldestPendingMs: number;
  status: "healthy" | "degraded" | "unhealthy";
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_STREAM_NAME = "agent-output";
export const DEFAULT_DLQ_STREAM_NAME = "agent-output:dlq";
export const DEFAULT_MAX_LEN = 100_000;
