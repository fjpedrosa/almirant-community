// ---------------------------------------------------------------------------
// SSE event consumer
//
// Extracted from JobExecutor.consumeSseEvents() and
// JobExecutor.waitForPlanningInteractionAnswer().
// Pure functions — no class dependency, all external calls via deps.
// ---------------------------------------------------------------------------

import type {
  AlmirantWorkerClient,
  OpenCodeSessionManager,
  BidirectionalRelay,
} from "@almirant/remote-agent";
import type {
  CanonicalEvent,
  CanonicalTextCoalescer,
  StreamPublisher,
} from "@almirant/stream-consumer";
import { createCanonicalTextCoalescer } from "@almirant/stream-consumer";
import { createSseCanonicalAdapter } from "./sse-canonical-adapter";
import type { EventAdapter } from "./adapter-types";
import {
  QUEUE_PUBLISH_THROTTLE_MS,
  nextSequence,
  publishCanonicalEvent,
  publishNativeEvent,
} from "./stream-events";
import type { ContainerDriver } from "../workspace/container-driver";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import {
  computeOverallTimeout,
  DEFAULT_OVERALL_TIMEOUT_MS,
  DEFAULT_EFFORT_POINT_DURATION_MS,
} from "../shared/timeout";
import { sleep } from "../shared/job-helpers";
import {
  EVENT_HANDLERS,
  handleDefaultUnknown,
  type EventHandlerContext,
  type EventHandlerDeps,
} from "./event-handlers";
import { createSessionUsageTracker } from "./usage-tracker";
import {
  detectQuotaPauseFromText,
  type QuotaPauseRequest,
} from "../shared/quota-pause";

// ---------------------------------------------------------------------------
// Constants (previously in job-executor.ts, only used by these functions)
// ---------------------------------------------------------------------------

export const IDLE_AFTER_COMPLETION_MS = 15_000;
/** Grace period after session.idle with "active" background agents. */
export const POST_IDLE_BACKGROUND_GRACE_MS = 90_000;
export const PLANNING_INTERACTION_POLL_MS = 1_500;
export const PLANNING_INTERACTION_TIMEOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

export type EventConsumerDeps = {
  workerClient: AlmirantWorkerClient;
  containerManager: ContainerDriver;
  config: {
    overallTimeoutMs?: number;
    effortPointDurationMs?: number;
    webOutputEnabled?: boolean;
  };
};

// ---------------------------------------------------------------------------
// consumeSseEvents
// ---------------------------------------------------------------------------

