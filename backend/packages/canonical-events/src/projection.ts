import type { CanonicalEvent, CanonicalEventEnvelope } from "./index.js";

export const CANONICAL_PROTOCOL_VERSION = "canonical.v2" as const;
export const CANONICAL_PROJECTOR_VERSION = 3;

export type CanonicalSessionStatus =
  | "idle"
  | "running"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "cancelled";

export type CanonicalProjectionBlock =
  | {
      id: string;
      type: "text" | "thinking";
      turnId: string | null;
      content: string;
      firstSequence: number;
      lastSequence: number;
    }
  | {
      id: string;
      type: "tool_call";
      turnId: string | null;
      toolCallId: string;
      toolName: string;
      status: "running" | "success" | "error";
      inputPreview?: string;
      outputPreview?: string;
      firstSequence: number;
      lastSequence: number;
    }
  | {
      id: string;
      type: "event";
      turnId: string | null;
      kind: string;
      label: string;
      sequence: number;
    };

export type CanonicalProjectionQuestion = {
  questionId: string;
  turnId: string | null;
  questionText: string;
  options: string[];
  questions?: Array<{ text: string; options: string[] }>;
  questionType?: "single_choice" | "multi_choice" | "free_text";
  expiresAt?: string | null;
  required: boolean;
};

export type CanonicalSessionProjection = {
  protocolVersion: typeof CANONICAL_PROTOCOL_VERSION;
  projectorVersion: typeof CANONICAL_PROJECTOR_VERSION;
  sessionId: string;
  jobId: string;
  workspaceId: string;
  status: CanonicalSessionStatus;
  currentTurnId: string | null;
  lastSequenceNumber: number;
  processedEventIds: string[];
  duplicateCount: number;
  outOfOrderCount: number;
  activeQuestion: CanonicalProjectionQuestion | null;
  pendingFollowUp: { prompt: string; expiresAt?: string | null } | null;
  blocks: CanonicalProjectionBlock[];
  activeToolCalls: Record<string, Extract<CanonicalProjectionBlock, { type: "tool_call" }>>;
  updatedAt: string;
};

export type CanonicalEnvelopeMetadata = {
  protocolVersion: typeof CANONICAL_PROTOCOL_VERSION;
  schemaVersion: typeof CANONICAL_PROTOCOL_VERSION;
  eventId: string;
  turnId?: string;
  causationId?: string;
  correlationId?: string;
  sourceRuntime?: string;
  occurredAt: string;
};

export type CanonicalEventEnvelopeV2 = CanonicalEventEnvelope & CanonicalEnvelopeMetadata;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const getCanonicalEventId = (envelope: CanonicalEventEnvelope): string => {
  const existing = getString((envelope as Partial<CanonicalEventEnvelopeV2>).eventId);
  if (existing) return existing;
  const metadata = isRecord(envelope.event.metadata) ? envelope.event.metadata : {};
  return (
    getString(metadata.eventId) ??
    `${envelope.jobId}:${envelope.sequenceNumber}:${envelope.event.kind}`
  );
};

export const getCanonicalTurnId = (envelope: CanonicalEventEnvelope): string | null => {
  const direct = getString((envelope as Partial<CanonicalEventEnvelopeV2>).turnId);
  if (direct) return direct;
  const metadata = isRecord(envelope.event.metadata) ? envelope.event.metadata : {};
  return getString(metadata.turnId) ?? null;
};

export const normalizeCanonicalEnvelope = (
  envelope: CanonicalEventEnvelope,
): CanonicalEventEnvelopeV2 => {
  const metadata = isRecord(envelope.event.metadata) ? envelope.event.metadata : {};
  const existing = envelope as Partial<CanonicalEventEnvelopeV2>;
  const eventId = getCanonicalEventId(envelope);
  const turnId = getCanonicalTurnId(envelope) ?? undefined;
  const occurredAt =
    getString(existing.occurredAt) ??
    getString(metadata.occurredAt) ??
    new Date(envelope.timestamp || Date.now()).toISOString();

  return {
    ...envelope,
    protocolVersion: CANONICAL_PROTOCOL_VERSION,
    schemaVersion: CANONICAL_PROTOCOL_VERSION,
    eventId,
    ...(turnId ? { turnId } : {}),
    ...(getString(existing.causationId) ?? getString(metadata.causationId)
      ? { causationId: getString(existing.causationId) ?? getString(metadata.causationId) }
      : {}),
    ...(getString(existing.correlationId) ?? getString(metadata.correlationId)
      ? { correlationId: getString(existing.correlationId) ?? getString(metadata.correlationId) }
      : {}),
    ...(getString(existing.sourceRuntime) ?? getString(metadata.sourceRuntime)
      ? { sourceRuntime: getString(existing.sourceRuntime) ?? getString(metadata.sourceRuntime) }
      : {}),
    occurredAt,
    event: {
      ...envelope.event,
      metadata: {
        ...metadata,
        schemaVersion: CANONICAL_PROTOCOL_VERSION,
        eventId,
        ...(turnId ? { turnId } : {}),
        occurredAt,
      },
    },
  };
};

