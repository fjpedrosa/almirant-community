// ---------------------------------------------------------------------------
// Event handler registry for SSE event processing
//
// Each handler corresponds to a case from the original switch statement in
// consumeSseEvents(). Handlers receive a shared mutable context and a
// dependency bag — they never hold closure state themselves.
// ---------------------------------------------------------------------------

import type { BidirectionalRelay } from "@almirant/remote-agent";
import type { StreamPublisher } from "@almirant/stream-consumer";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import {
  nextSequence,
  publishCanonicalEvent,
} from "./stream-events";
import { POST_IDLE_BACKGROUND_GRACE_MS, PLANNING_INTERACTION_TIMEOUT_MS } from "./event-consumer";

// ---------------------------------------------------------------------------
// Shared mutable context — mirrors the local variables of consumeSseEvents()
// ---------------------------------------------------------------------------

export type EventHandlerContext = {
  buffer: string;
  messageCompleted: boolean;
  lastActivityAt: number;
  errorMessage: string | undefined;
  cancelledByUser: boolean;
  currentContentType: "thinking" | "text" | "tool_use" | undefined;
  previousContentType: "thinking" | "text" | "tool_use" | undefined;
  hasActiveBackgroundAgents: boolean;
  wasIdleWithBackgroundAgents: boolean;
  activeBackgroundSubagentIds: Set<string>;
  pendingPlanningInteraction: {
    interactionId: string;
    questionText?: string;
    source?: string;
  } | null;
  currentToolUseBuffer: string;
  currentTextPart: string;
  lastAssistantText: string;
  accumulatedAssistantText: string;
  gitSignalLogged: boolean;
  prSignalLogged: boolean;
  pendingStreamPublish: boolean;
};

// ---------------------------------------------------------------------------
// Dependency injection bag
// ---------------------------------------------------------------------------

