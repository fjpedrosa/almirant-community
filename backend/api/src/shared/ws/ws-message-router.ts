import { randomUUID } from "crypto";
import { logger, runWithTraceId } from "@almirant/config";
import { resolveRuntime } from "@almirant/shared";
import { formatText, isAiConfigured } from "../../domains/ai/shared/services/ai-service";
import {
  saveGeneratedPrompt,
  getPlanningSessionById,
  createJob,
  createSequentialAgentJobLog,
  getActiveJobForPlanningSession,
  getInteractionById,
  getPendingInteractionForJob,
  respondToInteraction,
  updateJobStatus,
  cancelJob,
  cancelInteractionsByJobId,
  getPrewarmJobForSession,
  convertPrewarmToPlanning,
  completePlanningSession,
  createInteraction,
  getConversationHistoryFromLogs,
  getLatestJobForPlanningSession,
  getUserById,
  getWorkerById,
  getJobById,
} from "@almirant/database";
import { inferPlanningSkillName } from "../../domains/ideation/planning-sessions/services/planning-skill-routing";
import { wsConnectionManager } from "./ws-connection-manager";
import type { WsClientMessage, WsServerMessage } from "./ws-types";

const AI_TIMEOUT_MS = 60_000;

/** Persist a user input to agent_job_logs so it stays in transcript order. */
const persistUserInput = (jobId: string, orgId: string, message: string, metadata?: Record<string, unknown>) => {
  const now = new Date();
  void createSequentialAgentJobLog({
    jobId,
    orgId,
    level: "info",
    phase: "transcript",
    eventType: "user_input",
    message,
    contentType: "user_input",
    payload: metadata ?? {},
    timestamp: now,
  }).catch((err) => { logger.warn({ jobId, err }, "Failed to persist user_input to agent_job_logs"); });
};

const resolveResumedJobStatus = async (
  workerId: string | null | undefined,
): Promise<"running" | "queued"> => {
  if (!workerId) return "queued";

  const worker = await getWorkerById(workerId);
  return worker?.status === "online" ? "running" : "queued";
};

const isLegacySyntheticInteractionId = (questionId: string): boolean =>
  /^question-\d+$/.test(questionId) || /^permission-\d+$/.test(questionId);

type StartPlanningJobInput = {
  userId: string;
  organizationId: string | null;
  sessionId: string;
  userMessage: string;
  seedIds?: string[];
  conversationHistory?: Array<{ role: string; content: string }>;
  sendFn: (msg: WsServerMessage) => void;
  messageType?: string;
  messageMetadata?: Record<string, unknown>;
  failureCode?: string;
  failureMessage?: string;
  failureLogMessage?: string;
  successLogMessage?: string;
  provider?: string;
  codingAgent?: string;
  model?: string;
  previousSkillName?: string | null;
};

const resolveUserLocale = async (userId: string): Promise<string> =>
  getUserById(userId).then((user) => user?.locale ?? "es").catch(() => "es");

