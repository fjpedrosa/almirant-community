// ---------------------------------------------------------------------------
// BridgeRenderer — abstract interface for rendering canonical events
// Each bridge adapter (WebSocket, Discord, etc.) implements this interface
// ---------------------------------------------------------------------------

import type {
  CanonicalEvent,
  CanonicalEventEnvelope,
  AgentThinkingEvent,
  AgentTextEvent,
  AgentToolCallStartEvent,
  AgentToolCallResultEvent,
  AgentFileReadEvent,
  AgentFileWriteEvent,
  AgentFileEditEvent,
  AgentBashExecuteEvent,
  AgentSubagentSpawnEvent,
  AgentSubagentCompleteEvent,
  AgentWaveStartEvent,
  AgentWaveDoneEvent,
  AgentWaveEndEvent,
  AgentQuestionEvent,
  AgentPermissionRequestEvent,
  AgentStepEvent,
  SessionIdleEvent,
  SessionAwaitingUserEvent,
  SessionErrorEvent,
  JobCompletedEvent,
  JobIncompleteEvent,
  JobFailedEvent,
  HeartbeatEvent,
  MessageQueuedCanonical,
  MessageDequeuedCanonical,
} from "./canonical-events";

// ---------------------------------------------------------------------------
// Context & Config
// ---------------------------------------------------------------------------

/**
 * Routing metadata extracted from the CanonicalEventEnvelope.
 * Passed to every renderer method so handlers have access to
 * session/job/org context without coupling to the envelope shape.
 */
export type BridgeRendererContext = {
  sessionId: string;
  organizationId: string;
  jobId: string;
  threadId: string;
  timestamp: number;
  sequenceNumber: number;
};

/**
 * Configuration options for initializing a BridgeRenderer.
 */
export type BridgeRendererConfig = {
  /** Optional structured logger instance */
  logger?: {
    info: (msg: string, data?: Record<string, unknown>) => void;
    warn: (msg: string, data?: Record<string, unknown>) => void;
    error: (msg: string, data?: Record<string, unknown>) => void;
    debug: (msg: string, data?: Record<string, unknown>) => void;
  };
};

// ---------------------------------------------------------------------------
// BridgeRenderer interface
// ---------------------------------------------------------------------------

/**
 * Interface that each bridge adapter must implement to handle canonical events.
 * One async method per meaningful event category. Silenced events are routed
 * to the optional `onSilencedEvent` hook instead.
 */
