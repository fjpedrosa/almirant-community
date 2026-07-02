import { Elysia, t } from "elysia";
import {
  validateApiKey,
  listEnabledScheduledAgentConfigs,
  updateScheduledAgentConfigLastRunAt,
  getBacklogDrainCandidatesForConfigId,
  getDodRemediationCandidatesForConfigId,
  getWorkers,
  upsertWorker,
  updateHeartbeat,
  createJob,
  claimJobs,
  updateJobStatus,
  getJobById,
  getActiveJobForWorkItem,
  getWorkItemById,
  getDependencies,
  getDependents,
  findColumnByNameInBoard,
  moveWorkItem,
  setWorkItemAiProcessing,
  setWorkItemAiError,
  getLatestActiveAiKeyByProvider,
  updateConnectionLastUsedAt,
  decryptCredentials,
  createInteraction,
  createAgentJobLogBatch,
  getInteractionById,
  getAttachment,
  cancelInteractionsByJobId,
  checkQuotaAvailable,
  getInstallationByRepoId,
  getValidationCandidates,
  getDefinitionOfDoneReviewCandidates,
  getFixCandidates,
  getValidatingReleaseCandidates,
  getGithubRepoFullNameByRepoId,
  getRecoverableReleaseBatchesWithoutActiveJob,
  getActiveBatchForRepository,
  getOpenReleaseBatchForRepository,
  getNextReleaseNumber,
  countActiveBatchItemsByProject,
  countActiveAgentJobsForLane,
  getBatchByIdWithItems,
  createIntegrationBatch,
  addItemsToBatch,
  updateBatchStatus,
  getProjectsWithNightlyValidationEnabled,
  getCommitsByBranchAndRepo,
  createUsageRecord,
  getWorkItemsBySession,
  completePlanningSession,
  resetStaleChildWorkItems,
  getRunningJobsForWorker,
  getQueuedJobCount,
  getQueuedJobCountByAgent,
  getExecutingJobCount,
  insertMetricsSnapshot,
  getMetricsHistory,
  getAllWorkersMetricsHistory,
  cleanupOldMetrics,
  getRepositories,
  getOrgPrimaryRepository,
  getTranscriptByJobId,
  getSessionEventsByJobId,
  insertSessionEventsBatch,
  insertAgentNativeEventsBatch,
  getAgentNativeEventsByJobId,
  getLeafTaskIdsUnder,
  getDodRemediationExpectedLeafTaskIdsUnder,
  getCompletedWorkItemIdsForJob,
  db,
  agentJobs,
  eq,
  and,
  inArray,
  workItems,
  projects,
  planningSessions,
} from "@almirant/database";
import { getInstallationAccessToken } from "../../integrations/github/services/github-service";
import type { ProviderQuotaDb, ApiKey, CodingAgent, AiProvider, AgentJobConfig, NewAgentNativeEvent } from "@almirant/database";
import { env, logger } from "@almirant/config";
import { getGithubAppCredentials } from "../../instance/services/github-app-credentials-service";
import { errorResponse, notFoundResponse, successResponse } from "../../../shared/services/response";
import { downloadBufferFromS3, extractKeyFromUrl, isS3Configured } from "../../../shared/services/s3-service";
import { resolveLocalAttachmentPath } from "../../../shared/services/local-attachments";
import { wsConnectionManager } from "../../../shared/ws/ws-connection-manager";
import { broadcastAgentJobStatusChanged } from "../../../shared/ws/agent-job-events";
import { resolveAiKey } from "../../ai/shared/services/resolve-ai-key";
import { upsertNotificationBySource } from "../../../shared/services/notification-service";
import { refreshConnectionCredentialsIfNeeded } from "../../ai/shared/services/resolve-ai-key";
import { suspendConnection, getConnectionById } from "@almirant/database";
import { sanitizeLogMessage, sanitizeLogPayload } from "../services/agent-job-log-sanitizer";
import { autoLinkCommitsToWorkItems } from "../../integrations/github/services/github-webhook-handlers";
import { deriveJobUsageMetrics } from "../services/job-usage-metrics";
import { persistJobMemoryFromTerminalState } from "../../../lib/memory/post-job";
import { resolveRuntime } from "@almirant/shared";
import {
  buildDefaultJobResourceEstimate,
  buildWorkItemResourceForecast,
  toJobResourceEstimate,
} from "../services/resource-forecast";
import { resolveExpectedWorkItemIdsForCompletion } from "../services/completion-snapshot";

const buildReleaseIntegrationExecutionName = (
  repositoryFullName: string | null | undefined,
): string => {
  const normalized = repositoryFullName?.trim();
  return normalized ? `Integration — ${normalized}` : "Integration";
};

/** Serialize a raw Drizzle worker interaction to the WorkerInteraction client type. */
const toWorkerInteractionResponse = (interaction: {
  id: string;
  agentJobId: string;
  status: string;
  questionType: string;
  questionText: string;
  questionContext: unknown;
  options: unknown;
  answerText: string | null;
  answeredBy: string | null;
  answeredAt: Date | string | null;
  expiresAt: Date | string;
  timeoutAction: string;
  defaultAnswer: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}) => {
  const toISO = (v: Date | string | null | undefined): string | null => {
    if (!v) return null;
    return v instanceof Date ? v.toISOString() : String(v);
  };

  const mapStatus = (s: string): "pending" | "answered" | "timeout" | "cancelled" => {
    if (s === "timed_out") return "timeout";
    return s as "pending" | "answered" | "cancelled";
  };

  const deriveResponseSource = (
    status: string,
    answeredBy: string | null,
  ): "user" | "timeout" | "system" | null => {
    if (status === "pending" || status === "cancelled") return null;
    if (status === "timed_out") return "timeout";
    if (answeredBy) return "user";
    return "system";
  };

  return {
    id: interaction.id,
    agentJobId: interaction.agentJobId,
    status: mapStatus(interaction.status),
    questionType: interaction.questionType,
    questionText: interaction.questionText,
    questionContext: (interaction.questionContext as Record<string, unknown>) ?? null,
    options: (interaction.options as string[]) ?? null,
    response: interaction.answerText ?? null,
    responseSource: deriveResponseSource(interaction.status, interaction.answeredBy),
    answeredAt: toISO(interaction.answeredAt),
    expiresAt: toISO(interaction.expiresAt)!,
    timeoutAction: interaction.timeoutAction,
    defaultAnswer: interaction.defaultAnswer ?? null,
    createdAt: toISO(interaction.createdAt)!,
    updatedAt: toISO(interaction.updatedAt)!,
  };
};

const requireWorkerApiKey = async (request: Request): Promise<ApiKey | null> => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw = authHeader.slice(7);
  const apiKey = await validateApiKey(raw);
  if (!apiKey) return null;

  return apiKey;
};

/** Resolve organizationId from a workItemId via the work item's project. */
const resolveOrgIdFromWorkItem = async (workItemId: string | null): Promise<string | null> => {
  if (!workItemId) return null;
  const [row] = await db
    .select({ organizationId: projects.organizationId })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(eq(workItems.id, workItemId))
    .limit(1);
  return row?.organizationId ?? null;
};

/** Resolve organizationId from a planningSessionId directly (planning_sessions has organizationId). */
const resolveOrgIdFromPlanningSession = async (planningSessionId: string | null): Promise<string | null> => {
  if (!planningSessionId) return null;
  const [row] = await db
    .select({ organizationId: planningSessions.organizationId })
    .from(planningSessions)
    .where(eq(planningSessions.id, planningSessionId))
    .limit(1);
  return row?.organizationId ?? null;
};

/** Resolve organizationId from either workItemId or planningSessionId. */
const resolveOrgId = async (workItemId: string | null, planningSessionId: string | null): Promise<string | null> => {
  if (workItemId) return resolveOrgIdFromWorkItem(workItemId);
  if (planningSessionId) return resolveOrgIdFromPlanningSession(planningSessionId);
  return null;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type TerminalAgentJobStatus = "completed" | "incomplete" | "failed" | "cancelled";

const TERMINAL_AGENT_JOB_STATUSES = new Set<TerminalAgentJobStatus>([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
]);

const isTerminalAgentJobStatus = (status: string): status is TerminalAgentJobStatus =>
  TERMINAL_AGENT_JOB_STATUSES.has(status as TerminalAgentJobStatus);

const USAGE_RECORD_AGENT_JOB_STATUSES = new Set<TerminalAgentJobStatus>([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
]);

const pickFirstString = (
  record: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const pickFirstBoolean = (
  record: Record<string, unknown>,
  keys: string[],
): boolean | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
};

type PlanningToolUseEnvelope = {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  inputPreview?: string;
};

const parsePlanningToolUseEnvelope = (
  content: string,
): PlanningToolUseEnvelope | null => {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isPlainRecord(parsed)) return null;

    const toolName = pickFirstString(parsed, ["name", "toolName"]);
    const toolCallId = pickFirstString(parsed, ["id", "toolCallId"]);
    if (!toolName || !toolCallId) return null;

    const input = isPlainRecord(parsed.input) ? parsed.input : undefined;

    return {
      toolCallId,
      toolName,
      input,
      inputPreview: input ? JSON.stringify(input) : undefined,
    };
  } catch {
    return null;
  }
};

const broadcastPlanningToolUse = ({
  orgId,
  planningSessionId,
  toolUse,
}: {
  orgId: string;
  planningSessionId: string;
  toolUse: PlanningToolUseEnvelope;
}): void => {
  wsConnectionManager.broadcastToOrganization(orgId, {
    type: "planning:tool-call-start",
    payload: {
      sessionId: planningSessionId,
      toolCallId: toolUse.toolCallId,
      toolName: toolUse.toolName,
      ...(toolUse.inputPreview ? { inputPreview: toolUse.inputPreview } : {}),
    },
  });

  const input = toolUse.input;
  if (!input) return;

  if (toolUse.toolName === "Agent" || toolUse.toolName === "Task") {
    const description =
      pickFirstString(input, ["description", "prompt"])?.slice(0, 80) ??
      toolUse.toolName;
    const subagentType = pickFirstString(input, ["subagent_type", "subagentType"]);
    const isBackground =
      pickFirstBoolean(input, ["run_in_background", "isBackground"]) ?? false;

    wsConnectionManager.broadcastToOrganization(orgId, {
      type: "planning:subagent-spawn",
      payload: {
        sessionId: planningSessionId,
        subagentId: toolUse.toolCallId,
        description,
        isBackground,
        ...(subagentType ? { subagentType } : {}),
      },
    });
    return;
  }

  if (toolUse.toolName === "Bash") {
    const command = pickFirstString(input, ["command", "cmd"]);
    if (!command) return;

    const description = pickFirstString(input, ["description"]);

    wsConnectionManager.broadcastToOrganization(orgId, {
      type: "planning:bash-execute",
      payload: {
        sessionId: planningSessionId,
        command,
        ...(description ? { description } : {}),
      },
    });
    return;
  }

  if (toolUse.toolName === "Read") {
    const filePath = pickFirstString(input, ["file_path", "filePath", "path"]);
    if (!filePath) return;

    const lineRange = pickFirstString(input, ["line_range", "lineRange", "range"]);

    wsConnectionManager.broadcastToOrganization(orgId, {
      type: "planning:file-read",
      payload: {
        sessionId: planningSessionId,
        filePath,
        ...(lineRange ? { lineRange } : {}),
      },
    });
    return;
  }

  if (toolUse.toolName === "Write" || toolUse.toolName === "Edit") {
    const filePath = pickFirstString(input, ["file_path", "filePath", "path"]);
    if (!filePath) return;

    wsConnectionManager.broadcastToOrganization(orgId, {
      type: "planning:file-change",
      payload: {
        sessionId: planningSessionId,
        filePath,
        operation: toolUse.toolName === "Write" ? "write" : "edit",
      },
    });
  }
};