const startPlanningJob = async ({
  userId,
  organizationId,
  sessionId,
  userMessage,
  seedIds,
  conversationHistory,
  sendFn,
  messageType = "user",
  messageMetadata,
  failureCode = "START_FAILED",
  failureMessage = "Failed to start planning session",
  failureLogMessage = "Failed to start planning session",
  successLogMessage = "Planning session started, agent job created",
  provider: overrideProvider,
  codingAgent,
  model,
  previousSkillName,
}: StartPlanningJobInput): Promise<void> => {
  try {
    const session = await getPlanningSessionById(sessionId);
    if (!session) {
      logger.warn({ sessionId }, "Planning session not found");
      sendFn({
        type: "planning:error",
        payload: { sessionId, message: "Planning session not found", code: "SESSION_NOT_FOUND" },
      });
      return;
    }

    if (session.status !== "active") {
      logger.warn({ sessionId, status: session.status }, "Planning session is closed");
      sendFn({
        type: "planning:error",
        payload: { sessionId, message: "Planning session is closed", code: "SESSION_CLOSED" },
      });
      return;
    }

    const resolved = resolveRuntime({ provider: overrideProvider, codingAgent, model });
    const userLocale = await resolveUserLocale(userId);
    const skillName = inferPlanningSkillName({
      prompt: userMessage,
      previousSkillName,
    });

    const job = await createJob({
      projectId: session.projectId ?? null,
      boardId: session.boardId ?? null,
      workItemId: null,
      planningSessionId: sessionId,
      createdByUserId: userId,
      organizationId: organizationId ?? undefined,
      jobType: "planning",
      provider: resolved.provider,
      priority: "medium",
      config: {
        skillName,
        sessionMode: "planning",
        source: "websocket",
        workspaceIntent: "read-only",
        postSessionPushPolicy: "never",
        locale: userLocale,
        requestedByUserId: userId,
        planningSessionId: sessionId,
        repoPath: ".",
        baseBranch: "main",
        seedIds: seedIds ?? [],
        userMessage,
        ...(codingAgent ? { codingAgent: resolved.codingAgent } : {}),
        ...(model ? { model } : {}),
        ...(conversationHistory && conversationHistory.length > 0
          ? { conversationHistory }
          : {}),
      },
      codingAgent: resolved.codingAgent,
      aiProvider: resolved.aiProvider,
      model: resolved.model,
      skillName,
      promptTemplate: skillName,
      triggerType: "event",
      interactive: true,
    });

    // Persist user input to agent_job_logs for transcript replay
    persistUserInput(job.id, organizationId ?? "", userMessage, messageMetadata);

    if (organizationId) {
      wsConnectionManager.broadcastToOrganization(organizationId, {
        type: "agent-job:status-changed",
        payload: {
          jobId: job.id,
          status: job.status,
          workItemId: null,
          planningSessionId: sessionId,
        },
      });
    }

    sendFn({
      type: "planning:step",
      payload: { sessionId, stepName: "initializing", stepIndex: 0 },
    });

    logger.info(
      { userId, sessionId, jobId: job.id },
      successLogMessage
    );
  } catch (err) {
    logger.error({ userId, sessionId, err }, failureLogMessage);
    sendFn({
      type: "planning:error",
      payload: {
        sessionId,
        message: err instanceof Error ? err.message : failureMessage,
        code: failureCode,
      },
    });
  }
};

// ---------------------------------------------------------------------------
// Planning handlers (fire-and-forget async, same pattern as handleAiFormatText)
// ---------------------------------------------------------------------------