export type BridgeRenderer = {
  // ---- Agent output ----
  renderText(event: AgentTextEvent, ctx: BridgeRendererContext): Promise<void>;
  renderThinking(event: AgentThinkingEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Tool calls ----
  renderToolCallStart(event: AgentToolCallStartEvent, ctx: BridgeRendererContext): Promise<void>;
  renderToolCallResult(event: AgentToolCallResultEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- File operations ----
  renderFileRead(event: AgentFileReadEvent, ctx: BridgeRendererContext): Promise<void>;
  renderFileWrite(event: AgentFileWriteEvent, ctx: BridgeRendererContext): Promise<void>;
  renderFileEdit(event: AgentFileEditEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Shell ----
  renderBashExecute(event: AgentBashExecuteEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Sub-agents ----
  renderSubagentSpawn(event: AgentSubagentSpawnEvent, ctx: BridgeRendererContext): Promise<void>;
  renderSubagentComplete(event: AgentSubagentCompleteEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Waves ----
  renderWaveStart(event: AgentWaveStartEvent, ctx: BridgeRendererContext): Promise<void>;
  renderAgentDone(event: AgentWaveDoneEvent, ctx: BridgeRendererContext): Promise<void>;
  renderWaveEnd(event: AgentWaveEndEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Interaction ----
  renderQuestion(event: AgentQuestionEvent, ctx: BridgeRendererContext): Promise<void>;
  renderPermissionRequest(event: AgentPermissionRequestEvent, ctx: BridgeRendererContext): Promise<void>;
  renderStep(event: AgentStepEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Session lifecycle ----
  renderSessionIdle(event: SessionIdleEvent, ctx: BridgeRendererContext): Promise<void>;
  renderSessionAwaitingUser(event: SessionAwaitingUserEvent, ctx: BridgeRendererContext): Promise<void>;
  renderSessionError(event: SessionErrorEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Job lifecycle ----
  renderJobCompleted(event: JobCompletedEvent, ctx: BridgeRendererContext): Promise<void>;
  renderJobIncomplete(event: JobIncompleteEvent, ctx: BridgeRendererContext): Promise<void>;
  renderJobFailed(event: JobFailedEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- System ----
  renderHeartbeat(event: HeartbeatEvent, ctx: BridgeRendererContext): Promise<void>;

  // ---- Message queue ----
  renderMessageQueued(event: MessageQueuedCanonical, ctx: BridgeRendererContext): Promise<void>;
  renderMessageDequeued(event: MessageDequeuedCanonical, ctx: BridgeRendererContext): Promise<void>;

  // ---- Silenced events (optional) ----
  onSilencedEvent?(event: CanonicalEvent, ctx: BridgeRendererContext): Promise<void>;
};

// ---------------------------------------------------------------------------
// Canonical Router
// ---------------------------------------------------------------------------

/**
 * Extracts BridgeRendererContext from a CanonicalEventEnvelope.
 */
const extractContext = (envelope: CanonicalEventEnvelope): BridgeRendererContext => ({
  sessionId: envelope.sessionId,
  organizationId: envelope.organizationId,
  jobId: envelope.jobId,
  threadId: envelope.threadId,
  timestamp: envelope.timestamp,
  sequenceNumber: envelope.sequenceNumber,
});

/**
 * Creates a canonical event router that dispatches envelope events
 * to the appropriate BridgeRenderer method.
 *
 * Silenced events (events with no meaningful render action) are routed
 * to `renderer.onSilencedEvent` if provided.
 *
 * Uses an exhaustive switch with a `never` assertion in the default
 * branch to ensure all event kinds are handled at compile time.
 */
export const createCanonicalRouter = (
  renderer: BridgeRenderer,
): ((envelope: CanonicalEventEnvelope) => Promise<void>) => {
  return async (envelope: CanonicalEventEnvelope): Promise<void> => {
    const ctx = extractContext(envelope);
    const event = envelope.event;

    switch (event.kind) {
      // ---- Agent output ----
      case "agent.text":
        return renderer.renderText(event, ctx);

      case "agent.thinking":
        return renderer.renderThinking(event, ctx);

      // ---- Tool calls ----
      case "agent.tool_call.start":
        return renderer.renderToolCallStart(event, ctx);

      case "agent.tool_call.result":
        return renderer.renderToolCallResult(event, ctx);

      // ---- File operations ----
      case "agent.file.read":
        return renderer.renderFileRead(event, ctx);

      case "agent.file.write":
        return renderer.renderFileWrite(event, ctx);

      case "agent.file.edit":
        return renderer.renderFileEdit(event, ctx);

      // ---- Shell ----
      case "agent.bash.execute":
        return renderer.renderBashExecute(event, ctx);

      // ---- Sub-agents ----
      case "agent.subagent.spawn":
        return renderer.renderSubagentSpawn(event, ctx);

      case "agent.subagent.complete":
        return renderer.renderSubagentComplete(event, ctx);

      // ---- Waves ----
      case "agent.wave.start":
        return renderer.renderWaveStart(event, ctx);

      case "agent.wave.agent_done":
        return renderer.renderAgentDone(event, ctx);

      case "agent.wave.end":
        return renderer.renderWaveEnd(event, ctx);

      // ---- Interaction ----
      case "agent.question":
        return renderer.renderQuestion(event, ctx);

      case "agent.permission.request":
        return renderer.renderPermissionRequest(event, ctx);

      case "agent.step":
        return renderer.renderStep(event, ctx);

      // ---- Session lifecycle ----
      case "session.idle":
        return renderer.renderSessionIdle(event, ctx);

      case "session.awaiting_user":
        return renderer.renderSessionAwaitingUser(event, ctx);

      case "session.error":
        return renderer.renderSessionError(event, ctx);

      // ---- Job lifecycle ----
      case "job.completed":
        return renderer.renderJobCompleted(event, ctx);

      case "job.incomplete":
        return renderer.renderJobIncomplete(event, ctx);

      case "job.failed":
        return renderer.renderJobFailed(event, ctx);

      // ---- System ----
      case "heartbeat":
        return renderer.renderHeartbeat(event, ctx);

      // ---- Message queue ----
      case "message.queued":
        return renderer.renderMessageQueued(event, ctx);

      case "message.dequeued":
        return renderer.renderMessageDequeued(event, ctx);

      // agent.text.complete — render as text (fullText → content)
      case "agent.text.complete":
        return renderer.renderText(
          { kind: "agent.text", content: event.fullText },
          ctx,
        );

      // ---- Silenced events ----
      case "agent.bash.output":
      case "agent.summary":
      case "session.connected":
      case "session.closed":
      case "job.started":
      case "job.cancelled":
      case "job.timeout":
      case "system.info":
      case "system.warn":
        return renderer.onSilencedEvent?.(event, ctx);

      // Exhaustive check — TypeScript will error if a kind is unhandled
      default: {
        const _exhaustive: never = event;
        throw new Error(`Unhandled canonical event kind: ${(_exhaustive as CanonicalEvent).kind}`);
      }
    }
  };
};