const broadcastStatusChanged = async (
  job: {
    organizationId?: string | null;
    workItemId?: string | null;
    planningSessionId?: string | null;
  },
  args: {
    jobId: string;
    status: string;
    workItemId: string | null;
    planningSessionId?: string | null;
  },
) => {
  // Prefer the job's own organizationId (always populated). Only resolve via
  // workItem/planningSession as a legacy fallback for older call sites that
  // lack the full job record.
  const orgId =
    job.organizationId ??
    (await resolveOrgId(
      job.workItemId ?? args.workItemId ?? null,
      job.planningSessionId ?? args.planningSessionId ?? null,
    ));
  broadcastAgentJobStatusChanged({
    organizationId: orgId,
    jobId: args.jobId,
    status: args.status,
    workItemId: args.workItemId,
    planningSessionId: args.planningSessionId ?? null,
  });
};

type ResolvableWorkerProvider = "anthropic" | "openai" | "zai" | "xai";

const normalizeWorkerProvider = (provider: string): ResolvableWorkerProvider | null => {
  const normalized = provider.trim().toLowerCase();
  switch (normalized) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "openai-compatible":
    case "openai_compatible":
    case "zai":
      return "zai";
    case "grok":
    case "xai":
      return "xai";
    default:
      return null;
  }
};