const handlePlanningStart = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "planning:start" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { sessionId, userMessage, seedIds, provider, codingAgent, model } = message.payload;

  void (async () => {
    try {
      // Check if a prewarm job already exists for this session
      const prewarmJob = await getPrewarmJobForSession(sessionId);

      if (prewarmJob) {
        // Convert the prewarm job into a real planning job
        const session = await getPlanningSessionById(sessionId);
        const userLocale = await resolveUserLocale(userId);
        if (!session) {
          sendFn({
            type: "planning:error",
            payload: { sessionId, message: "Planning session not found", code: "SESSION_NOT_FOUND" },
          });
          return;
        }

        if (session.status !== "active") {
          sendFn({
            type: "planning:error",
            payload: { sessionId, message: "Planning session is closed", code: "SESSION_CLOSED" },
          });
          return;
        }

        // Update the prewarm job with the real planning config,
        // including the user-selected coding agent/provider/model.
        const prewarmConfigRecord = prewarmJob.config as unknown as Record<string, unknown>;
        const prewarmResolved = resolveRuntime({ provider, codingAgent, model });
        const skillName = inferPlanningSkillName({
          prompt: userMessage,
          previousSkillName:
            typeof prewarmJob.skillName === "string"
              ? prewarmJob.skillName
              : typeof prewarmJob.promptTemplate === "string"
                ? prewarmJob.promptTemplate
                : typeof prewarmConfigRecord.skillName === "string"
                  ? prewarmConfigRecord.skillName
                  : null,
        });
        const converted = await convertPrewarmToPlanning(prewarmJob.id, {
          ...prewarmConfigRecord,
          skillName,
          sessionMode: "planning" as const,
          source: "websocket" as const,
          workspaceIntent: "read-only" as const,
          postSessionPushPolicy: "never" as const,
          locale:
            (typeof prewarmConfigRecord.locale === "string" && prewarmConfigRecord.locale) ||
            userLocale,
          requestedByUserId: userId,
          planningSessionId: sessionId,
          repoPath: (prewarmConfigRecord.repoPath as string | undefined) ?? ".",
          baseBranch: (prewarmConfigRecord.baseBranch as string | undefined) ?? "main",
          seedIds: seedIds ?? [],
          userMessage,
          isPrewarm: false,
          ...(codingAgent ? { codingAgent: prewarmResolved.codingAgent } : {}),
          ...(model ? { model } : {}),
        }, {
          // Override top-level job fields with user's selection via shared resolver
          ...(provider ? { provider: prewarmResolved.provider } : {}),
          ...(codingAgent ? { codingAgent: prewarmResolved.codingAgent } : {}),
          ...(model ? { model } : {}),
          ...(provider ? { aiProvider: prewarmResolved.aiProvider } : {}),
          skillName,
          promptTemplate: skillName,
          triggerType: "event",
          interactive: true,
        });

        if (converted) {
          // Persist user input to agent_job_logs for transcript replay
          persistUserInput(converted.id, organizationId ?? "", userMessage);
        }

        if (converted && organizationId) {
          wsConnectionManager.broadcastToOrganization(organizationId, {
            type: "agent-job:status-changed",
            payload: {
              jobId: converted.id,
              status: converted.status,
              workItemId: null,
              planningSessionId: sessionId,
            },
          });
        }

        sendFn({
          type: "planning:step",
          payload: { sessionId, stepName: "initializing", stepIndex: 0 },
        });

        sendFn({
          type: "planning:prompt-ack",
          payload: { sessionId, promptId: randomUUID(), status: "processing" },
        });

        logger.info(
          { userId, sessionId, jobId: prewarmJob.id },
          "Prewarm job converted to planning job"
        );
        return;
      }

      // No prewarm job found, fall through to normal behavior
      await startPlanningJob({
        userId,
        organizationId,
        sessionId,
        userMessage,
        seedIds,
        sendFn,
        provider,
        codingAgent,
        model,
      });

      sendFn({
        type: "planning:prompt-ack",
        payload: { sessionId, promptId: randomUUID(), status: "processing" },
      });
    } catch (err) {
      logger.error({ userId, sessionId, err }, "Failed to start planning session");
      sendFn({
        type: "planning:error",
        payload: {
          sessionId,
          message: err instanceof Error ? err.message : "Failed to start planning session",
          code: "START_FAILED",
        },
      });
    }
  })();
};

const handlePlanningAnswer = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "planning:answer" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { sessionId, questionId, answer } = message.payload;

  void (async () => {
    try {
      // Look up the interaction to get the agentJobId
      const interaction = await getInteractionById(questionId);
      if (!interaction) {
        logger.warn({ questionId, sessionId }, "Interaction not found for planning answer");
        sendFn({
          type: "planning:error",
          payload: { sessionId, message: "Interaction not found", code: "INTERACTION_NOT_FOUND" },
        });
        return;
      }

      const agentJobId = interaction.agentJobId;

      // Respond to the interaction
      const updated = await respondToInteraction(questionId, answer, userId);
      if (!updated) {
        logger.warn({ questionId, sessionId }, "Interaction already answered or not pending");
        return;
      }

      const existingJob = await getJobById(agentJobId);
      const nextStatus = await resolveResumedJobStatus(existingJob?.job.workerId);
      const jobUpdated = await updateJobStatus(
        agentJobId,
        nextStatus,
        nextStatus === "queued"
          ? {
              workerId: null,
              startedAt: null,
            }
          : undefined,
      );
      if (jobUpdated && organizationId) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "agent-job:status-changed",
          payload: {
            jobId: jobUpdated.id,
            status: jobUpdated.status,
            workItemId: jobUpdated.workItemId ?? null,
            planningSessionId: jobUpdated.planningSessionId ?? null,
          },
        });

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "worker-interaction:responded",
          payload: {
            interactionId: updated.id,
            jobId: agentJobId,
            workItemId: updated.workItemId ?? "",
          },
        });
      }

      logger.info(
        { userId, sessionId, questionId, agentJobId },
        "Planning answer forwarded to worker"
      );
    } catch (err) {
      logger.error({ userId, sessionId, questionId, err }, "Failed to process planning answer");
    }
  })();
};

