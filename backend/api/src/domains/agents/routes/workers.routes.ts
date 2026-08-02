import { Elysia, t } from "elysia";
import { createHash } from "node:crypto";
import {
  validateApiKey,
  listEnabledScheduledAgentConfigs,
  updateScheduledAgentConfigLastRunAt,
  getBacklogDrainCandidatesForConfigId,
  getDodRemediationCandidatesForConfigId,
  getBacklogDrainCandidatesForScheduledConfig,
  getDodRemediationCandidatesForScheduledConfig,
  getScheduledAgentConfigById,
  getScheduledAgentConfigByIdUnscoped,
  isBacklogDrainTargetConfig,
  isDodRemediationTargetConfig,
  getWorkers,
  upsertWorker,
  updateHeartbeat,
  createJob,
  DuplicateActiveJobError,
  claimJobs,
  updateJobStatus,
  updateClaimedJobStatus,
  updateLegacyClaimedJobStatus,
  requestJobTerminalIntent,
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
  createFencedJobInteraction,
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
  ensureClaimSequenceReservation,
  prepareClaimSequenceHandoff,
  persistFencedAgentJobLogs,
  persistReceiptFreeLegacyAgentJobLogs,
  persistFencedSessionEvents,
  persistReceiptFreeLegacySessionEvents,
  persistFencedNativeEvents,
  persistReceiptFreeLegacyNativeEvents,
  ClaimSequenceReceiptConflictError,
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
  getAgentPluginById,
  getUserStorageObject,
} from "@almirant/database";
import { getInstallationAccessToken } from "../../integrations/github/services/github-service";
import type {
  ProviderQuotaDb,
  ApiKey,
  CodingAgent,
  AiProvider,
  AgentJobConfig,
  NewAgentNativeEvent,
  NewSessionEvent,
  ScheduledAgentConfigDb,
} from "@almirant/database";
import { env, logger } from "@almirant/config";
import { refreshCanonicalSessionProjection } from "../../ideation/planning-sessions/services/canonical-session-projection";
import { getGithubAppCredentials } from "../../instance/services/github-app-credentials-service";
import { errorResponse, notFoundResponse, successResponse } from "../../../shared/services/response";
import { downloadBufferFromS3, extractKeyFromUrl, getEditorUploadsBucket, isS3Configured } from "../../../shared/services/s3-service";
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
import {
  resolveRuntime,
  decodeAgentPluginBundleDescriptor,
  type AgentRuntimePluginReference,
} from "@almirant/shared";
import {
  buildDefaultJobResourceEstimate,
  buildWorkItemResourceForecast,
  toJobResourceEstimate,
} from "../services/resource-forecast";
import { resolveExpectedWorkItemIdsForCompletion } from "../services/completion-snapshot";
import { assertValidScheduledAgentRuntime } from "../services/scheduled-agent-runtime-validation";
import { getScheduledAgentDemand } from "../services/scheduled-agent-demand";
import { resolveScheduledAgentEffectiveRuntimes } from "../services/scheduled-agent-effective-model-resolver";

type RevalidatedScheduledWorkItemJob = {
  provider: "claude-code" | "codex" | "zipu" | "grok";
  codingAgent: CodingAgent;
  aiProvider: AiProvider;
  model: string;
  reasoningLevel: string | null;
  jobType: ScheduledAgentConfigDb["jobType"];
  projectId: string;
  scheduledConfigId: string;
  scheduledConfigName: string;
  skillName: string;
  source: "backlog-drain" | "dod-remediation" | "scheduled-config";
  mcpServers: ScheduledAgentConfigDb["mcpServers"];
  dodReport: string | null;
  dodReviewedAt: string | null;
};

type ScheduledWorkItemJobRequest = {
  provider: string;
  codingAgent?: string;
  aiProvider?: string;
  model?: string;
  reasoningLevel?: string;
  jobType?: string;
  config?: {
    projectId?: string;
    scheduledConfigId?: string;
    scheduledConfigName?: string;
    skillName?: string;
    source?: string;
    reasoningLevel?: string;
    dodReport?: string;
    dodReviewedAt?: string;
  };
};

const normalizeScheduledRuntimeValue = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const assertScheduledPayloadMatches = (
  field: string,
  requested: string | null | undefined,
  effective: string | null | undefined,
  required = false,
): void => {
  const requestedValue = normalizeScheduledRuntimeValue(requested);
  if (!requestedValue && !required) return;
  const effectiveValue = normalizeScheduledRuntimeValue(effective);
  if (requestedValue !== effectiveValue) {
    throw new Error(
      `Scheduled agent payload field '${field}' does not match the current server-side runtime`,
    );
  }
};

const SCHEDULED_WORK_ITEM_SOURCES = new Set(["backlog-drain", "dod-remediation"]);
const SCHEDULED_WORK_ITEM_SKILLS = new Set(["runner-implement", "runner-fix-dod"]);

/**
 * Detect every worker payload marker reserved for scheduled backlog/DoD work.
 * No single caller-controlled field is authoritative: removing the source must
 * not bypass the boundary while an internal skill or DoD evidence remains.
 */
const claimsBacklogOrDodSemantics = (request: ScheduledWorkItemJobRequest): boolean => {
  const source = normalizeScheduledRuntimeValue(request.config?.source);
  const skillName = normalizeScheduledRuntimeValue(request.config?.skillName);
  return (
    (source !== null && SCHEDULED_WORK_ITEM_SOURCES.has(source))
    || (skillName !== null && SCHEDULED_WORK_ITEM_SKILLS.has(skillName))
    || normalizeScheduledRuntimeValue(request.config?.dodReport) !== null
    || normalizeScheduledRuntimeValue(request.config?.dodReviewedAt) !== null
  );
};

const claimsScheduledWorkItemSemantics = (request: ScheduledWorkItemJobRequest): boolean =>
  claimsBacklogOrDodSemantics(request)
  || normalizeScheduledRuntimeValue(request.config?.scheduledConfigName) !== null;

/**
 * Re-resolve backlog/DoD candidates at the enqueue boundary. The runner's
 * payload is only a request: the scheduled config, project rule, project
 * defaults and active connection are server-authoritative.
 */
const revalidateScheduledWorkItemJob = async (
  workspaceId: string,
  workItemId: string,
  workItemProjectId: string | null | undefined,
  request: ScheduledWorkItemJobRequest,
): Promise<RevalidatedScheduledWorkItemJob | null> => {
  const scheduledConfigId = request.config?.scheduledConfigId?.trim();
  if (!scheduledConfigId) {
    if (claimsScheduledWorkItemSemantics(request)) {
      throw new Error(
        "config.scheduledConfigId is required for backlog-drain and DoD remediation jobs",
      );
    }
    return null;
  }

  const scheduledConfig = await getScheduledAgentConfigById(scheduledConfigId, workspaceId);
  if (!scheduledConfig) {
    throw new Error("Scheduled agent config not found in this workspace");
  }
  if (scheduledConfig.enabled === false) {
    throw new Error("Scheduled agent config is no longer enabled");
  }

  const isDodRemediation = isDodRemediationTargetConfig(scheduledConfig.targetConfig);
  const isBacklogDrain = isBacklogDrainTargetConfig(scheduledConfig.targetConfig);
  let runtime: {
    provider: string;
    codingAgent: string;
    aiProvider: string;
    model: string;
    reasoningLevel?: string | null;
  };
  let projectId: string;
  let source: RevalidatedScheduledWorkItemJob["source"];
  let skillName: string;
  let dodReport: string | null = null;
  let dodReviewedAt: string | null = null;
  let effectiveRuntimesToValidate: ReadonlyArray<typeof runtime>;

  if (isDodRemediation || isBacklogDrain) {
    const result = isDodRemediation
      ? await getDodRemediationCandidatesForScheduledConfig(scheduledConfig)
      : await getBacklogDrainCandidatesForScheduledConfig(scheduledConfig);
    const candidate = result.candidates.find((item) => item.id === workItemId);
    if (!candidate) {
      throw new Error(
        "Scheduled agent candidate is no longer eligible under the current server-side configuration",
      );
    }
    runtime = candidate;
    projectId = candidate.projectId;
    source = isDodRemediation ? "dod-remediation" : "backlog-drain";
    skillName = candidate.skillName;
    dodReport = candidate.dodReport ?? null;
    dodReviewedAt = candidate.dodReviewedAt ?? null;
    effectiveRuntimesToValidate = [runtime];
  } else {
    const effectiveRuntimes = await resolveScheduledAgentEffectiveRuntimes({
      workspaceId,
      provider: scheduledConfig.provider,
      codingAgent: scheduledConfig.codingAgent,
      aiProvider: scheduledConfig.aiProvider,
      aiModel: scheduledConfig.aiModel,
      reasoningLevel: scheduledConfig.reasoningLevel,
      jobType: scheduledConfig.jobType,
      projectId: workItemProjectId,
      targetConfig: scheduledConfig.targetConfig,
    });
    const [effectiveRuntime] = effectiveRuntimes;
    if (!effectiveRuntime || !workItemProjectId) {
      throw new Error(
        "Scheduled agent runtime could not be resolved from the current server-side configuration",
      );
    }
    runtime = effectiveRuntime;
    effectiveRuntimesToValidate = effectiveRuntimes;
    projectId = workItemProjectId;
    source = "scheduled-config";
    skillName = request.config?.skillName ?? "validate";
  }

  assertValidScheduledAgentRuntime({
    provider: scheduledConfig.provider,
    codingAgent: scheduledConfig.codingAgent,
    aiProvider: scheduledConfig.aiProvider,
    aiModel: scheduledConfig.aiModel,
    reasoningLevel: scheduledConfig.reasoningLevel,
    effectiveRuntimes: effectiveRuntimesToValidate,
    targetConfig: scheduledConfig.targetConfig,
  });

  assertScheduledPayloadMatches("provider", request.provider, runtime.provider, true);
  assertScheduledPayloadMatches("codingAgent", request.codingAgent, runtime.codingAgent);
  assertScheduledPayloadMatches("aiProvider", request.aiProvider, runtime.aiProvider);
  assertScheduledPayloadMatches("model", request.model, runtime.model);
  assertScheduledPayloadMatches("reasoningLevel", request.reasoningLevel, runtime.reasoningLevel);
  assertScheduledPayloadMatches(
    "config.reasoningLevel",
    request.config?.reasoningLevel,
    runtime.reasoningLevel,
  );
  assertScheduledPayloadMatches("jobType", request.jobType, scheduledConfig.jobType);
  assertScheduledPayloadMatches("config.projectId", request.config?.projectId, projectId);
  assertScheduledPayloadMatches("config.source", request.config?.source, source);
  if (isDodRemediation || isBacklogDrain) {
    assertScheduledPayloadMatches("config.skillName", request.config?.skillName, skillName);
  }
  assertScheduledPayloadMatches(
    "config.scheduledConfigName",
    request.config?.scheduledConfigName,
    scheduledConfig.name,
  );

  return {
    provider: runtime.provider as RevalidatedScheduledWorkItemJob["provider"],
    codingAgent: runtime.codingAgent as CodingAgent,
    aiProvider: runtime.aiProvider as AiProvider,
    model: runtime.model,
    reasoningLevel: runtime.reasoningLevel ?? null,
    jobType: scheduledConfig.jobType,
    projectId,
    scheduledConfigId: scheduledConfig.id,
    scheduledConfigName: scheduledConfig.name,
    skillName,
    source,
    mcpServers: scheduledConfig.mcpServers,
    dodReport,
    dodReviewedAt,
  };
};

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

/** Resolve workspaceId from a workItemId via the work item's project. */
const resolveOrgIdFromWorkItem = async (workItemId: string | null): Promise<string | null> => {
  if (!workItemId) return null;
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(eq(workItems.id, workItemId))
    .limit(1);
  return row?.workspaceId ?? null;
};

/** Resolve workspaceId from a planningSessionId directly (planning_sessions has workspaceId). */
const resolveOrgIdFromPlanningSession = async (planningSessionId: string | null): Promise<string | null> => {
  if (!planningSessionId) return null;
  const [row] = await db
    .select({ workspaceId: planningSessions.workspaceId })
    .from(planningSessions)
    .where(eq(planningSessions.id, planningSessionId))
    .limit(1);
  return row?.workspaceId ?? null;
};

/** Resolve workspaceId from either workItemId or planningSessionId. */
const resolveOrgId = async (workItemId: string | null, planningSessionId: string | null): Promise<string | null> => {
  if (workItemId) return resolveOrgIdFromWorkItem(workItemId);
  if (planningSessionId) return resolveOrgIdFromPlanningSession(planningSessionId);
  return null;
};

/**
 * Resolve which workspace a scheduled-worker read endpoint should query.
 *
 * The runner is shared instance infrastructure (same trust boundary as
 * /workers/jobs/claim): when it names a scheduledConfigId, that config is the
 * source of truth for tenancy and is resolved by id alone, never scoped to
 * the caller's own key. Older runner builds that omit the param keep the
 * pre-existing behavior of scoping to the worker key's own workspace.
 *
 * Returns null when a scheduledConfigId was given but did not resolve to any
 * config, so the caller can 404 instead of silently falling back to the key.
 */
const resolveScheduledWorkerIdentity = async (
  workerApiKeyWorkspaceId: string,
  scheduledConfigId: string | undefined,
): Promise<string | null> => {
  const trimmed = scheduledConfigId?.trim();
  if (!trimmed) return workerApiKeyWorkspaceId;
  const config = await getScheduledAgentConfigByIdUnscoped(trimmed);
  return config?.workspaceId ?? null;
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
  wsConnectionManager.broadcastToWorkspace(orgId, {
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

    wsConnectionManager.broadcastToWorkspace(orgId, {
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

    wsConnectionManager.broadcastToWorkspace(orgId, {
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

    wsConnectionManager.broadcastToWorkspace(orgId, {
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

    wsConnectionManager.broadcastToWorkspace(orgId, {
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
    workspaceId?: string | null;
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
  // Prefer the job's own workspaceId (always populated). Only resolve via
  // workItem/planningSession as a legacy fallback for older call sites that
  // lack the full job record.
  const orgId =
    job.workspaceId ??
    (await resolveOrgId(
      job.workItemId ?? args.workItemId ?? null,
      job.planningSessionId ?? args.planningSessionId ?? null,
    ));
  broadcastAgentJobStatusChanged({
    workspaceId: orgId,
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

// Receipts-protocol claim-ownership helpers. Genuinely generic (no
// Shoutrz/workspace-scope dependency) — ported from cloud verbatim.
const getCurrentClaimAttemptId = (
  config: AgentJobConfig | null | undefined,
): string | null =>
  typeof config?.claimAttemptId === "string" &&
  config.claimAttemptId.trim().length > 0
    ? config.claimAttemptId
    : null;

/** Exact equality includes the legacy state: no current nonce accepts only no nonce. */
const matchesCurrentClaimAttempt = (
  config: AgentJobConfig | null | undefined,
  provided: string | undefined,
): boolean => getCurrentClaimAttemptId(config) === (provided?.trim() || null);

const isLegacyUnclaimedSequenceEvent = (
  config: AgentJobConfig | null | undefined,
  event: {
    sequenceProtocolVersion?: "durable.v2";
    claimAttemptId?: string;
  },
): boolean =>
  getCurrentClaimAttemptId(config) === null &&
  event.sequenceProtocolVersion === undefined &&
  event.claimAttemptId === undefined;

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

// Ported from cloud's workers.routes.ts (community issue #85, lote 13) for
// GET /jobs/:jobId/agent-plugins/:pluginId/bundle. Minimal surgery: only
// this constant + helper + route are added -- no other part of this file
// is touched, and cloud's `resolveWorkerJobAccess` shared helper is
// deliberately NOT ported (community has no equivalent and every other
// job-scoped GET route in this file already does its own inline
// getJobById + 404 check instead of a shared abstraction -- see
// /jobs/:jobId/workspace-files/:fileId directly above).
const MAX_PLUGIN_BUNDLE_DESCRIPTOR_BYTES = 70 * 1024 * 1024;

const getJobAgentPluginReferences = (
  config: unknown,
): AgentRuntimePluginReference[] => {
  if (!isPlainRecord(config) || !Array.isArray(config.agentPlugins)) return [];
  return config.agentPlugins.filter((reference): reference is AgentRuntimePluginReference => {
    if (!isPlainRecord(reference)) return false;
    return (
      typeof reference.id === "string" &&
      typeof reference.slug === "string" &&
      typeof reference.kind === "string"
    );
  });
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
  workspaceId: string,
  workItemId: string,
): Promise<NonNullable<AgentJobConfig["resourceEstimate"]>> => {
  const forecast = await buildWorkItemResourceForecast(workspaceId, workItemId, {
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

      // Security: derive workspaceId from the API key, falling back to the
      // job's org when a jobId is provided.  Shared/dynamic runners may have an
      // API key that belongs to a different org than the job they claimed —
      // this is expected in the multi-tenant model where runners are created by
      // the scaler and can pick up work for any workspace.  The credential
      // resolution below is scoped to the resolved org, so credentials from one
      // org are never leaked to a job from another.
      let createdByUserId = query.createdByUserId?.trim() || null;
      let workspaceId: string | null = workerApiKey!.workspaceId;
      const jobId = query.jobId?.trim() || null;

      if (jobId) {
        const job = await getJobById(jobId);
        if (!job) {
          set.status = 404;
          return notFoundResponse("Agent job");
        }
        createdByUserId = createdByUserId ?? job.job.createdByUserId ?? null;
        // Use the job's org for credential resolution so that shared runners
        // can serve jobs from any workspace.
        if (job.job.workspaceId) {
          workspaceId = job.job.workspaceId;
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
        if (preferredConnectionId && workspaceId) {
          const pinned = await getConnectionById(
            preferredConnectionId,
            env.ENCRYPTION_KEY,
            { scope: "organization", scopeId: workspaceId },
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
                workspaceId,
                connectionId: pinned.id,
              },
              "provider-keys: using admin-pinned connection",
            );
          } else {
            logger.warn(
              {
                provider,
                workspaceId,
                preferredConnectionId,
                found: !!pinned,
                isActive: pinned?.isActive,
                providerMatches: pinned?.provider === provider,
              },
              "provider-keys: preferredConnectionId rejected, falling back to org resolution",
            );
          }
        }

        if (!connection && workspaceId) {
          // 1. Try orchestration-enabled connections first (preferred path)
          let resolved = await resolveAiKey({
            provider,
            userId: createdByUserId,
            workspaceId,
            encryptionKey: env.ENCRYPTION_KEY,
            forOrchestration: true,
            excludeConnectionIds: excludeConnectionIds.length > 0 ? excludeConnectionIds : undefined,
          });

          // 2. If no orchestration-enabled connection, retry with ALL org connections.
          //    This ensures we never cross org boundaries just because
          //    orchestrationEnabled is false.
          if (!resolved) {
            logger.info(
              { provider, workspaceId },
              "No orchestration-enabled connection found, retrying with all org connections",
            );
            resolved = await resolveAiKey({
              provider,
              userId: createdByUserId,
              workspaceId,
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
                workspaceId,
                excludedConnectionIds: excludeConnectionIds,
              },
              "Hot-swap failed: no alternative connection available after rate limit. All connections exhausted.",
            );
          }

          // HARD STOP: if we have a workspaceId but still no connection,
          // do NOT fall through to the global lookup. That would use another
          // org's credentials — a critical isolation violation.
          if (!connection || !credentials) {
            logger.error(
              { provider, workspaceId },
              "No usable connection found for workspace — refusing cross-org fallback",
            );
            continue;
          }
        }

        // Global fallback: only when there is NO workspaceId (legacy/system jobs)
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
  // Shared runners may process work items from any workspace.
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
  //
  // Ported from cloud without the assertWorkerIdentity check and the
  // scope/activeJobIds params to claimJobs (workspace-scoped runner
  // credentials + an unrelated active-claim-exclusion feature — neither is
  // part of the receipts protocol; see the "sequence-reservations" endpoint
  // comment above). The `capabilities` -> `protocol` negotiation IS part of
  // the receipts protocol: a worker opts in by declaring
  // "durable.v2.receipts", but the server-owned DURABLE_SEQUENCE_RECEIPTS_ENABLED
  // rollout gate must independently be "true" — a worker capability alone
  // must never activate the protocol (coordinated rollout: every Redis
  // bridge consumer must be upgraded and the old consumer group drained
  // first).
  .post(
    "/jobs/claim",
    async ({ body }) => {
      await updateHeartbeat(body.workerId, {
        activeJobs: body.activeJobs ?? undefined,
      });

      const jobs = await claimJobs(
        body.workerId,
        body.count,
        body.acceptedCodingAgents,
        {
          durableSequenceReceipts:
            env.DURABLE_SEQUENCE_RECEIPTS_ENABLED === "true" &&
            body.capabilities?.includes("durable.v2.receipts") === true,
        },
      );
      return successResponse(jobs);
    },
    {
      body: t.Object({
        workerId: t.String(),
        count: t.Number(),
        activeJobs: t.Optional(t.Number()),
        acceptedCodingAgents: t.Optional(t.Array(t.String())),
        capabilities: t.Optional(
          t.Array(t.Literal("durable.v2.receipts"), {
            maxItems: 1,
            uniqueItems: true,
          }),
        ),
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

      if (!body.workItemId && claimsBacklogOrDodSemantics(body)) {
        set.status = 400;
        return errorResponse(
          "workItemId is required for backlog-drain and DoD remediation jobs",
        );
      }

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

        const workspaceId = await resolveOrgIdFromWorkItem(body.workItemId);
        if (!workspaceId) {
          set.status = 400;
          return errorResponse("Unable to resolve workspace for work item");
        }

        const requestedJobType = body.jobType ?? "validation";
        const requestedSkillName = body.config?.skillName ?? "validate";
        let resourceEstimate = body.config?.resourceEstimate as
          | NonNullable<AgentJobConfig["resourceEstimate"]>
          | undefined;

        if (!resourceEstimate && requestedJobType === "implementation") {
          try {
            resourceEstimate = await buildRequiredImplementationResourceEstimate(
              workspaceId,
              body.workItemId,
            );
          } catch (error) {
            logger.error(
              { error, workItemId: body.workItemId, workspaceId },
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
          jobType: requestedJobType,
          skillName: requestedSkillName,
          promptTemplate: requestedSkillName,
        });

        // Keep this revalidation adjacent to createJob: resource forecasting
        // may perform I/O, so doing it first avoids a wider policy TOCTOU gap.
        let scheduledJob: RevalidatedScheduledWorkItemJob | null;
        try {
          scheduledJob = await revalidateScheduledWorkItemJob(
            workspaceId,
            body.workItemId,
            workItem.projectId,
            body,
          );
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "Scheduled agent runtime revalidation failed";
          logger.warn(
            { error, workItemId: body.workItemId, workspaceId },
            "workers/jobs: rejected stale or tampered scheduled job payload",
          );
          set.status = 400;
          return errorResponse(message);
        }

        const resolvedJobType = scheduledJob?.jobType ?? requestedJobType;
        const resolvedSkillName = scheduledJob?.skillName ?? requestedSkillName;
        const resolvedReasoningLevel = scheduledJob
          ? scheduledJob.reasoningLevel ?? undefined
          : body.reasoningLevel ?? body.config?.reasoningLevel;
        const resolvedMcpServers = scheduledJob
          ? scheduledJob.mcpServers
          : body.config?.mcpServers;

        // `getActiveJobForWorkItem` above is a read-then-write check: it is
        // not atomic with this INSERT, so the backend scheduled-agent-
        // dispatcher tick (flag-gated off by default) or another backend
        // replica can still win a race and create the active job first.
        // `createJob` translates the resulting
        // agent_jobs_work_item_job_type_active_uidx violation (migration
        // 0222, parity with cloud 0236) into `DuplicateActiveJobError` --
        // surface it as the exact same 409 the pre-check above already
        // returns for the sequential case, instead of an unhandled 500.
        let job: Awaited<ReturnType<typeof createJob>>;
        try {
          job = await createJob({
            projectId: scheduledJob?.projectId ?? workItem.projectId ?? null,
            boardId: workItem.boardId ?? null,
            workItemId: workItem.id,
            workspaceId,
            jobType: resolvedJobType,
            provider: scheduledJob?.provider ?? body.provider,
            priority: body.priority ?? "medium",
            config: {
              repoPath: body.config?.repoPath ?? ".",
              baseBranch: body.config?.baseBranch ?? "main",
              ...(body.config?.workspace ? { workspace: body.config.workspace } : {}),
              projectId: scheduledJob?.projectId ?? body.config?.projectId ?? workItem.projectId ?? undefined,
              ...(scheduledJob?.scheduledConfigId ?? body.config?.scheduledConfigId
                ? { scheduledConfigId: scheduledJob?.scheduledConfigId ?? body.config?.scheduledConfigId }
                : {}),
              ...(scheduledJob?.scheduledConfigName ?? body.config?.scheduledConfigName
                ? {
                    scheduledConfigName:
                      scheduledJob?.scheduledConfigName ?? body.config?.scheduledConfigName,
                  }
                : {}),
              skillName: resolvedSkillName,
              ...(body.config?.skillId ? { skillId: body.config.skillId } : {}),
              source: scheduledJob?.source ?? body.config?.source ?? "worker",
              ...(resolvedReasoningLevel
                ? { reasoningLevel: resolvedReasoningLevel }
                : {}),
              ...(scheduledJob?.dodReport ?? body.config?.dodReport
                ? { dodReport: scheduledJob?.dodReport ?? body.config?.dodReport }
                : {}),
              ...(scheduledJob?.dodReviewedAt ?? body.config?.dodReviewedAt
                ? { dodReviewedAt: scheduledJob?.dodReviewedAt ?? body.config?.dodReviewedAt }
                : {}),
              ...(body.config?.repositoryId
                ? { repositoryId: body.config.repositoryId }
                : {}),
              ...(resolvedMcpServers
                ? { mcpServers: resolvedMcpServers }
                : {}),
              ...(body.config?.needsBrowser ? { needsBrowser: true } : {}),
              ...(resourceEstimate ? { resourceEstimate } : {}),
            },
            codingAgent: scheduledJob?.codingAgent ??
              (body.codingAgent as CodingAgent | undefined) ??
              resolvedRuntime.codingAgent,
            aiProvider: scheduledJob?.aiProvider ??
              (body.aiProvider as AiProvider | undefined) ??
              resolvedRuntime.aiProvider,
            model: scheduledJob?.model ?? body.model ?? resolvedRuntime.model,
            skillName: resolvedSkillName,
            // New model fields
            promptTemplate: resolvedSkillName,
            triggerType: "event",
            interactive: false,
          });
        } catch (error) {
          if (error instanceof DuplicateActiveJobError) {
            set.status = 409;
            return errorResponse("An active job already exists for this work item");
          }
          throw error;
        }

        // Flip isAiProcessing on the linked work item as soon as the job is
        // enqueued so cards animate immediately, without waiting for the
        // runner-side skill to call move_work_item.
        if (job.workItemId) {
          await setWorkItemAiProcessing(workspaceId, job.workItemId, true);
          wsConnectionManager.broadcastToWorkspace(workspaceId, {
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
      } else if (body.workspaceId) {
        // === STANDALONE JOB (no work item) ===
        // Prompt-type scheduled agents (jobType "scheduled") always send
        // config.scheduledConfigId alongside workspaceId. Attribution must
        // come from the config itself, not the caller-supplied
        // body.workspaceId — the runner is shared instance infrastructure and
        // a request body is not proof of ownership (mirrors the workItemId
        // branch above, which derives workspace via resolveOrgIdFromWorkItem
        // instead of trusting anything the caller sent).
        let workspaceId = body.workspaceId;
        const standaloneScheduledConfigId = body.config?.scheduledConfigId?.trim();
        if (standaloneScheduledConfigId) {
          const scheduledConfig = await getScheduledAgentConfigByIdUnscoped(
            standaloneScheduledConfigId,
          );
          if (!scheduledConfig) {
            set.status = 400;
            return errorResponse("Scheduled agent config not found");
          }
          if (scheduledConfig.enabled === false) {
            set.status = 400;
            return errorResponse("Scheduled agent config is no longer enabled");
          }
          workspaceId = scheduledConfig.workspaceId;
        }

        // Resolve primary repository when projectId is provided
        let repoUrl: string | undefined;
        let repositoryId: string | undefined;
        let standaloneProjectId = body.config?.projectId ?? undefined;

        if (standaloneProjectId) {
          try {
            const repos = await getRepositories(workspaceId, standaloneProjectId);
            const primary = repos[0];
            if (primary) {
              repoUrl = primary.url;
              repositoryId = primary.id;
            }
          } catch {
            // Non-fatal: runner will resolve via API fallback
          }
        }

        // No project means no repository. This used to fall back to the
        // workspace's primary repository — the first by `order`, arbitrary when
        // several tie at 0 — which pointed the job at a repository nobody chose.
        // An empty workspace is a supported mode; guessing a repository is not.

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
          workspaceId,
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
        return errorResponse("Either workItemId or workspaceId is required");
      }
    },
    {
      body: t.Object({
        workItemId: t.Optional(t.String()),
        workspaceId: t.Optional(t.String()),
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
  // Security: filtered by the API key's workspace
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
        eq(agentJobs.workspaceId, workerApiKey!.workspaceId),
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
  //
  // Ported from cloud without the workerApiKey workspace-scope check (see
  // the "sequence-reservations" endpoint comment above for why). Exposes the
  // effective status/error, preferring a held pendingTerminalIntent over the
  // job's own (still finalizing) row so a polling runner sees the outcome
  // that will apply once the receipt drains, not a stale "running".
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
      const pendingTerminalIntent = existing.job.config?.pendingTerminalIntent;
      const pendingResult =
        pendingTerminalIntent?.result &&
        typeof pendingTerminalIntent.result === "object"
          ? pendingTerminalIntent.result
          : null;
      const effectiveErrorType =
        pendingTerminalIntent?.errorType ?? existing.job.errorType ?? undefined;
      const effectiveErrorMessage =
        pendingTerminalIntent?.errorMessage ?? existing.job.errorMessage ?? undefined;

      return successResponse({
        status: pendingTerminalIntent?.status ?? existing.job.status,
        shutdownRequested:
          pendingResult?.shutdownRequested === true ||
          resultPayload?.shutdownRequested === true,
        ...(effectiveErrorType ? { errorType: effectiveErrorType } : {}),
        ...(effectiveErrorMessage ? { errorMessage: effectiveErrorMessage } : {}),
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
  // download arbitrary attachments from the workspace.
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

      const workspaceId = existing.job.workspaceId ?? workerApiKey!.workspaceId;
      if (!workspaceId) {
        set.status = 400;
        return errorResponse("Job has no workspaceId");
      }

      const attachment = await getAttachment(workspaceId, params.fileId);
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

  // GET /workers/jobs/:jobId/agent-plugins/:pluginId/bundle
  // A worker can fetch only portable plugin IDs pinned into this job. The API
  // reads a canonical JSON descriptor from private user storage and validates
  // it before returning regular files; raw archives are never extracted here.
  // Ported from cloud (community issue #85, lote 13) -- see the
  // getJobAgentPluginReferences / MAX_PLUGIN_BUNDLE_DESCRIPTOR_BYTES comment
  // above for what was deliberately NOT ported (resolveWorkerJobAccess).
  .get(
    "/jobs/:jobId/agent-plugins/:pluginId/bundle",
    async ({ params, set, workerApiKey }) => {
      if (!workerApiKey?.serviceAccountId) {
        set.status = 403;
        return errorResponse("Worker service-account credential required", 403);
      }
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const reference = getJobAgentPluginReferences(existing.job.config).find(
        (candidate) => candidate.id === params.pluginId,
      );
      if (!reference) {
        set.status = 403;
        return errorResponse("Agent plugin is not declared by this job");
      }
      if (
        reference.kind !== "portable_skill" &&
        reference.kind !== "claude_upload"
      ) {
        set.status = 409;
        return errorResponse("Agent plugin does not use an uploaded bundle");
      }
      const expectedBundleKind = reference.kind === "claude_upload"
        ? "claude_plugin"
        : "portable_skill";
      const expectedProvider = reference.kind === "claude_upload"
        ? "claude-code"
        : "portable";

      const workspaceId = existing.job.workspaceId;
      if (!workspaceId) {
        set.status = 409;
        return errorResponse("Agent job has no workspaceId");
      }

      const plugin = await getAgentPluginById(
        params.pluginId,
        workspaceId,
        existing.job.createdByUserId,
      );
      if (!plugin) {
        set.status = 404;
        return notFoundResponse("Agent plugin");
      }

      const manifestKind =
        plugin.manifest && typeof plugin.manifest.kind === "string"
          ? plugin.manifest.kind
          : null;
      if (
        !plugin.enabled ||
        plugin.sourceType !== "upload" ||
        plugin.provider !== expectedProvider ||
        manifestKind !== expectedBundleKind ||
        !plugin.ownerUserId ||
        !plugin.storageObjectId ||
        !plugin.checksumSha256 ||
        plugin.slug !== reference.slug ||
        (reference.kind === "claude_upload" &&
          plugin.externalId !== reference.pluginName) ||
        plugin.checksumSha256.toLowerCase() !== reference.checksumSha256.toLowerCase()
      ) {
        set.status = 409;
        return errorResponse("Agent plugin runtime configuration no longer matches the job pin");
      }

      const storageObject = await getUserStorageObject(
        plugin.ownerUserId,
        plugin.storageObjectId,
      );
      if (!storageObject) {
        set.status = 404;
        return notFoundResponse("Agent plugin bundle");
      }

      const isCanonicalDescriptor =
        storageObject.contentType === "application/json" ||
        storageObject.contentType.startsWith("application/vnd.almirant.agent-plugin+json");
      if (
        storageObject.kind !== "plugin_bundle" ||
        !isCanonicalDescriptor ||
        (storageObject.workspaceId && storageObject.workspaceId !== workspaceId) ||
        storageObject.checksumSha256.toLowerCase() !==
          reference.checksumSha256.toLowerCase()
      ) {
        set.status = 409;
        return errorResponse("Agent plugin bundle is not a canonical job-scoped descriptor");
      }
      if (storageObject.sizeBytes > MAX_PLUGIN_BUNDLE_DESCRIPTOR_BYTES) {
        set.status = 413;
        return errorResponse("Agent plugin bundle descriptor exceeds the supported size");
      }

      const bucket = getEditorUploadsBucket();
      if (!bucket || !isS3Configured(bucket)) {
        set.status = 503;
        return errorResponse("Private plugin storage is not configured", 503);
      }

      try {
        const bytes = await downloadBufferFromS3(storageObject.objectKey, bucket);
        if (bytes.byteLength > MAX_PLUGIN_BUNDLE_DESCRIPTOR_BYTES) {
          set.status = 413;
          return errorResponse("Agent plugin bundle descriptor exceeds the supported size");
        }

        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (checksum !== reference.checksumSha256.toLowerCase()) {
          set.status = 409;
          return errorResponse("Agent plugin bundle checksum does not match the job pin");
        }

        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const parsed = JSON.parse(text) as unknown;
        const validated = decodeAgentPluginBundleDescriptor(parsed);
        if (validated.kind !== expectedBundleKind) {
          set.status = 409;
          return errorResponse("Agent plugin bundle kind does not match the job pin");
        }

        return successResponse({
          schemaVersion: 1 as const,
          pluginId: plugin.id,
          slug: plugin.slug,
          kind: validated.kind,
          checksumSha256: checksum,
          files: validated.files.map((file) => ({
            type: "file" as const,
            path: file.path,
            contentBase64: Buffer.from(file.content).toString("base64"),
          })),
        });
      } catch (error) {
        logger.error(
          { error, jobId: params.jobId, pluginId: params.pluginId },
          "Failed to validate agent plugin bundle",
        );
        set.status = 500;
        return errorResponse("Failed to validate agent plugin bundle", 500);
      }
    },
    {
      params: t.Object({
        jobId: t.String(),
        pluginId: t.String(),
      }),
    }
  )

  // POST /workers/jobs/:jobId/status
  //
  // Ported from cloud without the workerApiKey workspace-scope check (see the
  // "sequence-reservations" endpoint comment above). Adds claim-ownership
  // fencing: a request carrying (or whose job config already carries) a
  // claimAttemptId routes through updateClaimedJobStatus (requires the exact
  // receipt to be ready before a terminal/release transition, applies a held
  // pendingTerminalIntent, and short-circuits side effects on idempotent
  // replay); a receipt-free request routes through updateLegacyClaimedJobStatus
  // (CAS on the exact row generation the route observed, replacing the prior
  // unconditional updateJobStatus write). Bundled with cloud's own fallback
  // fixes for result/branchName/prUrl/prNumber/commitSha (preserve the
  // existing value when the runner's partial update omits the field) since
  // they live in the same handler rewrite as the receipts wiring.
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
      const currentClaimAttemptId = getCurrentClaimAttemptId(existing.job.config);
      const expectedClaimAttemptId = body.expectedClaimAttemptId?.trim();
      const usesClaimOwnership = Boolean(
        currentClaimAttemptId || expectedClaimAttemptId,
      );

      if (
        usesClaimOwnership &&
        (!body.workerId?.trim() || !expectedClaimAttemptId)
      ) {
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
      }

      if (
        usesClaimOwnership &&
        releasesWorkerResources &&
        !body.sequenceHighWater
      ) {
        set.status = 400;
        return errorResponse(
          "A fenced release requires producer sequence high-water marks",
          400,
        );
      }

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

      const previousSequenceHighWater = existing.job.config?.sequenceHighWater;
      const hasValidPreviousSequenceHighWater =
        previousSequenceHighWater?.protocolVersion === 2 &&
        [
          previousSequenceHighWater.jobLogs,
          previousSequenceHighWater.sessionEvents,
          previousSequenceHighWater.nativeEvents,
        ].every(
          (value) =>
            Number.isInteger(value) && value >= 0 && value <= 2_147_483_647,
        );
      const monotonicSequenceHighWater = body.sequenceHighWater
        ? {
            protocolVersion: 2 as const,
            jobLogs: Math.max(
              body.sequenceHighWater.jobLogs,
              hasValidPreviousSequenceHighWater
                ? previousSequenceHighWater.jobLogs
                : 0,
            ),
            sessionEvents: Math.max(
              body.sequenceHighWater.sessionEvents,
              hasValidPreviousSequenceHighWater
                ? previousSequenceHighWater.sessionEvents
                : 0,
            ),
            nativeEvents: Math.max(
              body.sequenceHighWater.nativeEvents,
              hasValidPreviousSequenceHighWater
                ? previousSequenceHighWater.nativeEvents
                : 0,
            ),
          }
        : undefined;

      const updatedConfig =
        releasesWorkerResources && (status === "paused" || body.sequenceHighWater)
          ? {
              ...existing.job.config,
              ...(status === "paused"
                ? { previousJobId: existing.job.config?.previousJobId ?? existing.job.id }
                : {}),
              ...(monotonicSequenceHighWater
                ? { sequenceHighWater: monotonicSequenceHighWater }
                : {}),
            } satisfies AgentJobConfig
          : undefined;

      const updateData = {
        workerId:
          releasesWorkerResources
            ? null
            : body.workerId ?? existing.job.workerId ?? null,
        result:
          body.result === undefined
            ? normalizeJobResultPayload(existing.job.result)
            : normalizeJobResultPayload(body.result),
        errorMessage: body.errorMessage ?? null,
        errorType: body.errorType ?? null,
        retryCount: body.retryCount ?? null,
        availableAt,
        branchName:
          releasesWorkerResources
            ? null
            : body.branchName ?? existing.job.branchName ?? null,
        worktreePath: releasesWorkerResources ? null : body.worktreePath ?? null,
        prUrl: body.prUrl ?? existing.job.prUrl ?? null,
        prNumber: body.prNumber ?? existing.job.prNumber ?? null,
        commitSha: body.commitSha ?? existing.job.commitSha ?? null,
        cost: usageMetrics.cost,
        tokensUsed: usageMetrics.tokensUsed,
        sessionId: body.sessionId ?? undefined,
        config: usesClaimOwnership ? undefined : updatedConfig,
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
      };

      const updated = usesClaimOwnership
        ? await updateClaimedJobStatus(
            params.jobId,
            status,
            {
              workerId: body.workerId!,
              claimAttemptId: expectedClaimAttemptId!,
            },
            updateData,
            releasesWorkerResources
              ? {
                  ...(status === "paused"
                    ? { previousJobId: existing.job.id }
                    : {}),
                  ...(body.sequenceHighWater
                    ? { sequenceHighWater: body.sequenceHighWater }
                    : {}),
                }
              : undefined,
          )
        : await updateLegacyClaimedJobStatus(
            params.jobId,
            status,
            {
              workerId: body.workerId?.trim() || existing.job.workerId,
              expectedStatus: existing.job.status,
              expectedUpdatedAt: existing.job.updatedAt,
            },
            updateData,
          );

      if (!updated) {
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
      }

      if (
        "claimStatusOutcome" in updated &&
        updated.claimStatusOutcome === "idempotent-replay"
      ) {
        const { claimStatusOutcome: _claimStatusOutcome, ...publicUpdated } = updated;
        return successResponse(publicUpdated);
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
              wsConnectionManager.broadcastToWorkspace(orgId, {
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
              wsConnectionManager.broadcastToWorkspace(cleanupOrgId, {
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
              wsConnectionManager.broadcastToWorkspace(cleanupOrgId, {
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
            wsConnectionManager.broadcastToWorkspace(runningOrgId, {
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
          const notifOrgId = existing.job.workspaceId ?? await resolveOrgIdFromWorkItem(existing.workItem.id);
          if (notifOrgId) {
            const taskLabel = existing.workItem.taskId
              ? `${existing.workItem.taskId}: ${existing.workItem.title}`
              : existing.workItem.title;

            void upsertNotificationBySource({
              recipientUserId: existing.job.createdByUserId,
              workspaceId: notifOrgId,
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
              workspaceId: usageOrgId,
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
            existing.job.workspaceId ??
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
              workspaceId: memoryOrgId,
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
        expectedClaimAttemptId: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
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
        sequenceHighWater: t.Optional(
          t.Object({
            protocolVersion: t.Literal(2),
            jobLogs: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
            sessionEvents: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
            nativeEvents: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
          }),
        ),
      }),
    }
  )

  // Extend a current claim's disjoint durable sequence reservation before a
  // producer reaches its inclusive end. Receipt and job ownership are locked
  // and checked atomically in the database repository.
  //
  // Ported from cloud without the workerApiKey workspace-scope check
  // (canWorkerCredentialAccessWorkspace): that gate belongs to a separate
  // cloud-only feature (shared-runner workspace isolation) that does not
  // exist in community.
  .post(
    "/jobs/:jobId/sequence-reservations/:channel/ensure",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      try {
        return successResponse(
          await ensureClaimSequenceReservation({
            jobId: params.jobId,
            workerId: body.workerId,
            claimAttemptId: body.expectedClaimAttemptId,
            channel: params.channel,
            requiredThrough: body.requiredThrough,
          }),
        );
      } catch (error) {
        if (error instanceof ClaimSequenceReceiptConflictError) {
          set.status = 409;
          return errorResponse("Job claim is no longer active", 409);
        }
        throw error;
      }
    },
    {
      params: t.Object({
        jobId: t.String(),
        channel: t.Union([
          t.Literal("jobLogs"),
          t.Literal("sessionEvents"),
          t.Literal("nativeEvents"),
        ]),
      }),
      body: t.Object({
        workerId: t.String({ minLength: 1 }),
        expectedClaimAttemptId: t.String({ minLength: 1, maxLength: 100 }),
        requiredThrough: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
      }),
    },
  )

  // Freeze exact producer high-water marks and report whether every durable
  // row has reached the database. The runner must not release ownership until
  // this endpoint returns ready=true.
  //
  // Ported from cloud without the workerApiKey workspace-scope check (see
  // note above).
  .post(
    "/jobs/:jobId/sequence-handoff",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      try {
        const handoff = await prepareClaimSequenceHandoff({
          jobId: params.jobId,
          workerId: body.workerId,
          claimAttemptId: body.expectedClaimAttemptId,
          emittedThrough: body.emittedThrough,
        });
        if (!handoff.ready) {
          // A job that waited minutes here used to leave no trace at all, so
          // nobody could tell which channel was behind — or whether it was
          // moving. One line per unready poll makes the backlog visible.
          logger.debug(
            {
              jobId: params.jobId,
              workerId: body.workerId,
              inserted: handoff.insertedCount,
              expected: handoff.expectedCount,
            },
            "sequence handoff not ready",
          );
        }
        return successResponse(handoff);
      } catch (error) {
        if (error instanceof ClaimSequenceReceiptConflictError) {
          set.status = 409;
          return errorResponse("Job claim is no longer active", 409);
        }
        throw error;
      }
    },
    {
      params: t.Object({ jobId: t.String() }),
      body: t.Object({
        workerId: t.String({ minLength: 1 }),
        expectedClaimAttemptId: t.String({ minLength: 1, maxLength: 100 }),
        emittedThrough: t.Object({
          protocolVersion: t.Literal(2),
          jobLogs: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
          sessionEvents: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
          nativeEvents: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
        }),
      }),
    },
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

      const hasDurableClaim =
        typeof body.expectedClaimAttemptId === "string" &&
        body.expectedClaimAttemptId.trim().length > 0;
      if (
        !hasDurableClaim &&
        (!matchesCurrentClaimAttempt(existing.job.config, undefined) || body.workerId !== undefined)
      ) {
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
      }
      if (hasDurableClaim && !body.workerId) {
        set.status = 409;
        return errorResponse("Durable log batches require exact claim ownership", 409);
      }

      if (body.logs.length > MAX_LOG_BATCH_SIZE) {
        set.status = 400;
        return errorResponse(`logs batch exceeds max size (${MAX_LOG_BATCH_SIZE})`);
      }

      const workspaceId = existing.job.workspaceId;
      if (!workspaceId) {
        set.status = 400;
        return errorResponse("Job has no workspaceId");
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
          orgId: workspaceId,
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

      let inserted;
      try {
        inserted = hasDurableClaim
          ? await persistFencedAgentJobLogs({
              jobId: params.jobId,
              workerId: body.workerId!,
              claimAttemptId: body.expectedClaimAttemptId!,
              logs: preparedLogs,
            })
          : await persistReceiptFreeLegacyAgentJobLogs(preparedLogs);
      } catch (error) {
        if (error instanceof ClaimSequenceReceiptConflictError) {
          set.status = 409;
          return errorResponse("Job claim is no longer active", 409);
        }
        throw error;
      }

      // Broadcast inserted chunks via WebSocket (omit payload field to reduce traffic)
      if (inserted.length > 0) {
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
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
        workerId: t.Optional(t.String({ minLength: 1 })),
        expectedClaimAttemptId: t.Optional(
          t.String({ minLength: 1, maxLength: 100 }),
        ),
        logs: t.Array(
          t.Object({
            seq: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
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
  //
  // Ported from cloud without the workerApiKey workspace-scope check (see
  // the "sequence-reservations" endpoint comment above).
  .post(
    "/jobs/:jobId/stream",
    async ({ params, body, set }) => {
      // 1. Validate job exists and get planningSessionId
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const currentClaimAttemptId = getCurrentClaimAttemptId(existing.job.config);
      if (
        currentClaimAttemptId
          ? body.expectedClaimAttemptId !== currentClaimAttemptId ||
            body.workerId !== existing.job.workerId
          : body.expectedClaimAttemptId !== undefined ||
            body.workerId !== undefined
      ) {
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
      }

      const planningSessionId = existing.job.planningSessionId;
      if (!planningSessionId) {
        set.status = 400;
        return errorResponse("Job is not a planning job");
      }

      // 2. Resolve workspace for WS broadcast
      const orgId = await resolveOrgId(null, planningSessionId);
      if (!orgId) {
        set.status = 400;
        return errorResponse("Cannot resolve workspace for planning session");
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
        wsConnectionManager.broadcastToWorkspace(orgId, {
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
        workerId: t.Optional(t.String({ minLength: 1 })),
        expectedClaimAttemptId: t.Optional(
          t.String({ minLength: 1, maxLength: 100 }),
        ),
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
  //
  // Ported from cloud without the workerApiKey workspace-scope check (see the
  // "sequence-reservations" endpoint comment above) and without the
  // deadline_exceeded outcome (Shoutrz only — community's adapted
  // createFencedJobInteraction never returns it). Replaces the prior
  // two-step write (a separate updateJobStatus("waiting_for_input") before
  // createInteraction, with no atomicity between them) with one atomic
  // claim-fenced transition + insert.
  .post(
    "/jobs/:jobId/interactions",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.jobId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const currentClaimAttemptId = getCurrentClaimAttemptId(existing.job.config);
      if (
        currentClaimAttemptId
          ? body.expectedClaimAttemptId !== currentClaimAttemptId ||
            body.workerId !== existing.job.workerId
          : body.expectedClaimAttemptId !== undefined ||
            body.workerId !== undefined
      ) {
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
      }

      const expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        set.status = 400;
        return errorResponse("expiresAt must be a valid ISO date string");
      }

      const creation = await createFencedJobInteraction({
        agentJobId: params.jobId,
        workItemId: existing.job.workItemId ?? undefined,
        workerId: body.workerId,
        claimAttemptId: body.expectedClaimAttemptId,
        questionType: body.questionType,
        questionText: body.questionText,
        questionContext: (body.questionContext ?? null) as Record<string, unknown> | null,
        options: body.options ?? null,
        expiresAt,
        timeoutAction: body.timeoutAction ?? "fail",
        defaultAnswer: body.defaultAnswer ?? null,
      });
      if (creation.outcome !== "created") {
        if (creation.outcome === "not_found") {
          set.status = 404;
          return notFoundResponse("Agent job");
        }
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
      }
      const { interaction, job: updated } = creation;
      void broadcastStatusChanged(updated, {
        jobId: updated.id,
        status: updated.status,
        workItemId: updated.workItemId ?? null,
        planningSessionId: updated.planningSessionId ?? null,
      });

      // Broadcast to connected clients
      const orgId = await resolveOrgId(existing.job.workItemId ?? null, existing.job.planningSessionId ?? null);
      if (orgId) {
        wsConnectionManager.broadcastToWorkspace(orgId, {
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
        workerId: t.Optional(t.String({ minLength: 1 })),
        expectedClaimAttemptId: t.Optional(
          t.String({ minLength: 1, maxLength: 100 }),
        ),
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
        const workspaceId = query.workspaceId?.trim();
        if (!workspaceId) {
          // Worker-side quota guard is fail-open when org cannot be resolved.
          return successResponse({ allowed: true });
        }

        const availability = await checkQuotaAvailable(
          workspaceId,
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
        workspaceId: t.Optional(t.String()),
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
  // Security: filtered by the API key's workspace
  .get("/nightly-validation/configs", async ({ set, workerApiKey }) => {
    try {
      const allProjects = await getProjectsWithNightlyValidationEnabled();
      const filtered = allProjects.filter(
        (p) => p.workspaceId === workerApiKey!.workspaceId,
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
  // Security: the runner is instance infrastructure (like /workers/jobs/claim);
  // the config is resolved by id alone and its own workspaceId is what scopes
  // the candidate search, never the worker key's workspace.
  .get(
    "/backlog-drain-candidates",
    async ({ query, set }) => {
      const result = await getBacklogDrainCandidatesForConfigId(query.configId);

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
  // Security: the runner is instance infrastructure (like /workers/jobs/claim);
  // the config is resolved by id alone and its own workspaceId is what scopes
  // the candidate search, never the worker key's workspace.
  .get(
    "/dod-remediation-candidates",
    async ({ query, set }) => {
      const result = await getDodRemediationCandidatesForConfigId(query.configId);

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
  // Security: workspaceId comes from scheduledConfigId when provided (config
  // resolved by id alone, like /workers/jobs/claim); otherwise falls back to
  // the worker API key's workspace for runner builds that predate the param.
  .get(
    "/dod-review-candidates",
    async ({ query, set, workerApiKey }) => {
      const workspaceId = await resolveScheduledWorkerIdentity(
        workerApiKey!.workspaceId,
        query.scheduledConfigId,
      );
      if (!workspaceId) {
        set.status = 404;
        return errorResponse("Scheduled agent config not found", 404);
      }

      const maxActiveJobs = typeof query.maxActiveJobs === "number"
        ? Math.max(0, Math.floor(query.maxActiveJobs))
        : undefined;
      let effectiveLimit = query.limit;

      if (maxActiveJobs !== undefined) {
        const activeCount = await countActiveAgentJobsForLane({
          workspaceId,
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
        workspaceId,
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
        scheduledConfigId: t.Optional(t.String()),
      }),
    }
  )

  // POST /workers/release-integration/queue - Batch validating work items into release integration jobs
  // Security: workspaceId comes from scheduledConfigId when provided (config
  // resolved by id alone, like /workers/jobs/claim); otherwise falls back to
  // the worker API key's workspace for runner builds that predate the param.
  .post(
    "/release-integration/queue",
    async ({ query, set, workerApiKey }) => {
      const workspaceId = await resolveScheduledWorkerIdentity(
        workerApiKey!.workspaceId,
        query.scheduledConfigId,
      );
      if (!workspaceId) {
        set.status = 404;
        return errorResponse("Scheduled agent config not found", 404);
      }

      const maxActiveItems = typeof query.maxActiveItems === "number"
        ? Math.max(0, Math.floor(query.maxActiveItems))
        : undefined;
      const minAgeMinutes = typeof query.minAgeMinutes === "number"
        ? Math.max(0, Math.floor(query.minAgeMinutes))
        : undefined;
      let effectiveLimit = query.limit;

      const recoverableBatches = await getRecoverableReleaseBatchesWithoutActiveJob(
        workspaceId,
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
            workspaceId,
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
          workspaceId,
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
        workspaceId,
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
          workspaceId,
          first.repositoryId,
        );
        const active = openReleaseBatch ??
          await getActiveBatchForRepository(workspaceId, first.repositoryId);
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
          : await getNextReleaseNumber(workspaceId, first.repositoryId);
        const batch = activeWithItems ?? await createIntegrationBatch({
          workspaceId,
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
            workspaceId,
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
        scheduledConfigId: t.Optional(t.String()),
      }),
    }
  )

  // GET /workers/validation-candidates - Get work items ready for validation, grouped by root ancestor
  // Security: the scheduled-agent-config flow already sends the config's own
  // workspaceId here (needed for org-wide configs with no fixed projectId);
  // the runner is instance infrastructure, so honoring it is consistent with
  // /workers/jobs/claim. The nightly-scheduler flow only ever sends
  // projectId, so it keeps scoping to the worker key's own workspace.
  .get(
    "/validation-candidates",
    async ({ query, workerApiKey }) => {
      const candidates = await getValidationCandidates(
        query.workspaceId?.trim() || workerApiKey!.workspaceId,
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
        workspaceId: t.Optional(t.String()),
      }),
    }
  )

  // GET /workers/fix-candidates - Get work items ready for nightly fix (in Needs Fix column, < 2 attempts)
  // Security: see /workers/validation-candidates above — same fallback pattern.
  .get(
    "/fix-candidates",
    async ({ query, workerApiKey }) => {
      const candidates = await getFixCandidates(
        query.workspaceId?.trim() || workerApiKey!.workspaceId,
        query.projectId,
      );
      return successResponse(candidates);
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
        workspaceId: t.Optional(t.String()),
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

  // GET /workers/scheduled-demand — work that scheduled agents would pick up
  // right now but that nobody has enqueued, because dispatching requires a
  // runner. Lets the scaler boot one on real demand instead of keeping a warm
  // runner around, which is what MIN_RUNNERS=0 otherwise makes impossible.
  .get(
    "/scheduled-demand",
    async ({ set }) => {
      const demand = await getScheduledAgentDemand();
      set.status = 200;
      return successResponse(demand);
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
  // The token is scoped to a specific project and workspace.
  // Shared runners may have an API key from a different org, so we validate
  // project-org consistency instead of API key-org consistency.
  .post(
    "/session-token",
    async ({ body, set, workerApiKey }) => {
      // Validate that the project belongs to the requested workspace
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, body.projectId),
            eq(projects.workspaceId, body.workspaceId)
          )
        )
        .limit(1);
      if (!project) {
        set.status = 403;
        return errorResponse("Project does not belong to the specified workspace");
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
          jobDetail.job.workspaceId !== body.workspaceId ||
          jobDetail.job.projectId !== body.projectId
        ) {
          set.status = 403;
          return errorResponse("Job does not belong to the specified project/workspace");
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
        workspaceId: body.workspaceId,
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
        workspaceId: body.workspaceId,
        ...(actorUserId ? { userId: actorUserId } : {}),
      });
    },
    {
      body: t.Object({
        projectId: t.String(),
        workspaceId: t.String(),
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
        // Resolve workspaceId from the project
        const [project] = await db
          .select({ workspaceId: projects.workspaceId })
          .from(projects)
          .where(eq(projects.id, query.projectId))
          .limit(1);

        if (!project) {
          set.status = 404;
          return notFoundResponse("Project");
        }

        if (!project.workspaceId) {
          set.status = 400;
          return errorResponse("Project has no workspace");
        }

        const repos = await getRepositories(project.workspaceId, query.projectId);
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
  // The runner is shared instance infrastructure, not scoped to one workspace —
  // same trust boundary as /workers/jobs/claim, which already returns jobs from
  // any workspace. Each config carries its own workspaceId, and that value
  // (not the worker key's) is what flows into job creation and usage billing,
  // so filtering this list by the key's workspace only broke dispatch for
  // every other workspace's scheduled agents without buying any real isolation.
  .get("/scheduled-configs", async ({ set }) => {
    try {
      const allConfigs = await listEnabledScheduledAgentConfigs();
      return successResponse(allConfigs);
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
  //
  // Ported from cloud without the workerApiKey workspace-scope check (see the
  // "sequence-reservations" endpoint comment above). A batch must be either
  // fully durable.v2 (every event carries sequenceProtocolVersion +
  // claimAttemptId, routed through persistFencedSessionEvents) or fully
  // legacy-unclaimed (routed through persistReceiptFreeLegacySessionEvents,
  // isLegacyUnclaimedSequenceEvent / getCurrentClaimAttemptId ported
  // verbatim) — a mixed batch, or a batch that doesn't match the job's
  // current claim state, is rejected with 409 rather than silently
  // persisted through the old unconditional insertSessionEventsBatch.
  .post(
    "/agent-jobs/:id/session-events",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const hasDurableFields = body.events.some(
        (event) =>
          event.sequenceProtocolVersion !== undefined ||
          event.claimAttemptId !== undefined,
      );
      const isFullyDurable = body.events.every(
        (event) =>
          event.sequenceProtocolVersion === "durable.v2" &&
          typeof event.claimAttemptId === "string" &&
          event.claimAttemptId.trim().length > 0,
      );
      const isFullyLegacy = body.events.every((event) =>
        isLegacyUnclaimedSequenceEvent(existing.job.config, event),
      );
      if ((hasDurableFields && !isFullyDurable) || (!hasDurableFields && !isFullyLegacy)) {
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
      }

      const events = body.events.map((e) => ({
        agentJobId: params.id,
        planningSessionId: existing.job.planningSessionId ?? undefined,
        sequenceNum: e.sequenceNum,
        sequenceProtocolVersion: e.sequenceProtocolVersion,
        kind: e.kind,
        payload: e.payload as Record<string, unknown>,
        provider: e.provider ?? null,
      }));

      let inserted: number;
      try {
        inserted = isFullyDurable
          ? await persistFencedSessionEvents(
              events.map((event, index) => ({
                claimAttemptId: body.events[index]!.claimAttemptId!,
                event,
              })),
            )
          : await persistReceiptFreeLegacySessionEvents(events);
      } catch (error) {
        if (error instanceof ClaimSequenceReceiptConflictError) {
          set.status = 409;
          return errorResponse("Job claim is no longer active", 409);
        }
        throw error;
      }
      if (existing.job.planningSessionId) {
        await refreshCanonicalSessionProjection({
          planningSessionId: existing.job.planningSessionId,
          workspaceId: existing.job.workspaceId,
        }).catch((error) => {
          logger.warn(
            { jobId: params.id, error },
            "Failed to refresh canonical session projection after worker event persistence",
          );
        });
      }
      return successResponse({ inserted });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        events: t.Array(
          t.Object({
            sequenceNum: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
            sequenceProtocolVersion: t.Optional(t.Literal("durable.v2")),
            claimAttemptId: t.Optional(
              t.String({ minLength: 1, maxLength: 100 }),
            ),
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
      const workspaceId = existing.job.workspaceId ?? null;

      const expectedWorkItemIds = await resolveExpectedWorkItemIdsForCompletion(
        {
          rootWorkItemId,
          workspaceId,
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
  //
  // Ported from cloud without the workerApiKey workspace-scope check (see the
  // "sequence-reservations" endpoint comment above). Same fully-durable/
  // fully-legacy batch fencing as the session-events endpoint above.
  .post(
    "/agent-jobs/:id/native-events",
    async ({ params, body, set }) => {
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const hasDurableFields = body.events.some(
        (event) =>
          event.sequenceProtocolVersion !== undefined ||
          event.claimAttemptId !== undefined,
      );
      const isFullyDurable = body.events.every(
        (event) =>
          event.sequenceProtocolVersion === "durable.v2" &&
          typeof event.claimAttemptId === "string" &&
          event.claimAttemptId.trim().length > 0,
      );
      const isFullyLegacy = body.events.every((event) =>
        isLegacyUnclaimedSequenceEvent(existing.job.config, event),
      );
      if ((hasDurableFields && !isFullyDurable) || (!hasDurableFields && !isFullyLegacy)) {
        set.status = 409;
        return errorResponse("Job claim is no longer active", 409);
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

      let inserted: number;
      try {
        inserted = isFullyDurable
          ? await persistFencedNativeEvents(
              events.map((event, index) => ({
                claimAttemptId: body.events[index]!.claimAttemptId!,
                event,
              })),
            )
          : await persistReceiptFreeLegacyNativeEvents(events);
      } catch (error) {
        if (error instanceof ClaimSequenceReceiptConflictError) {
          set.status = 409;
          return errorResponse("Job claim is no longer active", 409);
        }
        throw error;
      }
      return successResponse({ inserted });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        events: t.Array(
          t.Object({
            sequenceNum: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
            sequenceProtocolVersion: t.Optional(t.Literal("durable.v2")),
            claimAttemptId: t.Optional(
              t.String({ minLength: 1, maxLength: 100 }),
            ),
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
