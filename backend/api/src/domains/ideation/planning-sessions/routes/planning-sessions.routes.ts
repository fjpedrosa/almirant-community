import { Elysia, t } from "elysia";
import {
  getPlanningSessions,
  getPlanningSessionById,
  createPlanningSession,
  updatePlanningSession,
  completePlanningSession,
  resumePlanningSession,
  deletePlanningSession,
  addSeedToSession,
  removeSeedFromSession,
  getSeedsBySession,
  getSeedIdsBySession,
  getWorkItemsBySession,
  getActiveSessionForUser,
  createJob,
  getActiveJobForPlanningSession,
  getPrewarmJobForSession,
  markSeedsAsToReview,
  getConversationHistoryFromLogs,
  getLatestJobForPlanningSession,
  getEnrichedConversationHistory,
  buildSessionRecoverySummary,
  getPendingInteractionForSession,
  getSessionEventsBySessionId,
  getRepositories,
  getJobById,
  listAgentJobLogsByJobId,
} from "@almirant/database";
import { resolveRuntime } from "@almirant/shared";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../../shared/services/response";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";
import { getDefaultModel, resolveModelFromProviderKey } from "../../../ai/shared/services/model-factory";
import { localeToLanguageName } from "../../../ai/shared/services/locale-utils";
import { renameDiscordThread } from "../../../integrations/discord/services/discord-thread";
import { logger } from "@almirant/config";
import { inferPlanningSkillName } from "../services/planning-skill-routing";
import { getOrRefreshCanonicalSessionProjection } from "../services/canonical-session-projection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLANNING_SESSION_STATUS_SCHEMA = t.Union([
  t.Literal("active"),
  t.Literal("completed"),
  t.Literal("archived"),
]);

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getWorkspaceIdFromContext = (ctx: unknown): string => {
  const activeWorkspace = (ctx as { activeWorkspace?: { id?: string } }).activeWorkspace;
  if (!activeWorkspace?.id) {
    throw new Error("ACTIVE_WORKSPACE_NOT_FOUND");
  }
  return activeWorkspace.id;
};

const getUserIdFromContext = (ctx: unknown): string | undefined => {
  const currentUser = (ctx as { user?: { id?: string } }).user;
  return currentUser?.id;
};

const getUserLocaleFromContext = (ctx: unknown): string => {
  const currentUser = (ctx as { user?: { locale?: string } }).user;
  return currentUser?.locale ?? "es";
};

const RESUME_MESSAGES: Record<
  string,
  { closed: string; continue: string; phaseInfo: string; workItemsInfo: string; resumeInstruction: string }
> = {
  es: {
    closed: "Cerrada automáticamente al reanudar otra sesión",
    continue: "Continúa la sesión de planificación desde donde se dejó.",
    phaseInfo: ' La sesión estaba en la fase "{phase}".',
    workItemsInfo: " Ya se habían creado {count} work items.",
    resumeInstruction: " NO empieces de nuevo desde la fase 1 — retoma exactamente donde se interrumpió.",
  },
  en: {
    closed: "Automatically closed when resuming another session",
    continue: "Continue the planning session from where it was left off.",
    phaseInfo: ' The session was in the "{phase}" phase.',
    workItemsInfo: " {count} work items had already been created.",
    resumeInstruction: " Do NOT start over from phase 1 — resume exactly where it was interrupted.",
  },
};

const WELCOME_FALLBACKS: Record<string, { primary: string; secondary: string }> = {
  es: {
    primary: "¡Hola! Estoy listo para ayudarte a planificar. ¿Qué tienes en mente?",
    secondary: "¡Hola! Estoy listo para ayudarte a planificar. ¿En qué te gustaría trabajar hoy?",
  },
  en: {
    primary: "Hi! I'm ready to help you plan. What's on your mind?",
    secondary: "Hi! I'm ready to help you plan. What would you like to work on today?",
  },
};

const getResumeMessages = (locale: string) => {
  const key = locale.split("-")[0]?.toLowerCase() ?? "es";
  return RESUME_MESSAGES[key] ?? RESUME_MESSAGES.es!;
};

const getWelcomeFallbacks = (locale: string) => {
  const key = locale.split("-")[0]?.toLowerCase() ?? "es";
  return WELCOME_FALLBACKS[key] ?? WELCOME_FALLBACKS.es!;
};

const mapPlanningErrorToHttp = (errorMessage: string): { status: number; message: string } => {
  if (errorMessage === "ACTIVE_WORKSPACE_NOT_FOUND") {
    return { status: 403, message: "No active workspace in session" };
  }
  if (errorMessage === "User already has an active planning session") {
    return { status: 409, message: "User already has an active planning session" };
  }
  if (errorMessage.includes("no configured repository")) {
    return { status: 422, message: "Project has no configured repository. Add a repository in project settings before planning." };
  }
  return { status: 500, message: errorMessage };
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const planningSessionsRoutes = new Elysia({ prefix: "/planning-sessions" })

  // GET /planning-sessions — List sessions (paginated, filterable)
  .get(
    "/",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const pagination = parsePaginationParams(query);
        const { items, total } = await getPlanningSessions(orgId, query.projectId, pagination, {
          status: query.status as "active" | "completed" | "archived" | undefined,
          createdByUserId: query.createdByUserId,
        });
        return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(PLANNING_SESSION_STATUS_SCHEMA),
        createdByUserId: t.Optional(t.String()),
      }),
    }
  )

  // GET /planning-sessions/:id — Get session with meta
  .get(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        getWorkspaceIdFromContext(ctx); // validate org access
        const session = await getPlanningSessionById(params.id);
        if (!session) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        // Attach any pending (unanswered) interaction so the frontend can
        // restore follow-up state on reload / deep-link.
        let pendingInteraction: {
          id: string;
          questionType: string;
          questionText: string;
          questionContext: Record<string, unknown> | null;
          options: string[] | null;
          expiresAt: string;
          timeoutAction: string | null;
        } | null = null;

        if (session.status === "active") {
          try {
            const interaction = await getPendingInteractionForSession(params.id);
            if (interaction) {
              pendingInteraction = {
                id: interaction.id,
                questionType: interaction.questionType,
                questionText: interaction.questionText,
                questionContext: interaction.questionContext,
                options: interaction.options,
                expiresAt: interaction.expiresAt.toISOString(),
                timeoutAction: interaction.timeoutAction,
              };
            }
          } catch (err) {
            // Non-critical — log and continue without pendingInteraction
            logger.warn({ err, sessionId: params.id }, "Failed to fetch pending interaction for session");
          }
        }

        return successResponse({ ...session, pendingInteraction });
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /planning-sessions — Create session
  .post(
    "/",
    async (ctx) => {
      try {
        const { body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);

        if (!userId) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }

        // Check for existing active session (also checked inside repo, but we want 409 here)
        const activeSession = await getActiveSessionForUser(orgId, userId);
        if (activeSession) {
          set.status = 409;
          return errorResponse("User already has an active planning session", 409);
        }

        // Validate project has at least one repository configured
        if (body.projectId) {
          const repos = await getRepositories(orgId, body.projectId);
          if (repos.length === 0) {
            set.status = 422;
            return errorResponse("Project has no configured repository. Add a repository in project settings before planning.", 422);
          }
        }

        const session = await createPlanningSession(orgId, {
          projectId: body.projectId,
          boardId: body.boardId,
          title: body.title,
          config: body.config,
          createdByUserId: userId,
        });

        // Link seeds if provided
        if (body.seedIds && body.seedIds.length > 0) {
          await Promise.all(
            body.seedIds.map((seedId) => addSeedToSession(session.id, seedId))
          );
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "planning-session:created",
          payload: {
            sessionId: session.id,
            projectId: session.projectId,
            title: session.title,
          },
        });

        set.status = 201;
        // Re-fetch to include updated seedCount
        const fresh = await getPlanningSessionById(session.id);
        return successResponse(fresh ?? session);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      body: t.Object({
        projectId: t.Optional(t.String()),
        boardId: t.Optional(t.String()),
        title: t.String({ minLength: 1 }),
        seedIds: t.Optional(t.Array(t.String())),
        config: t.Optional(
          t.Object({
            model: t.Optional(t.String()),
            provider: t.Optional(t.String()),
            systemPrompt: t.Optional(t.String()),
            temperature: t.Optional(t.Number()),
          })
        ),
      }),
    }
  )

  // PATCH /planning-sessions/:id — Update session (title, status, config)
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const updated = await updatePlanningSession(params.id, {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.status !== undefined && { status: body.status as "active" | "completed" | "archived" }),
          ...(body.config !== undefined && { config: body.config }),
        });

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "planning-session:updated",
          payload: {
            sessionId: params.id,
            changes: body as Record<string, unknown>,
          },
        });

        // Sync Discord thread name when session title changes (best-effort)
        if (body.title) {
          void (async () => {
            try {
              const job = await getActiveJobForPlanningSession(params.id);
              const config = job?.config as Record<string, unknown> | undefined;
              const threadId = config?.threadId as string | undefined;
              if (threadId) {
                await renameDiscordThread(threadId, body.title!);
              }
            } catch {
              // Best-effort — don't fail the PATCH
            }
          })();
        }

        return successResponse(updated);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1 })),
        status: t.Optional(PLANNING_SESSION_STATUS_SCHEMA),
        config: t.Optional(
          t.Object({
            model: t.Optional(t.String()),
            provider: t.Optional(t.String()),
            systemPrompt: t.Optional(t.String()),
            temperature: t.Optional(t.Number()),
          })
        ),
      }),
    }
  )

  // DELETE /planning-sessions/:id — Delete session
  .delete(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        getWorkspaceIdFromContext(ctx); // validate org access
        const deleted = await deletePlanningSession(params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /planning-sessions/:id/complete — Complete session with result
  .post(
    "/:id/complete",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const completed = await completePlanningSession(params.id, body.result);
        if (!completed) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "planning-session:completed",
          payload: {
            sessionId: params.id,
            result: body.result,
          },
        });

        return successResponse(completed);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        result: t.Object({
          summary: t.Optional(t.String()),
          workItemsCreated: t.Optional(t.Number()),
          seedsProcessed: t.Optional(t.Number()),
        }),
      }),
    }
  )

  // POST /planning-sessions/:id/complete-seeds — Mark seeds as to_review + clear selectedForIdeation
  .post(
    "/:id/complete-seeds",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);

        // Verify session exists
        const session = await getPlanningSessionById(params.id);
        if (!session) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        // Get seed IDs attached to this session
        const seedIds = await getSeedIdsBySession(params.id);
        if (seedIds.length === 0) {
          return successResponse({ updated: 0 });
        }

        // Mark seeds as to_review and clear selectedForIdeation
        const updated = await markSeedsAsToReview(orgId, seedIds);

        return successResponse({ updated });
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /planning-sessions/:id/resume — Resume a completed/archived session
  .post(
    "/:id/resume",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);

        if (!userId) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }

        // Fetch the session
        const session = await getPlanningSessionById(params.id);
        if (!session) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        // Validate session is not already active.
        // Exception: if already active but a job is waiting for user input, return the
        // pending interaction so the frontend can display the questionnaire without
        // creating a duplicate job.
        if (session.status === "active") {
          const activePendingInteraction = await getPendingInteractionForSession(params.id);
          if (activePendingInteraction) {
            const activeJob = await getActiveJobForPlanningSession(params.id);
            wsConnectionManager.broadcastToWorkspace(orgId, {
              type: "worker-interaction:created",
              payload: {
                questionId: activePendingInteraction.id,
                jobId: activePendingInteraction.agentJobId,
                workItemId: activePendingInteraction.workItemId ?? activeJob?.workItemId ?? "",
                planningSessionId: params.id,
                workItemTitle: session.title,
                provider: activeJob?.provider ?? "claude-code",
                questionType: activePendingInteraction.questionType,
                questionText: activePendingInteraction.questionText,
                context: activePendingInteraction.questionContext,
                options: activePendingInteraction.options,
                expiresAt: activePendingInteraction.expiresAt.toISOString(),
              },
            });
            return successResponse({ ...session, pendingInteraction: activePendingInteraction });
          }
          set.status = 400;
          return errorResponse("Session is already active", 400);
        }

        // Validate session is not older than 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (new Date(session.createdAt) < sevenDaysAgo) {
          set.status = 400;
          return errorResponse("Cannot resume sessions older than 7 days", 400);
        }

        // Check for existing active session
        const activeSession = await getActiveSessionForUser(orgId, userId);
        if (activeSession) {
          if (body.forceClose) {
            const locale = getUserLocaleFromContext(ctx);
            const resumeMsg = getResumeMessages(locale);
            // Complete the active session first
            await completePlanningSession(activeSession.id, {
              summary: resumeMsg.closed,
            });
            wsConnectionManager.broadcastToWorkspace(orgId, {
              type: "planning-session:completed",
              payload: {
                sessionId: activeSession.id,
                result: { summary: resumeMsg.closed },
              },
            });
          } else {
            set.status = 409;
            return errorResponse("User already has an active planning session", 409);
          }
        }

        // Resume the session
        const resumed = await resumePlanningSession(params.id);
        if (!resumed) {
          set.status = 500;
          return errorResponse("Failed to resume session", 500);
        }

        // Check for an existing pending interaction before creating a new job.
        // This handles the case where a previous resume job is still waiting for user input.
        const existingPendingInteraction = await getPendingInteractionForSession(params.id);
        if (existingPendingInteraction) {
          const pendingJob = await getActiveJobForPlanningSession(params.id);
          // A job is already waiting for user input — no need to create another one.
          wsConnectionManager.broadcastToWorkspace(orgId, {
            type: "planning-session:resumed",
            payload: { sessionId: params.id },
          });
          // Re-broadcast the pending interaction so the frontend can show the questionnaire.
          wsConnectionManager.broadcastToWorkspace(orgId, {
            type: "worker-interaction:created",
            payload: {
              questionId: existingPendingInteraction.id,
              jobId: existingPendingInteraction.agentJobId,
              workItemId: existingPendingInteraction.workItemId ?? pendingJob?.workItemId ?? "",
              planningSessionId: params.id,
              workItemTitle: resumed.title,
              provider: pendingJob?.provider ?? "claude-code",
              questionType: existingPendingInteraction.questionType,
              questionText: existingPendingInteraction.questionText,
              context: existingPendingInteraction.questionContext,
              options: existingPendingInteraction.options,
              expiresAt: existingPendingInteraction.expiresAt.toISOString(),
            },
          });
          return successResponse({ ...resumed, pendingInteraction: existingPendingInteraction });
        }

        // Build enriched conversation history and recovery context
        let conversationHistory: Array<{ role: string; content: string }> = [];
        let recoveryContext: string | undefined;
        let lastJob: Awaited<ReturnType<typeof getLatestJobForPlanningSession>> = null;
        try {
          lastJob = await getLatestJobForPlanningSession(params.id);
          if (lastJob) {
            const enrichedHistory = await getEnrichedConversationHistory(lastJob.id);
            // Flatten enriched messages: inline tool calls as text
            conversationHistory = enrichedHistory.map((msg) => {
              let content = msg.content;
              if (msg.toolCalls && msg.toolCalls.length > 0) {
                const toolLines = msg.toolCalls
                  .map((tc) => `[Tool: ${tc.toolName}] Input: ${tc.input}`)
                  .join("\n");
                content = content ? `${content}\n\n${toolLines}` : toolLines;
              }
              return { role: msg.role, content };
            });
          }
          // Build structured recovery summary
          const summary = await buildSessionRecoverySummary(params.id);
          if (summary) {
            recoveryContext = summary;
          }
        } catch {
          // Best-effort; proceed without enriched history
        }

        // Build a resume message that instructs the agent to continue from where it left off
        const sessionResult = session.result as { interruptionContext?: { lastPhase?: string; workItemsCreatedSoFar?: number } } | null;
        const interruptCtx = sessionResult?.interruptionContext;
        const resumeMsgs = getResumeMessages(getUserLocaleFromContext(ctx));
        const phaseInfo = interruptCtx?.lastPhase
          ? resumeMsgs.phaseInfo.replace("{phase}", interruptCtx.lastPhase)
          : "";
        const workItemsInfo = interruptCtx?.workItemsCreatedSoFar
          ? resumeMsgs.workItemsInfo.replace("{count}", String(interruptCtx.workItemsCreatedSoFar))
          : "";
        const resumeUserMessage = `${resumeMsgs.continue}${phaseInfo}${workItemsInfo}${resumeMsgs.resumeInstruction}`;

        // Use the original session's agent config (from last job), falling back to defaults
        const resumeProvider = (lastJob?.provider ?? "claude-code") as "claude-code" | "codex" | "zipu" | "grok";
        const resumeCodingAgent = (lastJob?.codingAgent ?? "claude-code") as "claude-code" | "codex" | "opencode";
        const resumeAiProvider = (lastJob?.aiProvider ?? "anthropic") as "anthropic" | "openai" | "google" | "zai" | "xai";
        const resumeModel = lastJob?.model ?? resolveRuntime({ provider: resumeProvider }).model;
        const lastJobDetail = lastJob ? await getJobById(lastJob.id) : null;
        const resumeSkillName = inferPlanningSkillName({
          prompt: resumeUserMessage,
          previousSkillName:
            lastJobDetail?.job.promptTemplate ??
            lastJobDetail?.job.skillName ??
            null,
        });

        // Resume marker handled via canonical event path (agent_job_logs)

        // Create a new agent job with history
        const job = await createJob({
          projectId: resumed.projectId ?? null,
          boardId: resumed.boardId ?? null,
          workItemId: null,
          planningSessionId: params.id,
          createdByUserId: userId,
          workspaceId: orgId,
          jobType: "planning",
          provider: resumeProvider,
          priority: "medium",
          config: {
            skillName: resumeSkillName,
            sessionMode: "planning",
            source: "resume",
            workspaceIntent: "read-only",
            postSessionPushPolicy: "never",
            locale: getUserLocaleFromContext(ctx),
            requestedByUserId: userId,
            planningSessionId: params.id,
            repoPath: ".",
            baseBranch: "main",
            seedIds: [],
            userMessage: resumeUserMessage,
            ...(conversationHistory.length > 0 ? { conversationHistory } : {}),
            ...(recoveryContext ? { recoveryContext } : {}),
          },
          codingAgent: resumeCodingAgent,
          aiProvider: resumeAiProvider,
          model: resumeModel,
          skillName: resumeSkillName,
          // New model fields
          promptTemplate: resumeSkillName,
          triggerType: "event",
          interactive: true,
        });

        // Broadcast resumed event
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "planning-session:resumed",
          payload: {
            sessionId: params.id,
          },
        });

        // Broadcast job status
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "agent-job:status-changed",
          payload: {
            jobId: job.id,
            status: job.status,
            workItemId: null,
            planningSessionId: params.id,
          },
        });

        return successResponse(resumed);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        forceClose: t.Optional(t.Boolean()),
      }),
    }
  )

  // ---------------------------------------------------------------------------
  // Welcome message (warm welcome via LLM)
  // ---------------------------------------------------------------------------

  // POST /planning-sessions/:id/welcome — Generate personalized welcome message
  .post(
    "/:id/welcome",
    async (ctx) => {
      try {
        getWorkspaceIdFromContext(ctx); // validate org access
        const { body } = ctx;

        const locale = getUserLocaleFromContext(ctx);
        const langName = localeToLanguageName(locale);
        const fallbacks = getWelcomeFallbacks(locale);

        let message: string;

        try {
          const model = getDefaultModel();

          const prompt = `Generate a brief and warm greeting (2-3 sentences) in ${langName} for a user starting a planning session${body.projectName ? ` on the project "${body.projectName}"` : ""}. ${body.seedCount ? `They have ${body.seedCount} pending ideas to explore. ` : ""}Ask what brings them here. Be natural and concise.`;

          // Use AbortController for 2s timeout
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2000);

          try {
            const result = await model.invoke(
              [{ role: "user" as const, content: prompt }],
              { signal: controller.signal },
            );
            clearTimeout(timeout);

            const rawContent = result.content;
            message =
              typeof rawContent === "string"
                ? rawContent
                : Array.isArray(rawContent)
                  ? (rawContent.find(
                      (b: { type: string; text?: string }) =>
                        b.type === "text",
                    ) as { type: string; text?: string } | undefined)?.text ??
                    fallbacks.primary
                  : fallbacks.primary;
          } catch {
            clearTimeout(timeout);
            // Fallback static message on timeout or LLM error
            message = fallbacks.secondary;
          }
        } catch {
          // Fallback if getDefaultModel() fails (e.g. no API key configured)
          message = fallbacks.secondary;
        }

        return successResponse({ message });
      } catch (error) {
        ctx.set.status = 500;
        return errorResponse(normalizeErrorMessage(error), 500);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        projectName: t.Optional(t.String()),
        seedCount: t.Optional(t.Number()),
      }),
    }
  )

  // POST /planning-sessions/:id/generate-title — Generate title from prompt via LLM
  .post(
    "/:id/generate-title",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        getWorkspaceIdFromContext(ctx);

        const session = await getPlanningSessionById(params.id);
        if (!session) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        const getFallbackTitle = (): string => {
          const trimmed = body.prompt.trim();
          return trimmed.length > 80 ? trimmed.slice(0, 80) + "..." : trimmed;
        };

        let title: string;

        try {
          // Use the user's provider key with a fast/cheap model for title generation
          let resolved: Awaited<ReturnType<typeof resolveModelFromProviderKey>> | null = null;
          if (body.providerKeyId) {
            resolved = await resolveModelFromProviderKey(body.providerKeyId, {
              modelName: "claude-haiku-4-5",
            });
            logger.info({ providerKeyId: body.providerKeyId, hasModel: !!resolved }, "generate-title: resolved provider key");
          }

          if (!resolved) {
            // Try default model as fallback
            try {
              const defaultModel = getDefaultModel();
              resolved = { model: defaultModel, connectionId: "default" };
            } catch {
              logger.warn("generate-title: no provider key and no default model configured");
            }
          }

          if (!resolved) {
            title = getFallbackTitle();
          } else {
            const titleLocale = getUserLocaleFromContext(ctx);
            const titleLangName = localeToLanguageName(titleLocale);
            const systemPrompt = `You are a conversation title generator. Given the user's first message in a planning session, generate a short, descriptive title.

Rules:
- 3 to 6 words maximum
- Capture the MAIN TOPIC or GOAL, not the phrasing
- You MUST write the title in ${titleLangName}
- Return ONLY the title text, nothing else
- No quotes, no punctuation at the end, no prefixes
- Be specific and descriptive

Examples:
- Input: "Quiero que analicemos cómo mejorar el rendimiento de las queries de la base de datos" → "Optimización queries base de datos"
- Input: "Need to add user authentication with OAuth" → "OAuth user authentication"
- Input: "Me gustaría que pensáramos cómo podríamos implementar un sistema de notificaciones push" → "Sistema notificaciones push"`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            try {
              const result = await resolved.model.invoke(
                [
                  { role: "system" as const, content: systemPrompt },
                  { role: "user" as const, content: body.prompt.slice(0, 500) },
                ],
                { signal: controller.signal }
              );
              clearTimeout(timeout);

              const rawContent = result.content;
              const extracted =
                typeof rawContent === "string"
                  ? rawContent
                  : Array.isArray(rawContent)
                    ? (rawContent.find(
                        (b: { type: string; text?: string }) => b.type === "text"
                      ) as { type: string; text?: string } | undefined)?.text ??
                      null
                    : null;

              logger.info({ extracted: extracted?.slice(0, 50) }, "generate-title: LLM response");

              if (extracted) {
                title = extracted.replace(/^["'.]|["'.]$/g, "").trim().slice(0, 100);
              } else {
                title = getFallbackTitle();
              }
            } catch (err) {
              clearTimeout(timeout);
              logger.warn({ error: err instanceof Error ? err.message : String(err) }, "generate-title: LLM call failed");
              title = getFallbackTitle();
            }
          }
        } catch (err) {
          logger.warn({ error: err instanceof Error ? err.message : String(err) }, "generate-title: provider key resolution failed");
          title = getFallbackTitle();
        }

        await updatePlanningSession(params.id, { title });
        return successResponse({ title });
      } catch (error) {
        ctx.set.status = 500;
        return errorResponse(normalizeErrorMessage(error), 500);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        prompt: t.String({ minLength: 1 }),
        providerKeyId: t.Optional(t.String()),
      }),
    }
  )

  // ---------------------------------------------------------------------------
  // Pre-warm
  // ---------------------------------------------------------------------------

  // POST /planning-sessions/:id/prewarm — Create a pre-warm job for runner preparation
  .post(
    "/:id/prewarm",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);

        if (!userId) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }

        const session = await getPlanningSessionById(params.id);
        if (!session) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        if (session.status !== "active") {
          set.status = 400;
          return errorResponse("Planning session is not active", 400);
        }

        // Check for existing active job (planning or prewarm)
        const existingJob = await getActiveJobForPlanningSession(params.id);
        if (existingJob) {
          set.status = 409;
          return errorResponse("Session already has an active job", 409);
        }

        const existingPrewarm = await getPrewarmJobForSession(params.id);
        if (existingPrewarm) {
          // Return existing prewarm job instead of creating a duplicate
          return successResponse({ jobId: existingPrewarm.id, status: existingPrewarm.status });
        }

        // Accept optional agent config from the request body.
        // Frontend may send AI provider ("zai", "xai", "anthropic", "openai") or agent provider ("zipu", "grok", "claude-code", "codex").
        const body = ctx.body as { provider?: string; codingAgent?: string; model?: string } | undefined;
        const { provider: reqProvider, codingAgent: reqCodingAgent, aiProvider: reqAiProvider, model: reqModel } =
          resolveRuntime({ provider: body?.provider, codingAgent: body?.codingAgent, model: body?.model });

        const job = await createJob({
          projectId: session.projectId ?? null,
          boardId: session.boardId ?? null,
          workItemId: null,
          planningSessionId: params.id,
          createdByUserId: userId,
          workspaceId: orgId,
          jobType: "prewarm",
          provider: reqProvider,
          priority: "medium",
          config: {
            repoPath: ".",
            baseBranch: "main",
            planningSessionId: params.id,
            requestedByUserId: userId,
            projectId: session.projectId ?? undefined,
            isPrewarm: true,
            workspaceIntent: "read-only",
            postSessionPushPolicy: "never",
            locale: getUserLocaleFromContext(ctx),
            ...(body?.codingAgent ? { codingAgent: reqCodingAgent } : {}),
            ...(body?.model ? { model: reqModel } : {}),
          },
          codingAgent: reqCodingAgent,
          aiProvider: reqAiProvider,
          model: reqModel,
          skillName: "ideate",
          // New model fields (prewarm becomes interactive after conversion)
          promptTemplate: "ideate",
          triggerType: "event",
          interactive: false,
        });

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "agent-job:status-changed",
          payload: {
            jobId: job.id,
            status: job.status,
            workItemId: null,
            planningSessionId: params.id,
          },
        });

        set.status = 201;
        return successResponse({ jobId: job.id, status: job.status });
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // ---------------------------------------------------------------------------
  // Seeds
  // ---------------------------------------------------------------------------

  // GET /planning-sessions/:id/seeds — Get linked seeds
  .get(
    "/:id/seeds",
    async (ctx) => {
      try {
        const { params } = ctx;
        getWorkspaceIdFromContext(ctx); // validate org access
        const seeds = await getSeedsBySession(params.id);
        return successResponse(seeds);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /planning-sessions/:id/seeds — Add seed mid-session
  .post(
    "/:id/seeds",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        getWorkspaceIdFromContext(ctx); // validate org access
        await addSeedToSession(params.id, body.seedId);
        set.status = 201;
        return successResponse({ added: true });
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ seedId: t.String() }),
    }
  )

  // DELETE /planning-sessions/:id/seeds/:seedId — Remove seed
  .delete(
    "/:id/seeds/:seedId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        getWorkspaceIdFromContext(ctx); // validate org access
        const removed = await removeSeedFromSession(params.id, params.seedId);
        if (!removed) {
          set.status = 404;
          return notFoundResponse("Seed link");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), seedId: t.String() }) }
  )

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  // GET /planning-sessions/:id/session-events — Get canonical session events by planning session
  .get(
    "/:id/session-events",
    async (ctx) => {
      try {
        const { params, query, set } = ctx;
        getWorkspaceIdFromContext(ctx); // validate org access

        const session = await getPlanningSessionById(params.id);
        if (!session) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        const afterSequence = query.after ? Number(query.after) : undefined;
        const kinds = query.kinds ? query.kinds.split(",").filter(Boolean) : undefined;
        const limit = query.limit ? Math.min(Number(query.limit), 10000) : 5000;

        const events = await getSessionEventsBySessionId(params.id, {
          afterSequence,
          kinds,
          limit,
        });

        return successResponse(events);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        after: t.Optional(t.String()),
        kinds: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
      }),
    }
  )

  // GET /planning-sessions/:id/session-projection — Get materialized canonical v2 session state
  .get(
    "/:id/session-projection",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const workspaceId = getWorkspaceIdFromContext(ctx);

        const session = await getPlanningSessionById(params.id);
        if (!session || session.workspaceId !== workspaceId) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        const projection = await getOrRefreshCanonicalSessionProjection({
          planningSessionId: params.id,
          workspaceId,
        });

        return successResponse(projection);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )

  // GET /planning-sessions/:id/latest-output — Output of the latest job in one call
  // Collapses the jobs->output chain the replay UI does today (list jobs by
  // session, take the newest, then fetch that job's output) into a single
  // request. Reuses the existing getLatestJobForPlanningSession +
  // listAgentJobLogsByJobId logic and returns the same chunk shape as
  // GET /agent-jobs/:id/output.
  .get(
    "/:id/latest-output",
    async (ctx) => {
      try {
        const { params, query, set } = ctx;
        const workspaceId = getWorkspaceIdFromContext(ctx);

        const session = await getPlanningSessionById(params.id);
        if (!session || session.workspaceId !== workspaceId) {
          set.status = 404;
          return notFoundResponse("Planning session");
        }

        const latestJob = await getLatestJobForPlanningSession(params.id);
        if (!latestJob) {
          return successResponse({
            jobId: null,
            sessionId: params.id,
            chunks: [],
            text: "",
            nextCursor: null,
            hasMore: false,
          });
        }

        const limitRaw = query.limit ? Number.parseInt(query.limit, 10) : 1000;
        const limit =
          Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(limitRaw, 5000)
            : 1000;

        const result = await listAgentJobLogsByJobId(latestJob.id, { limit });
        const chunks = result.logs.map((log) => ({
          id: log.id,
          seq: log.seq,
          level: log.level,
          phase: log.phase,
          eventType: log.eventType,
          message: log.message,
          contentType: log.contentType,
          payload: log.payload ?? {},
          timestamp:
            log.timestamp instanceof Date
              ? log.timestamp.toISOString()
              : new Date(log.timestamp).toISOString(),
        }));

        return successResponse({
          jobId: latestJob.id,
          sessionId: params.id,
          chunks,
          text: chunks.map((chunk) => chunk.message).join("\n"),
          nextCursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
        });
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ limit: t.Optional(t.String()) }),
    }
  )

  // ---------------------------------------------------------------------------
  // Work items
  // ---------------------------------------------------------------------------

  // GET /planning-sessions/:id/work-items — Get linked work items
  .get(
    "/:id/work-items",
    async (ctx) => {
      try {
        const { params } = ctx;
        getWorkspaceIdFromContext(ctx); // validate org access
        const workItems = await getWorkItemsBySession(params.id);
        return successResponse(workItems);
      } catch (error) {
        const mapped = mapPlanningErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  );