const handlePlanningPrompt = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "planning:prompt" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { sessionId, prompt, questionId } = message.payload;
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    sendFn({
      type: "planning:error",
      payload: {
        sessionId,
        message: "Prompt cannot be empty",
        code: "EMPTY_PROMPT",
      },
    });
    return;
  }

  const promptId = randomUUID();

  void (async () => {
    try {
      const activeJob = await getActiveJobForPlanningSession(sessionId);
      if (!activeJob) {
        // Fetch conversation history from agent_job_logs for follow-up jobs so the new container has context
        let conversationHistory: Array<{ role: string; content: string }> = [];
        let previousSkillName: string | null = null;
        try {
          const lastJob = await getLatestJobForPlanningSession(sessionId);
          if (lastJob) {
            conversationHistory = await getConversationHistoryFromLogs(lastJob.id);
            const lastJobDetail = await getJobById(lastJob.id);
            previousSkillName =
              lastJobDetail?.job.promptTemplate ??
              lastJobDetail?.job.skillName ??
              null;
          }
        } catch (err) {
          logger.warn({ sessionId, err }, "Failed to fetch conversation history for follow-up job");
        }

        await startPlanningJob({
          userId,
          organizationId,
          sessionId,
          userMessage: trimmedPrompt,
          conversationHistory,
          sendFn,
          messageType: "user",
          messageMetadata: { source: "planning:prompt" },
          failureCode: "PROMPT_FAILED",
          failureMessage: "Failed to resume planning session",
          failureLogMessage: "Failed to resume planning session",
          successLogMessage: "Planning session resumed with a new agent job",
          previousSkillName,
        });
        sendFn({
          type: "planning:prompt-ack",
          payload: { sessionId, promptId, status: "processing" },
        });
        return;
      }

      const pendingInteraction = await getPendingInteractionForJob(activeJob.id);
      if (!pendingInteraction) {
        // Agent is busy — acknowledge receipt, frontend will re-send when streaming ends
        sendFn({
          type: "planning:prompt-ack",
          payload: { sessionId, promptId, status: "queued" },
        });
        return;
      }

      const pendingQuestionType = pendingInteraction.questionType;
      const requiresExplicitQuestionBinding =
        pendingQuestionType === "approval" || pendingQuestionType === "choice";

      if (
        questionId &&
        questionId !== pendingInteraction.id &&
        !isLegacySyntheticInteractionId(questionId)
      ) {
        sendFn({
          type: "planning:error",
          payload: {
            sessionId,
            message: "La aprobación pendiente cambió. Revisa la pregunta actual y vuelve a intentarlo.",
            code: "PROMPT_INTERACTION_MISMATCH",
          },
        });
        return;
      }

      if (!questionId && requiresExplicitQuestionBinding) {
        sendFn({
          type: "planning:error",
          payload: {
            sessionId,
            message: "Hay una aprobación pendiente. Respóndela explícitamente antes de enviar otro mensaje.",
            code: "PROMPT_PENDING_APPROVAL",
          },
        });
        return;
      }

      // Persist user answer to agent_job_logs for transcript replay
      persistUserInput(activeJob.id, organizationId ?? "", trimmedPrompt, { source: "planning:prompt" });

      const updated = await respondToInteraction(
        pendingInteraction.id,
        trimmedPrompt,
        userId,
        { source: "planning:prompt" }
      );
      if (!updated) {
        sendFn({
          type: "planning:error",
          payload: {
            sessionId,
            message: "Failed to submit prompt. Please retry.",
            code: "PROMPT_SUBMIT_FAILED",
          },
        });
        return;
      }

      sendFn({
        type: "planning:prompt-ack",
        payload: { sessionId, promptId, status: "processing" },
      });

      const nextStatus = await resolveResumedJobStatus(activeJob.workerId);
      const jobUpdated = await updateJobStatus(
        activeJob.id,
        nextStatus,
        nextStatus === "queued"
          ? {
              workerId: null,
              startedAt: null,
            }
          : undefined,
      );
      if (jobUpdated && organizationId) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "agent-job:status-changed",
          payload: {
            jobId: jobUpdated.id,
            status: jobUpdated.status,
            workItemId: jobUpdated.workItemId ?? null,
            planningSessionId: jobUpdated.planningSessionId ?? null,
          },
        });

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "worker-interaction:responded",
          payload: {
            interactionId: updated.id,
            jobId: activeJob.id,
            workItemId: updated.workItemId ?? "",
          },
        });

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "planning:answer-received",
          payload: {
            sessionId,
            questionId: updated.id,
            answer: trimmedPrompt,
          },
        });
      }

    } catch (err) {
      logger.error({ userId, sessionId, err }, "Failed to process planning prompt");
      sendFn({
        type: "planning:error",
        payload: {
          sessionId,
          message: err instanceof Error ? err.message : "Failed to process planning prompt",
          code: "PROMPT_FAILED",
        },
      });
    }
  })();
};

