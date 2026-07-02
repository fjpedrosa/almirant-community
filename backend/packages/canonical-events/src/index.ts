// ---------------------------------------------------------------------------
// Canonical event types — strongly typed discriminated union for agent output
// ---------------------------------------------------------------------------

// ---- Agent output events ----

export type AgentThinkingEvent = {
  kind: "agent.thinking";
  content: string;
};

export type AgentTextEvent = {
  kind: "agent.text";
  content: string;
};

export type AgentTextCompleteEvent = {
  kind: "agent.text.complete";
  fullText: string;
};

// ---- Tool call events ----

export type AgentToolCallStartEvent = {
  kind: "agent.tool_call.start";
  toolName: string;
  toolCallId: string;
  inputPreview?: string;
};

export type AgentToolCallResultEvent = {
  kind: "agent.tool_call.result";
  toolCallId: string;
  toolName: string;
  success: boolean;
  outputPreview?: string;
  durationMs?: number;
};

// ---- File operation events ----

export type AgentFileReadEvent = {
  kind: "agent.file.read";
  toolCallId: string;
  filePath: string;
  lineRange?: string;
};

export type AgentFileWriteEvent = {
  kind: "agent.file.write";
  toolCallId: string;
  filePath: string;
};

export type AgentFileEditEvent = {
  kind: "agent.file.edit";
  toolCallId: string;
  filePath: string;
};

// ---- Shell events ----

export type AgentBashExecuteEvent = {
  kind: "agent.bash.execute";
  toolCallId: string;
  command: string;
  description?: string;
};

export type AgentBashOutputEvent = {
  kind: "agent.bash.output";
  toolCallId: string;
  output: string;
  exitCode?: number;
};

// ---- Sub-agent events ----

export type AgentSubagentSpawnEvent = {
  kind: "agent.subagent.spawn";
  subagentId: string;
  description: string;
  isBackground: boolean;
  subagentType?: string;
};

export type AgentSubagentCompleteEvent = {
  kind: "agent.subagent.complete";
  subagentId: string;
  success: boolean;
  reason?: string;
};

// ---- Final summary event ----

export type AgentSummaryEvent = {
  kind: "agent.summary";
  text: string;
  section: "Summary" | "Resumen";
};

// ---- Wave events ----

export type AgentWaveStartEvent = {
  kind: "agent.wave.start";
  agents: Array<{ agent: string; taskId: string; title: string }>;
};

export type AgentWaveDoneEvent = {
  kind: "agent.wave.agent_done";
  agent: string;
  taskId: string;
  success: boolean;
  reason?: string;
};

export type AgentWaveEndEvent = {
  kind: "agent.wave.end";
  successCount: number;
  totalCount: number;
};

// ---- Interaction events ----

export type AgentQuestionEvent = {
  kind: "agent.question";
  /** Stable interaction id. Legacy producers may omit it; consumers fallback to sequence. */
  questionId?: string;
  questionText: string;
  options?: string[];
  questions?: Array<{
    text: string;
    options: string[];
  }>;
  questionType?: "single_choice" | "multi_choice" | "free_text";
  interactionType?: "free_text" | "single_choice" | "multi_choice" | "approval";
  expiresAt?: string;
  required?: boolean;
};

export type AgentQuestionResolvedEvent = {
  kind: "agent.question.resolved";
  questionId: string;
};

export type UserAnswerSubmittedEvent = {
  kind: "user.answer.submitted";
  questionId?: string;
  answerPreview?: string;
};

export type AgentPermissionRequestEvent = {
  kind: "agent.permission.request";
  toolName: string;
  description?: string;
};

export type AgentStepEvent = {
  kind: "agent.step";
  description: string;
};

// ---- Session lifecycle events ----

export type SessionConnectedEvent = {
  kind: "session.connected";
};

export type SessionIdleEvent = {
  kind: "session.idle";
  hasBackgroundAgents: boolean;
  isPlanningJob: boolean;
};

export type SessionAwaitingUserEvent = {
  kind: "session.awaiting_user";
  prompt: string;
  expiresAt?: string;
};

export type SessionErrorEvent = {
  kind: "session.error";
  message: string;
  recoverable?: boolean;
  errorCode?: string;
  errorCategory?: "agent" | "infra" | "config" | "quota";
};

export type SessionClosedEvent = {
  kind: "session.closed";
  reason?: string;
};

// ---- Turn lifecycle events ----

export type TurnStartedEvent = {
  kind: "turn.started";
  turnId: string;
  reason?: "initial" | "user_prompt" | "resume" | "queued_prompt" | "system";
};

export type TurnAwaitingUserEvent = {
  kind: "turn.awaiting_user";
  turnId: string;
  interactionId?: string;
};

export type TurnResumedEvent = {
  kind: "turn.resumed";
  turnId: string;
  interactionId?: string;
};

export type TurnCompletedEvent = {
  kind: "turn.completed";
  turnId: string;
  outcome?: "completed" | "awaiting_user" | "interrupted" | "failed";
};

// ---- Job lifecycle events ----

export type JobStartedEvent = {
  kind: "job.started";
  model?: string;
  branch?: string;
};