export async function consumeSseEvents(
  deps: EventConsumerDeps,
  params: {
    sessionManager: OpenCodeSessionManager;
    sessionId: string;
    jobId: string;
    isPlanningJob: boolean;
    eventLogger: RunnerJobEventLogger;
    relay?: BidirectionalRelay;
    streamPublisher?: StreamPublisher;
    threadId?: string;
    onStreamReady?: () => Promise<void>;
    estimatedHours?: number | null;
    webSessionId?: string;
    webOrganizationId?: string;
    tmpfsWatcher?: { cleanup: () => void; isCritical: () => boolean } | null;
  },
): Promise<{
  success: boolean;
  summary?: string;
  errorMessage?: string;
  cancelledByUser?: boolean;
  shutdownRequested?: boolean;
  timedOut?: boolean;
  backgroundAgentTimedOut?: boolean;
  sessionId: string;
  inputTokens?: number;
  outputTokens?: number;
  tokensUsed?: number;
  pausedForQuota?: QuotaPauseRequest;
}> {
  const {
    sessionManager,
    sessionId,
    jobId,
    isPlanningJob,
    eventLogger,
    relay,
    streamPublisher,
    threadId,
    onStreamReady,
    estimatedHours,
    webSessionId,
    webOrganizationId,
    tmpfsWatcher,
  } = params;

  const abortController = new AbortController();
  let shutdownRequested = false;
  let timedOut = false;
  let backgroundAgentTimedOut = false;
  let cancelPollInFlight = false;
  let quotaPauseRequest: QuotaPauseRequest | undefined;
  const usageTracker = createSessionUsageTracker();

  // Shared mutable state consumed by event handlers via the context object.
  const ctx: EventHandlerContext = {
    buffer: "",
    messageCompleted: false,
    lastActivityAt: Date.now(),
    errorMessage: undefined,
    cancelledByUser: false,
    currentContentType: undefined,
    previousContentType: undefined,
    hasActiveBackgroundAgents: false,
    wasIdleWithBackgroundAgents: false,
    activeBackgroundSubagentIds: new Set<string>(),
    pendingPlanningInteraction: null,
    currentToolUseBuffer: "",
    currentTextPart: "",
    lastAssistantText: "",
    accumulatedAssistantText: "",
    gitSignalLogged: false,
    prSignalLogged: false,
    pendingStreamPublish: false,
  };

  // Background agent grace timer (not part of handler context)
  let postIdleBackgroundGraceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Extract tool name and ID from the current tool_use buffer for log enrichment. */
  const extractToolMeta = (buf: string): { toolName?: string; toolCallId?: string } => {
    const nameMatch = buf.match(/"name"\s*:\s*"([^"]+)"/);
    const idMatch = buf.match(/"id"\s*:\s*"([^"]+)"/);
    return { toolName: nameMatch?.[1], toolCallId: idMatch?.[1] };
  };

  // Throttled stream publishing: track last publish time to avoid flooding
  let lastStreamPublishAt = 0;
  /** Offset into `buffer` that has already been published to the stream. */
  let lastPublishedBufferLength = 0;

  const publishStreamingUpdate = async (_force = false): Promise<void> => {
    // Legacy streaming disabled — canonical events handle real-time delivery
  };

  // Canonical event adapter — processes SSE events into structured canonical events
  const canonicalAdapter: EventAdapter = createSseCanonicalAdapter();

  // Publish a single canonical event to the Redis Stream (deferred capture of
  // jobId / threadId so the coalescer's onFlush callback below can call it).
  const publishCanonicalCoalesced = async (event: CanonicalEvent): Promise<void> => {
    if (!streamPublisher) return;
    const finalEvent = event.kind === "session.idle"
      ? { ...event, isPlanningJob }
      : event;
    await publishCanonicalEvent(streamPublisher, {
      jobId,
      sessionId: webSessionId ?? "",
      organizationId: webOrganizationId ?? "",
      threadId: threadId ?? "",
      timestamp: Date.now(),
      sequenceNumber: nextSequence(),
      event: finalEvent,
    });
  };

  // Per-job text/thinking coalescer. Collapses runs of high-granularity
  // agent.text / agent.thinking deltas (some shims like opencode emit one
  // event per word / sub-token) into a single aggregated event before
  // publishing. This keeps `session_events` rows manageable AND ensures the
  // runner-implement completion validator can see the trailing `## Summary`
  // block within its 2_000-event window.
  const canonicalCoalescer: CanonicalTextCoalescer = createCanonicalTextCoalescer({
    onFlush: publishCanonicalCoalesced,
    idleMs: 250,
  });

  const clearBackgroundAgentTimeout = (): void => undefined;

  const clearPostIdleBackgroundGrace = (): void => {
    if (postIdleBackgroundGraceTimer) {
      clearTimeout(postIdleBackgroundGraceTimer);
      postIdleBackgroundGraceTimer = null;
    }
  };

  // Do not fail a session solely because background subagents remain active for
  // a fixed duration. The overall job timeout remains the final anti-zombie fuse,
  // while background-agent completion is handled by explicit completion events
  // or the post-idle grace flow below.
  const resetBackgroundAgentTimeout = (): void => undefined;

  /**
   * Start a grace period after session.idle fires with active background agents.
   * Claude Code SSE does NOT emit agent.subagent.complete for background agents,
   * so the runner can never know they finished via events. If the main agent went
   * idle and doesn't resume within POST_IDLE_BACKGROUND_GRACE_MS, the background
   * agents have already completed (their results are in the accumulated text).
   * Emit synthetic subagent.complete events and allow normal termination.
   */
  const startPostIdleBackgroundGrace = (): void => {
    clearPostIdleBackgroundGrace();
    postIdleBackgroundGraceTimer = setTimeout(async () => {
      postIdleBackgroundGraceTimer = null;
      if (!ctx.wasIdleWithBackgroundAgents) return;

      const pendingIds = [...ctx.activeBackgroundSubagentIds];
      console.log(`[job:${jobId}] Post-idle background grace expired (${POST_IDLE_BACKGROUND_GRACE_MS}ms) — assuming ${pendingIds.length} background agent(s) completed`);
      eventLogger.info("session", "session.background_agents_grace_completed",
        `Background agents assumed complete after ${POST_IDLE_BACKGROUND_GRACE_MS}ms idle grace`, {
          assumedCompletedSubagentIds: pendingIds,
        });

      // Publish synthetic subagent.complete events so frontend banners clear
      if (streamPublisher) {
        for (const subagentId of pendingIds) {
          await publishCanonicalEvent(streamPublisher, {
            jobId,
            sessionId: webSessionId ?? "",
            organizationId: webOrganizationId ?? "",
            threadId: threadId ?? "",
            timestamp: Date.now(),
            sequenceNumber: nextSequence(),
            event: {
              kind: "agent.subagent.complete",
              subagentId,
              success: true,
            },
          });
        }
      }

      // Clear background state and allow normal idle termination
      ctx.activeBackgroundSubagentIds.clear();
      ctx.hasActiveBackgroundAgents = false;
      ctx.wasIdleWithBackgroundAgents = false;
      clearBackgroundAgentTimeout();
      ctx.messageCompleted = true;
      ctx.lastActivityAt = Date.now();
    }, POST_IDLE_BACKGROUND_GRACE_MS);
  };

  const clearBackgroundAgentWaitState = (
    reason: "resume" | "completed",
    completedSubagentId?: string,
  ): void => {
    ctx.hasActiveBackgroundAgents = false;
    clearBackgroundAgentTimeout();
    clearPostIdleBackgroundGrace();
    ctx.currentToolUseBuffer = "";

    if (!ctx.wasIdleWithBackgroundAgents) return;

    ctx.wasIdleWithBackgroundAgents = false;
    ctx.lastActivityAt = Date.now();

    if (reason === "resume") {
      console.log(`[job:${jobId}] Agent resumed after background agent idle — flag reset`);
      eventLogger.info("session", "session.background_agent_resumed", "Agent resumed, background flag reset");
      return;
    }

    ctx.messageCompleted = true;
    console.log(`[job:${jobId}] Background agents completed after idle — finishing session`);
    eventLogger.info("session", "session.background_agents_completed", "Background agents completed after idle", {
      completedSubagentIds: completedSubagentId ? [completedSubagentId] : [],
    });
  };

  const asOptionalString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const asOptionalIsoTimestamp = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    return undefined;
  };

  const collectStringFragments = (
    value: unknown,
    fragments: string[] = [],
    depth = 0,
  ): string[] => {
    if (fragments.length >= 80 || depth > 4) return fragments;

    if (typeof value === "string") {
      if (value.trim().length > 0) fragments.push(value);
      return fragments;
    }

    if (typeof value !== "object" || value === null) {
      return fragments;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectStringFragments(item, fragments, depth + 1);
        if (fragments.length >= 80) break;
      }
      return fragments;
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      collectStringFragments(nestedValue, fragments, depth + 1);
      if (fragments.length >= 80) break;
    }

    return fragments;
  };

  const buildQuotaDetectionText = (args: {
    eventType: string;
    eventData: Record<string, unknown>;
    props: Record<string, unknown>;
    rawData: string;
  }): string => {
    const eventType = args.eventType;

    if (eventType === "message.part.delta") {
      const fragments = [
        eventType,
        asOptionalString(args.props.delta),
        asOptionalString(args.props.text),
        asOptionalString(args.props.message),
        asOptionalString(args.props.error),
      ];
      return fragments.filter(Boolean).join("\n").slice(-20_000);
    }

    if (eventType === "message.part.updated") {
      const part = isRecord(args.props.part) ? args.props.part : null;
      if (!part) return "";

      const partType = asOptionalString(part.type);
      // Tool updates include command inputs, file contents, and MCP outputs.
      // Those are application data, not provider/runtime errors. Scanning them
      // caused false quota pauses when a file or task prompt mentioned phrases
      // such as "usage limit".
      if (partType && partType !== "text") {
        return "";
      }

      const fragments = [
        eventType,
        asOptionalString(part.text),
        asOptionalString(part.delta),
        asOptionalString(part.message),
        asOptionalString(part.error),
      ];
      return fragments.filter(Boolean).join("\n").slice(-20_000);
    }

    if (
      eventType === "session.error" ||
      eventType === "session.status" ||
      /error|rate|quota|limit/i.test(eventType)
    ) {
      const fragments = [
        eventType,
        ...collectStringFragments(args.props),
      ];
      return fragments.join("\n").slice(-20_000);
    }

    if (!eventType && /429|too many requests|rate limit|quota|you['’]?ve hit your limit/i.test(args.rawData)) {
      return args.rawData.slice(-20_000);
    }

    return "";
  };

  const publishNativeSseEvent = async (args: {
    sseEvent: { event?: string; data: string };
    eventType: string;
    eventData: Record<string, unknown>;
    props: Record<string, unknown>;
  }): Promise<boolean> => {
    if (!streamPublisher) return args.eventType === "native.event";

    if (args.eventType === "native.event") {
      const nativeEventType = asOptionalString(args.props.nativeEventType) ?? "unknown";
      const sourceFormat = asOptionalString(args.props.sourceFormat) ?? "sse";
      const payload =
        typeof args.props.payload === "object" && args.props.payload !== null
          ? (args.props.payload as Record<string, unknown>)
          : { payload: args.props.payload ?? null };

      await publishNativeEvent(streamPublisher, {
        jobId,
        sessionId: webSessionId ?? "",
        organizationId: webOrganizationId ?? "",
        threadId: threadId ?? "",
        timestamp: Date.now(),
        sequenceNumber: nextSequence(),
        nativeEventType,
        sourceFormat,
        provider: asOptionalString(args.props.provider),
        codingAgent: asOptionalString(args.props.codingAgent),
        runtimeSessionId: asOptionalString(args.props.runtimeSessionId) ?? sessionId,
        emittedAt: asOptionalIsoTimestamp(args.props.emittedAt),
        payload,
      });
      return true;
    }

    await publishNativeEvent(streamPublisher, {
      jobId,
      sessionId: webSessionId ?? "",
      organizationId: webOrganizationId ?? "",
      threadId: threadId ?? "",
      timestamp: Date.now(),
      sequenceNumber: nextSequence(),
      nativeEventType: args.eventType || "unknown",
      sourceFormat: "runtime-sse",
      runtimeSessionId:
        asOptionalString(args.props.sessionId) ??
        asOptionalString(args.props.sessionID) ??
        sessionId,
      emittedAt:
        asOptionalIsoTimestamp(args.props.timestamp) ??
        asOptionalIsoTimestamp(args.props.createdAt) ??
        asOptionalIsoTimestamp(args.props.time),
      payload: {
        event: args.sseEvent.event ?? null,
        data: Object.keys(args.eventData).length > 0 ? args.eventData : args.sseEvent.data,
      },
    });

    return false;
  };

  const publishCanonicalEvents = async (sseEvent: { event?: string; data: string }): Promise<void> => {
    if (!streamPublisher) return;
    const events = canonicalAdapter.processEvent(sseEvent);
    for (const event of events) {
      // Side effects (subagent tracking) run on every event regardless of
      // whether the coalescer buffers it: subagent.* events are not
      // text/thinking and pass through immediately, so this is safe.
      if (event.kind === "agent.subagent.spawn") {
        if (event.isBackground) {
          ctx.activeBackgroundSubagentIds.add(event.subagentId);
          ctx.hasActiveBackgroundAgents = true;
          resetBackgroundAgentTimeout();
        }
        eventLogger.info("transcript", "subagent.spawn", event.description, {
          subagentId: event.subagentId,
          isBackground: event.isBackground,
          subagentType: event.subagentType,
        });
      }
      if (event.kind === "agent.subagent.complete") {
        const resolvedBackgroundSubagent = ctx.activeBackgroundSubagentIds.delete(event.subagentId);
        if (resolvedBackgroundSubagent && ctx.activeBackgroundSubagentIds.size === 0) {
          clearBackgroundAgentWaitState("completed", event.subagentId);
        }
        eventLogger.info("transcript", "subagent.complete", "", {
          subagentId: event.subagentId,
          success: event.success,
        });
      }

      // Persistence path: buffer text/thinking deltas, pass everything else
      // through immediately. The coalescer publishes via publishCanonicalCoalesced.
      canonicalCoalescer.push(event);
    }
  };

  // Overall timeout — dynamic based on effort points
  const overallTimeoutMs = computeOverallTimeout(
    estimatedHours,
    deps.config.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS,
    deps.config.effortPointDurationMs ?? DEFAULT_EFFORT_POINT_DURATION_MS,
  );
  console.log(
    `[job:${jobId}] Overall timeout set to ${Math.round(overallTimeoutMs / 60_000)}min` +
      (estimatedHours ? ` (effort points: ${estimatedHours})` : ""),
  );
  const overallTimer = setTimeout(() => {
    console.log(`[job:${jobId}] Overall timeout reached (${overallTimeoutMs}ms)`);
    timedOut = true;
    abortController.abort();
  }, overallTimeoutMs);

  // Idle-after-completion checker
  const idleChecker = setInterval(() => {
    // Abort if tmpfs is critically full
    if (tmpfsWatcher?.isCritical()) {
      console.log(`[job:${jobId}] Tmpfs critical — aborting session`);
      ctx.messageCompleted = true;
      ctx.hasActiveBackgroundAgents = false;
      abortController.abort();
    }
    if (ctx.messageCompleted && Date.now() - ctx.lastActivityAt > IDLE_AFTER_COMPLETION_MS) {
      console.log(`[job:${jobId}] Idle after completion, finishing`);
      abortController.abort();
    }
  }, 3_000);

  const cancelChecker = setInterval(() => {
    if (cancelPollInFlight || abortController.signal.aborted) {
      return;
    }

    cancelPollInFlight = true;
    void deps.workerClient
      .getJobStatus(jobId)
      .then((jobStatus) => {
        if (jobStatus.status === "cancelled") {
          ctx.cancelledByUser = true;
          shutdownRequested = jobStatus.shutdownRequested === true;
          abortController.abort();
        }
      })
      .catch(() => {
        // Non-fatal: temporary API issues should not interrupt the session.
      })
      .finally(() => {
        cancelPollInFlight = false;
      });
  }, 5_000);

  // Periodic publisher for pending stream updates
  const queuePublishInterval = setInterval(() => {
    if (ctx.pendingStreamPublish) {
      void publishStreamingUpdate(true);
    }
  }, QUEUE_PUBLISH_THROTTLE_MS);

  const createUserInteraction = async ({
    questionText,
    options = [],
    questionContext,
  }: {
    questionText: string;
    options?: string[];
    questionContext?: Record<string, unknown> | null;
  }): Promise<string> => {
    const interaction = await deps.workerClient.createInteraction(jobId, {
      questionType: options.length > 0 ? "choice" : "free_text",
      questionText,
      ...(questionContext ? { questionContext } : {}),
      ...(options.length > 0 ? { options } : {}),
      expiresAt: new Date(Date.now() + PLANNING_INTERACTION_TIMEOUT_MS).toISOString(),
      timeoutAction: "fail",
    });

    eventLogger.info("interaction", "interaction.created", "Created user interaction", {
      interactionId: interaction.id,
      questionType: interaction.questionType,
      optionsCount: options.length,
      source:
        questionContext && typeof questionContext.source === "string"
          ? questionContext.source
          : undefined,
    });

    return interaction.id;
  };

  // Back-compat alias — older callers still importing the planning-named
  // helper continue to work. The implementation is fully generic.
  const createPlanningInteraction = createUserInteraction;

  const awaitUserInteraction = async (
    interactionId: string,
    opts?: { questionText?: string; source?: string },
  ): Promise<void> => {
    const answer = await waitForPlanningInteractionAnswer(deps, {
      jobId,
      interactionId,
      signal: abortController.signal,
      eventLogger,
    });
    if (!answer) {
      console.log(`[job:${jobId}] User interaction unanswered — aborting job`);
      eventLogger.warn("interaction", "interaction.unanswered_abort", "Aborting job after unanswered user interaction", {
        interactionId,
      });
      abortController.abort();
      return;
    }

    // When the question originated from an AskUserQuestion tool call,
    // the tool was auto-resolved by --dangerously-skip-permissions before
    // the user could answer.  Wrap the answer with explicit context so the
    // agent recognises it as the response to its questionnaire instead of
    // treating the (auto-resolved) tool call as failed and re-asking.
    let prompt = answer;
    if (opts?.source === "agent_question") {
      prompt = [
        "[AskUserQuestion Response]",
        "The user has answered your AskUserQuestion questionnaire. Here are their responses:",
        "",
        answer,
        "",
        "Continue with the next step based on these answers. Do NOT repeat or re-ask these questions.",
      ].join("\n");
    }

    await sessionManager.sendPromptAsync(sessionId, { prompt });
    eventLogger.info("interaction", "interaction.answered", "Forwarded interaction answer", {
      interactionId,
      wrappedAsToolResponse: opts?.source === "agent_question",
    });
  };

  // Back-compat alias — older callers still importing the planning-named
  // helper continue to work. The implementation is fully generic.
  const awaitPlanningInteraction = awaitUserInteraction;

  try {
    // Use global /event endpoint — the runtime streams all events there
    const eventStream = sessionManager.streamSessionEvents(
      undefined,
      abortController.signal
    );

    if (onStreamReady) {
      onStreamReady().catch((err) => {
        console.error(`[job:${jobId}] Failed to send prompt: ${err}`);
        ctx.errorMessage = err instanceof Error ? err.message : String(err);
        abortController.abort();
      });
    }

    // Build the dependency bag for event handlers.
    // The `isPlanningJob` parameter on consumeSseEvents is the source of truth
    // today — its value is `intent.interactive` from session-runner. Forward
    // it as `isInteractiveJob` to make the semantics explicit at the gate.
    const handlerDeps: EventHandlerDeps = {
      jobId,
      isInteractiveJob: isPlanningJob,
      webSessionId: webSessionId ?? "",
      webOrganizationId: webOrganizationId ?? "",
      threadId: threadId ?? "",
      eventLogger,
      streamPublisher,
      relay,
      abortController,
      extractToolMeta,
      publishStreamingUpdate,
      clearBackgroundAgentWaitState,
      resetBackgroundAgentTimeout,
      startPostIdleBackgroundGrace,
      createUserInteraction,
      awaitUserInteraction,
    };

    for await (const event of eventStream) {
      if (abortController.signal.aborted) break;

      let eventData: Record<string, unknown> = {};
      try {
        eventData = JSON.parse(event.data);
      } catch {
        // Non-JSON data — treat as raw text
      }

      const eventType =
        typeof eventData.type === "string"
          ? eventData.type
          : event.event ?? "";

      const props =
        typeof eventData.properties === "object" && eventData.properties !== null
          ? (eventData.properties as Record<string, unknown>)
          : eventData;

      const quotaDetection = detectQuotaPauseFromText(
        buildQuotaDetectionText({
          eventType,
          eventData,
          props,
          rawData: event.data,
        }),
      );
      if (quotaDetection) {
        quotaPauseRequest = {
          ...quotaDetection,
          sourceEventType: eventType || event.event,
        };
        ctx.errorMessage = quotaPauseRequest.reason;
        eventLogger.warn(
          "session",
          "session.quota_pause_detected",
          quotaPauseRequest.reason,
          {
            errorType: quotaPauseRequest.errorType,
            retryDelayMs: quotaPauseRequest.retryDelayMs,
            availableAt: quotaPauseRequest.availableAt,
            sourceEventType: quotaPauseRequest.sourceEventType,
          },
        );
        abortController.abort();
        break;
      }

      const nativeOnly = await publishNativeSseEvent({
        sseEvent: event,
        eventType,
        eventData,
        props,
      });
      if (nativeOnly) {
        continue;
      }

      // Only update activity timer for meaningful events, not heartbeats/connection
      if (eventType !== "session.idle" && eventType !== "server.heartbeat" && eventType !== "server.connected") {
        ctx.lastActivityAt = Date.now();
      }

      // Dual-publish: canonical events alongside old format (when enabled)
      await publishCanonicalEvents(event);

      usageTracker.trackEvent(eventType, props);

      // Dispatch to registered handler or fall back to unknown-event handler
      const handler = EVENT_HANDLERS[eventType];
      if (handler) {
        await handler(ctx, handlerDeps, props, event);
      } else {
        await handleDefaultUnknown(ctx, handlerDeps, props, event);
      }
    }
  } catch (error) {
    // SSE stream closed or aborted — not necessarily an error
    if (!abortController.signal.aborted) {
      ctx.errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[job:${jobId}] SSE stream error: ${ctx.errorMessage}`);
      eventLogger.error("session", "session.stream_error", "SSE stream error", {
        errorMessage: ctx.errorMessage,
      });
    }
  } finally {
    clearTimeout(overallTimer);
    clearInterval(idleChecker);
    tmpfsWatcher?.cleanup();
    clearInterval(cancelChecker);
    clearInterval(queuePublishInterval);
    clearPostIdleBackgroundGrace();
    // Flush any remaining canonical adapter state through the coalescer so
    // a trailing text/thinking run is collapsed into a single aggregated
    // event. canonicalCoalescer.destroy() then forces any leftover buffer
    // to flush via onFlush -> publishCanonicalCoalesced.
    if (streamPublisher) {
      const remaining = canonicalAdapter.flush();
      for (const evt of remaining) {
        canonicalCoalescer.push(evt);
      }
    }
    canonicalCoalescer.destroy();
  }

  if (isPlanningJob && !deps.config.webOutputEnabled) {
    const terminalMessage = ctx.errorMessage || ctx.cancelledByUser || timedOut
      ? (ctx.errorMessage ?? (timedOut ? "Job timed out" : "Job cancelled"))
      : "Planning turn completed";
    await deps.workerClient.streamJobOutput(jobId, {
      content: `${terminalMessage}\n`,
      stepIndex: 0,
      persistContent: true,
      contentType: "text",
    }).catch(() => undefined);
  }

  eventLogger.info(
    "finish",
    ctx.errorMessage ? "job.failed" : ctx.cancelledByUser ? "job.cancelled" : "job.completed",
    ctx.errorMessage
      ? "Session finished with error"
      : ctx.cancelledByUser
        ? "Session cancelled by user"
        : "Session completed"
  );

  // Terminal queue events (done/error) are published by the caller (executeJob)
  // to avoid duplicate embeds in Discord.

  const assistantSummary = ctx.accumulatedAssistantText.trim() || ctx.lastAssistantText.trim();
  const usageSummary = usageTracker.getSummary();
  const hasUsage = usageSummary.tokensUsed > 0;

  return {
    success: !ctx.errorMessage && !ctx.cancelledByUser && !timedOut,
    // Prefer the accumulated text (which contains the full ## Summary block)
    // over the last text block (which may be a trailing comment after the summary).
    // Keep the summary even on error so post-session validation can inspect
    // transcripts that completed logically before a late failure/timeout.
    summary: timedOut
      ? (assistantSummary || "Job timed out before completing all tasks")
      : (assistantSummary || (!ctx.errorMessage ? "completed" : undefined)),
    errorMessage: timedOut ? `Overall timeout reached (${Math.round(overallTimeoutMs / 60_000)}min)` : ctx.errorMessage,
    cancelledByUser: ctx.cancelledByUser,
    shutdownRequested,
    timedOut,
    backgroundAgentTimedOut,
    sessionId,
    pausedForQuota: quotaPauseRequest,
    ...(hasUsage
      ? {
          inputTokens: usageSummary.inputTokens,
          outputTokens: usageSummary.outputTokens,
          tokensUsed: usageSummary.tokensUsed,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// waitForPlanningInteractionAnswer
// ---------------------------------------------------------------------------

export type WaitForInteractionDeps = Pick<EventConsumerDeps, "workerClient">;

export async function waitForPlanningInteractionAnswer(
  deps: WaitForInteractionDeps,
  params: {
    jobId: string;
    interactionId: string;
    signal: AbortSignal;
    eventLogger: RunnerJobEventLogger;
  },
): Promise<string | null> {
  const { jobId, interactionId, signal, eventLogger } = params;
  const deadline = Date.now() + PLANNING_INTERACTION_TIMEOUT_MS;
  let pollCount = 0;

  while (!signal.aborted && Date.now() < deadline) {
    try {
      const interaction = await deps.workerClient.pollInteraction(
        jobId,
        interactionId,
      );

      if (
        interaction.status === "answered" &&
        typeof interaction.response === "string"
      ) {
        const answer = interaction.response.trim();
        eventLogger.info("interaction", "interaction.answer_received", "Interaction answered", {
          interactionId,
          length: answer.length,
        });
        return answer.length > 0 ? answer : null;
      }

      if (interaction.status === "answered" && typeof interaction.response !== "string") {
        eventLogger.warn("interaction", "interaction.response_missing", "Interaction answered but response field is not a string", {
          interactionId,
          responseType: typeof interaction.response,
          responseValue: interaction.response,
          status: interaction.status,
        });
      }

      if (
        interaction.status === "timeout" ||
        interaction.status === "cancelled"
      ) {
        eventLogger.warn(
          "interaction",
          interaction.status === "timeout"
            ? "interaction.timeout"
            : "interaction.cancelled",
          "Interaction ended without answer",
          { interactionId }
        );
        return null;
      }

      // Throttled status logging (every 10 polls)
      pollCount++;
      if (pollCount % 10 === 0) {
        eventLogger.info("interaction", "interaction.poll_status", "Polling interaction", {
          interactionId,
          pollCount,
          status: interaction.status,
          hasResponse: typeof interaction.response === "string",
        });
      }
    } catch (err) {
      pollCount++;
      eventLogger.warn("interaction", "interaction.poll_error", "Error polling interaction", {
        interactionId,
        jobId,
        pollCount,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await sleep(PLANNING_INTERACTION_POLL_MS);
  }

  if (!signal.aborted) {
    eventLogger.warn("interaction", "interaction.poll_timeout", "Interaction polling expired without response", {
      interactionId,
      jobId,
      pollCount,
      elapsedMs: Date.now() - (deadline - PLANNING_INTERACTION_TIMEOUT_MS),
    });
  }

  return null;
}