const handlePlanningCancel = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "planning:cancel" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { sessionId } = message.payload;

  void (async () => {
    try {
      // Find the active job for this planning session
      const activeJob = await getActiveJobForPlanningSession(sessionId);
      if (!activeJob) {
        logger.info({ sessionId }, "No active job found for planning session cancel");
        return;
      }

      // Cancel pending interactions first
      void cancelInteractionsByJobId(activeJob.id);

      // Cancel the job itself
      const cancelled = await cancelJob(activeJob.id);
      if (cancelled && organizationId) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "agent-job:status-changed",
          payload: {
            jobId: cancelled.id,
            status: cancelled.status,
            workItemId: cancelled.workItemId ?? null,
            planningSessionId: cancelled.planningSessionId ?? null,
          },
        });
      }

      logger.info(
        { userId, sessionId, jobId: activeJob.id },
        "Planning session cancelled"
      );
    } catch (err) {
      logger.error({ userId, sessionId, err }, "Failed to cancel planning session");
    }
  })();
};

const handlePlanningKill = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "planning:kill" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { sessionId } = message.payload;

  void (async () => {
    try {
      // Find the active job for this planning session
      const activeJob = await getActiveJobForPlanningSession(sessionId);
      if (activeJob) {
        // Cancel pending interactions first
        void cancelInteractionsByJobId(activeJob.id);

        // Cancel the job itself
        const cancelled = await cancelJob(activeJob.id);
        if (cancelled && organizationId) {
          wsConnectionManager.broadcastToOrganization(organizationId, {
            type: "agent-job:status-changed",
            payload: {
              jobId: cancelled.id,
              status: cancelled.status,
              workItemId: cancelled.workItemId ?? null,
              planningSessionId: cancelled.planningSessionId ?? null,
            },
          });
        }
      }

      // Mark the planning session as completed with reason "killed_by_user"
      const completed = await completePlanningSession(sessionId, {
        reason: "killed_by_user",
      });

      if (completed && organizationId) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "planning-session:completed",
          payload: {
            sessionId,
            result: { summary: "Session terminated by user" },
          },
        });
      }

      logger.info(
        { userId, sessionId, jobId: activeJob?.id },
        "Planning session killed by user"
      );
    } catch (err) {
      logger.error({ userId, sessionId, err }, "Failed to kill planning session");
    }
  })();
};

const handlePlanningPrewarm = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "planning:prewarm" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { sessionId } = message.payload;

  void (async () => {
    try {
      const session = await getPlanningSessionById(sessionId);
      if (!session) {
        sendFn({
          type: "planning:error",
          payload: { sessionId, message: "Planning session not found", code: "SESSION_NOT_FOUND" },
        });
        return;
      }

      if (session.status !== "active") {
        sendFn({
          type: "planning:error",
          payload: { sessionId, message: "Planning session is closed", code: "SESSION_CLOSED" },
        });
        return;
      }

      // Check if there's already an active job (including prewarm) for this session
      const existingJob = await getActiveJobForPlanningSession(sessionId);
      if (existingJob) {
        logger.info({ sessionId, jobId: existingJob.id }, "Active job already exists for session, skipping prewarm");
        return;
      }

      // Also check for existing prewarm job
      const existingPrewarm = await getPrewarmJobForSession(sessionId);
      if (existingPrewarm) {
        logger.info({ sessionId, jobId: existingPrewarm.id }, "Prewarm job already exists for session");
        sendFn({
          type: "planning:prewarm-ready",
          payload: { sessionId, jobId: existingPrewarm.id },
        });
        return;
      }

      // Create a prewarm job with minimal config
      const job = await createJob({
        projectId: session.projectId ?? null,
        boardId: session.boardId ?? null,
        workItemId: null,
        planningSessionId: sessionId,
        createdByUserId: userId,
        organizationId: organizationId ?? undefined,
        jobType: "prewarm",
        provider: "claude-code",
        priority: "medium",
        config: {
          repoPath: ".",
          baseBranch: "main",
          planningSessionId: sessionId,
          requestedByUserId: userId,
          projectId: session.projectId ?? undefined,
          isPrewarm: true,
          workspaceIntent: "read-only",
          postSessionPushPolicy: "never",
        },
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-6",
        skillName: "ideate",
        promptTemplate: "ideate",
        triggerType: "event",
        interactive: false,
      });

      if (organizationId) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "agent-job:status-changed",
          payload: {
            jobId: job.id,
            status: job.status,
            workItemId: null,
            planningSessionId: sessionId,
          },
        });
      }

      sendFn({
        type: "planning:prewarm-ready",
        payload: { sessionId, jobId: job.id },
      });

      logger.info(
        { userId, sessionId, jobId: job.id },
        "Prewarm job created for planning session"
      );
    } catch (err) {
      logger.error({ userId, sessionId, err }, "Failed to create prewarm job");
      sendFn({
        type: "planning:error",
        payload: {
          sessionId,
          message: err instanceof Error ? err.message : "Failed to create prewarm job",
          code: "PREWARM_FAILED",
        },
      });
    }
  })();
};

const handlePlanningInterrupt = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "planning:interrupt" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { sessionId } = message.payload;

  void (async () => {
    try {
      const activeJob = await getActiveJobForPlanningSession(sessionId);
      if (!activeJob) {
        logger.info({ sessionId }, "No active job for interrupt");
        return;
      }

      // Create a special interaction so the runner knows to pause
      await createInteraction({
        agentJobId: activeJob.id,
        questionType: "free_text",
        questionText: "[INTERRUPT] User requested pause — waiting for instructions",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min timeout
        timeoutAction: "use_default",
        defaultAnswer: "Continue as before",
      });

      // Transition job to waiting_for_input
      const jobUpdated = await updateJobStatus(activeJob.id, "waiting_for_input");
      if (jobUpdated && organizationId) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "agent-job:status-changed",
          payload: {
            jobId: jobUpdated.id,
            status: jobUpdated.status,
            workItemId: jobUpdated.workItemId ?? null,
            planningSessionId: jobUpdated.planningSessionId ?? null,
          },
        });
      }

      // Send paused event to the user
      sendFn({
        type: "planning:paused",
        payload: { sessionId },
      });

      if (organizationId) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "planning:paused",
          payload: { sessionId },
        });
      }

      logger.info({ userId, sessionId, jobId: activeJob.id }, "Planning session interrupted by user");
    } catch (err) {
      logger.error({ userId, sessionId, err }, "Failed to interrupt planning session");
    }
  })();
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms)
    ),
  ]);