export type JobCompletedEvent = {
  kind: "job.completed";
  summary?: string;
  elapsedMs?: number;
};

export type JobIncompleteEvent = {
  kind: "job.incomplete";
  summary?: string;
  elapsedMs?: number;
  missingWorkItemIds?: string[];
};

export type JobFailedEvent = {
  kind: "job.failed";
  errorMessage: string;
  elapsedMs?: number;
  errorCode?: string;
  errorCategory?: "agent" | "infra" | "config" | "quota";
};

export type JobCancelledEvent = {
  kind: "job.cancelled";
  reason?: string;
};

export type JobTimeoutEvent = {
  kind: "job.timeout";
  elapsedMs: number;
};

// ---- System events ----

export type HeartbeatEvent = {
  kind: "heartbeat";
  elapsedMs?: number;
};

export type SystemInfoEvent = {
  kind: "system.info";
  message: string;
  payload?: Record<string, unknown>;
};

export type SystemWarnEvent = {
  kind: "system.warn";
  message: string;
  payload?: Record<string, unknown>;
};

// ---- Message queue events ----

export type MessageQueuedCanonical = {
  kind: "message.queued";
  messageId: string;
  position: number;
  queueDepth: number;
};

export type MessageDequeuedCanonical = {
  kind: "message.dequeued";
  messageId: string;
  remainingInQueue: number;
};

export type CanonicalEventBase = { metadata?: Record<string, unknown> };

export type CanonicalEvent = (
  | AgentThinkingEvent
  | AgentTextEvent
  | AgentTextCompleteEvent
  | AgentToolCallStartEvent
  | AgentToolCallResultEvent
  | AgentFileReadEvent
  | AgentFileWriteEvent
  | AgentFileEditEvent
  | AgentBashExecuteEvent
  | AgentBashOutputEvent
  | AgentSubagentSpawnEvent
  | AgentSubagentCompleteEvent
  | AgentSummaryEvent
  | AgentWaveStartEvent
  | AgentWaveDoneEvent
  | AgentWaveEndEvent
  | AgentQuestionEvent
  | AgentQuestionResolvedEvent
  | UserAnswerSubmittedEvent
  | AgentPermissionRequestEvent
  | AgentStepEvent
  | SessionConnectedEvent
  | SessionIdleEvent
  | SessionAwaitingUserEvent
  | SessionErrorEvent
  | SessionClosedEvent
  | TurnStartedEvent
  | TurnAwaitingUserEvent
  | TurnResumedEvent
  | TurnCompletedEvent
  | JobStartedEvent
  | JobCompletedEvent
  | JobIncompleteEvent
  | JobFailedEvent
  | JobCancelledEvent
  | JobTimeoutEvent
  | HeartbeatEvent
  | SystemInfoEvent
  | SystemWarnEvent
  | MessageQueuedCanonical
  | MessageDequeuedCanonical
) & CanonicalEventBase;

export type CanonicalEventKind = CanonicalEvent["kind"];

export type CanonicalEventEnvelope = {
  jobId: string;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  timestamp: number;
  sequenceNumber: number;
  protocolVersion?: "canonical.v1" | "canonical.v2";
  schemaVersion?: "canonical.v1" | "canonical.v2";
  eventId?: string;
  turnId?: string;
  causationId?: string;
  correlationId?: string;
  sourceRuntime?: string;
  occurredAt?: string;
  event: CanonicalEvent;
};


export type NativeEventEnvelope = {
  jobId: string;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  timestamp: number;
  sequenceNumber: number;
  nativeEventType: string;
  sourceFormat: string;
  provider?: string;
  codingAgent?: string;
  runtimeSessionId?: string;
  emittedAt?: string;
  payload: Record<string, unknown>;
};

export const serializeNativeEnvelope = (
  envelope: NativeEventEnvelope,
): string[] => {
  const fields: string[] = [];

  fields.push("jobId", envelope.jobId);
  fields.push("sessionId", envelope.sessionId);
  fields.push("workspaceId", envelope.workspaceId);
  fields.push("threadId", envelope.threadId);
  fields.push("timestamp", String(envelope.timestamp));
  fields.push("sequenceNumber", String(envelope.sequenceNumber));
  fields.push("nativeEventType", envelope.nativeEventType);
  fields.push("sourceFormat", envelope.sourceFormat);
  fields.push("payload", JSON.stringify(envelope.payload));
  fields.push("_format", "native");

  if (envelope.provider) fields.push("provider", envelope.provider);
  if (envelope.codingAgent) fields.push("codingAgent", envelope.codingAgent);
  if (envelope.runtimeSessionId) fields.push("runtimeSessionId", envelope.runtimeSessionId);
  if (envelope.emittedAt) fields.push("emittedAt", envelope.emittedAt);

  return fields;
};