export type EventHandlerDeps = {
  jobId: string;
  /**
   * True when the job is interactive (admits human turns mid-session).
   * Derived from `agent_jobs.interactive`. Includes planning jobs but is
   * not limited to them — any job marked interactive uses the same
   * pause/resume + user-question pipeline.
   */
  isInteractiveJob: boolean;
  webSessionId: string;
  webOrganizationId: string;
  threadId: string;
  eventLogger: RunnerJobEventLogger;
  streamPublisher?: StreamPublisher;
  relay?: BidirectionalRelay;
  abortController: AbortController;
  extractToolMeta: (buf: string) => { toolName?: string; toolCallId?: string };
  publishStreamingUpdate: (force?: boolean) => Promise<void>;
  clearBackgroundAgentWaitState: (reason: "resume" | "completed", completedSubagentId?: string) => void;
  resetBackgroundAgentTimeout: () => void;
  startPostIdleBackgroundGrace: () => void;
  createUserInteraction: (params: {
    questionText: string;
    options?: string[];
    questionContext?: Record<string, unknown> | null;
  }) => Promise<string>;
  awaitUserInteraction: (
    interactionId: string,
    opts?: { questionText?: string; source?: string },
  ) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Handler signature
// ---------------------------------------------------------------------------

export type EventHandler = (
  ctx: EventHandlerContext,
  deps: EventHandlerDeps,
  props: Record<string, unknown>,
  rawEvent: { event?: string; data: string },
) => Promise<void>;

type StructuredQuestion = {
  text: string;
  options: string[];
};

const normalizeQuestionOption = (value: unknown): string | null => {
  if (typeof value === "string") return value;

  if (typeof value === "object" && value !== null) {
    const option = value as Record<string, unknown>;
    const label =
      typeof option.label === "string"
        ? option.label
        : typeof option.value === "string"
          ? option.value
          : "";
    if (!label) return null;
    const description =
      typeof option.description === "string" ? option.description : undefined;
    return description ? `${label}::${description}` : label;
  }

  return null;
};

const normalizeStructuredQuestions = (value: unknown): StructuredQuestion[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((question) => {
      if (typeof question !== "object" || question === null) return null;
      const questionObj = question as Record<string, unknown>;
      const text =
        typeof questionObj.text === "string"
          ? questionObj.text
          : typeof questionObj.question === "string"
            ? questionObj.question
            : "";
      if (!text) return null;

      const options = Array.isArray(questionObj.options)
        ? questionObj.options
            .map(normalizeQuestionOption)
            .filter((option): option is string => option !== null)
        : [];

      return { text, options };
    })
    .filter((question): question is StructuredQuestion => question !== null);
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handlePartDelta: EventHandler = async (ctx, deps, props) => {
  // If the agent resumes after an idle that had background agents,
  // reset the flag. The new turn will re-detect if more agents are launched.
  if (ctx.wasIdleWithBackgroundAgents) {
    deps.clearBackgroundAgentWaitState("resume");
  }

  ctx.messageCompleted = false;
  if (typeof props.contentType === "string") {
    ctx.currentContentType = props.contentType as "thinking" | "text" | "tool_use";
  }
  // OpenCode may use partType instead of contentType
  if (!ctx.currentContentType && typeof props.partType === "string") {
    const mapped = props.partType === "reasoning" ? "thinking" : props.partType;
    if (mapped === "thinking" || mapped === "text" || mapped === "tool_use") {
      ctx.currentContentType = mapped;
    }
  }

  // Track tool_use buffer transitions for background agent detection.
  if (ctx.previousContentType === "tool_use" && ctx.currentContentType !== "tool_use") {
    ctx.currentToolUseBuffer = "";
  }
  ctx.previousContentType = ctx.currentContentType;

  if (typeof props.delta === "string") {
    // Accumulate tool_use deltas to detect background agent launches.
    if (ctx.currentContentType === "tool_use") {
      ctx.currentToolUseBuffer += props.delta;
      if (
        !ctx.hasActiveBackgroundAgents &&
        /run_in_background["\s]*[:=]\s*true/i.test(ctx.currentToolUseBuffer)
      ) {
        ctx.hasActiveBackgroundAgents = true;
        console.log(`[job:${deps.jobId}] Detected background agent launch — idle termination suppressed`);
        deps.eventLogger.info("session", "session.background_agent_detected", "Background agent detected in tool_use stream");
        deps.resetBackgroundAgentTimeout();
      }
    }

    ctx.buffer += props.delta;
    if (ctx.currentContentType === "text") {
      ctx.currentTextPart += props.delta;
      // Reset background agent timeout on text activity — measures
      // inactivity, not total duration, so active sessions aren't killed.
      if (ctx.hasActiveBackgroundAgents || ctx.activeBackgroundSubagentIds.size > 0) {
        deps.resetBackgroundAgentTimeout();
      }
    }

    // Persist raw transcript chunk for later reconstruction
    if (ctx.currentContentType === "tool_use") {
      const meta = deps.extractToolMeta(ctx.currentToolUseBuffer);
      const isAgentTool = meta.toolName === "Agent" || meta.toolName === "Task";
      deps.eventLogger.transcript(props.delta, ctx.currentContentType, isAgentTool ? {
        toolName: meta.toolName,
        toolCallId: meta.toolCallId,
        isBackground: ctx.hasActiveBackgroundAgents ||
          /run_in_background["\s]*[:=]\s*true/i.test(ctx.currentToolUseBuffer),
      } : undefined);
    } else {
      deps.eventLogger.transcript(props.delta, ctx.currentContentType);
    }

    // Throttled publish to queue
    await deps.publishStreamingUpdate();
    await deps.publishStreamingUpdate();

    if (!ctx.gitSignalLogged && /(\bgit\b|\bclone\b|\bbranch\b|\bcommit\b|\bpush\b)/i.test(props.delta)) {
      ctx.gitSignalLogged = true;
      deps.eventLogger.info("git", "git.signal", "Detected git-related output", {
        snippet: (props.delta as string).slice(0, 200),
      });
    }
    if (!ctx.prSignalLogged && /(\bpull request\b|\bpr\s*#|\bgh pr\b)/i.test(props.delta)) {
      ctx.prSignalLogged = true;
      deps.eventLogger.info("pr", "pr.signal", "Detected PR-related output", {
        snippet: (props.delta as string).slice(0, 200),
      });
    }

    if (deps.isInteractiveJob) {
      // Interactive real-time delivery/persistence is fully canonical.
      // No marker mirroring or buffer replay is needed here.
    }
  }
};

export const handlePartUpdated: EventHandler = async (ctx, deps, props) => {
  ctx.messageCompleted = false;
  if (typeof props.contentType === "string") {
    ctx.currentContentType = props.contentType as "thinking" | "text" | "tool_use";
  }
  // OpenCode may use partType instead of contentType
  if (!ctx.currentContentType && typeof props.partType === "string") {
    const mapped = props.partType === "reasoning" ? "thinking" : props.partType;
    if (mapped === "thinking" || mapped === "text" || mapped === "tool_use") {
      ctx.currentContentType = mapped;
    }
  }
  const part =
    typeof props.part === "object" && props.part !== null
      ? (props.part as Record<string, unknown>)
      : null;
  if (part && typeof part.text === "string") {
    // Persist any content not already transcribed via message.part.delta.
    const prevBuffer = ctx.buffer;
    // Short-circuit when the snapshot only repeats what we already streamed
    // as deltas for the current text part. Without this guard the frontend
    // ends up rendering the same text twice around tool markers because the
    // snapshot is forwarded as `agent.text.complete` on top of the existing
    // `agent.text` deltas.
    if (
      ctx.currentContentType === "text" &&
      part.text === ctx.currentTextPart
    ) {
      return;
    }
    ctx.buffer = part.text;
    if (ctx.currentContentType === "text") {
      ctx.currentTextPart = part.text;
    }

    if (prevBuffer.length === 0 && part.text.length > 0) {
      // First snapshot with no preceding deltas — write full text
      deps.eventLogger.transcript(part.text, ctx.currentContentType);
    } else if (part.text.length > prevBuffer.length && part.text.startsWith(prevBuffer)) {
      // Incremental extension — write only the new part
      const newContent = part.text.slice(prevBuffer.length);
      if (newContent) {
        deps.eventLogger.transcript(newContent, ctx.currentContentType);
      }
    }

    if (deps.isInteractiveJob) {
      // Interactive snapshots are handled through canonical session
      // events; avoid rebuilding legacy text buffers here.
    } else {
      // Non-interactive jobs: force publish the full snapshot
      await deps.publishStreamingUpdate(true);
    }
  }
};

export const handleSessionIdle: EventHandler = async (ctx, deps) => {
  ctx.currentContentType = undefined;
  ctx.previousContentType = undefined;
  if (ctx.currentTextPart.trim()) {
    ctx.lastAssistantText = ctx.currentTextPart;
    ctx.accumulatedAssistantText += ctx.currentTextPart + "\n";
  }
  ctx.currentTextPart = "";

  if (ctx.hasActiveBackgroundAgents) {
    // Background agents are still running — do NOT set messageCompleted.
    ctx.wasIdleWithBackgroundAgents = true;
    console.log(`[job:${deps.jobId}] Session idle with pending background agents — suppressing idle termination, starting ${POST_IDLE_BACKGROUND_GRACE_MS}ms grace period`);
    deps.eventLogger.info("session", "session.idle_suppressed", "Idle suppressed: background agents pending, grace period started");
    deps.eventLogger.info("session", "session.waiting_background_agents",
      "Waiting for background agents to complete");
    deps.startPostIdleBackgroundGrace();
  } else if (deps.isInteractiveJob) {
    // Interactive jobs stay alive between turns.
    console.log(`[job:${deps.jobId}] Session idle (interactive) — waiting for next user message`);
    deps.eventLogger.info("session", "session.idle_interactive", "Session idle, waiting for next user message");

    if (ctx.buffer.length > 0) {
      await deps.publishStreamingUpdate(true);
      await deps.publishStreamingUpdate(true);
    }

    if (ctx.pendingPlanningInteraction) {
      const { interactionId, questionText: qText, source: qSource } = ctx.pendingPlanningInteraction;
      ctx.pendingPlanningInteraction = null;
      await deps.awaitUserInteraction(interactionId, { questionText: qText, source: qSource });
      return;
    }

    const prompt = "\u00bfC\u00f3mo te gustar\u00eda continuar?";
    const awaitingExpiresAt = new Date(Date.now() + PLANNING_INTERACTION_TIMEOUT_MS).toISOString();
    if (deps.streamPublisher) {
      await publishCanonicalEvent(deps.streamPublisher, {
        jobId: deps.jobId,
        sessionId: deps.webSessionId,
        organizationId: deps.webOrganizationId,
        threadId: deps.threadId,
        timestamp: Date.now(),
        sequenceNumber: nextSequence(),
        event: {
          kind: "session.awaiting_user",
          prompt,
          expiresAt: awaitingExpiresAt,
        },
      });
    }

    const interactionId = await deps.createUserInteraction({
      questionText: prompt,
      questionContext: {
        source: "session.awaiting_user",
        requiresUserReply: true,
        ui: "chat_input",
      },
    });
    await deps.awaitUserInteraction(interactionId);
    return;
  } else {
    ctx.messageCompleted = true;
    console.log(`[job:${deps.jobId}] Session idle — agent finished`);
    deps.eventLogger.info("session", "session.idle", "Session entered idle state");
  }

  if (ctx.buffer.length > 0) {
    await deps.publishStreamingUpdate(true);
    await deps.publishStreamingUpdate(true);
  }
};

export const handleMessageCompletedOrUpdated: EventHandler = async (ctx, deps) => {
  ctx.currentContentType = undefined;
  if (ctx.currentTextPart.trim()) {
    ctx.lastAssistantText = ctx.currentTextPart;
    ctx.accumulatedAssistantText += ctx.currentTextPart + "\n";
  }
  ctx.currentTextPart = "";
  if (ctx.buffer.length > 0) {
    await deps.publishStreamingUpdate(true);
    await deps.publishStreamingUpdate(true);
  }
};

export const handleQuestionAsked: EventHandler = async (ctx, deps, props, rawEvent) => {
  ctx.messageCompleted = false;
  const questionText =
    typeof props.text === "string"
      ? props.text
      : typeof props.question === "string"
        ? props.question
        : rawEvent.data;

  console.log(`[job:${deps.jobId}] Question: ${questionText.slice(0, 100)}`);
  deps.eventLogger.info("interaction", "interaction.asked", "Agent asked for input", {
    question: questionText.slice(0, 500),
  });

  if (deps.isInteractiveJob) {
    const options = Array.isArray(props.options)
      ? props.options.map((opt: unknown) => {
          const normalized = normalizeQuestionOption(opt);
          return normalized ?? String(opt);
        })
      : [];
    const questions = normalizeStructuredQuestions(props.questions);

    if (ctx.pendingPlanningInteraction) {
      deps.eventLogger.warn("interaction", "interaction.pending_replaced", "Replacing pending interactive interaction before idle", {
        previousInteractionId: ctx.pendingPlanningInteraction.interactionId,
        nextQuestion: questionText.slice(0, 200),
      });
    }

    ctx.pendingPlanningInteraction = {
      interactionId: await deps.createUserInteraction({
        questionText,
        options,
        questionContext: {
          source: "agent_question",
          ...(questions.length > 0 ? { questions } : {}),
        },
      }),
      questionText,
      source: "agent_question",
    };
    return;
  }

  if (deps.relay) {
    await deps.relay.handleOutputEvent({
      type: "question",
      text: questionText,
    }).catch(() => undefined);
  }

  if (
    Array.isArray(props.options) &&
    props.options.length > 0
  ) {
    const options = props.options.map(String);
    if (deps.relay) {
      await deps.relay.handleOutputEvent({ type: "options", options }).catch(() => undefined);
    }
  }
};

export const handlePermissionAsked: EventHandler = async (_ctx, deps, _props, rawEvent) => {
  console.log(
    `[job:${deps.jobId}] Unexpected permission event: ${rawEvent.data}`
  );
};

export const handleSessionClosed: EventHandler = async (_ctx, deps) => {
  console.log(`[job:${deps.jobId}] Session closed`);
  deps.abortController.abort();
};

export const handleSessionError: EventHandler = async (ctx, deps, props, rawEvent) => {
  // Extract error message from nested structure
  const errObj = typeof props.error === "object" && props.error !== null
    ? (props.error as Record<string, unknown>)
    : undefined;
  const errData = typeof errObj?.data === "object" && errObj.data !== null
    ? (errObj.data as Record<string, unknown>)
    : undefined;
  const errMsg =
    typeof errData?.message === "string" ? errData.message
    : typeof errObj?.message === "string" ? errObj.message
    : typeof props.message === "string" ? props.message
    : rawEvent.data;

  // Classify: SQLite/disk errors are recoverable (OpenCode may continue)
  const isRecoverable = /sqlite|disk is full|database.*full/i.test(errMsg);

  if (isRecoverable) {
    console.warn(`[job:${deps.jobId}] Recoverable error (continuing): ${errMsg}`);
    deps.eventLogger.warn("session", "session.recoverable_error", "Recoverable session error", {
      errorMessage: errMsg,
    });
  } else {
    ctx.errorMessage = errMsg;
    console.error(`[job:${deps.jobId}] Fatal session error: ${errMsg}`);
    deps.eventLogger.error("session", "session.error_event", "Fatal session error", {
      errorMessage: errMsg,
    });
    deps.abortController.abort();
  }
};

export const handleSessionStatus: EventHandler = async (ctx, deps, props) => {
  if (props.status !== "error") {
    return;
  }

  const errMsg =
    typeof props.message === "string" && props.message.trim().length > 0
      ? props.message
      : "Runtime reported session status error";

  ctx.errorMessage = errMsg;
  console.error(`[job:${deps.jobId}] Fatal session status error: ${errMsg}`);
  deps.eventLogger.error("session", "session.status_error", "Fatal session status error", {
    errorMessage: errMsg,
  });
  deps.abortController.abort();
};

export const handleMessageQueued: EventHandler = async (_ctx, deps, props) => {
  console.log(`[job:${deps.jobId}] Message queued: ${props.messageId} (depth: ${props.queueDepth})`);
};

export const handleMessageDequeued: EventHandler = async (ctx, deps, props) => {
  ctx.lastActivityAt = Date.now();
  console.log(`[job:${deps.jobId}] Message dequeued: ${props.messageId} (remaining: ${props.remainingInQueue})`);
};

/** No-op handler for known informational events that are silently ignored. */
export const handleNoOp: EventHandler = async () => {
  // Known informational events — ignore silently
};

export const handleDefaultUnknown: EventHandler = async (ctx, deps, _props, rawEvent) => {
  const eventData = JSON.parse(rawEvent.data) as Record<string, unknown>;
  const eventType =
    typeof eventData.type === "string"
      ? eventData.type
      : rawEvent.event ?? "";

  if (
    eventType.includes("error") ||
    typeof eventData.error === "string"
  ) {
    ctx.errorMessage =
      typeof eventData.error === "string"
        ? eventData.error
        : typeof eventData.message === "string"
          ? eventData.message
          : rawEvent.data;
    console.error(`[job:${deps.jobId}] Error event: ${ctx.errorMessage}`);
    deps.eventLogger.error("session", "session.error_event", "Received error event from stream", {
      errorMessage: ctx.errorMessage,
    });
    deps.abortController.abort();
  }
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EVENT_HANDLERS: Record<string, EventHandler> = {
  "message.part.delta": handlePartDelta,
  "message.part.updated": handlePartUpdated,
  "session.idle": handleSessionIdle,
  "message.completed": handleMessageCompletedOrUpdated,
  "message.updated": handleMessageCompletedOrUpdated,
  "question.asked": handleQuestionAsked,
  "permission.asked": handlePermissionAsked,
  "session.closed": handleSessionClosed,
  "session.error": handleSessionError,
  "message.queued": handleMessageQueued,
  "message.dequeued": handleMessageDequeued,
  "session.status": handleSessionStatus,
  // Known informational events — ignore silently
  "server.heartbeat": handleNoOp,
  "server.connected": handleNoOp,
  "session.updated": handleNoOp,
  "session.diff": handleNoOp,
  "step-start": handleNoOp,
  "step-finish": handleNoOp,
};