const handleAiFormatText = (
  userId: string,
  organizationId: string | null,
  message: Extract<WsClientMessage, { type: "ai:format-text" }>,
  sendFn: (msg: WsServerMessage) => void
) => {
  const { requestId, payload } = message;

  // Check AI configuration
  if (!isAiConfigured()) {
    sendFn({
      type: "ai:error",
      requestId,
      payload: { message: "AI service is not configured", code: "AI_NOT_CONFIGURED" },
    });
    return;
  }

  // Send accepted immediately
  sendFn({ type: "ai:accepted", requestId });

  // Resolve user locale then fire AI processing
  const localePromise = getUserById(userId).then((u) => u?.locale ?? "es").catch(() => "es");

  // Fire-and-forget AI processing
  localePromise.then((locale) => withTimeout(formatText(payload.text, payload.fieldContext, undefined, locale), AI_TIMEOUT_MS))
    .then(async (formattedText) => {
      let savedToDb = false;

      // If workItemId present, persist the generated prompt
      if (payload.workItemId && payload.fieldContext === "prompt") {
        try {
          savedToDb = organizationId
            ? await saveGeneratedPrompt(organizationId, payload.workItemId, formattedText)
            : false;

          if (savedToDb) {
            // Broadcast work-item:updated to all connections of this user
            wsConnectionManager.sendToUser(userId, {
              type: "work-item:updated",
              payload: {
                workItemId: payload.workItemId,
                changes: { generatedPrompt: formattedText },
              },
            });
          }
        } catch (dbErr) {
          logger.error(
            { requestId, workItemId: payload.workItemId, err: dbErr },
            "Failed to save generated prompt to DB"
          );
        }
      }

      sendFn({
        type: "ai:result",
        requestId,
        payload: {
          formattedText,
          fieldContext: payload.fieldContext,
          workItemId: payload.workItemId,
          savedToDb,
        },
      });
    })
    .catch((err) => {
      const isTimeout = err instanceof Error && err.message === "Timeout";
      logger.error(
        { requestId, userId, err },
        isTimeout ? "AI format-text timed out" : "AI format-text failed"
      );

      sendFn({
        type: "ai:error",
        requestId,
        payload: {
          message: isTimeout
            ? "AI processing timed out"
            : "AI processing failed",
          code: isTimeout ? "AI_TIMEOUT" : "AI_ERROR",
        },
      });
    });
};

export const routeMessage = (
  userId: string,
  organizationId: string | null,
  message: WsClientMessage,
  sendFn: (msg: WsServerMessage) => void
) => {
  // Each client-initiated WS message gets its own causal trace scope.
  // clientActionId (optional) lets the client correlate ws-out → ws-in → job.
  const traceId =
    (message as unknown as { clientActionId?: string }).clientActionId ??
    randomUUID();

  return runWithTraceId(traceId, () => routeMessageInner(userId, organizationId, message, sendFn));
};

const routeMessageInner = (
  userId: string,
  organizationId: string | null,
  message: WsClientMessage,
  sendFn: (msg: WsServerMessage) => void
) => {
  switch (message.type) {
    case "ping":
      sendFn({ type: "pong" });
      break;

    case "ai:format-text":
      handleAiFormatText(userId, organizationId, message, sendFn);
      break;

    case "planning:start":
      logger.info(
        { userId, sessionId: message.payload.sessionId },
        "Planning session start requested"
      );
      handlePlanningStart(userId, organizationId, message, sendFn);
      break;

    case "planning:answer":
      logger.info(
        { userId, sessionId: message.payload.sessionId },
        "Planning answer received"
      );
      handlePlanningAnswer(userId, organizationId, message, sendFn);
      break;

    case "planning:prompt":
      logger.info(
        { userId, sessionId: message.payload.sessionId },
        "Planning prompt received"
      );
      handlePlanningPrompt(userId, organizationId, message, sendFn);
      break;

    case "planning:cancel":
      logger.info(
        { userId, sessionId: message.payload.sessionId },
        "Planning session cancel requested"
      );
      handlePlanningCancel(userId, organizationId, message, sendFn);
      break;

    case "planning:kill":
      logger.info(
        { userId, sessionId: message.payload.sessionId },
        "Planning session kill requested"
      );
      handlePlanningKill(userId, organizationId, message, sendFn);
      break;

    case "planning:prewarm":
      logger.info(
        { userId, sessionId: message.payload.sessionId },
        "Planning session prewarm requested"
      );
      handlePlanningPrewarm(userId, organizationId, message, sendFn);
      break;

    case "planning:interrupt":
      logger.info(
        { userId, sessionId: message.payload.sessionId },
        "Planning interrupt requested"
      );
      handlePlanningInterrupt(userId, organizationId, message, sendFn);
      break;

    default:
      logger.warn(
        { userId, messageType: (message as Record<string, unknown>).type },
        "Unknown WS message type"
      );
      break;
  }
};