export const deserializeNativeEnvelope = (
  fields: string[],
): NativeEventEnvelope | null => {
  const map = new Map<string, string>();

  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === undefined || value === undefined) {
      continue;
    }
    map.set(key, value);
  }

  if (
    map.get("_format") !== "native" ||
    !map.has("payload") ||
    !map.has("nativeEventType") ||
    !map.has("sourceFormat")
  ) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(map.get("payload")!);
    payload =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
  } catch {
    return null;
  }

  return {
    jobId: map.get("jobId") ?? "",
    sessionId: map.get("sessionId") ?? "",
    workspaceId: map.get("workspaceId") ?? "",
    threadId: map.get("threadId") ?? "",
    timestamp: Number(map.get("timestamp") ?? 0),
    sequenceNumber: Number(map.get("sequenceNumber") ?? 0),
    nativeEventType: map.get("nativeEventType") ?? "unknown",
    sourceFormat: map.get("sourceFormat") ?? "sse",
    provider: map.get("provider") || undefined,
    codingAgent: map.get("codingAgent") || undefined,
    runtimeSessionId: map.get("runtimeSessionId") || undefined,
    emittedAt: map.get("emittedAt") || undefined,
    payload,
  };
};

export const isNativeFormat = (fields: string[]): boolean => {
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === "_format" && value === "native") {
      return true;
    }
  }

  return false;
};

export const serializeCanonicalEnvelope = (
  envelope: CanonicalEventEnvelope,
): string[] => {
  const fields: string[] = [];

  fields.push("jobId", envelope.jobId);
  fields.push("sessionId", envelope.sessionId);
  fields.push("workspaceId", envelope.workspaceId);
  fields.push("threadId", envelope.threadId);
  fields.push("timestamp", String(envelope.timestamp));
  fields.push("sequenceNumber", String(envelope.sequenceNumber));
  if (envelope.protocolVersion) fields.push("protocolVersion", envelope.protocolVersion);
  if (envelope.schemaVersion) fields.push("schemaVersion", envelope.schemaVersion);
  if (envelope.eventId) fields.push("eventId", envelope.eventId);
  if (envelope.turnId) fields.push("turnId", envelope.turnId);
  if (envelope.causationId) fields.push("causationId", envelope.causationId);
  if (envelope.correlationId) fields.push("correlationId", envelope.correlationId);
  if (envelope.sourceRuntime) fields.push("sourceRuntime", envelope.sourceRuntime);
  if (envelope.occurredAt) fields.push("occurredAt", envelope.occurredAt);
  fields.push("event", JSON.stringify(envelope.event));
  fields.push("_format", "canonical");

  return fields;
};

export const deserializeCanonicalEnvelope = (
  fields: string[],
): CanonicalEventEnvelope | null => {
  const map = new Map<string, string>();

  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === undefined || value === undefined) {
      continue;
    }
    map.set(key, value);
  }

  if (map.get("_format") !== "canonical" || !map.has("event")) {
    return null;
  }

  let event: CanonicalEvent;
  try {
    event = JSON.parse(map.get("event")!) as CanonicalEvent;
  } catch {
    return null;
  }

  return {
    jobId: map.get("jobId") ?? "",
    sessionId: map.get("sessionId") ?? "",
    workspaceId: map.get("workspaceId") ?? "",
    threadId: map.get("threadId") ?? "",
    timestamp: Number(map.get("timestamp") ?? 0),
    // Absent sequence numbers must NOT collapse to 0: the web-bridge dedup
    // guard would then treat the second such envelope as a regression and drop
    // it. Represent absence as a non-finite value so the consumer can bypass
    // dedup for envelopes that carry no sequence number (e.g. an older producer
    // during a rolling deploy).
    sequenceNumber: map.has("sequenceNumber")
      ? Number(map.get("sequenceNumber"))
      : Number.NaN,
    ...(map.get("protocolVersion") ? { protocolVersion: map.get("protocolVersion") as "canonical.v1" | "canonical.v2" } : {}),
    ...(map.get("schemaVersion") ? { schemaVersion: map.get("schemaVersion") as "canonical.v1" | "canonical.v2" } : {}),
    ...(map.get("eventId") ? { eventId: map.get("eventId")! } : {}),
    ...(map.get("turnId") ? { turnId: map.get("turnId")! } : {}),
    ...(map.get("causationId") ? { causationId: map.get("causationId")! } : {}),
    ...(map.get("correlationId") ? { correlationId: map.get("correlationId")! } : {}),
    ...(map.get("sourceRuntime") ? { sourceRuntime: map.get("sourceRuntime")! } : {}),
    ...(map.get("occurredAt") ? { occurredAt: map.get("occurredAt")! } : {}),
    event,
  };
};

export const isCanonicalFormat = (fields: string[]): boolean => {
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === "_format" && value === "canonical") {
      return true;
    }
  }

  return false;
};

export {
  CANONICAL_PROTOCOL_VERSION,
  CANONICAL_PROJECTOR_VERSION,
  createInitialCanonicalSessionProjection,
  normalizeCanonicalEnvelope,
  reduceCanonicalSessionProjection,
  buildCanonicalSessionProjection,
  getCanonicalEventId,
  getCanonicalTurnId,
  type CanonicalEnvelopeMetadata,
  type CanonicalEventEnvelopeV2,
  type CanonicalProjectionBlock,
  type CanonicalProjectionQuestion,
  type CanonicalSessionProjection,
  type CanonicalSessionStatus,
} from "./projection";