const normalizeJobResultPayload = (
  result: unknown,
): Record<string, unknown> | null => {
  if (result == null) return null;
  if (typeof result === "string") return { summary: result };
  if (typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { value: result };
};

const MAX_LOG_BATCH_SIZE = 1_000;

const resourceEstimateSchema = t.Object({
  estimatedMemoryMb: t.Number(),
  source: t.Union([
    t.Literal("forecast"),
    t.Literal("profile"),
    t.Literal("skill-default"),
  ]),
  confidence: t.Union([
    t.Literal("low"),
    t.Literal("medium"),
    t.Literal("high"),
  ]),
  reason: t.Optional(t.String()),
});

const agentWorkspaceSchema = t.Union([
  t.Object({
    kind: t.Literal("git_repo"),
    repositoryId: t.Optional(t.String()),
    repoUrl: t.Optional(t.String()),
    ref: t.Optional(t.String()),
    branch: t.Optional(t.String()),
    depth: t.Optional(t.Number({ minimum: 1 })),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal("empty_workspace"),
    templateId: t.Optional(t.String()),
    template: t.Optional(t.String()),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal("uploaded_files"),
    fileIds: t.Array(t.String()),
    unpackMode: t.Optional(t.Union([
      t.Literal("flat"),
      t.Literal("preserve_paths"),
    ])),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal("mounted_volume"),
    volumeId: t.Optional(t.String()),
    path: t.Optional(t.String()),
    mountPath: t.Optional(t.String()),
    readOnly: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal("memory_only"),
    contextIds: t.Array(t.String()),
  }, { additionalProperties: false }),
]);

const workerMcpServerSchema = t.Object(
  {
    type: t.Optional(t.Literal("remote")),
    url: t.String({ minLength: 1, maxLength: 2048 }),
    enabled: t.Optional(t.Boolean()),
    oauth: t.Optional(t.Literal(false)),
  },
  { additionalProperties: false },
);

const workerMcpServersSchema = t.Record(
  t.String({ minLength: 1, maxLength: 64 }),
  workerMcpServerSchema,
);

const MAX_WORKSPACE_FILE_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const getUploadedWorkspaceFileIds = (config: unknown): string[] => {
  if (!isPlainRecord(config)) return [];
  const workspace = config.workspace;
  if (!isPlainRecord(workspace) || workspace.kind !== "uploaded_files") return [];

  return Array.isArray(workspace.fileIds)
    ? workspace.fileIds.filter(
        (fileId): fileId is string =>
          typeof fileId === "string" && fileId.trim().length > 0,
      )
    : [];
};

const pickAttachmentWorkspacePath = (metadata: Record<string, unknown>): string | null => {
  for (const key of ["workspacePath", "relativePath", "path"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const buildRequiredImplementationResourceEstimate = async (
  organizationId: string,
  workItemId: string,
): Promise<NonNullable<AgentJobConfig["resourceEstimate"]>> => {
  const forecast = await buildWorkItemResourceForecast(organizationId, workItemId, {
    persist: true,
  });

  if (!forecast) {
    throw new Error(`Unable to calculate resource forecast for workItemId=${workItemId}`);
  }

  return toJobResourceEstimate(forecast);
};

export const workersRoutes = new Elysia({ prefix: "/workers" })
  .derive({ as: "scoped" }, async ({ request }) => {
    const workerApiKey = await requireWorkerApiKey(request);
    return { workerApiKey };
  })
  .onBeforeHandle(({ workerApiKey, set }) => {
    if (!workerApiKey) {
      set.status = 401;
      return errorResponse("Unauthorized");
    }
  })

  // GET /workers/provider-keys - Resolve provider keys for workers (decrypted)
  //
  // Note: This endpoint is authenticated with the worker API key (Bearer token).
  // It intentionally returns plaintext keys so the worker can set provider env vars.
  .get(
    "/provider-keys",
    async ({ query, set, workerApiKey }) => {
      if (!env.ENCRYPTION_KEY) {
        set.status = 500;
        return errorResponse("Encryption key not configured. Set ENCRYPTION_KEY env variable.", 500);
      }

      const requested = (query.providers ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const providersToResolve = (
        requested.length === 0 ? ["anthropic", "openai"] : requested
      )
        .map(normalizeWorkerProvider)
        .filter((p): p is ResolvableWorkerProvider => p !== null);
      const uniqueProviders = [...new Set(providersToResolve)];

      // Parse excluded connection IDs (comma-separated) for hot-swap on rate limits
      const excludeConnectionIds = (query.excludeConnectionIds ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      // Admin-pinned connection (set via system_settings.agent_routing for
      // Almirant-internal skills). When supplied, we look it up directly and
      // use its credentials, bypassing the org's default resolution order.
      const preferredConnectionId = query.preferredConnectionId?.trim() || null;

      // Security: derive organizationId from the API key, falling back to the
      // job's org when a jobId is provided.  Shared/dynamic runners may have an
      // API key that belongs to a different org than the job they claimed —
      // this is expected in the multi-tenant model where runners are created by
      // the scaler and can pick up work for any organization.  The credential
      // resolution below is scoped to the resolved org, so credentials from one
      // org are never leaked to a job from another.
      let createdByUserId = query.createdByUserId?.trim() || null;
      let organizationId: string | null = workerApiKey!.organizationId;
      const jobId = query.jobId?.trim() || null;

      if (jobId) {
        const job = await getJobById(jobId);
        if (!job) {
          set.status = 404;
          return notFoundResponse("Agent job");
        }
        createdByUserId = createdByUserId ?? job.job.createdByUserId ?? null;
        // Use the job's org for credential resolution so that shared runners
        // can serve jobs from any organization.
        if (job.job.organizationId) {
          organizationId = job.job.organizationId;
        }
      }

      const result: Record<string, unknown> = {};
      const debugInfo: Record<string, unknown> = {};

      for (const provider of uniqueProviders) {
        let connection:
          | Awaited<ReturnType<typeof getLatestActiveAiKeyByProvider>>
          | null = null;
        let credentials: Record<string, unknown> | null = null;

        // 0. Admin-pinned connection short-circuit. Scoped to the job's org
        //    so a malformed/forged preferredConnectionId cannot leak
        //    credentials across orgs. If the pinned connection exists, is
        //    active, and matches the requested provider, use it directly.
        //    Otherwise we log a warning and fall through to the normal
        //    resolution path below so the job still executes.
        if (preferredConnectionId && organizationId) {
          const pinned = await getConnectionById(
            preferredConnectionId,
            env.ENCRYPTION_KEY,
            { scope: "organization", scopeId: organizationId },
          );
          if (
            pinned &&
            pinned.isActive &&
            pinned.category === "ai" &&
            pinned.provider === provider &&
            pinned.credentials
          ) {
            connection = pinned;
            credentials = pinned.credentials;
            logger.info(
              {
                provider,
                organizationId,
                connectionId: pinned.id,
              },
              "provider-keys: using admin-pinned connection",
            );
          } else {
            logger.warn(
              {
                provider,
                organizationId,
                preferredConnectionId,
                found: !!pinned,
                isActive: pinned?.isActive,
                providerMatches: pinned?.provider === provider,
              },
              "provider-keys: preferredConnectionId rejected, falling back to org resolution",
            );
          }
        }

        if (!connection && organizationId) {
          // 1. Try orchestration-enabled connections first (preferred path)
          let resolved = await resolveAiKey({
            provider,
            userId: createdByUserId,
            organizationId,
            encryptionKey: env.ENCRYPTION_KEY,
            forOrchestration: true,
            excludeConnectionIds: excludeConnectionIds.length > 0 ? excludeConnectionIds : undefined,
          });

          // 2. If no orchestration-enabled connection, retry with ALL org connections.
          //    This ensures we never cross org boundaries just because
          //    orchestrationEnabled is false.
          if (!resolved) {
            logger.info(
              { provider, organizationId },
              "No orchestration-enabled connection found, retrying with all org connections",
            );
            resolved = await resolveAiKey({
              provider,
              userId: createdByUserId,
              organizationId,
              encryptionKey: env.ENCRYPTION_KEY,
              forOrchestration: false,
              excludeConnectionIds: excludeConnectionIds.length > 0 ? excludeConnectionIds : undefined,
            });
          }

          // Suspend excluded connections (rate-limited mid-session)
          if (excludeConnectionIds.length > 0) {
            for (const excludedId of excludeConnectionIds) {
              void suspendConnection(
                excludedId,
                "Rate limit / quota exhausted mid-session (HTTP 429)",
              ).then(() => {
                logger.info(
                  { connectionId: excludedId, provider },
                  "Suspended rate-limited connection during hot-swap",
                );
              }).catch((err) => {
                logger.warn(
                  { connectionId: excludedId, err },
                  "Failed to suspend rate-limited connection",
                );
              });
            }
          }

          if (resolved) {
            connection = resolved.connection;
            credentials = resolved.credentials;

            if (excludeConnectionIds.length > 0) {
              logger.info(
                {
                  provider,
                  newConnectionId: resolved.connection.id,
                  newConnectionName: resolved.connection.name,
                  excludedConnectionIds: excludeConnectionIds,
                },
                "Hot-swap successful: switched to alternative connection after rate limit",
              );
            }
          } else if (excludeConnectionIds.length > 0) {
            logger.error(
              {
                provider,
                organizationId,
                excludedConnectionIds: excludeConnectionIds,
              },
              "Hot-swap failed: no alternative connection available after rate limit. All connections exhausted.",
            );
          }

          // HARD STOP: if we have an organizationId but still no connection,
          // do NOT fall through to the global lookup. That would use another
          // org's credentials — a critical isolation violation.
          if (!connection || !credentials) {
            logger.error(
              { provider, organizationId },
              "No usable connection found for organization — refusing cross-org fallback",
            );
            continue;
          }
        }

        // Global fallback: only when there is NO organizationId (legacy/system jobs)
        if (!connection || !credentials) {
          const fallbackProvider = provider;
          const row = await getLatestActiveAiKeyByProvider(fallbackProvider);
          if (!row) continue;
          connection = row;
          try {
            credentials = await refreshConnectionCredentialsIfNeeded(
              row,
              env.ENCRYPTION_KEY,
            );
          } catch (error) {
            continue;
          }
        }

        // Handle both camelCase (apiKey) and underscore (api_key) for codex auth.json compat
        const apiKey = typeof credentials.apiKey === "string"
          ? credentials.apiKey
          : typeof credentials.api_key === "string"
            ? (credentials.api_key as string)
            : undefined;
        if (!apiKey) continue;

        if (provider === "anthropic") {
          result.anthropicApiKey = apiKey;
        } else if (provider === "xai") {
          result.xaiApiKey = apiKey;
        } else {
          result.openaiApiKey = apiKey;
        }

        const config = (connection.config ?? {}) as Record<string, unknown>;
        const rawAuthMethod = typeof config.authMethod === "string" ? config.authMethod : undefined;
        const resolvedAuthMethod: "api_key" | "subscription" =
          rawAuthMethod === "oauth" || rawAuthMethod === "setup_token" || rawAuthMethod === "subscription"
            ? "subscription"
            : "api_key";

        if (provider === "anthropic") {
          result.anthropicAuthMethod = resolvedAuthMethod;
        } else if (provider === "xai") {
          result.xaiAuthMethod = resolvedAuthMethod;
        } else {
          result.openaiAuthMethod = resolvedAuthMethod;
        }

        // For openai subscription, include the full credentials JSON
        // (needed by the runner to write ~/.codex/auth.json)
        if (provider === "openai" && resolvedAuthMethod === "subscription") {
          const cleanCredentials = Object.fromEntries(
            Object.entries(credentials).filter(([k]) => k !== "authMethod"),
          );
          result.openaiCredentialsJson = JSON.stringify(cleanCredentials);
        }
        const planningModel =
          typeof config.planningModel === "string" && config.planningModel.trim().length > 0
            ? config.planningModel.trim()
            : undefined;
        const implementationModel =
          typeof config.implementationModel === "string" && config.implementationModel.trim().length > 0
            ? config.implementationModel.trim()
            : undefined;
        const validationModel =
          typeof config.validationModel === "string" && config.validationModel.trim().length > 0
            ? config.validationModel.trim()
            : undefined;
        const planningReasoningBudget =
          typeof config.planningReasoningBudget === "string" && config.planningReasoningBudget.trim().length > 0
            ? config.planningReasoningBudget.trim()
            : undefined;
        const implementationReasoningBudget =
          typeof config.implementationReasoningBudget === "string" && config.implementationReasoningBudget.trim().length > 0
            ? config.implementationReasoningBudget.trim()
            : undefined;
        const validationReasoningBudget =
          typeof config.validationReasoningBudget === "string" && config.validationReasoningBudget.trim().length > 0
            ? config.validationReasoningBudget.trim()
            : undefined;
        const baseUrlFromConfig =
          typeof config.baseUrl === "string" && config.baseUrl.trim().length > 0
            ? config.baseUrl.trim()
            : undefined;
        const baseUrlFromCreds =
          typeof credentials.baseUrl === "string" && credentials.baseUrl.trim().length > 0
            ? credentials.baseUrl.trim()
            : undefined;

        if (planningModel) result.planningModel = planningModel;
        if (implementationModel) result.implementationModel = implementationModel;
        if (validationModel) result.validationModel = validationModel;
        if (planningReasoningBudget) result.planningReasoningBudget = planningReasoningBudget;
        if (implementationReasoningBudget) result.implementationReasoningBudget = implementationReasoningBudget;
        if (validationReasoningBudget) result.validationReasoningBudget = validationReasoningBudget;
        if (baseUrlFromConfig ?? baseUrlFromCreds) {
          result.baseUrl = baseUrlFromConfig ?? baseUrlFromCreds;
        }

        // Build debug metadata for this provider
        const tokenFingerprint = apiKey.length > 12
          ? { prefix: apiKey.slice(0, 8), suffix: apiKey.slice(-4) }
          : { prefix: apiKey.slice(0, 4), suffix: "****" };

        debugInfo[provider] = {
          connectionId: connection.id,
          connectionName: connection.name ?? "unnamed",
          provider,
          authMethod: resolvedAuthMethod,
          tokenPrefix: tokenFingerprint.prefix,
          tokenSuffix: tokenFingerprint.suffix,
          tokenExpiresAt: connection.tokenExpiresAt
            ? new Date(connection.tokenExpiresAt).toISOString()
            : null,
          scope: connection.scope,
        };

        logger.info(
          {
            jobId: query.jobId,
            provider,
            connectionId: connection.id,
            connectionName: connection.name,
            authMethod: resolvedAuthMethod,
            tokenPrefix: tokenFingerprint.prefix,
            tokenSuffix: tokenFingerprint.suffix,
            tokenExpiresAt: connection.tokenExpiresAt
              ? new Date(connection.tokenExpiresAt).toISOString()
              : null,
          },
          "provider-keys: resolved connection for job",
        );

        void updateConnectionLastUsedAt(connection.id);
      }

      result._debug = debugInfo;
      return successResponse(result);
    },
    {
      query: t.Object({
        providers: t.Optional(t.String()),
        jobId: t.Optional(t.String()),
        createdByUserId: t.Optional(t.String()),
        excludeConnectionIds: t.Optional(t.String()),
        preferredConnectionId: t.Optional(t.String()),
      }),
    }
  )

  // POST /workers/heartbeat
  .post(
    "/heartbeat",
    async ({ body, set }) => {
      const config = (body.config ?? {}) as Record<string, unknown>;
      if (body.startedAt) config.startedAt = body.startedAt;
      const worker = await upsertWorker({
        workerId: body.workerId,
        hostname: body.hostname,
        currentIp: body.ip ?? null,
        config,
        activeJobs: Array.isArray(body.activeJobs) ? body.activeJobs.length : body.activeJobsCount ?? 0,
        maxConcurrentAgents: body.maxConcurrentAgents ?? undefined,
        isDraining: body.isDraining ?? undefined,
        availableSlots: body.availableSlots ?? undefined,
        ramBudgetMb: body.ramBudgetMb ?? null,
        ramCommittedMb: body.ramCommittedMb ?? null,
        ramAvailableMb: body.ramAvailableMb ?? null,
        systemMetrics: body.systemMetrics as Record<string, unknown> | undefined,
      });

      // Store metrics snapshot for time-series history (fire-and-forget)
      if (body.systemMetrics) {
        insertMetricsSnapshot({
          workerId: body.workerId,
          timestamp: new Date(),
          cpuPercent: body.systemMetrics.cpuPercent,
          ramPercent: body.systemMetrics.ramPercent,
          ramUsedMb: body.systemMetrics.ramUsedMb,
          ramTotalMb: body.systemMetrics.ramTotalMb,
          activeJobs: body.activeJobsCount ?? 0,
          containerMetrics: body.systemMetrics.containerMetrics ?? null,
        }).catch((err) => logger.error({ err, workerId: body.workerId }, "Unhandled error in insertMetricsSnapshot"));

        // Throttled cleanup: every ~100th heartbeat (probabilistic)
        if (Math.random() < 0.01) {
          cleanupOldMetrics(7).catch((err) => logger.error({ err }, "Unhandled error in cleanupOldMetrics"));
        }
      }

      set.status = 200;
      return successResponse(worker);
    },
    {
      body: t.Object({
        workerId: t.String(),
        hostname: t.String(),
        ip: t.Optional(t.String()),
        config: t.Optional(t.Record(t.String(), t.Any())),
        activeJobs: t.Optional(t.Array(t.Any())),
        activeJobsCount: t.Optional(t.Number()),
        maxConcurrentAgents: t.Optional(t.Number()),
        isDraining: t.Optional(t.Boolean()),
        availableSlots: t.Optional(t.Number()),
        ramBudgetMb: t.Optional(t.Number()),
        ramCommittedMb: t.Optional(t.Number()),
        ramAvailableMb: t.Optional(t.Number()),
        startedAt: t.Optional(t.String()),
        systemMetrics: t.Optional(t.Object({
          cpuPercent: t.Number(),
          cpuCores: t.Optional(t.Number()),
          ramPercent: t.Number(),
          ramTotalMb: t.Number(),
          ramUsedMb: t.Number(),
          ramSystemAvailableMb: t.Optional(t.Number()),
          ramReservedMb: t.Optional(t.Number()),
          ramAvailableForRunnersMb: t.Optional(t.Number()),
          ramPressurePercent: t.Optional(t.Number()),
          ramBudgetEnabled: t.Optional(t.Boolean()),
          memorySource: t.Optional(t.Union([
            t.Literal("proc-meminfo"),
            t.Literal("os"),
          ])),
          processes: t.Array(t.Object({
            jobId: t.String(),
            skillName: t.String(),
          })),
          containerMetrics: t.Optional(t.Array(t.Object({
            containerId: t.String(),
            jobId: t.String(),
            jobType: t.String(),
            cpuPercent: t.Number(),
            memoryUsageMb: t.Number(),
            memoryLimitMb: t.Number(),
            memoryPercent: t.Number(),
          }))),
        })),
      }),
    }
  )

  // GET /workers/metrics-history
  .get(
    "/metrics-history",
    async ({ query }) => {
      const range = (query.range as string) ?? "1h";
      const workerId = query.workerId as string | undefined;

      const rangeMs: Record<string, number> = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
      };

      const ms = rangeMs[range] ?? rangeMs["1h"]!;
      const now = new Date();
      const from = new Date(now.getTime() - ms!);

      // Downsample for larger ranges to keep payload manageable
      let downsampleInterval: number | undefined;
      if (range === "24h") downsampleInterval = 6; // ~1 per minute
      else if (range === "7d") downsampleInterval = 30; // ~1 per 5 minutes

      const data = workerId
        ? await getMetricsHistory(workerId, from, now, downsampleInterval)
        : await getAllWorkersMetricsHistory(from, now, downsampleInterval);

      return successResponse(data);
    },
    {
      query: t.Object({
        workerId: t.Optional(t.String()),
        range: t.Optional(t.String()),
      }),
    }
  )

  // GET /workers/work-items/:id
  // Shared runners may process work items from any organization.
  .get(
    "/work-items/:id",
    async ({ params, set }) => {
      const item = await getWorkItemById(params.id);
      if (!item) {
        set.status = 404;
        return notFoundResponse("Work item");
      }
      return successResponse(item);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /workers/work-items/:id/reset-stale-children
  .post(
    "/work-items/:id/reset-stale-children",
    async ({ params }) => {
      const resetIds = await resetStaleChildWorkItems(params.id);
      return successResponse({ resetIds });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /workers/work-items/:id/dependencies
  .get(
    "/work-items/:id/dependencies",
    async ({ params }) => {
      const dependencies = await getDependencies(params.id);
      const dependents = await getDependents(params.id);
      return successResponse({ dependencies, dependents });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /workers/jobs/claim
  .post(
    "/jobs/claim",
    async ({ body }) => {
      await updateHeartbeat(body.workerId, {
        activeJobs: body.activeJobs ?? undefined,
      });

      const jobs = await claimJobs(body.workerId, body.count, body.acceptedCodingAgents);
      return successResponse(jobs);
    },
    {
      body: t.Object({
        workerId: t.String(),
        count: t.Number(),
        activeJobs: t.Optional(t.Number()),
        acceptedCodingAgents: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // POST /workers/jobs
  .post(
    "/jobs",
    async ({ body, set }) => {
      const resolvedRuntime = resolveRuntime({
        provider: body.provider,
        codingAgent: body.codingAgent,
        model: body.model,
      });

      if (body.workItemId) {
        // === EXISTING FLOW (work-item-based job) ===
        const workItem = await getWorkItemById(body.workItemId);
        if (!workItem) {
          set.status = 404;
          return notFoundResponse("Work item");
        }

        const active = await getActiveJobForWorkItem(body.workItemId);
        if (active) {
          set.status = 409;
          return errorResponse("An active job already exists for this work item");
        }

        const organizationId = await resolveOrgIdFromWorkItem(body.workItemId);
        if (!organizationId) {
          set.status = 400;
          return errorResponse("Unable to resolve organization for work item");
        }

        const resolvedJobType = body.jobType ?? "validation";
        let resourceEstimate = body.config?.resourceEstimate as
          | NonNullable<AgentJobConfig["resourceEstimate"]>
          | undefined;

        if (!resourceEstimate && resolvedJobType === "implementation") {
          try {
            resourceEstimate = await buildRequiredImplementationResourceEstimate(
              organizationId,
              body.workItemId,
            );
          } catch (error) {
            logger.error(
              { error, workItemId: body.workItemId, organizationId },
              "workers/jobs: failed to calculate required implementation resource forecast",
            );
            set.status = 500;
            return errorResponse(
              "Unable to calculate resource forecast for implementation job",
              500,
            );
          }
        }
        resourceEstimate ??= buildDefaultJobResourceEstimate({
          jobType: resolvedJobType,
          skillName: body.config?.skillName ?? "validate",
          promptTemplate: body.config?.skillName ?? "validate",
        });

        const job = await createJob({
          projectId: workItem.projectId ?? null,
          boardId: workItem.boardId ?? null,
          workItemId: workItem.id,
          organizationId,
          jobType: resolvedJobType,
          provider: body.provider,
          priority: body.priority ?? "medium",
          config: {
            repoPath: body.config?.repoPath ?? ".",
            baseBranch: body.config?.baseBranch ?? "main",
            ...(body.config?.workspace ? { workspace: body.config.workspace } : {}),
            projectId: body.config?.projectId ?? workItem.projectId ?? undefined,
            ...(body.config?.scheduledConfigId
              ? { scheduledConfigId: body.config.scheduledConfigId }
              : {}),
            ...(body.config?.scheduledConfigName
              ? { scheduledConfigName: body.config.scheduledConfigName }
              : {}),
            skillName: body.config?.skillName ?? "validate",
            ...(body.config?.skillId ? { skillId: body.config.skillId } : {}),
            source: body.config?.source ?? "worker",
            ...(body.reasoningLevel ?? body.config?.reasoningLevel
              ? { reasoningLevel: body.reasoningLevel ?? body.config?.reasoningLevel }
              : {}),
            ...(body.config?.repositoryId
              ? { repositoryId: body.config.repositoryId }
              : {}),
            ...(body.config?.mcpServers
              ? { mcpServers: body.config.mcpServers }
              : {}),
            ...(body.config?.needsBrowser ? { needsBrowser: true } : {}),
            ...(resourceEstimate ? { resourceEstimate } : {}),
          },
          codingAgent: (body.codingAgent as CodingAgent | undefined) ?? resolvedRuntime.codingAgent,
          aiProvider: (body.aiProvider as AiProvider | undefined) ?? resolvedRuntime.aiProvider,
          model: body.model ?? resolvedRuntime.model,
          skillName: body.config?.skillName ?? "validate",
          // New model fields
          promptTemplate: body.config?.skillName ?? "validate",
          triggerType: "event",
          interactive: false,
        });

        // Flip isAiProcessing on the linked work item as soon as the job is
        // enqueued so cards animate immediately, without waiting for the
        // runner-side skill to call move_work_item.
        if (job.workItemId) {
          await setWorkItemAiProcessing(organizationId, job.workItemId, true);
          wsConnectionManager.broadcastToOrganization(organizationId, {
            type: "work-item:updated",
            payload: {
              workItemId: job.workItemId,
              boardId: job.boardId ?? undefined,
              changes: { isAiProcessing: true },
            },
          });
        }

        await broadcastStatusChanged(job, {
          jobId: job.id,
          status: job.status,
          workItemId: job.workItemId ?? null,
          planningSessionId: job.planningSessionId ?? null,
        });

        set.status = 201;
        return successResponse(job);
      } else if (body.organizationId) {
        // === STANDALONE JOB (no work item) ===
        // Resolve primary repository when projectId is provided
        let repoUrl: string | undefined;
        let repositoryId: string | undefined;
        let standaloneProjectId = body.config?.projectId ?? undefined;

        if (standaloneProjectId) {
          try {
            const repos = await getRepositories(body.organizationId, standaloneProjectId);
            const primary = repos[0];
            if (primary) {
              repoUrl = primary.url;
              repositoryId = primary.id;
            }
          } catch {
            // Non-fatal: runner will resolve via API fallback
          }
        }

        // Fallback: if no projectId, resolve the org's primary repository
        if (!repoUrl) {
          try {
            const orgRepo = await getOrgPrimaryRepository(body.organizationId);
            if (orgRepo) {
              repoUrl = orgRepo.url;
              repositoryId = orgRepo.id;
              standaloneProjectId = standaloneProjectId ?? orgRepo.projectId;
            }
          } catch {
            // Non-fatal: runner will resolve via API fallback
          }
        }

        // Prompt-only scheduled agents omit config.skillName so the runner
        // uses the raw prompt instead of looking for a SKILL.md file.
        const resolvedSkillName = body.config?.skillName ?? undefined;
        const resolvedSource = body.config?.source ?? "scheduled-config";
        const resourceEstimate =
          (body.config?.resourceEstimate as NonNullable<AgentJobConfig["resourceEstimate"]> | undefined) ??
          buildDefaultJobResourceEstimate({
            jobType: body.jobType ?? "scheduled",
            skillName: resolvedSkillName,
            promptTemplate: resolvedSkillName ?? null,
          });
        const job = await createJob({
          projectId: standaloneProjectId ?? null,
          organizationId: body.organizationId,
          jobType: body.jobType ?? "scheduled",
          provider: body.provider,
          priority: body.priority ?? "medium",
          config: {
            repoPath: body.config?.repoPath ?? ".",
            baseBranch: body.config?.baseBranch ?? "main",
            ...(body.config?.workspace ? { workspace: body.config.workspace } : {}),
            projectId: standaloneProjectId,
            ...(body.config?.scheduledConfigId
              ? { scheduledConfigId: body.config.scheduledConfigId }
              : {}),
            ...(body.config?.scheduledConfigName
              ? { scheduledConfigName: body.config.scheduledConfigName }
              : {}),
            ...(resolvedSkillName && { skillName: resolvedSkillName }),
            source: resolvedSource,
            prompt: body.prompt ?? body.config?.prompt ?? undefined,
            resourceEstimate,
            ...(body.reasoningLevel ?? body.config?.reasoningLevel
              ? { reasoningLevel: body.reasoningLevel ?? body.config?.reasoningLevel }
              : {}),
            ...(repoUrl && { repoUrl }),
            ...(repositoryId && { repositoryId }),
            ...(body.config?.mcpServers
              ? { mcpServers: body.config.mcpServers }
              : {}),
          },
          codingAgent: (body.codingAgent as CodingAgent | undefined) ?? resolvedRuntime.codingAgent,
          aiProvider: (body.aiProvider as AiProvider | undefined) ?? resolvedRuntime.aiProvider,
          model: body.model ?? resolvedRuntime.model,
          ...(resolvedSkillName && { skillName: resolvedSkillName }),
          // New model fields
          prompt: body.prompt ?? body.config?.prompt ?? null,
          promptTemplate: resolvedSkillName ?? null,
          triggerType: resolvedSource === "scheduled-config" ? "scheduled" : "event",
          interactive: false,
        });

        set.status = 201;
        return successResponse(job);
      } else {
        set.status = 400;
        return errorResponse("Either workItemId or organizationId is required");
      }
    },
    {
      body: t.Object({
        workItemId: t.Optional(t.String()),
        organizationId: t.Optional(t.String()),
        prompt: t.Optional(t.String()),
        jobType: t.Optional(
          t.Union([
            t.Literal("implementation"),
            t.Literal("planning"),
            t.Literal("review"),
            t.Literal("validation"),
            t.Literal("scheduled"),
            t.Literal("bug-fix"),
            t.Literal("integration"),
          ]),
        ),
        provider: t.Union([
          t.Literal("claude-code"),
          t.Literal("codex"),
          t.Literal("zipu"),
          t.Literal("grok"),
        ]),
        priority: t.Optional(
          t.Union([
            t.Literal("low"),
            t.Literal("medium"),
            t.Literal("high"),
            t.Literal("urgent"),
          ]),
        ),
        codingAgent: t.Optional(t.String()),
        aiProvider: t.Optional(t.String()),
        model: t.Optional(t.String()),
        reasoningLevel: t.Optional(t.String()),
        config: t.Optional(
          t.Object({
            repoPath: t.Optional(t.String()),
            baseBranch: t.Optional(t.String()),
            workspace: t.Optional(agentWorkspaceSchema),
            projectId: t.Optional(t.String()),
            scheduledConfigId: t.Optional(t.String()),
            scheduledConfigName: t.Optional(t.String()),
            skillName: t.Optional(t.String()),
            skillId: t.Optional(t.String()),
            source: t.Optional(t.String()),
            dodReport: t.Optional(t.String()),
            dodReviewedAt: t.Optional(t.String()),
            repositoryId: t.Optional(t.String()),
            prompt: t.Optional(t.String()),
            reasoningLevel: t.Optional(t.String()),
            batchId: t.Optional(t.String()),
            integrationPhase: t.Optional(t.Union([
              t.Literal("process"),
              t.Literal("merge"),
            ])),
            workspaceIntent: t.Optional(t.Union([
              t.Literal("read-only"),
              t.Literal("write"),
            ])),
            postSessionPushPolicy: t.Optional(t.Union([
              t.Literal("never"),
              t.Literal("on-success"),
            ])),
            mcpServers: t.Optional(workerMcpServersSchema),
            needsBrowser: t.Optional(t.Boolean()),
            resourceEstimate: t.Optional(resourceEstimateSchema),
          }),
        ),
      }),
    }
  )

  // GET /workers/jobs/running
  // Security: filtered by the API key's organization
  .get("/jobs/running", async ({ workerApiKey }) => {
    const rows = await db
      .select({
        id: agentJobs.id,
        worktreePath: agentJobs.worktreePath,
        branchName: agentJobs.branchName,
        workerId: agentJobs.workerId,
      })
      .from(agentJobs)
      .where(and(
        inArray(agentJobs.status, ["running", "finalizing"]),
        eq(agentJobs.organizationId, workerApiKey!.organizationId),
      ));

    return successResponse(rows);
  })

  // GET /workers/jobs/mine — returns running jobs assigned to a specific worker
  .get(
    "/jobs/mine",
    async ({ query, set }) => {
      const jobs = await getRunningJobsForWorker(query.workerId);
      set.status = 200;
      return successResponse(jobs);
    },
    {
      query: t.Object({
        workerId: t.String(),
      }),
    }
  )

  // GET /workers/jobs/:jobId/status
  .get(
    "/jobs/:jobId/status",
    async ({ params, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const resultPayload =
        typeof existing.job.result === "object" && existing.job.result !== null
          ? (existing.job.result as unknown as Record<string, unknown>)
          : null;

      return successResponse({
        status: existing.job.status,
        shutdownRequested: resultPayload?.shutdownRequested === true,
      });
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
    }
  )

  // GET /workers/jobs/:jobId/config
  .get(
    "/jobs/:jobId/config",
    async ({ params, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      return successResponse({
        jobType: existing.job.jobType,
        config: existing.job.config,
        status: existing.job.status,
      });
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
    }
  )

  // GET /workers/jobs/:jobId/workspace-files/:fileId
  // Runner-only endpoint used by uploaded_files workspaces. The file must be
  // explicitly listed in the job config so a worker token cannot enumerate or
  // download arbitrary attachments from the organization.
  .get(
    "/jobs/:jobId/workspace-files/:fileId",
    async ({ params, set, workerApiKey }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const allowedFileIds = getUploadedWorkspaceFileIds(existing.job.config);
      if (!allowedFileIds.includes(params.fileId)) {
        set.status = 403;
        return errorResponse("Workspace file is not declared by this job");
      }

      const organizationId = existing.job.organizationId ?? workerApiKey!.organizationId;
      if (!organizationId) {
        set.status = 400;
        return errorResponse("Job has no organizationId");
      }

      const attachment = await getAttachment(organizationId, params.fileId);
      if (!attachment) {
        set.status = 404;
        return notFoundResponse("Workspace file");
      }

      if (
        typeof attachment.fileSize === "number" &&
        attachment.fileSize > MAX_WORKSPACE_FILE_DOWNLOAD_BYTES
      ) {
        set.status = 413;
        return errorResponse("Workspace file exceeds maximum supported size");
      }

      const metadata = isPlainRecord(attachment.metadata) ? attachment.metadata : {};
      const storage = typeof metadata.storage === "string" ? metadata.storage : null;
      const key = typeof metadata.key === "string"
        ? metadata.key
        : extractKeyFromUrl(attachment.fileUrl);

      if (!key) {
        set.status = 500;
        return errorResponse("Workspace file storage key is missing", 500);
      }

      const expectedKeyPrefix = `work-items/${attachment.workItemId}/`;
      if (!key.startsWith(expectedKeyPrefix)) {
        set.status = 403;
        return errorResponse("Workspace file storage key does not belong to its work item");
      }

      let bytes: Uint8Array;
      try {
        if (storage === "local" || attachment.fileUrl.startsWith("/api/work-items/")) {
          const file = Bun.file(resolveLocalAttachmentPath(key));
          if (!(await file.exists())) {
            set.status = 404;
            return notFoundResponse("Workspace file content");
          }
          bytes = new Uint8Array(await file.arrayBuffer());
        } else {
          if (!isS3Configured()) {
            set.status = 503;
            return errorResponse("S3 storage is not configured", 503);
          }
          bytes = await downloadBufferFromS3(key);
        }
      } catch (error) {
        logger.error({ error, jobId: params.jobId, fileId: params.fileId }, "Failed to download workspace file");
        set.status = 500;
        return errorResponse("Failed to download workspace file", 500);
      }

      if (bytes.byteLength > MAX_WORKSPACE_FILE_DOWNLOAD_BYTES) {
        set.status = 413;
        return errorResponse("Workspace file exceeds maximum supported size");
      }

      return successResponse({
        id: attachment.id,
        fileName: attachment.fileName,
        fileSize: bytes.byteLength,
        mimeType: attachment.mimeType,
        contentBase64: Buffer.from(bytes).toString("base64"),
        ...(pickAttachmentWorkspacePath(metadata)
          ? { workspacePath: pickAttachmentWorkspacePath(metadata) }
          : {}),
      });
    },
    {
      params: t.Object({
        jobId: t.String(),
        fileId: t.String(),
      }),
    }
  )

  // POST /workers/jobs/:jobId/status
  .post(
    "/jobs/:jobId/status",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const now = new Date();
      const status = body.status;
      const releasesWorkerResources = status === "queued" || status === "paused";

      const availableAt =
        body.availableAt && body.availableAt.trim()
          ? new Date(body.availableAt)
          : null;
      if (availableAt && Number.isNaN(availableAt.getTime())) {
        set.status = 400;
        return errorResponse("availableAt must be a valid ISO date string");
      }

      const usageMetrics = deriveJobUsageMetrics({
        model: body.model ?? existing.job.model ?? null,
        cost: body.cost,
        tokensUsed: body.tokensUsed,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
      });

      const updatedConfig =
        status === "paused"
          ? {
              ...existing.job.config,
              previousJobId: existing.job.config?.previousJobId ?? existing.job.id,
            } satisfies AgentJobConfig
          : undefined;

      const updated = await updateJobStatus(params.jobId, status, {
        workerId:
          releasesWorkerResources
            ? null
            : body.workerId ?? existing.job.workerId ?? null,
        result: normalizeJobResultPayload(body.result),
        errorMessage: body.errorMessage ?? null,
        errorType: body.errorType ?? null,
        retryCount: body.retryCount ?? null,
        availableAt,
        branchName: releasesWorkerResources ? null : body.branchName ?? null,
        worktreePath: releasesWorkerResources ? null : body.worktreePath ?? null,
        prUrl: body.prUrl ?? null,
        prNumber: body.prNumber ?? null,
        commitSha: body.commitSha ?? null,
        cost: usageMetrics.cost,
        tokensUsed: usageMetrics.tokensUsed,
        sessionId: body.sessionId ?? undefined,
        config: updatedConfig,
        model: body.model ?? undefined,
        startedAt:
          status === "running"
            ? now
            : releasesWorkerResources
              ? null
              : undefined,
        completedAt:
          status === "completed" || status === "incomplete" || status === "cancelled"
            ? now
            : releasesWorkerResources
              ? null
              : undefined,
        failedAt:
          status === "failed"
            ? now
            : releasesWorkerResources
              ? null
              : undefined,
        durationMs: (() => {
          const cumulative = existing.job.cumulativeDurationMs ?? 0;
          if (body.durationMs != null) return cumulative + body.durationMs;
          if (status === "completed" || status === "incomplete" || status === "failed") {
            const startedAt = existing.job.startedAt;
            if (startedAt) {
              const segmentMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
              return cumulative + segmentMs;
            }
            return cumulative > 0 ? cumulative : null;
          }
          return body.durationMs ?? null;
        })(),
        cumulativeDurationMs:
          releasesWorkerResources
            ? (() => {
                const cumulative = existing.job.cumulativeDurationMs ?? 0;
                const startedAt = existing.job.startedAt;
                if (startedAt instanceof Date || typeof startedAt === "string") {
                  const segmentMs = Math.max(0, now.getTime() - new Date(startedAt).getTime());
                  return cumulative + segmentMs;
                }
                return cumulative;
              })()
            : undefined,
      });

      if (!updated) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      void broadcastStatusChanged(updated, {
        jobId: updated.id,
        status: updated.status,
        workItemId: updated.workItemId ?? null,
        planningSessionId: updated.planningSessionId ?? null,
      });

      // Planning jobs do not have associated work items -- skip work item side-effects
      const isWorkItemJob = existing.job.jobType !== "planning";

      // Check if this completion represents a multi-turn response boundary (session stays active).
      const resultPayload =
        typeof updated.result === "object" && updated.result !== null
          ? (updated.result as unknown as Record<string, unknown>)
          : null;
      const isResponseComplete = resultPayload?.responseComplete === true;

      // Best-effort: complete the planning session when a planning job reaches terminal status
      // Skip session completion when the result explicitly keeps the session active for
      // multi-turn conversations.
      if (
        !isWorkItemJob &&
        (status === "failed" || status === "incomplete" || status === "cancelled" || (status === "completed" && !isResponseComplete)) &&
        updated.planningSessionId
      ) {
        try {
          const summaryByStatus: Record<string, string> = {
            completed: "Planning session completed by agent",
            incomplete: "Planning session ended with incomplete agent work",
            failed: "Planning session ended due to agent job failure",
            cancelled: "Planning session cancelled",
          };
          const completed = await completePlanningSession(updated.planningSessionId, {
            summary: summaryByStatus[status] ?? "Planning session ended",
          });

          if (completed) {
            const orgId = await resolveOrgIdFromPlanningSession(updated.planningSessionId);
            if (orgId) {
              wsConnectionManager.broadcastToOrganization(orgId, {
                type: "planning-session:completed",
                payload: {
                  sessionId: updated.planningSessionId,
                  result: completed.result ?? {},
                },
              });
            }
          }
        } catch {
          // Ignore: job status update should not fail due to session completion issues
        }
      }

      // Best-effort: clear AI processing flag and propagate error info when the job terminates
      if (
        isWorkItemJob &&
        isTerminalAgentJobStatus(status) &&
        updated.workItemId
      ) {
        try {
          const cleanupOrgId = await resolveOrgIdFromWorkItem(updated.workItemId);
          if (cleanupOrgId) {
            await setWorkItemAiProcessing(cleanupOrgId, updated.workItemId, false);

            if (status === "failed") {
              // Set the error in metadata so the frontend can display it
              await setWorkItemAiError(updated.workItemId, {
                message: body.errorMessage || "Job failed",
                type: body.errorType || undefined,
                jobId: updated.id,
              });
              wsConnectionManager.broadcastToOrganization(cleanupOrgId, {
                type: "work-item:updated",
                payload: {
                  workItemId: updated.workItemId,
                  changes: {
                    isAiProcessing: false,
                    metadata: {
                      lastAiError: {
                        message: body.errorMessage || "Job failed",
                        ...(body.errorType ? { type: body.errorType } : {}),
                        jobId: updated.id,
                        at: new Date().toISOString(),
                      },
                    },
                  },
                },
              });
            } else {
              // Completed, incomplete or cancelled: clear any previous error
              await setWorkItemAiError(updated.workItemId, null);
              wsConnectionManager.broadcastToOrganization(cleanupOrgId, {
                type: "work-item:updated",
                payload: {
                  workItemId: updated.workItemId,
                  changes: {
                    isAiProcessing: false,
                    metadata: { lastAiError: null },
                  },
                },
              });
            }
          }
        } catch {
          // Ignore: status update should not fail due to flag cleanup issues
        }
      }

      // Best-effort: clear previous AI error when a new job starts running
      if (isWorkItemJob && status === "running" && updated.workItemId) {
        try {
          await setWorkItemAiError(updated.workItemId, null);
          const runningOrgId = await resolveOrgIdFromWorkItem(updated.workItemId);
          if (runningOrgId) {
            wsConnectionManager.broadcastToOrganization(runningOrgId, {
              type: "work-item:updated",
              payload: {
                workItemId: updated.workItemId,
                changes: { metadata: { lastAiError: null } },
              },
            });
          }
        } catch {
          // Ignore: error clearing should not fail the status update
        }
      }

      // Best-effort: on permanent failure, move the linked work item to "Needs Attention" if that column exists.
      if (isWorkItemJob && status === "failed" && existing.workItem?.id && existing.workItem.boardId) {
        try {
          const needsAttention = await findColumnByNameInBoard(existing.workItem.boardId, "Needs Attention");
          if (needsAttention?.id) {
            await moveWorkItem(existing.workItem.id, needsAttention.id, 0, {
              triggeredBy: "worker",
              provenance: { source: "worker", workerId: existing.job.workerId ?? undefined },
            });
          }
        } catch {
          // Ignore: job status update should not fail due to column lookup/move issues.
        }
      }

      // Best-effort: send bell notification when a work-item job fails permanently.
      // Uses upsertNotificationBySource with sourceEntityType "agent_job" to prevent
      // duplicate notifications if the same job id is reported as failed multiple times.
      if (isWorkItemJob && status === "failed" && existing.workItem?.id && existing.job.createdByUserId) {
        try {
          const notifOrgId = existing.job.organizationId ?? await resolveOrgIdFromWorkItem(existing.workItem.id);
          if (notifOrgId) {
            const taskLabel = existing.workItem.taskId
              ? `${existing.workItem.taskId}: ${existing.workItem.title}`
              : existing.workItem.title;

            void upsertNotificationBySource({
              recipientUserId: existing.job.createdByUserId,
              organizationId: notifOrgId,
              type: "status_changed",
              title: `Agent job failed: ${taskLabel}`,
              body: body.errorMessage || "The agent encountered an error while processing this task.",
              link: `/work-items/${existing.workItem.id}`,
              sourceEntityType: "agent_job",
              sourceEntityId: existing.job.id,
              metadata: {
                kind: "task_implementation_failed",
                jobId: existing.job.id,
                workItemId: existing.workItem.id,
                taskId: existing.workItem.taskId ?? null,
                errorType: body.errorType ?? null,
              },
            }).catch((err) => {
              logger.debug({ err, jobId: existing.job.id }, "Failed to send job failure notification");
            });
          }
        } catch {
          // Ignore: notification should not fail the status update
        }
      }

      // Best-effort: create usage record for every terminal work-item job.
      // Billing/usage must reflect consumed runtime tokens even when the work
      // finished incomplete or failed after the provider already charged us.
      if (isWorkItemJob && isTerminalAgentJobStatus(status) && USAGE_RECORD_AGENT_JOB_STATUSES.has(status) && updated.workItemId) {
        try {
          const usageOrgId = await resolveOrgIdFromWorkItem(updated.workItemId);
          if (usageOrgId) {
            const jobTypeToSessionType: Record<string, string> = {
              implementation: "implement",
              validation: "validate",
              planning: "planning",
              review: "review",
            };
            const sessionType = existing.job.jobType
              ? jobTypeToSessionType[existing.job.jobType] ?? "chat"
              : "chat";
            const startedAt = updated.startedAt ?? new Date();
            const endedAt = updated.completedAt ?? updated.failedAt ?? new Date();
            const durationSeconds = body.durationMs
              ? Math.round(body.durationMs / 1000)
              : Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
            const jobConfig = existing.job.config;

            await createUsageRecord({
              organizationId: usageOrgId,
              projectId: (jobConfig?.projectId as string | undefined) ?? existing.job.projectId ?? null,
              jobId: updated.id,
              userId: existing.job.createdByUserId ?? null,
              sessionType: sessionType as "implement" | "validate" | "planning" | "review" | "chat",
              startedAt,
              endedAt,
              durationSeconds,
              tokensUsed: usageMetrics.tokensUsed ?? null,
            });
          }
        } catch {
          // Ignore: usage tracking should not fail the status update
        }
      }

      // Best-effort: auto-link commits when job completes with a branch name
      if (
        isWorkItemJob &&
        status === "completed" &&
        body.branchName &&
        body.branchName !== "main"
      ) {
        const jobConfig = existing.job.config;
        const repositoryId = jobConfig?.repositoryId ?? null;

        if (repositoryId) {
          try {
            const commits = await getCommitsByBranchAndRepo(repositoryId, body.branchName);
            if (commits.length > 0) {
              await autoLinkCommitsToWorkItems(repositoryId, body.branchName, commits);
            }
          } catch {
            // Ignore: auto-linking should not fail the status update
          }
        }
      }

      if (isTerminalAgentJobStatus(status)) {
        try {
          const memoryOrgId =
            existing.job.organizationId ??
            (isWorkItemJob
              ? await resolveOrgIdFromWorkItem(updated.workItemId ?? null)
              : await resolveOrgIdFromPlanningSession(
                  updated.planningSessionId ?? null
                ));

          if (memoryOrgId) {
            const jobConfig =
              typeof existing.job.config === "object" && existing.job.config
                ? (existing.job.config as unknown as Record<string, unknown>)
                : null;
            await persistJobMemoryFromTerminalState({
              organizationId: memoryOrgId,
              projectId:
                (jobConfig?.projectId as string | undefined) ??
                existing.job.projectId ??
                null,
              agentJobId: updated.id,
              workItemId: updated.workItemId ?? null,
              status,
              result:
                typeof updated.result === "object" && updated.result !== null
                  ? (updated.result as unknown as Record<string, unknown>)
                  : null,
              errorMessage: body.errorMessage ?? null,
            });
          }
        } catch (error) {
          logger.debug(
            { error, jobId: updated.id },
            "Failed to persist post-job memory"
          );
        }
      }

      return successResponse(updated);
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
      body: t.Object({
        status: t.Union([
          t.Literal("queued"),
          t.Literal("running"),
          t.Literal("finalizing"),
          t.Literal("completed"),
          t.Literal("incomplete"),
          t.Literal("failed"),
          t.Literal("cancelled"),
          t.Literal("waiting_for_input"),
          t.Literal("paused"),
        ]),
        workerId: t.Optional(t.String()),
        result: t.Optional(t.Union([t.Record(t.String(), t.Any()), t.String()])),
        errorMessage: t.Optional(t.String()),
        errorType: t.Optional(t.String()),
        retryCount: t.Optional(t.Number()),
        availableAt: t.Optional(t.String()),
        branchName: t.Optional(t.String()),
        worktreePath: t.Optional(t.String()),
        durationMs: t.Optional(t.Number()),
        prUrl: t.Optional(t.String()),
        prNumber: t.Optional(t.Number()),
        commitSha: t.Optional(t.String()),
        cost: t.Optional(t.Number()),
        tokensUsed: t.Optional(t.Number()),
        inputTokens: t.Optional(t.Number()),
        outputTokens: t.Optional(t.Number()),
        sessionId: t.Optional(t.String()),
        model: t.Optional(t.String()),
      }),
    }
  )

  // POST /workers/jobs/:jobId/logs
  .post(
    "/jobs/:jobId/logs",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      if (body.logs.length > MAX_LOG_BATCH_SIZE) {
        set.status = 400;
        return errorResponse(`logs batch exceeds max size (${MAX_LOG_BATCH_SIZE})`);
      }

      const organizationId = existing.job.organizationId;
      if (!organizationId) {
        set.status = 400;
        return errorResponse("Job has no organizationId");
      }

      const preparedLogs = [];
      for (const entry of body.logs) {
        const timestamp = new Date(entry.timestamp);
        if (Number.isNaN(timestamp.getTime())) {
          set.status = 400;
          return errorResponse("Log timestamp must be a valid ISO date string");
        }

        preparedLogs.push({
          jobId: params.jobId,
          orgId: organizationId,
          workItemId: existing.job.workItemId ?? null,
          seq: entry.seq,
          level: entry.level ?? "info",
          phase: entry.phase,
          eventType: entry.eventType,
          message: sanitizeLogMessage(entry.message),
          payload: sanitizeLogPayload(entry.payload),
          contentType: entry.contentType,
          timestamp,
        });
      }

      const inserted = await createAgentJobLogBatch(preparedLogs);

      // Broadcast inserted chunks via WebSocket (omit payload field to reduce traffic)
      if (inserted.length > 0) {
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "agent-job:log-batch",
          payload: {
            jobId: params.jobId,
            workItemId: existing.job.workItemId ?? null,
            chunks: inserted.map((chunk) => ({
              seq: chunk.seq,
              level: chunk.level,
              phase: chunk.phase,
              eventType: chunk.eventType,
              message: chunk.message,
              contentType: chunk.contentType,
              payload: chunk.payload,
              timestamp:
                chunk.timestamp instanceof Date
                  ? chunk.timestamp.toISOString()
                  : String(chunk.timestamp),
            })),
          },
        });
      }

      set.status = 201;
      return successResponse({
        jobId: params.jobId,
        received: body.logs.length,
        inserted: inserted.length,
        duplicates: Math.max(0, body.logs.length - inserted.length),
      });
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
      body: t.Object({
        logs: t.Array(
          t.Object({
            seq: t.Integer({ minimum: 0 }),
            level: t.Optional(
              t.Union([
                t.Literal("debug"),
                t.Literal("info"),
                t.Literal("warn"),
                t.Literal("error"),
              ])
            ),
            phase: t.String(),
            eventType: t.String(),
            message: t.String(),
            payload: t.Optional(t.Record(t.String(), t.Any())),
            timestamp: t.String(),
            contentType: t.Optional(t.String()),
          })
        ),
      }),
    }
  )

  // GET /workers/jobs/:jobId/transcript — raw transcript for session recovery
  .get(
    "/jobs/:jobId/transcript",
    async ({ params, query, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const limitRaw = query.limit ? Number.parseInt(query.limit, 10) : 500;
      if (!Number.isFinite(limitRaw) || limitRaw < 1) {
        set.status = 400;
        return errorResponse("limit must be a positive integer");
      }

      const result = await getTranscriptByJobId(params.jobId, {
        limit: Math.min(limitRaw, 1000),
        tail: query.tail === "true",
      });

      const transcript = result.logs.map((log) => log.message).join("");

      return successResponse({ transcript });
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        tail: t.Optional(t.String()),
      }),
    }
  )

  // POST /workers/jobs/:jobId/stream - Worker sends output stream chunks for planning jobs
  .post(
    "/jobs/:jobId/stream",
    async ({ params, body, set }) => {
      // 1. Validate job exists and get planningSessionId
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const planningSessionId = existing.job.planningSessionId;
      if (!planningSessionId) {
        set.status = 400;
        return errorResponse("Job is not a planning job");
      }

      // 2. Resolve organization for WS broadcast
      const orgId = await resolveOrgId(null, planningSessionId);
      if (!orgId) {
        set.status = 400;
        return errorResponse("Cannot resolve organization for planning session");
      }

      // 3. Relay plain output. Business state transitions must come from
      // canonical session events or explicit job status updates, never from
      // parsing textual transcript content.
      const lines = body.content.split("\n");
      const stepIndex = body.stepIndex ?? 0;
      const interactionIds: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        if (body.contentType === "tool_use") {
          const toolUse = parsePlanningToolUseEnvelope(line);
          if (toolUse) {
            broadcastPlanningToolUse({
              orgId,
              planningSessionId,
              toolUse,
            });
            continue;
          }
        }

        const wsType = body.contentType === "thinking" ? "planning:thinking" : "planning:text";
        wsConnectionManager.broadcastToOrganization(orgId, {
          type: wsType,
          payload: { sessionId: planningSessionId, content: `${line}\n` },
        });
      }

      return successResponse({ processed: lines.length, stepIndex, interactionIds });
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
      body: t.Object({
        content: t.String(),
        stepIndex: t.Optional(t.Number()),
        persistContent: t.Optional(t.Boolean()),
        contentType: t.Optional(t.String()),
      }),
    }
  )
  // Interaction flow:
  // 1. Runner creates interaction via POST (question + options)
  // 2. Discord webhook handler (discord-interactions.routes.ts) receives user answer via button/select
  // 3. respondToInteraction() stores the answer
  // 4. Runner polls via GET until status is "answered"

  // POST /workers/jobs/:jobId/interactions - Worker asks a question (creates interaction)
  .post(
    "/jobs/:jobId/interactions",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      // Transition job to waiting_for_input
      const updated = await updateJobStatus(params.jobId, "waiting_for_input");
      if (updated) {
        void broadcastStatusChanged(updated, {
          jobId: updated.id,
          status: updated.status,
          workItemId: updated.workItemId ?? null,
          planningSessionId: updated.planningSessionId ?? null,
        });
      }

      const expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        set.status = 400;
        return errorResponse("expiresAt must be a valid ISO date string");
      }

      const interaction = await createInteraction({
        agentJobId: params.jobId,
        workItemId: existing.job.workItemId ?? undefined,
        questionType: body.questionType,
        questionText: body.questionText,
        questionContext: (body.questionContext ?? null) as Record<string, unknown> | null,
        options: body.options ?? null,
        expiresAt,
        timeoutAction: body.timeoutAction ?? "fail",
        defaultAnswer: body.defaultAnswer ?? null,
      });

      // Broadcast to connected clients
      const orgId = await resolveOrgId(existing.job.workItemId ?? null, existing.job.planningSessionId ?? null);
      if (orgId) {
        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "worker-interaction:created",
          payload: {
            questionId: interaction.id,
            jobId: params.jobId,
            workItemId: existing.job.workItemId ?? "",
            planningSessionId: existing.job.planningSessionId ?? null,
            workItemTitle: existing.workItem?.title ?? "",
            provider: existing.job.provider,
            questionText: interaction.questionText,
            questionType: interaction.questionType,
            options: interaction.options as string[] | null,
            context: interaction.questionContext as Record<string, unknown> | null,
            expiresAt: interaction.expiresAt instanceof Date ? interaction.expiresAt.toISOString() : String(interaction.expiresAt),
          },
        });
      }

      set.status = 201;
      return successResponse(toWorkerInteractionResponse(interaction));
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
      body: t.Object({
        questionType: t.Union([
          t.Literal("clarification"),
          t.Literal("approval"),
          t.Literal("choice"),
          t.Literal("free_text"),
        ]),
        questionText: t.String(),
        questionContext: t.Optional(t.Record(t.String(), t.Any())),
        options: t.Optional(t.Array(t.String())),
        expiresAt: t.String(),
        timeoutAction: t.Optional(t.String()),
        defaultAnswer: t.Optional(t.String()),
      }),
    }
  )

  // GET /workers/jobs/:jobId/interactions/:interactionId - Worker polls for answer
  .get(
    "/jobs/:jobId/interactions/:interactionId",
    async ({ params, set }) => {
      const interaction = await getInteractionById(params.interactionId);
      if (!interaction || interaction.agentJobId !== params.jobId) {
        set.status = 404;
        return notFoundResponse("Interaction");
      }

      return successResponse(toWorkerInteractionResponse(interaction));
    },
    {
      params: t.Object({
        jobId: t.String(),
        interactionId: t.String(),
      }),
    }
  )

  // GET /workers/quota-check - Check quota availability for a provider
  .get(
    "/quota-check",
    async ({ query }) => {
      try {
        const organizationId = query.organizationId?.trim();
        if (!organizationId) {
          // Worker-side quota guard is fail-open when org cannot be resolved.
          return successResponse({ allowed: true });
        }

        const availability = await checkQuotaAvailable(
          organizationId,
          query.provider as ProviderQuotaDb["provider"]
        );
        return successResponse(availability);
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to check quota"
        );
      }
    },
    {
      query: t.Object({
        provider: t.String(),
        organizationId: t.Optional(t.String()),
      }),
    }
  )

  // GET /workers/github/installation-token?repositoryId=<uuid>
  // Returns a short-lived GitHub App installation token for cloning a private repo.
  // The worker uses this to inject credentials into the clone URL.
  .get(
    "/github/installation-token",
    async ({ query, set }) => {
      const githubCreds = await getGithubAppCredentials();
      if (!githubCreds) {
        set.status = 503;
        return errorResponse("GitHub App is not configured on this server");
      }

      const installation = await getInstallationByRepoId(query.repositoryId);
      if (!installation) {
        set.status = 404;
        return notFoundResponse("GitHub App installation for repository");
      }

      try {
        const token = await getInstallationAccessToken(Number(installation.installationId));
        // expiresAt: use the stored DB value if available, otherwise default to 55 min from now
        // (GitHub installation tokens expire after 1 hour; 55 min gives the worker time to refresh)
        const expiresAt = installation.tokenExpiresAt
          ? (installation.tokenExpiresAt instanceof Date
              ? installation.tokenExpiresAt.toISOString()
              : String(installation.tokenExpiresAt))
          : new Date(Date.now() + 55 * 60 * 1000).toISOString();
        return successResponse({ token, expiresAt });
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Failed to get installation token"
        );
      }
    },
    {
      query: t.Object({
        repositoryId: t.String(),
      }),
    }
  )

  // GET /workers/nightly-validation/configs — Returns projects with nightly validation enabled
  // Security: filtered by the API key's organization
  .get("/nightly-validation/configs", async ({ set, workerApiKey }) => {
    try {
      const allProjects = await getProjectsWithNightlyValidationEnabled();
      const filtered = allProjects.filter(
        (p) => p.organizationId === workerApiKey!.organizationId,
      );
      return successResponse(filtered);
    } catch (error) {
      set.status = 500;
      return errorResponse(
        error instanceof Error ? error.message : "Failed to get nightly validation configs",
        500,
      );
    }
  })

  // GET /workers/backlog-drain-candidates - Deterministically select ready Backlog items for a scheduled backlog-drain config
  // Security: organizationId is derived from the worker API key; config ownership is verified in the repository lookup.
  .get(
    "/backlog-drain-candidates",
    async ({ query, set, workerApiKey }) => {
      const result = await getBacklogDrainCandidatesForConfigId(
        query.configId,
        workerApiKey!.organizationId,
      );

      if (!result) {
        set.status = 404;
        return errorResponse("Scheduled agent config not found", 404);
      }

      return successResponse(result);
    },
    {
      query: t.Object({
        configId: t.String(),
      }),
    },
  )

  // GET /workers/dod-remediation-candidates - Select Backlog items that failed Definition of Done review
  // Security: organizationId is derived from the worker API key; config ownership is verified in the repository lookup.
  .get(
    "/dod-remediation-candidates",
    async ({ query, set, workerApiKey }) => {
      const result = await getDodRemediationCandidatesForConfigId(
        query.configId,
        workerApiKey!.organizationId,
      );

      if (!result) {
        set.status = 404;
        return errorResponse("Scheduled agent config not found", 404);
      }

      return successResponse(result);
    },
    {
      query: t.Object({
        configId: t.String(),
      }),
    },
  )

  // GET /workers/dod-review-candidates - Get review-column work items waiting for Definition of Done approval
  // Security: organizationId derived from API key, not from query params
  .get(
    "/dod-review-candidates",
    async ({ query, workerApiKey }) => {
      const maxActiveJobs = typeof query.maxActiveJobs === "number"
        ? Math.max(0, Math.floor(query.maxActiveJobs))
        : undefined;
      let effectiveLimit = query.limit;

      if (maxActiveJobs !== undefined) {
        const activeCount = await countActiveAgentJobsForLane({
          organizationId: workerApiKey!.organizationId,
          projectId: query.projectId,
          sources: ["dod-review"],
          skillNames: ["dod-review"],
          promptTemplates: ["dod-review"],
        });
        const availableSlots = Math.max(0, maxActiveJobs - activeCount);
        if (availableSlots <= 0) {
          return successResponse([]);
        }
        effectiveLimit = Math.min(query.limit ?? availableSlots, availableSlots);
      }

      const candidates = await getDefinitionOfDoneReviewCandidates(
        workerApiKey!.organizationId,
        query.projectId,
        effectiveLimit,
        { minAgeMinutes: query.minAgeMinutes },
      );
      return successResponse(candidates);
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
        limit: t.Optional(t.Number()),
        maxActiveJobs: t.Optional(t.Number()),
        minAgeMinutes: t.Optional(t.Number()),
      }),
    }
  )

  // POST /workers/release-integration/queue - Batch validating work items into release integration jobs
  // Security: organizationId derived from API key, not from query params
  .post(
    "/release-integration/queue",
    async ({ query, workerApiKey }) => {
      const organizationId = workerApiKey!.organizationId;
      const maxActiveItems = typeof query.maxActiveItems === "number"
        ? Math.max(0, Math.floor(query.maxActiveItems))
        : undefined;
      const minAgeMinutes = typeof query.minAgeMinutes === "number"
        ? Math.max(0, Math.floor(query.minAgeMinutes))
        : undefined;
      let effectiveLimit = query.limit;

      const recoverableBatches = await getRecoverableReleaseBatchesWithoutActiveJob(
        organizationId,
        query.projectId,
        maxActiveItems ?? query.limit,
      );

      if (recoverableBatches.length > 0) {
        const batches: Array<{
          batchId: string;
          repositoryId: string;
          projectId: string;
          created: boolean;
          enqueuedItemCount: number;
        }> = [];

        for (const batch of recoverableBatches) {
          const integrationPhase = batch.status === "merging" ? "merge" : "process";
          const repositoryFullName = await getGithubRepoFullNameByRepoId(batch.repositoryId);
          await createJob({
            organizationId,
            projectId: batch.projectId,
            boardId: batch.boardId ?? undefined,
            provider: "claude-code",
            codingAgent: "claude-code",
            jobType: "integration",
            skillName: "runner-release-integration",
            promptTemplate: "runner-release-integration",
            triggerType: "scheduled",
            priority: "high",
            config: {
              repoPath: "",
              baseBranch: batch.baseBranch,
              repositoryId: batch.repositoryId,
              repositoryFullName: repositoryFullName ?? undefined,
              projectId: batch.projectId,
              batchId: batch.id,
              integrationPhase,
              skillName: "runner-release-integration",
              executionName: buildReleaseIntegrationExecutionName(repositoryFullName),
              selfManagesPr: true,
              source: "release-integration",
            },
          });

          batches.push({
            batchId: batch.id,
            repositoryId: batch.repositoryId,
            projectId: batch.projectId,
            created: false,
            enqueuedItemCount: batch.items.filter((item) =>
              item.status !== "merged" &&
              item.status !== "skipped" &&
              item.status !== "failed"
            ).length,
          });
        }

        return successResponse({
          batches,
          skipped: {
            noCandidates: 0,
            activeRunningBatches: 0,
            activeProjectLimit: 0,
            duplicateItems: 0,
            missingPullRequest: 0,
            unresolvedRepository: 0,
          },
        });
      }

      if (maxActiveItems !== undefined) {
        const activeCount = await countActiveBatchItemsByProject(
          organizationId,
          query.projectId,
        );
        const availableSlots = Math.max(0, maxActiveItems - activeCount);
        if (availableSlots <= 0) {
          return successResponse({
            batches: [],
            skipped: {
              noCandidates: 0,
              activeRunningBatches: 0,
              activeProjectLimit: 1,
              duplicateItems: 0,
              missingPullRequest: 0,
              unresolvedRepository: 0,
            },
          });
        } else {
          effectiveLimit = Math.min(query.limit ?? availableSlots, availableSlots);
        }
      }

      const candidateResult = await getValidatingReleaseCandidates(
        organizationId,
        query.projectId,
        effectiveLimit,
        { minAgeMinutes },
      );

      const groups = new Map<string, typeof candidateResult.candidates>();
      for (const candidate of candidateResult.candidates) {
        const key = [
          candidate.repositoryId,
          candidate.projectId,
          candidate.boardId,
          candidate.baseBranch,
        ].join(":");
        const existing = groups.get(key);
        if (existing) existing.push(candidate);
        else groups.set(key, [candidate]);
      }

      const batches: Array<{
        batchId: string;
        repositoryId: string;
        projectId: string;
        created: boolean;
        enqueuedItemCount: number;
      }> = [];
      const skipped = {
        noCandidates: candidateResult.candidates.length === 0 ? 1 : 0,
        activeRunningBatches: 0,
        activeProjectLimit: 0,
        duplicateItems: candidateResult.skipped.alreadyBatched,
        missingPullRequest: candidateResult.skipped.missingPullRequest,
        unresolvedRepository: candidateResult.skipped.unresolvedRepository,
      };

      for (const candidates of groups.values()) {
        const first = candidates[0];
        if (!first) continue;

        const openReleaseBatch = await getOpenReleaseBatchForRepository(
          organizationId,
          first.repositoryId,
        );
        const active = openReleaseBatch ??
          await getActiveBatchForRepository(organizationId, first.repositoryId);
        const activeWithItems = active ? await getBatchByIdWithItems(active.id) : null;
        if (active && (active.status === "running" || active.status === "merging")) {
          skipped.activeRunningBatches += candidates.length;
          continue;
        }

        const activeItems = activeWithItems?.items ?? [];
        // Failed items are NOT retried automatically. The release-integration
        // skill is required to resolve conflicts in a single pass; if the
        // agent escalated, a human owns the item now (DoD human_action
        // metadata is stamped by setItemFailure). We exclude failed items
        // from new-candidate dedup so the batch can keep accepting fresh
        // Validating work without re-queueing the failed one.
        const existingItemWorkIds = new Set(
          activeItems.map((item) => item.workItemId),
        );
        const newCandidates = candidates.filter(
          (candidate) => !existingItemWorkIds.has(candidate.id),
        );
        skipped.duplicateItems += candidates.length - newCandidates.length;
        if (newCandidates.length === 0) continue;

        const releaseNumber = activeWithItems
          ? activeWithItems.releaseNumber
          : await getNextReleaseNumber(organizationId, first.repositoryId);
        const batch = activeWithItems ?? await createIntegrationBatch({
          organizationId,
          projectId: first.projectId,
          repositoryId: first.repositoryId,
          boardId: first.boardId,
          integrationBranch: `release/main-v${releaseNumber}`,
          baseBranch: first.baseBranch,
          releaseNumber,
          triggeredByUserId: null,
        });

        if (activeWithItems?.status === "awaiting_release") {
          await updateBatchStatus(batch.id, "queued");
        }

        const nextOrder = activeWithItems?.items.length ?? 0;
        await addItemsToBatch(
          newCandidates.map((candidate, index) => ({
            batchId: batch.id,
            workItemId: candidate.id,
            prNumber: candidate.prNumber,
            prUrl: candidate.prUrl,
            branchName: candidate.branchName,
            processingOrder: nextOrder + index,
          })),
        );

        if (!activeWithItems || activeWithItems.status === "awaiting_release") {
          await createJob({
            organizationId,
            projectId: first.projectId,
            boardId: first.boardId,
            provider: "claude-code",
            codingAgent: "claude-code",
            jobType: "integration",
            skillName: "runner-release-integration",
            promptTemplate: "runner-release-integration",
            triggerType: "scheduled",
            priority: "high",
            config: {
              repoPath: "",
              baseBranch: first.baseBranch,
              repositoryId: first.repositoryId,
              repositoryFullName: first.repositoryFullName,
              projectId: first.projectId,
              batchId: batch.id,
              integrationPhase: "process",
              skillName: "runner-release-integration",
              executionName: buildReleaseIntegrationExecutionName(first.repositoryFullName),
              selfManagesPr: true,
              source: "release-integration",
            },
          });
        }

        batches.push({
          batchId: batch.id,
          repositoryId: first.repositoryId,
          projectId: first.projectId,
          created: !activeWithItems,
          enqueuedItemCount: newCandidates.length,
        });
      }

      return successResponse({ batches, skipped });
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
        limit: t.Optional(t.Number()),
        maxActiveItems: t.Optional(t.Number()),
        minAgeMinutes: t.Optional(t.Number()),
      }),
    }
  )

  // GET /workers/validation-candidates - Get work items ready for validation, grouped by root ancestor
  // Security: organizationId derived from API key, not from query params
  .get(
    "/validation-candidates",
    async ({ query, workerApiKey }) => {
      const candidates = await getValidationCandidates(
        workerApiKey!.organizationId,
        query.projectId,
        query.limit,
        { requireDodApproved: query.requireDodApproved },
      );
      return successResponse(candidates);
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
        limit: t.Optional(t.Number()),
        requireDodApproved: t.Optional(t.Boolean()),
      }),
    }
  )

  // GET /workers/fix-candidates - Get work items ready for nightly fix (in Needs Fix column, < 2 attempts)
  // Security: organizationId derived from API key, not from query params
  .get(
    "/fix-candidates",
    async ({ query, workerApiKey }) => {
      const candidates = await getFixCandidates(workerApiKey!.organizationId, query.projectId);
      return successResponse(candidates);
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
      }),
    }
  )

  // GET /workers/queue-depth — returns count of queued jobs (for scaler)
  .get(
    "/queue-depth",
    async ({ set }) => {
      const count = await getQueuedJobCount();
      set.status = 200;
      return successResponse({ depth: count });
    }
  )

  // GET /workers/queue-depth-by-agent — returns queued job counts grouped by codingAgent (for scaler)
  .get(
    "/queue-depth-by-agent",
    async ({ set }) => {
      const depths = await getQueuedJobCountByAgent();
      set.status = 200;
      return successResponse({ depths });
    }
  )

  // GET /workers/scaling-metric — returns the desired total capacity for the scaler:
  // queued jobs + jobs currently executing + configurable spare slots
  .get(
    "/scaling-metric",
    async ({ set }) => {
      const [queueDepth, activeJobs] = await Promise.all([
        getQueuedJobCount(),
        getExecutingJobCount(),
      ]);
      set.status = 200;
      return successResponse({
        targetCapacity: queueDepth + activeJobs + env.SCALING_MIN_AVAILABLE_SLOTS,
      });
    }
  )

  // GET /workers/registered — returns all registered workers (for scaler)
  .get(
    "/registered",
    async ({ set }) => {
      const workers = await getWorkers();
      set.status = 200;
      return successResponse(workers);
    }
  )

  // POST /workers/session-token — generate a scoped session token for agent containers
  //
  // Instead of injecting the global worker API key into agent containers,
  // the runner requests a short-lived JWT with limited permissions (MCP only).
  // The token is scoped to a specific project and organization.
  // Shared runners may have an API key from a different org, so we validate
  // project-org consistency instead of API key-org consistency.
  .post(
    "/session-token",
    async ({ body, set, workerApiKey }) => {
      // Validate that the project belongs to the requested organization
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, body.projectId),
            eq(projects.organizationId, body.organizationId)
          )
        )
        .limit(1);
      if (!project) {
        set.status = 403;
        return errorResponse("Project does not belong to the specified organization");
      }

      if (!env.ENCRYPTION_KEY) {
        set.status = 500;
        return errorResponse("Encryption key not configured", 500);
      }

      const {
        generateSessionToken,
        computeExpiresAt,
        resolveSessionActorUserId,
      } = await import("../../../shared/services/session-token");

      const permissions = body.permissions ?? ["mcp:read", "mcp:write"];

      // Validate that requested permissions are within what this API key is authorized to issue
      const allowedByKey: string[] = workerApiKey!.allowedIssuedPermissions ?? ["mcp:read", "mcp:write"];
      const unauthorized = permissions.filter((p) => !allowedByKey.includes(p));
      if (unauthorized.length > 0) {
        set.status = 403;
        return errorResponse(`API key not authorized to issue permissions: ${unauthorized.join(", ")}`);
      }

      const wantsInternal = permissions.includes("mcp:internal");

      let actorUserId: string | undefined;
      let jobDetail: Awaited<ReturnType<typeof getJobById>> | null = null;
      if (body.jobId) {
        jobDetail = await getJobById(body.jobId);
        if (!jobDetail) {
          set.status = 404;
          return errorResponse("Job not found", 404);
        }

        if (
          jobDetail.job.organizationId !== body.organizationId ||
          jobDetail.job.projectId !== body.projectId
        ) {
          set.status = 403;
          return errorResponse("Job does not belong to the specified project/organization");
        }

        actorUserId = resolveSessionActorUserId(jobDetail.job);
      }

      // Bypass-proof guard: even if the runner requests `mcp:internal` for a
      // job that somehow carries an internal skillName, refuse to emit the
      // token unless the job originated from a system actor. This stops a
      // user-authored job (createdByUserId set) from ever receiving a token
      // that unlocks the `/mcp/internal` mount, regardless of what the
      // runner asks for.
      if (wantsInternal) {
        if (!body.jobId || !jobDetail) {
          set.status = 403;
          return errorResponse(
            "mcp:internal requires a jobId referencing a system-initiated internal job"
          );
        }

        const { requiresInternalMcp } = await import("@almirant/shared");
        const { AUTOMATION_BOT_USER_ID } = await import(
          "../../../shared/services/session-token"
        );

        const templateOrSkill =
          jobDetail.job.promptTemplate ?? jobDetail.job.skillName ?? null;
        const skillIsInternal = requiresInternalMcp(templateOrSkill);
        const createdBy = jobDetail.job.createdByUserId;
        const createdBySystem = createdBy == null || createdBy === AUTOMATION_BOT_USER_ID;

        if (!skillIsInternal || !createdBySystem) {
          set.status = 403;
          return errorResponse(
            "mcp:internal is only issued for system-initiated jobs bound to an internal skill"
          );
        }
      }

      const token = generateSessionToken({
        projectId: body.projectId,
        organizationId: body.organizationId,
        ...(actorUserId ? { userId: actorUserId } : {}),
        ...(body.jobId ? { jobId: body.jobId } : {}),
        permissions,
        sessionType: "agent",
        ttlSeconds: body.ttlSeconds ?? 3600,
        signingSecret: env.ENCRYPTION_KEY,
      });

      const expiresAt = computeExpiresAt(body.ttlSeconds ?? 3600);

      return successResponse({
        token,
        expiresAt: expiresAt.toISOString(),
        projectId: body.projectId,
        organizationId: body.organizationId,
        ...(actorUserId ? { userId: actorUserId } : {}),
      });
    },
    {
      body: t.Object({
        projectId: t.String(),
        organizationId: t.String(),
        jobId: t.Optional(t.String()),
        permissions: t.Optional(
          t.Array(t.Union([
            t.Literal("mcp:read"),
            t.Literal("mcp:write"),
            t.Literal("mcp:internal"),
            t.Literal("mcp:debug"),
          ]))
        ),
        ttlSeconds: t.Optional(t.Number({ minimum: 60, maximum: 86400 })),
      }),
    }
  )

  // GET /workers/repo-config — Resolve repository URL and config for a project
  .get(
    "/repo-config",
    async ({ query, set }) => {
      try {
        // Resolve organizationId from the project
        const [project] = await db
          .select({ organizationId: projects.organizationId })
          .from(projects)
          .where(eq(projects.id, query.projectId))
          .limit(1);

        if (!project) {
          set.status = 404;
          return notFoundResponse("Project");
        }

        if (!project.organizationId) {
          set.status = 400;
          return errorResponse("Project has no organization");
        }

        const repos = await getRepositories(project.organizationId, query.projectId);
        if (!repos.length) {
          set.status = 404;
          return notFoundResponse("No repository configured for this project");
        }
        const primary = repos[0];
        if (!primary) {
          set.status = 404;
          return notFoundResponse("No repository configured for this project");
        }
        return successResponse({
          repositoryId: primary.id,
          url: primary.url,
          branch: "main",
          provider: primary.provider,
          name: primary.name,
        });
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Failed to get repo config"
        );
      }
    },
    {
      query: t.Object({
        projectId: t.String(),
      }),
    }
  )

  // GET /workers/scheduled-configs - Returns enabled scheduled agent configs for the scheduler
  // Security: filtered by the API key's organization
  .get("/scheduled-configs", async ({ set, workerApiKey }) => {
    try {
      const allConfigs = await listEnabledScheduledAgentConfigs();
      const filtered = allConfigs.filter(
        (c) => c.organizationId === workerApiKey!.organizationId,
      );
      return successResponse(filtered);
    } catch (error) {
      set.status = 500;
      return errorResponse(
        error instanceof Error ? error.message : "Failed to get scheduled configs",
        500,
      );
    }
  })

  // POST /workers/scheduled-configs/:id/last-run - Update lastRunAt for a scheduled config
  .post(
    "/scheduled-configs/:id/last-run",
    async ({ params, set }) => {
      try {
        await updateScheduledAgentConfigLastRunAt(params.id);
        return successResponse({ updated: true });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to update last run",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /workers/agent-jobs/:id/session-events — batch persist session events (API key auth)
  // Mirror of /api/agent-jobs/:id/session-events for services that authenticate
  // via API key (e.g. web-bridge) instead of user session cookies.
  .post(
    "/agent-jobs/:id/session-events",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const events = body.events.map((e) => ({
        agentJobId: params.id,
        planningSessionId: existing.job.planningSessionId ?? undefined,
        sequenceNum: e.sequenceNum,
        kind: e.kind,
        payload: e.payload as Record<string, unknown>,
        provider: e.provider ?? null,
      }));

      const inserted = await insertSessionEventsBatch(events);
      return successResponse({ inserted });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        events: t.Array(
          t.Object({
            sequenceNum: t.Number(),
            kind: t.String(),
            payload: t.Any(),
            provider: t.Optional(t.String()),
          })
        ),
      }),
    }
  )

  // GET /workers/agent-jobs/:id/session-events — load canonical session events (API key auth)
  .get(
    "/agent-jobs/:id/session-events",
    async ({ params, query, set }) => {
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const afterSequence = query.after ? Number(query.after) : undefined;
      const kinds = query.kinds ? query.kinds.split(",").filter(Boolean) : undefined;
      const limit = query.limit ? Math.min(Number(query.limit), 10000) : 5000;

      const events = await getSessionEventsByJobId(params.id, {
        afterSequence,
        kinds,
        limit,
      });

      return successResponse(events);
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        after: t.Optional(t.String()),
        kinds: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /workers/agent-jobs/:id/completion-snapshot
  // Returns the deterministic expected-vs-completed work item set used by
  // runner-implement's INV-4 completion gate. "Expected" = leaf task IDs under
  // the job's root work item. "Completed" = distinct work item IDs that have
  // an ai_session row with agent_job_id = :id.
  .get(
    "/agent-jobs/:id/completion-snapshot",
    async ({ params, set }) => {
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const rootWorkItemId = existing.workItem?.id ?? null;
      const organizationId = existing.job.organizationId ?? null;

      const expectedWorkItemIds = await resolveExpectedWorkItemIdsForCompletion(
        {
          rootWorkItemId,
          organizationId,
          job: existing.job,
        },
        {
          getLeafTaskIdsUnder,
          getDodRemediationExpectedLeafTaskIdsUnder,
        },
      );

      const completedWorkItemIds = await getCompletedWorkItemIdsForJob(params.id);

      return successResponse({
        jobId: params.id,
        rootWorkItemId,
        expectedWorkItemIds,
        completedWorkItemIds,
      });
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )

  // POST /workers/agent-jobs/:id/native-events — batch persist native runtime events (API key auth)
  .post(
    "/agent-jobs/:id/native-events",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const events = body.events.map((e) => ({
        agentJobId: params.id,
        planningSessionId: existing.job.planningSessionId ?? undefined,
        sequenceNum: e.sequenceNum,
        nativeEventType: e.nativeEventType,
        sourceFormat: e.sourceFormat,
        provider: (e.provider ?? existing.job.provider ?? null) as NewAgentNativeEvent["provider"],
        codingAgent: (e.codingAgent ?? existing.job.codingAgent ?? null) as NewAgentNativeEvent["codingAgent"],
        runtimeSessionId: e.runtimeSessionId ?? null,
        payload: e.payload as Record<string, unknown>,
        emittedAt: e.emittedAt ? new Date(e.emittedAt) : null,
      }));

      const inserted = await insertAgentNativeEventsBatch(events);
      return successResponse({ inserted });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        events: t.Array(
          t.Object({
            sequenceNum: t.Number(),
            nativeEventType: t.String(),
            sourceFormat: t.String(),
            payload: t.Any(),
            provider: t.Optional(t.String()),
            codingAgent: t.Optional(t.String()),
            runtimeSessionId: t.Optional(t.String()),
            emittedAt: t.Optional(t.String()),
          })
        ),
      }),
    }
  )

  // GET /workers/agent-jobs/:id/native-events — load native runtime events (API key auth)
  .get(
    "/agent-jobs/:id/native-events",
    async ({ params, query, set }) => {
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const afterSequence = query.after ? Number(query.after) : undefined;
      const limit = query.limit ? Math.min(Number(query.limit), 10000) : 5000;

      const events = await getAgentNativeEventsByJobId(params.id, {
        afterSequence,
        limit,
      });

      return successResponse(events);
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        after: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );
