import { randomBytes, randomUUID } from "node:crypto";
import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  listScheduledAgentConfigsByWorkspace,
  getScheduledAgentConfigById,
  createScheduledAgentConfig,
  updateScheduledAgentConfig,
  deleteScheduledAgentConfig,
  pauseScheduledAgentConfig,
  previewBacklogDrainCandidates,
  listBacklogDrainWorkItems,
} from "@almirant/database";
import { logger } from "@almirant/config";
import {
  normalizeRunnerCustomMcpServersConfig,
  requiresInternalMcp,
} from "@almirant/shared";
import { successResponse, errorResponse, notFoundResponse } from "../../../shared/services/response";
import { getInstanceConfig } from "../../instance/services/instance-config-service";
import { executeScheduledAgentConfig } from "../services/execute-scheduled-agent-config";
import {
  assertValidScheduledAgentRuntime,
  SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR,
} from "../services/scheduled-agent-runtime-validation";
import {
  resolveScheduledAgentEffectiveRuntimes,
} from "../services/scheduled-agent-effective-model-resolver";
import { resolveScheduledAgentProjectContext } from "../services/scheduled-agent-project-context";

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

// Internal-only jobTypes (feedback-triage, bug-analysis, bug-fix, feedback-bug-*)
// are deliberately EXCLUDED here. Those skills require the privileged
// `/mcp/internal` mount and must only be enqueued by internal backend services
// (feedback-triage-enqueue, bug-analysis-orchestrator). User-created scheduled
// agents must never be able to target them — see requiresInternalMcp.
const VALID_JOB_TYPES = [
  "implementation",
  "planning",
  "review",
  "validation",
  "bug-fix",
  "recording",
  "prewarm",
  "scheduled",
  "incident-analyze",
  "integration",
] as const;

const VALID_PROVIDERS = ["claude-code", "codex", "zipu", "grok"] as const;
const VALID_AI_PROVIDERS = ["anthropic", "openai", "zai", "xai"] as const;
const VALID_CODING_AGENTS = ["claude-code", "codex", "opencode", "codex-cli"] as const;
const VALID_SCHEDULE_TYPES = ["manual", "time_window", "cron"] as const;
const VALID_BACKLOG_DRAIN_CODING_AGENTS = ["claude-code", "codex", "opencode"] as const;
const VALID_BACKLOG_DRAIN_AI_PROVIDERS = ["anthropic", "openai", "google", "zai", "xai"] as const;

// ---------------------------------------------------------------------------
// Elysia body schemas
// ---------------------------------------------------------------------------

const timeWindowConfigSchema = t.Object({
  startHour: t.Number({ minimum: 0, maximum: 23 }),
  endHour: t.Number({ minimum: 0, maximum: 23 }),
  daysOfWeek: t.Array(t.Number({ minimum: 0, maximum: 6 })),
});

const cronConfigSchema = t.Object({
  expression: t.String({ minLength: 1 }),
});

const backlogDrainProjectRuleSchema = t.Object(
  {
    projectId: t.String({ minLength: 1 }),
    enabled: t.Optional(t.Boolean()),
    maxConcurrentJobs: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 100 }))),
    excludedWorkItemIds: t.Optional(t.Array(t.String())),
    excludeDescendants: t.Optional(t.Boolean()),
    codingAgent: t.Optional(t.Nullable(t.Union(VALID_BACKLOG_DRAIN_CODING_AGENTS.map((agent) => t.Literal(agent))))),
    aiProvider: t.Optional(t.Nullable(t.Union(VALID_BACKLOG_DRAIN_AI_PROVIDERS.map((provider) => t.Literal(provider))))),
    model: t.Optional(t.Nullable(t.String())),
    reasoningLevel: t.Optional(t.Nullable(t.String())),
  },
  { additionalProperties: false },
);

const backlogDrainConfigSchema = t.Object(
  {
    enabled: t.Optional(t.Boolean()),
    minAgeMinutes: t.Optional(t.Number({ minimum: 0, maximum: 1440 })),
    defaultMaxConcurrentJobs: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 100 }))),
    projects: t.Optional(t.Array(backlogDrainProjectRuleSchema)),
  },
  { additionalProperties: false },
);

const dodReviewConfigSchema = t.Object(
  {
    enabled: t.Optional(t.Boolean()),
    minAgeMinutes: t.Optional(t.Number({ minimum: 0, maximum: 1440 })),
    defaultMaxConcurrentJobs: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 100 }))),
    projects: t.Optional(t.Array(backlogDrainProjectRuleSchema)),
  },
  { additionalProperties: false },
);

const releaseIntegrationConfigSchema = t.Object(
  {
    enabled: t.Optional(t.Boolean()),
    minAgeMinutes: t.Optional(t.Number({ minimum: 0, maximum: 1440 })),
    defaultMaxConcurrentJobs: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 100 }))),
    projects: t.Optional(t.Array(backlogDrainProjectRuleSchema)),
  },
  { additionalProperties: false },
);

const targetConfigSchema = t.Object(
  {
    projectIds: t.Optional(t.Array(t.String())),
    columnIds: t.Optional(t.Array(t.String())),
    statuses: t.Optional(t.Array(t.String())),
    priorities: t.Optional(t.Array(t.String())),
    maxAgeHours: t.Optional(t.Number({ minimum: 1 })),
    customFilters: t.Optional(t.Record(t.String(), t.Unknown())),
    requireDodApproved: t.Optional(t.Boolean()),
    backlogDrain: t.Optional(backlogDrainConfigSchema),
    dodRemediation: t.Optional(backlogDrainConfigSchema),
    dodReview: t.Optional(dodReviewConfigSchema),
    releaseIntegration: t.Optional(releaseIntegrationConfigSchema),
  },
  { additionalProperties: false },
);

const VALID_TRIGGERS = ["scheduled", "webhook"] as const;

const mcpServerSchema = t.Object(
  {
    type: t.Optional(t.Literal("remote")),
    url: t.String({ minLength: 1, maxLength: 2048 }),
    enabled: t.Optional(t.Boolean()),
    oauth: t.Optional(t.Literal(false)),
  },
  { additionalProperties: false },
);

const mcpServersSchema = t.Record(t.String({ minLength: 1, maxLength: 64 }), mcpServerSchema);

const createBodySchema = t.Object({
  id: t.Optional(t.String({ minLength: 1 })),
  name: t.String({ minLength: 1, maxLength: 255 }),
  prompt: t.Optional(t.String()),
  jobType: t.Union(VALID_JOB_TYPES.map((j) => t.Literal(j))),
  provider: t.Union(VALID_PROVIDERS.map((p) => t.Literal(p))),
  trigger: t.Optional(t.Union(VALID_TRIGGERS.map((trigger) => t.Literal(trigger)))),
  webhookToken: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  skillId: t.Optional(t.Nullable(t.String())),
  scheduleType: t.Optional(t.Union(VALID_SCHEDULE_TYPES.map((scheduleType) => t.Literal(scheduleType)))),
  scheduleConfig: t.Optional(t.Nullable(t.Union([timeWindowConfigSchema, cronConfigSchema]))),
  timezone: t.Optional(t.String({ minLength: 1 })),
  enabled: t.Optional(t.Boolean()),
  targetConfig: t.Optional(targetConfigSchema),
  maxJobsPerRun: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  projectId: t.Optional(t.Nullable(t.String())),
  description: t.Optional(t.String()),
  codingAgent: t.Optional(t.Union(VALID_CODING_AGENTS.map((agent) => t.Literal(agent)))),
  aiProvider: t.Optional(t.Union(VALID_AI_PROVIDERS.map((provider) => t.Literal(provider)))),
  aiModel: t.Optional(t.String()),
  reasoningLevel: t.Optional(t.String()),
  mcpServers: t.Optional(t.Nullable(mcpServersSchema)),
});

const updateBodySchema = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  prompt: t.Optional(t.Nullable(t.String())),
  jobType: t.Optional(t.Union(VALID_JOB_TYPES.map((j) => t.Literal(j)))),
  provider: t.Optional(t.Union(VALID_PROVIDERS.map((p) => t.Literal(p)))),
  trigger: t.Optional(t.Union(VALID_TRIGGERS.map((trigger) => t.Literal(trigger)))),
  webhookToken: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  skillId: t.Optional(t.Nullable(t.String())),
  scheduleType: t.Optional(t.Union(VALID_SCHEDULE_TYPES.map((scheduleType) => t.Literal(scheduleType)))),
  scheduleConfig: t.Optional(t.Nullable(t.Union([timeWindowConfigSchema, cronConfigSchema]))),
  timezone: t.Optional(t.String({ minLength: 1 })),
  enabled: t.Optional(t.Boolean()),
  targetConfig: t.Optional(targetConfigSchema),
  maxJobsPerRun: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  projectId: t.Optional(t.Nullable(t.String())),
  description: t.Optional(t.String()),
  codingAgent: t.Optional(t.Union(VALID_CODING_AGENTS.map((agent) => t.Literal(agent)))),
  aiProvider: t.Optional(t.Union(VALID_AI_PROVIDERS.map((provider) => t.Literal(provider)))),
  aiModel: t.Optional(t.String()),
  reasoningLevel: t.Optional(t.String()),
  mcpServers: t.Optional(t.Nullable(mcpServersSchema)),
});

type RouteScheduleType = (typeof VALID_SCHEDULE_TYPES)[number];
type RouteTrigger = (typeof VALID_TRIGGERS)[number];
type RouteScheduleConfig =
  | { startHour: number; endHour: number; daysOfWeek: number[] }
  | { expression: string }
  | null
  | undefined;

const normalizeScheduledConfigInput = (
  trigger: RouteTrigger,
  scheduleType: RouteScheduleType,
  scheduleConfig: RouteScheduleConfig,
) => {
  // Webhook agents are not driven by the cron scheduler; force a manual schedule.
  if (trigger === "webhook") {
    return { scheduleType: "manual" as const, scheduleConfig: null, enabled: undefined };
  }

  if (scheduleType === "manual") {
    return { scheduleType, scheduleConfig: null, enabled: false };
  }

  if (!scheduleConfig) {
    throw new Error("Scheduled agents require a schedule configuration");
  }

  return { scheduleType, scheduleConfig, enabled: undefined };
};

const normalizeMcpServersInput = (mcpServers: unknown) => {
  const result = normalizeRunnerCustomMcpServersConfig(mcpServers);
  if (result.errors.length > 0) {
    throw new Error(`Invalid MCP server config: ${result.errors.join("; ")}`);
  }
  return result.servers;
};

const generateWebhookToken = (): string => randomBytes(32).toString("base64url");

const buildWebhookProposal = async (
  request: Request,
  input?: { id?: string; webhookToken?: string },
) => {
  const id = input?.id ?? randomUUID();
  const webhookToken = input?.webhookToken ?? generateWebhookToken();
  const instanceConfig = await getInstanceConfig();
  const requestOrigin = new URL(request.url).origin;
  const baseUrl = (instanceConfig.publicUrl ?? requestOrigin).replace(/\/$/, "");
  const token = encodeURIComponent(webhookToken);

  return {
    id,
    webhookToken,
    webhookUrl: `${baseUrl}/webhooks/agents/${id}?token=${token}`,
    testWebhookUrl: `${baseUrl}/webhook-test/agents/${id}?token=${token}`,
  };
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const scheduledAgentsRoutes = new Elysia({ prefix: "/scheduled-agents" })
  .use(sessionContextTypes)

  // GET /scheduled-agents - List configs for the active workspace
  .get(
    "/",
    async ({ activeWorkspace, query }) => {
      try {
        const orgId = activeWorkspace!.id;
        const configs = await listScheduledAgentConfigsByWorkspace(orgId, {
          projectId: query.projectId,
        });
        return successResponse(configs);
      } catch (error) {
        logger.error({ error }, "Failed to list scheduled agent configs");
        return errorResponse("Failed to list scheduled agent configs");
      }
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
      }),
    },
  )

  // POST /scheduled-agents/backlog-drain/preview - Preview deterministic backlog-drain candidates before saving/enabling
  .post(
    "/backlog-drain/preview",
    async ({ body, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const preview = await previewBacklogDrainCandidates({
          workspaceId: orgId,
          projectId: body.projectId ?? null,
          targetConfig: body.targetConfig,
          codingAgent: body.codingAgent ?? null,
          aiProvider: body.aiProvider ?? null,
          aiModel: body.aiModel ?? null,
          reasoningLevel: body.reasoningLevel ?? null,
        });
        return successResponse(preview);
      } catch (error) {
        logger.error({ error }, "Failed to preview backlog drain candidates");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to preview backlog drain candidates",
        );
      }
    },
    {
      body: t.Object({
        projectId: t.Optional(t.Nullable(t.String())),
        targetConfig: targetConfigSchema,
        codingAgent: t.Optional(t.Nullable(t.Union(VALID_BACKLOG_DRAIN_CODING_AGENTS.map((agent) => t.Literal(agent))))),
        aiProvider: t.Optional(t.Nullable(t.Union(VALID_BACKLOG_DRAIN_AI_PROVIDERS.map((provider) => t.Literal(provider))))),
        aiModel: t.Optional(t.Nullable(t.String())),
        reasoningLevel: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  // POST /scheduled-agents/webhook-proposal - Build production/test webhook URLs before saving.
  .post(
    "/webhook-proposal",
    async ({ body, request }) => {
      try {
        const proposal = await buildWebhookProposal(request, {
          id: body.id,
          webhookToken: body.webhookToken,
        });
        return successResponse(proposal);
      } catch (error) {
        logger.error({ error }, "Failed to build scheduled agent webhook proposal");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to build scheduled agent webhook proposal",
        );
      }
    },
    {
      body: t.Object({
        id: t.Optional(t.String({ minLength: 1 })),
        webhookToken: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      }),
    },
  )

  // GET /scheduled-agents/backlog-drain/work-items?projectIds=a,b - Tree data for guided exclusions
  .get(
    "/backlog-drain/work-items",
    async ({ query, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const projectIds = query.projectIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        const items = await listBacklogDrainWorkItems(orgId, projectIds);
        return successResponse(items);
      } catch (error) {
        logger.error({ error }, "Failed to list backlog drain work items");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to list backlog drain work items",
        );
      }
    },
    {
      query: t.Object({
        projectIds: t.String({ minLength: 1 }),
      }),
    },
  )

  // GET /scheduled-agents/:id - Get a single config
  .get(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const config = await getScheduledAgentConfigById(params.id, orgId);

        if (!config) {
          set.status = 404;
          return notFoundResponse("Scheduled agent config");
        }

        return successResponse(config);
      } catch (error) {
        logger.error({ error }, "Failed to get scheduled agent config");
        return errorResponse("Failed to get scheduled agent config");
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // POST /scheduled-agents - Create a new config
  .post(
    "/",
    async ({ body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        // Defense in depth: even though `feedback-triage`, `bug-analysis` and
        // `bug-fix` are not in VALID_JOB_TYPES, guard against any future
        // addition or prompt-based smuggling that would route to an internal
        // skill. Also rejects a freeform `prompt` that starts with a slash
        // command targeting an internal skill.
        const promptFirstToken = body.prompt?.trim().split(/\s+/)[0]?.replace(/^\//, "") ?? "";
        if (requiresInternalMcp(body.jobType) || requiresInternalMcp(promptFirstToken)) {
          set.status = 403;
          return errorResponse(
            "This jobType/skill is reserved for internal system flows and cannot be scheduled via the public API"
          );
        }
        const trigger = (body.trigger ?? "scheduled") as RouteTrigger;
        const isWebhook = trigger === ("webhook" as RouteTrigger);
        const requestedScheduleType: RouteScheduleType | undefined =
          body.scheduleType ?? (isWebhook ? "manual" : undefined);
        if (!isWebhook && !requestedScheduleType) {
          set.status = 400;
          return errorResponse("scheduleType is required for scheduled agents");
        }
        const normalizedSchedule = normalizeScheduledConfigInput(
          trigger,
          requestedScheduleType ?? "manual",
          body.scheduleConfig,
        );
        const normalizedMcpServers = normalizeMcpServersInput(body.mcpServers);
        const effectiveProject = await resolveScheduledAgentProjectContext(orgId, body.projectId);
        const effectiveRuntimes = await resolveScheduledAgentEffectiveRuntimes({
          workspaceId: orgId,
          provider: body.provider,
          codingAgent: body.codingAgent,
          aiProvider: body.aiProvider,
          aiModel: body.aiModel,
          reasoningLevel: body.reasoningLevel,
          jobType: body.jobType,
          projectId: effectiveProject.projectId,
          targetConfig: body.targetConfig,
        });
        assertValidScheduledAgentRuntime({
          provider: body.provider,
          codingAgent: body.codingAgent,
          aiProvider: body.aiProvider,
          aiModel: body.aiModel,
          reasoningLevel: body.reasoningLevel,
          effectiveRuntimes,
          targetConfig: body.targetConfig,
        });

        const config = await createScheduledAgentConfig({
          id: isWebhook ? body.id : undefined,
          workspaceId: orgId,
          name: body.name,
          prompt: body.prompt ?? null,
          jobType: body.jobType,
          provider: body.provider,
          trigger,
          webhookToken: isWebhook ? body.webhookToken : undefined,
          skillId: body.skillId ?? null,
          scheduleType: normalizedSchedule.scheduleType,
          scheduleConfig: normalizedSchedule.scheduleConfig,
          timezone: body.timezone,
          enabled: normalizedSchedule.enabled ?? body.enabled,
          targetConfig: body.targetConfig ?? {},
          maxJobsPerRun: body.maxJobsPerRun,
          projectId: body.projectId,
          description: body.description ?? null,
          codingAgent: body.codingAgent ?? null,
          aiProvider: body.aiProvider ?? null,
          aiModel: body.aiModel ?? null,
          reasoningLevel: body.reasoningLevel ?? null,
          mcpServers: normalizedMcpServers,
        });

        set.status = 201;
        return successResponse(config);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Invalid MCP server config")) {
          logger.warn({ error }, "Rejected scheduled agent MCP config");
          set.status = 400;
          return errorResponse(error.message);
        }
        if (error instanceof Error && error.message.startsWith(SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR)) {
          logger.warn({ error }, "Rejected scheduled agent runtime config");
          set.status = 400;
          return errorResponse(error.message);
        }
        logger.error({ error }, "Failed to create scheduled agent config");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to create scheduled agent config",
        );
      }
    },
    { body: createBodySchema },
  )

  // PATCH /scheduled-agents/:id - Update a config
  .patch(
    "/:id",
    async ({ params, body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const { mcpServers: bodyMcpServers, ...bodyWithoutMcpServers } = body;

        const existing = await getScheduledAgentConfigById(params.id, orgId);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Scheduled agent config");
        }

        const nextTrigger = body.trigger ?? existing.trigger;
        const nextScheduleType = body.scheduleType ?? existing.scheduleType;
        const nextScheduleConfig =
          body.scheduleConfig !== undefined ? body.scheduleConfig : existing.scheduleConfig;
        const normalizedSchedule = normalizeScheduledConfigInput(
          nextTrigger,
          nextScheduleType,
          nextScheduleConfig,
        );
        const nextEnabled = normalizedSchedule.enabled ?? body.enabled ?? existing.enabled;
        const becameEnabled = existing.enabled === false && nextEnabled === true;
        const normalizedMcpServers =
          bodyMcpServers !== undefined ? normalizeMcpServersInput(bodyMcpServers) : undefined;
        const touchesRuntime =
          body.provider !== undefined ||
          body.codingAgent !== undefined ||
          body.aiProvider !== undefined ||
          body.aiModel !== undefined ||
          body.reasoningLevel !== undefined ||
          body.jobType !== undefined ||
          body.targetConfig !== undefined ||
          body.projectId !== undefined;

        if (touchesRuntime) {
          const nextProvider = body.provider ?? existing.provider;
          const nextAiProvider = body.aiProvider ?? existing.aiProvider;
          const nextAiModel = body.aiModel ?? existing.aiModel;
          const nextJobType = body.jobType ?? existing.jobType;
          const nextProjectId = body.projectId !== undefined
            ? body.projectId
            : existing.projectId;
          const effectiveProject = await resolveScheduledAgentProjectContext(orgId, nextProjectId);
          const effectiveRuntimes = await resolveScheduledAgentEffectiveRuntimes({
            workspaceId: orgId,
            provider: nextProvider,
            codingAgent: body.codingAgent ?? existing.codingAgent,
            aiProvider: nextAiProvider,
            aiModel: nextAiModel,
            reasoningLevel: body.reasoningLevel ?? existing.reasoningLevel,
            jobType: nextJobType,
            projectId: effectiveProject.projectId,
            targetConfig: body.targetConfig ?? existing.targetConfig,
          });
          assertValidScheduledAgentRuntime({
            provider: nextProvider,
            codingAgent: body.codingAgent ?? existing.codingAgent,
            aiProvider: nextAiProvider,
            aiModel: nextAiModel,
            reasoningLevel: body.reasoningLevel ?? existing.reasoningLevel,
            effectiveRuntimes,
            targetConfig: body.targetConfig ?? existing.targetConfig,
          });
        }

        const config = await updateScheduledAgentConfig(params.id, orgId, {
          ...bodyWithoutMcpServers,
          trigger: nextTrigger,
          scheduleType: normalizedSchedule.scheduleType,
          scheduleConfig: normalizedSchedule.scheduleConfig,
          enabled: nextEnabled,
          ...(bodyMcpServers !== undefined ? { mcpServers: normalizedMcpServers } : {}),
          // Re-enabling inside an active time window should not be blocked by the
          // previous run timestamp; the runner will pick it up on the next tick.
          ...(becameEnabled ? { lastRunAt: null } : {}),
        });
        return successResponse(config);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Invalid MCP server config")) {
          logger.warn({ error }, "Rejected scheduled agent MCP config update");
          set.status = 400;
          return errorResponse(error.message);
        }
        if (error instanceof Error && error.message.startsWith(SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR)) {
          logger.warn({ error }, "Rejected scheduled agent runtime config update");
          set.status = 400;
          return errorResponse(error.message);
        }
        logger.error({ error }, "Failed to update scheduled agent config");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to update scheduled agent config",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: updateBodySchema,
    },
  )

  // DELETE /scheduled-agents/:id - Delete a config
  .delete(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        // Verify ownership
        const existing = await getScheduledAgentConfigById(params.id, orgId);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Scheduled agent config");
        }

        await deleteScheduledAgentConfig(params.id, orgId);
        return successResponse({ deleted: true });
      } catch (error) {
        logger.error({ error }, "Failed to delete scheduled agent config");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to delete scheduled agent config",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  // POST /scheduled-agents/:id/pause - Pause or resume a config
  .post(
    "/:id/pause",
    async ({ params, body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        // Verify ownership
        const existing = await getScheduledAgentConfigById(params.id, orgId);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Scheduled agent config");
        }

        const until = body.until ? new Date(body.until) : null;

        if (until !== null && isNaN(until.getTime())) {
          set.status = 400;
          return errorResponse("Invalid ISO 8601 timestamp for 'until'");
        }

        const updated = await pauseScheduledAgentConfig(params.id, orgId, until);
        return successResponse(updated);
      } catch (error) {
        logger.error({ error }, "Failed to pause/resume scheduled agent config");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to pause/resume scheduled agent config",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        until: t.Nullable(t.String()),
      }),
    },
  )

  // POST /scheduled-agents/:id/trigger - Manually trigger a scheduled agent
  .post(
    "/:id/trigger",
    async ({ params, set, activeWorkspace, user }) => {
      try {
        const orgId = activeWorkspace!.id;

        const config = await getScheduledAgentConfigById(params.id, orgId);
        if (!config) {
          set.status = 404;
          return notFoundResponse("Scheduled agent config");
        }

        const job = await executeScheduledAgentConfig(config, {
          createdByUserId: user?.id ?? null,
        });

        return successResponse(job);
      } catch (error) {
        logger.error({ error }, "Failed to trigger scheduled agent config");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to trigger scheduled agent config",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