export const createInitialCanonicalSessionProjection = ({
  sessionId,
  jobId,
  workspaceId,
}: {
  sessionId: string;
  jobId: string;
  workspaceId: string;
}): CanonicalSessionProjection => ({
  protocolVersion: CANONICAL_PROTOCOL_VERSION,
  projectorVersion: CANONICAL_PROJECTOR_VERSION,
  sessionId,
  jobId,
  workspaceId,
  status: "idle",
  currentTurnId: null,
  lastSequenceNumber: -1,
  processedEventIds: [],
  duplicateCount: 0,
  outOfOrderCount: 0,
  activeQuestion: null,
  pendingFollowUp: null,
  blocks: [],
  activeToolCalls: {},
  updatedAt: new Date(0).toISOString(),
});

const rememberProcessed = (
  projection: CanonicalSessionProjection,
  eventId: string,
): CanonicalSessionProjection => ({
  ...projection,
  processedEventIds: [...projection.processedEventIds, eventId].slice(-1000),
});

const appendOrMergeTextBlock = (
  projection: CanonicalSessionProjection,
  envelope: CanonicalEventEnvelopeV2,
  type: "text" | "thinking",
  content: string,
): CanonicalSessionProjection => {
  const turnId = envelope.turnId ?? projection.currentTurnId;
  const blocks = [...projection.blocks];
  const last = blocks[blocks.length - 1];

  if (last?.type === type && last.turnId === (turnId ?? null)) {
    blocks[blocks.length - 1] = {
      ...last,
      content: last.content + content,
      lastSequence: envelope.sequenceNumber,
    };
  } else {
    blocks.push({
      id: `${type}-${envelope.sequenceNumber}`,
      type,
      turnId: turnId ?? null,
      content,
      firstSequence: envelope.sequenceNumber,
      lastSequence: envelope.sequenceNumber,
    });
  }

  return { ...projection, blocks };
};

const upsertToolCall = (
  projection: CanonicalSessionProjection,
  envelope: CanonicalEventEnvelopeV2,
  patch: Partial<Extract<CanonicalProjectionBlock, { type: "tool_call" }>> & {
    toolCallId: string;
    toolName: string;
  },
): CanonicalSessionProjection => {
  const current = projection.activeToolCalls[patch.toolCallId];
  const turnId = envelope.turnId ?? projection.currentTurnId;
  const next: Extract<CanonicalProjectionBlock, { type: "tool_call" }> = {
    id: current?.id ?? `tool-${patch.toolCallId}`,
    type: "tool_call",
    turnId: current?.turnId ?? turnId ?? null,
    toolCallId: patch.toolCallId,
    toolName: patch.toolName,
    status: patch.status ?? current?.status ?? "running",
    inputPreview: patch.inputPreview ?? current?.inputPreview,
    outputPreview: patch.outputPreview ?? current?.outputPreview,
    firstSequence: current?.firstSequence ?? envelope.sequenceNumber,
    lastSequence: envelope.sequenceNumber,
  };

  const activeToolCalls = { ...projection.activeToolCalls, [patch.toolCallId]: next };
  const existingIndex = projection.blocks.findIndex(
    (block) => block.type === "tool_call" && block.toolCallId === patch.toolCallId,
  );
  const blocks = [...projection.blocks];
  if (existingIndex >= 0) {
    blocks[existingIndex] = next;
  } else {
    blocks.push(next);
  }

  return { ...projection, activeToolCalls, blocks };
};

const appendEventBlock = (
  projection: CanonicalSessionProjection,
  envelope: CanonicalEventEnvelopeV2,
  label: string,
): CanonicalSessionProjection => ({
  ...projection,
  blocks: [
    ...projection.blocks,
    {
      id: `event-${envelope.sequenceNumber}`,
      type: "event",
      turnId: envelope.turnId ?? projection.currentTurnId ?? null,
      kind: envelope.event.kind,
      label,
      sequence: envelope.sequenceNumber,
    },
  ],
});

const getQuestionId = (event: Extract<CanonicalEvent, { kind: "agent.question" }>, envelope: CanonicalEventEnvelopeV2): string => {
  const metadata = isRecord(event.metadata) ? event.metadata : {};
  return (
    getString((event as typeof event & { questionId?: string }).questionId) ??
    getString(metadata.questionId) ??
    `question-${envelope.sequenceNumber}`
  );
};

export const reduceCanonicalSessionProjection = (
  projection: CanonicalSessionProjection,
  inputEnvelope: CanonicalEventEnvelope,
): CanonicalSessionProjection => {
  const envelope = normalizeCanonicalEnvelope(inputEnvelope);

  if (projection.processedEventIds.includes(envelope.eventId)) {
    return {
      ...projection,
      duplicateCount: projection.duplicateCount + 1,
    };
  }

  const sequenceRegression = envelope.sequenceNumber <= projection.lastSequenceNumber;
  let next = rememberProcessed(
    {
      ...projection,
      outOfOrderCount: projection.outOfOrderCount + (sequenceRegression ? 1 : 0),
      lastSequenceNumber: Math.max(projection.lastSequenceNumber, envelope.sequenceNumber),
      currentTurnId: envelope.turnId ?? projection.currentTurnId,
      updatedAt: envelope.occurredAt,
    },
    envelope.eventId,
  );

  const event = envelope.event;
  switch (event.kind) {
    case "turn.started":
      return {
        ...next,
        status: "running",
        currentTurnId: event.turnId,
        activeQuestion: null,
        pendingFollowUp: null,
      };

    case "turn.completed":
      return {
        ...next,
        status: next.status === "failed" || next.status === "cancelled" ? next.status : "idle",
        currentTurnId: next.currentTurnId === event.turnId ? null : next.currentTurnId,
        activeQuestion: null,
        pendingFollowUp: null,
      };

    case "turn.awaiting_user":
      return {
        ...next,
        status: "awaiting_user",
        currentTurnId: event.turnId,
      };

    case "turn.resumed":
      return {
        ...next,
        status: "running",
        currentTurnId: event.turnId,
        activeQuestion: null,
        pendingFollowUp: null,
      };

    case "agent.text":
      return appendOrMergeTextBlock({ ...next, status: "running" }, envelope, "text", event.content);

    case "agent.thinking":
      return appendOrMergeTextBlock({ ...next, status: "running" }, envelope, "thinking", event.content);

    case "agent.text.complete":
      return appendOrMergeTextBlock({ ...next, status: "running" }, envelope, "text", event.fullText);

    case "agent.tool_call.start":
      return upsertToolCall({ ...next, status: "running" }, envelope, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        inputPreview: event.inputPreview,
        status: "running",
      });

    case "agent.tool_call.result":
      return upsertToolCall(next, envelope, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        outputPreview: event.outputPreview,
        status: event.success ? "success" : "error",
      });

    case "agent.question":
      return {
        ...next,
        status: "awaiting_user",
        activeQuestion: {
          questionId: getQuestionId(event, envelope),
          turnId: envelope.turnId ?? next.currentTurnId,
          questionText: event.questionText,
          options: event.options ?? [],
          ...(event.questions ? { questions: event.questions } : {}),
          ...(event.questionType ? { questionType: event.questionType } : {}),
          expiresAt: (event as typeof event & { expiresAt?: string }).expiresAt ?? null,
          required: (event as typeof event & { required?: boolean }).required ?? true,
        },
        pendingFollowUp: null,
      };

    case "user.answer.submitted":
      return {
        ...next,
        status: "running",
        activeQuestion: null,
        pendingFollowUp: null,
      };

    case "agent.question.resolved":
      return {
        ...next,
        status: "running",
        activeQuestion: null,
      };

    case "session.awaiting_user":
      return {
        ...next,
        status: "awaiting_user",
        pendingFollowUp: { prompt: event.prompt, expiresAt: event.expiresAt ?? null },
        activeQuestion: null,
      };

    case "session.idle":
      return {
        ...next,
        status: next.status === "completed" || next.status === "failed" || next.status === "cancelled" ? next.status : "idle",
      };

    case "job.completed":
      return { ...next, status: "completed", activeQuestion: null, pendingFollowUp: null };

    case "job.failed":
    case "session.error":
      return { ...next, status: "failed" };

    case "job.cancelled":
      return { ...next, status: "cancelled" };

    case "agent.step":
      return appendEventBlock(next, envelope, event.description);

    case "agent.file.read":
      return appendEventBlock(next, envelope, `Read ${event.filePath}`);

    case "agent.file.write":
      return appendEventBlock(next, envelope, `Wrote ${event.filePath}`);

    case "agent.file.edit":
      return appendEventBlock(next, envelope, `Edited ${event.filePath}`);

    case "agent.bash.execute":
      return appendEventBlock(next, envelope, `Ran ${event.command}`);

    default:
      return next;
  }
};

export const buildCanonicalSessionProjection = (
  envelopes: CanonicalEventEnvelope[],
): CanonicalSessionProjection | null => {
  const first = envelopes[0];
  if (!first) return null;

  return envelopes.reduce(
    reduceCanonicalSessionProjection,
    createInitialCanonicalSessionProjection({
      sessionId: first.sessionId,
      jobId: first.jobId,
      workspaceId: first.workspaceId,
    }),
  );
};
