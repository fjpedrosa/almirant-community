import { db, type Database } from "../../client";
import { agentJobs, agentJobClaimSequenceReceipts, workItems, projects, boards, planningSessions, user, workerRegistrations, workspaceSettings, workspace, feedbackItems } from "../../schema";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, isNotNull, lte, or, sql, notInArray, count } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AgentJobConfig, AgentJobPendingTerminalIntent } from "../../schema/agent-jobs";
import {
  deriveRuntimeCapabilityIntent,
  getSkillMemoryMb,
  LEGACY_CLAIMABLE_CODING_AGENTS,
  resolveRequestedRuntimeSelection,
  RuntimeCapabilityIntentError,
  type ResolvedRuntimeSelection,
  type ResourceEstimate,
  type RuntimeEvidence,
} from "@almirant/shared";
import { logger, getCurrentTraceId } from "@almirant/config";
import { resolvePersistedJobTemplateFields } from "./job-template-resolution";
import { INTERNAL_SKILL_KEYS, type AgentRoutingEntry } from "../../schema/system-settings";
import { getSystemSettings } from "../admin/admin-settings.repository";
import {
  CLAIM_RECEIPT_CURRENT_JOB_STATUSES,
  MAX_DURABLE_SEQUENCE,
  calculateSequenceReservationEnd,
} from "./claim-sequence-receipt-repository";

// Aliased `user` join used by getJobById to resolve the human requester
// recorded in `agent_jobs.config.requestedByUserId` when the job's
// `created_by_user_id` is a bot identity (e.g. "auto-fix-bot").
const requestedUser = alias(user, "requested_user");

const INTERNAL_SKILL_SET = new Set<string>(INTERNAL_SKILL_KEYS);
const AGENT_ROUTING_CACHE_TTL_MS = 30_000;
let agentRoutingCache: {
  expiresAt: number;
  routing: Record<string, AgentRoutingEntry>;
} | null = null;

/**
 * Look up the per-skill override for one of Almirant's internal skills.
 * Falls back to no override (null) if the skill is not internal, the settings
 * row has no entry for it, or the settings lookup fails.
 */
const resolveInternalSkillRouting = async (
  skillName: string | null | undefined,
): Promise<AgentRoutingEntry | null> => {
  if (!skillName || !INTERNAL_SKILL_SET.has(skillName)) return null;

  const now = Date.now();
  if (!agentRoutingCache || agentRoutingCache.expiresAt <= now) {
    try {
      const settings = await getSystemSettings();
      agentRoutingCache = {
        expiresAt: now + AGENT_ROUTING_CACHE_TTL_MS,
        routing: settings.agentRouting ?? {},
      };
    } catch (error) {
      logger.warn(
        { error },
        "agent-routing: failed to load system_settings, using hardcoded defaults",
      );
      return null;
    }
  }

  return agentRoutingCache.routing[skillName] ?? null;
};

/**
 * Invalidate the in-memory agent-routing cache. Called by the admin settings
 * update path so config changes apply on the next `createJob` without waiting
 * for the TTL.
 */
export const invalidateAgentRoutingCache = (): void => {
  agentRoutingCache = null;
};

export type AgentJobStatus = "queued" | "running" | "finalizing" | "completed" | "incomplete" | "failed" | "cancelled" | "waiting_for_input" | "paused";
export type AgentJobType = "implementation" | "planning" | "review" | "validation" | "bug-fix" | "recording" | "prewarm" | "bug-analysis" | "scheduled" | "incident-analyze" | "feedback-triage" | "feedback-triage-batch" | "integration";
export type AgentProvider = "claude-code" | "codex" | "zipu" | "grok";
export type CodingAgent = NonNullable<AgentJobConfig["codingAgent"]>;
export type AiProvider = "anthropic" | "openai" | "google" | "zai" | "xai";

export type TriggerType = "event" | "scheduled" | "recovery";

const resolveResourceEstimateKey = (input: {
  jobType?: AgentJobType;
  resolvedSkillName?: string | null;
  resolvedPromptTemplate?: string | null;
  config?: AgentJobConfig | null;
}): string =>
  input.resolvedPromptTemplate?.trim() ||
  input.resolvedSkillName?.trim() ||
  input.config?.skillName?.trim() ||
  input.jobType ||
  "job";

const buildDefaultResourceEstimate = (input: {
  jobType?: AgentJobType;
  resolvedSkillName?: string | null;
  resolvedPromptTemplate?: string | null;
  config?: AgentJobConfig | null;
}): ResourceEstimate => {
  const estimateKey = resolveResourceEstimateKey(input);

  return {
    estimatedMemoryMb: getSkillMemoryMb(estimateKey),
    source: "skill-default",
    confidence: "low",
    reason: `Default ${estimateKey} estimate calculated at enqueue time`,
  };
};

const ensureResourceEstimate = (
  config: AgentJobConfig,
  input: {
    jobType?: AgentJobType;
    resolvedSkillName?: string | null;
    resolvedPromptTemplate?: string | null;
  },
): AgentJobConfig => {
  if (config.resourceEstimate) return config;

  return {
    ...config,
    resourceEstimate: buildDefaultResourceEstimate({
      ...input,
      config,
    }),
  };
};

const ACTIVE_AGENT_JOB_STATUSES: AgentJobStatus[] = ["queued", "running", "finalizing", "waiting_for_input", "paused"];
const EXECUTING_AGENT_JOB_STATUSES: AgentJobStatus[] = ["running", "finalizing"];

export type CreateAgentJobInput = {
  /** Optional server-preassigned id for durable dispatch-occurrence correlation. */
  id?: string;
  projectId?: string | null;
  workItemId?: string | null;
  boardId?: string | null;
  planningSessionId?: string | null;
  createdByUserId?: string | null;
  workspaceId?: string | null;
  jobType?: AgentJobType;
  provider: AgentProvider;
  priority?: "low" | "medium" | "high" | "urgent";
  config: AgentJobConfig;
  status?: AgentJobStatus;
  result?: unknown;
  completedAt?: Date | null;
  codingAgent?: CodingAgent;
  aiProvider?: AiProvider;
  model?: string;
  resolvedRuntimeSelection?: ResolvedRuntimeSelection | null;
  skillName?: string;
  // New model fields (prompt + trigger)
  prompt?: string | null;
  promptTemplate?: string | null;
  triggerType?: TriggerType;
  interactive?: boolean;
};

export interface CreateJobOptions {
  /** Join an existing transaction for durable plan-review admission. */
  executor?: Pick<Database, "insert">;
}

const RUNTIME_SELECTION_KEYS = [
  "schemaVersion",
  "registryVersion",
  "projectionHash",
  "provider",
  "codingAgent",
  "aiProvider",
  "model",
  "authClass",
  "capabilities",
  "provenance",
] as const;
const RUNTIME_SELECTION_PROVENANCE_KEYS = [
  "provider",
  "codingAgent",
  "aiProvider",
  "model",
  "authClass",
  "capabilities",
] as const;

const hasExactOwnKeys = (
  value: object,
  expectedKeys: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
};

const exactRuntimeStringArrayMatch = (
  left: readonly string[] | null | undefined,
  right: readonly string[],
): boolean =>
  Array.isArray(left) &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const resolvePersistedRuntimeSelection = (input: {
  provider: string;
  codingAgent: string;
  aiProvider: string;
  model: string;
  config: unknown;
  provided?: ResolvedRuntimeSelection | null;
}): ResolvedRuntimeSelection => {
  const intentResult = deriveRuntimeCapabilityIntent(input.config);
  if (!intentResult.ok) {
    throw new RuntimeCapabilityIntentError(intentResult.code, intentResult.field);
  }

  const resolution = resolveRequestedRuntimeSelection({
    provider: input.provider,
    codingAgent: input.codingAgent,
    aiProvider: input.aiProvider,
    model: input.model,
    authClass:
      intentResult.intent.authClass ?? input.provided?.authClass ?? "api_key",
    capabilities: intentResult.intent.capabilities,
  });
  if (!resolution.admitted) {
    throw new Error(
      `Invalid agent job runtime: ${resolution.code} (${input.codingAgent}/${input.aiProvider}/${input.model})`,
    );
  }

  if (!input.provided) return resolution.selection;
  const provided = input.provided;
  const expected = resolution.selection;
  const providedProvenance = provided.provenance;
  if (
    !hasExactOwnKeys(provided, RUNTIME_SELECTION_KEYS) ||
    !providedProvenance ||
    !hasExactOwnKeys(providedProvenance, RUNTIME_SELECTION_PROVENANCE_KEYS) ||
    provided.schemaVersion !== expected.schemaVersion ||
    provided.registryVersion !== expected.registryVersion ||
    provided.projectionHash !== expected.projectionHash ||
    provided.provider !== expected.provider ||
    provided.codingAgent !== expected.codingAgent ||
    provided.aiProvider !== expected.aiProvider ||
    provided.model !== expected.model ||
    provided.authClass !== expected.authClass ||
    !exactRuntimeStringArrayMatch(provided.capabilities, expected.capabilities) ||
    RUNTIME_SELECTION_PROVENANCE_KEYS.some(
      (field) => providedProvenance[field] !== expected.provenance[field],
    )
  ) {
    throw new Error(
      "Invalid agent job runtime: provided resolved selection does not exactly match the current registry, persisted columns, and derived intent",
    );
  }
  return provided;
};

export type AgentJobWithRelations = {
  job: typeof agentJobs.$inferSelect;
  workItem: Pick<typeof workItems.$inferSelect, "id" | "taskId" | "title" | "boardId" | "boardColumnId"> | null;
  project: Pick<typeof projects.$inferSelect, "id" | "name"> | null;
  board: Pick<typeof boards.$inferSelect, "id" | "name"> | null;
  planningSession: Pick<typeof planningSessions.$inferSelect, "id" | "title"> | null;
  feedbackItem: Pick<typeof feedbackItems.$inferSelect, "id" | "title"> | null;
  createdByUser: Pick<typeof user.$inferSelect, "id" | "name" | "image"> | null;
  requestedByUser: Pick<typeof user.$inferSelect, "id" | "name" | "image"> | null;
};

/**
 * Thrown by `createJob` when the INSERT collides with
 * `agent_jobs_work_item_job_type_active_uidx` (migration 0222, parity with
 * cloud 0236) -- i.e. another transaction already created an active job for
 * the same (work_item_id, job_type) pair. This guards the race between the
 * two dispatch authorities (the backend scheduled-agent-dispatcher tick,
 * flag-gated off by default, and the runner scheduler over /workers/*),
 * both of which read-then-write against an "active job exists" filter that
 * is not atomic with the INSERT.
 *
 * Callers must treat this as a benign "candidate skipped" outcome -- never
 * as an unexpected job-creation failure -- and continue processing the next
 * candidate.
 */
export class DuplicateActiveJobError extends Error {
  constructor(
    public readonly workItemId: string | null,
    public readonly jobType: string | null,
  ) {
    super(
      `An active job already exists for work_item_id=${workItemId ?? "null"} job_type=${jobType ?? "null"}`,
    );
    this.name = "DuplicateActiveJobError";
  }
}

const AGENT_JOBS_WORK_ITEM_JOB_TYPE_ACTIVE_UNIQUE_INDEX =
  "agent_jobs_work_item_job_type_active_uidx";

/**
 * Narrowed shape of a pg unique-violation error. Mirrors the pattern used in
 * `feedback-cluster-repository.ts`'s `getBugFixAttemptUniqueViolationKind` --
 * we only care about the SQLSTATE code and the constraint name.
 */
interface PgUniqueViolationError {
  code?: string;
  constraint_name?: string;
  cause?: unknown;
}

/**
 * True when `err` is a postgres 23505 unique-violation raised by
 * `agent_jobs_work_item_job_type_active_uidx`. Drizzle/postgres-js wrap
 * driver errors inconsistently across versions, so we probe both the raw
 * error and one level of `.cause` unwrap.
 */
const isDuplicateActiveJobViolation = (err: unknown): boolean => {
  const probe = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    const pg = candidate as PgUniqueViolationError;
    return (
      pg.code === "23505" &&
      pg.constraint_name === AGENT_JOBS_WORK_ITEM_JOB_TYPE_ACTIVE_UNIQUE_INDEX
    );
  };
  if (!err || typeof err !== "object") return false;
  if (probe(err)) return true;
  return probe((err as PgUniqueViolationError).cause);
};

export const createJob = async (
  input: CreateAgentJobInput,
  options: CreateJobOptions = {},
): Promise<typeof agentJobs.$inferSelect> => {
  const {
    prompt: resolvedPrompt,
    skillName: resolvedSkillName,
    promptTemplate: resolvedPromptTemplate,
  } = resolvePersistedJobTemplateFields(input);
  const resolvedJobType = input.jobType ?? "implementation";

  // Resolution order for codingAgent/aiProvider/model, narrowest first:
  //   1. explicit `input.*` passed by the caller
  //   2. admin-configured override in system_settings.agent_routing[skillName]
  //      (only for Almirant-internal skills — see INTERNAL_SKILL_KEYS)
  //   3. hardcoded default
  const routingOverride = await resolveInternalSkillRouting(resolvedSkillName);

  // When the routing override pins a specific provider connection, surface it
  // to the runner via config.providerConnectionId — the runner reads that
  // field to request the exact account's credentials from the backend
  // instead of falling through the org's default resolution order.
  const traceId = input.config.traceId ?? getCurrentTraceId();
  const configWithOverrides: AgentJobConfig = ensureResourceEstimate(
    {
      ...input.config,
      ...(traceId ? { traceId } : {}),
      ...(routingOverride?.providerConnectionId &&
      input.config.providerConnectionId === undefined
        ? { providerConnectionId: routingOverride.providerConnectionId }
        : {}),
    },
    {
      jobType: resolvedJobType,
      resolvedSkillName,
      resolvedPromptTemplate,
    },
  );

  const codingAgent =
    input.codingAgent ??
    ((routingOverride?.codingAgent ?? "claude-code") as CodingAgent);
  const aiProvider =
    input.aiProvider ??
    ((routingOverride?.aiProvider ?? "anthropic") as AiProvider);
  const model = input.model ?? routingOverride?.model ?? "claude-opus-4-8";
  const resolvedRuntimeSelection = resolvePersistedRuntimeSelection({
    provider: input.provider,
    codingAgent,
    aiProvider,
    model,
    config: configWithOverrides,
    provided: input.resolvedRuntimeSelection,
  });

  const jobValues = {
    ...(input.id ? { id: input.id } : {}),
    projectId: input.projectId ?? null,
    workItemId: input.workItemId ?? null,
    boardId: input.boardId ?? null,
    planningSessionId: input.planningSessionId ?? null,
    createdByUserId: input.createdByUserId ?? null,
    workspaceId: input.workspaceId ?? null,
    // Old model (kept for backward compat)
    jobType: resolvedJobType,
    skillName: resolvedSkillName,
    // New model (prompt + trigger)
    prompt: resolvedPrompt,
    promptTemplate: resolvedPromptTemplate,
    triggerType: (input.triggerType ?? "event") as "event" | "scheduled" | "recovery",
    interactive: input.interactive ?? resolvedJobType === "planning",
    // Common fields
    provider: input.provider,
    priority: input.priority ?? "medium",
    status: (input.status ?? "queued") as AgentJobStatus,
    ...(input.result !== undefined ? { result: input.result as never } : {}),
    ...(input.completedAt !== undefined
      ? { completedAt: input.completedAt }
      : input.status === "completed"
        ? { completedAt: new Date() }
        : {}),
    config: configWithOverrides,
    codingAgent,
    aiProvider,
    model,
    resolvedRuntimeSelection,
  };

  let created: typeof agentJobs.$inferSelect | undefined;
  try {
    [created] = await (options.executor ?? db).insert(agentJobs).values(jobValues).returning();
  } catch (error) {
    if (isDuplicateActiveJobViolation(error)) {
      throw new DuplicateActiveJobError(jobValues.workItemId, jobValues.jobType ?? null);
    }
    throw error;
  }

  if (!created) throw new Error("Failed to create agent job");
  return created;
};

export const createBatchJobs = async (
  jobs: CreateAgentJobInput[]
): Promise<typeof agentJobs.$inferSelect[]> => {
  if (jobs.length === 0) return [];

  const resolvedJobs = await Promise.all(
    jobs.map(async (j) => {
      const {
        prompt: resolvedPrompt,
        skillName: resolvedSkillName,
        promptTemplate: resolvedPromptTemplate,
      } = resolvePersistedJobTemplateFields(j);
      const jt = j.jobType ?? "implementation";
      const routingOverride = await resolveInternalSkillRouting(resolvedSkillName);
      const codingAgent =
        j.codingAgent ??
        ((routingOverride?.codingAgent ?? "claude-code") as CodingAgent);
      const aiProvider =
        j.aiProvider ??
        ((routingOverride?.aiProvider ?? "anthropic") as AiProvider);
      const model = j.model ?? routingOverride?.model ?? "claude-opus-4-8";
      const configWithOverrides: AgentJobConfig = ensureResourceEstimate(
        {
          ...j.config,
          ...(routingOverride?.providerConnectionId &&
          j.config.providerConnectionId === undefined
            ? { providerConnectionId: routingOverride.providerConnectionId }
            : {}),
        },
        {
          jobType: jt,
          resolvedSkillName,
          resolvedPromptTemplate,
        },
      );
      const resolvedRuntimeSelection = resolvePersistedRuntimeSelection({
        provider: j.provider,
        codingAgent,
        aiProvider,
        model,
        config: configWithOverrides,
        provided: j.resolvedRuntimeSelection,
      });
      return {
        projectId: j.projectId ?? null,
        workItemId: j.workItemId ?? null,
        boardId: j.boardId ?? null,
        planningSessionId: j.planningSessionId ?? null,
        createdByUserId: j.createdByUserId ?? null,
        workspaceId: j.workspaceId ?? null,
        jobType: jt,
        skillName: resolvedSkillName,
        prompt: resolvedPrompt,
        promptTemplate: resolvedPromptTemplate,
        triggerType: (j.triggerType ?? "event") as "event" | "scheduled" | "recovery",
        interactive: j.interactive ?? jt === "planning",
        provider: j.provider,
        priority: j.priority ?? "medium",
        status: "queued" as const,
        config: configWithOverrides,
        codingAgent,
        aiProvider,
        model,
        resolvedRuntimeSelection,
      };
    }),
  );

  return db.transaction(async (tx) => {
    const created = await tx
      .insert(agentJobs)
      .values(resolvedJobs)
      .returning();

    return created;
  });
};

export const getJobById = async (id: string): Promise<AgentJobWithRelations | null> => {
  const [row] = await db
    .select({
      job: agentJobs,
      workItem: {
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        boardId: workItems.boardId,
        boardColumnId: workItems.boardColumnId,
      },
      project: {
        id: projects.id,
        name: projects.name,
      },
      board: {
        id: boards.id,
        name: boards.name,
        area: boards.area,
      },
      planningSession: {
        id: planningSessions.id,
        title: planningSessions.title,
      },
      feedbackItem: {
        id: feedbackItems.id,
        title: feedbackItems.title,
      },
      createdByUser: {
        id: user.id,
        name: user.name,
        image: user.image,
      },
      requestedByUser: {
        id: requestedUser.id,
        name: requestedUser.name,
        image: requestedUser.image,
      },
    })
    .from(agentJobs)
    .leftJoin(workItems, eq(agentJobs.workItemId, workItems.id))
    .leftJoin(projects, eq(agentJobs.projectId, projects.id))
    .leftJoin(boards, eq(agentJobs.boardId, boards.id))
    .leftJoin(planningSessions, eq(agentJobs.planningSessionId, planningSessions.id))
    .leftJoin(
      feedbackItems,
      sql`${feedbackItems.id} = NULLIF(${agentJobs.config} ->> 'feedbackItemId', '')::uuid`
    )
    .leftJoin(user, eq(agentJobs.createdByUserId, user.id))
    .leftJoin(
      requestedUser,
      eq(requestedUser.id, sql`${agentJobs.config} ->> 'requestedByUserId'`)
    )
    .where(eq(agentJobs.id, id))
    .limit(1);

  if (!row) return null;

  return {
    job: row.job,
    workItem: row.workItem?.id ? row.workItem : null,
    project: row.project?.id ? row.project : null,
    board: row.board?.id ? row.board : null,
    planningSession: row.planningSession?.id ? row.planningSession : null,
    feedbackItem: row.feedbackItem?.id ? row.feedbackItem : null,
    createdByUser: row.createdByUser?.id ? row.createdByUser : null,
    requestedByUser: row.requestedByUser?.id ? row.requestedByUser : null,
  };
};

export const getJobsByWorkItem = async (
  workItemId: string
): Promise<typeof agentJobs.$inferSelect[]> => {
  return db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.workItemId, workItemId))
    .orderBy(desc(agentJobs.createdAt));
};

export type GetJobsByBoardFilters = {
  status?: AgentJobStatus;
  workItemId?: string;
  projectId?: string;
};

export const getJobsByBoard = async (
  boardId: string,
  filters?: GetJobsByBoardFilters
): Promise<typeof agentJobs.$inferSelect[]> => {
  const conditions = [eq(agentJobs.boardId, boardId)];

  if (filters?.status) conditions.push(eq(agentJobs.status, filters.status));
  if (filters?.workItemId) conditions.push(eq(agentJobs.workItemId, filters.workItemId));
  if (filters?.projectId) conditions.push(eq(agentJobs.projectId, filters.projectId));

  return db
    .select()
    .from(agentJobs)
    .where(and(...conditions))
    .orderBy(desc(agentJobs.createdAt));
};

export type ListAgentJobsFilters = {
  workspaceId: string;
  status?: AgentJobStatus | AgentJobStatus[];
  projectId?: string | string[];
  boardId?: string;
  workItemId?: string;
  taskId?: string;
  planningSessionId?: string;
  jobType?: AgentJobType | AgentJobType[];
  accessibleProjectIds?: string[];
};

type SingleOrMany<T extends string> = T | T[];

const toFilterArray = <T extends string>(value: SingleOrMany<T> | undefined): T[] => {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (item): item is T =>
      item !== undefined &&
      item !== null &&
      item !== "",
  );
};

export const listAgentJobs = async (
  pagination: { limit: number; offset: number },
  filters?: ListAgentJobsFilters
): Promise<{ jobs: typeof agentJobs.$inferSelect[]; total: number }> => {
  const conditions = [];

  if (filters?.workspaceId) conditions.push(eq(agentJobs.workspaceId, filters.workspaceId));
  const statusFilters = toFilterArray(filters?.status);
  if (statusFilters.length === 1) conditions.push(eq(agentJobs.status, statusFilters[0]!));
  if (statusFilters.length > 1) conditions.push(inArray(agentJobs.status, statusFilters));
  const projectIdFilters = toFilterArray(filters?.projectId);
  if (projectIdFilters.length === 1) conditions.push(eq(agentJobs.projectId, projectIdFilters[0]!));
  if (projectIdFilters.length > 1) conditions.push(inArray(agentJobs.projectId, projectIdFilters));
  if (filters?.boardId) conditions.push(eq(agentJobs.boardId, filters.boardId));
  if (filters?.workItemId) conditions.push(eq(agentJobs.workItemId, filters.workItemId));
  if (filters?.taskId) conditions.push(ilike(workItems.taskId, `%${filters.taskId}%`));
  if (filters?.planningSessionId) conditions.push(eq(agentJobs.planningSessionId, filters.planningSessionId));
  const jobTypeFilters = toFilterArray(filters?.jobType);
  if (jobTypeFilters.length === 1) conditions.push(eq(agentJobs.jobType, jobTypeFilters[0]!));
  if (jobTypeFilters.length > 1) conditions.push(inArray(agentJobs.jobType, jobTypeFilters));
  if (filters?.accessibleProjectIds) {
    if (filters.accessibleProjectIds.length === 0) {
      return { jobs: [], total: 0 };
    }
    conditions.push(
      or(
        inArray(agentJobs.projectId, filters.accessibleProjectIds),
        isNull(agentJobs.projectId)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select({ job: agentJobs })
      .from(agentJobs)
      .leftJoin(workItems, eq(agentJobs.workItemId, workItems.id))
      .where(whereClause)
      .orderBy(desc(agentJobs.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .then((result) => result.map((row) => row.job)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentJobs)
      .leftJoin(workItems, eq(agentJobs.workItemId, workItems.id))
      .where(whereClause),
  ]);

  return {
    jobs: rows,
    total: countResult[0]?.count ?? 0,
  };
};

/**
 * List agent jobs that failed within a recent time window.
 * Used by auto-debug-failed skill to find jobs to diagnose.
 */
export const listRecentFailedJobs = async (
  workspaceId: string,
  options?: {
    sinceMinutes?: number;
    limit?: number;
    projectId?: string;
  }
): Promise<(typeof agentJobs.$inferSelect)[]> => {
  const sinceMinutes = options?.sinceMinutes ?? 30;
  const limit = Math.min(options?.limit ?? 50, 100);
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

  const conditions = [
    eq(agentJobs.workspaceId, workspaceId),
    eq(agentJobs.status, "failed"),
    gte(agentJobs.failedAt, since),
  ];

  if (options?.projectId) {
    conditions.push(eq(agentJobs.projectId, options.projectId));
  }

  return db
    .select()
    .from(agentJobs)
    .where(and(...conditions))
    .orderBy(desc(agentJobs.failedAt))
    .limit(limit);
};

export const normalizeAgentJobResult = (
  result: unknown,
): Record<string, unknown> | null | undefined => {
  if (result === undefined) return undefined;
  if (result === null) return null;
  if (typeof result === "string") return { summary: result };
  if (typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { value: result };
};

export type UpdateJobStatusData = {
  result?: Record<string, unknown> | string | null;
  errorMessage?: string | null;
  errorType?: string | null;
  workerId?: string | null;
  retryCount?: number | null;
  maxRetries?: number | null;
  availableAt?: Date | null;
  branchName?: string | null;
  worktreePath?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  durationMs?: number | null;
  prUrl?: string | null;
  prNumber?: number | null;
  commitSha?: string | null;
  cost?: number | null;
  tokensUsed?: number | null;
  sessionId?: string | null;
  config?: AgentJobConfig;
  model?: string | null;
  runtimeEvidence?: RuntimeEvidence | null;
  cumulativeDurationMs?: number | null;
};

const buildJobStatusPatch = (
  status: AgentJobStatus,
  data?: UpdateJobStatusData
): Partial<typeof agentJobs.$inferInsert> => ({
  status,
  // Note: null clears the field; undefined leaves it unchanged.
  workerId: data?.workerId,
  result: normalizeAgentJobResult(data?.result) as never,
  errorMessage: data?.errorMessage,
  errorType: data?.errorType,
  retryCount: data?.retryCount ?? undefined,
  maxRetries: data?.maxRetries ?? undefined,
  availableAt: data?.availableAt,
  branchName: data?.branchName,
  worktreePath: data?.worktreePath,
  startedAt: data?.startedAt,
  completedAt: data?.completedAt,
  failedAt: data?.failedAt,
  durationMs: data?.durationMs ?? undefined,
  cumulativeDurationMs: data?.cumulativeDurationMs ?? undefined,
  prUrl: data?.prUrl,
  prNumber: data?.prNumber ?? undefined,
  commitSha: data?.commitSha,
  cost: data?.cost === undefined || data?.cost === null ? undefined : String(data.cost),
  tokensUsed: data?.tokensUsed ?? undefined,
  sessionId: data?.sessionId,
  config: data?.config,
  model: data?.model ?? undefined,
  runtimeEvidence: data?.runtimeEvidence,
  updatedAt: new Date(),
});

export const updateJobStatus = async (
  id: string,
  status: AgentJobStatus,
  data?: UpdateJobStatusData
): Promise<typeof agentJobs.$inferSelect | null> => {
  const patch = buildJobStatusPatch(status, data);

  const [updated] = await db
    .update(agentJobs)
    .set(patch)
    .where(eq(agentJobs.id, id))
    .returning();

  if (updated && (status === "cancelled" || status === "failed")) {
    await cascadeTerminalJobToBugFixAttempt(id, status);
  }

  return updated ?? null;
};

/**
 * When an agent_jobs row transitions to a terminal state — `cancelled`
 * (runner shutdown, explicit user cancel, internal sweeper) or `failed`
 * (stale-job recovery, timeout, quota/retry exhaustion, worker-reported
 * failure) — the linked bug_fix_attempt (if any) must transition to
 * `failed` right away. Without this cascade the attempt lingers in an
 * active status until the ~30-min zombie sweeper cleans it up, blocking
 * the feedback item from being re-triaged (and, before the sweeper was
 * wired in community, forever).
 *
 * Isolated as a fire-and-log helper so a DB hiccup on the cascade never
 * masks the job-status update itself.
 *
 * The bug-fix repository is imported lazily (not statically) on purpose:
 * it transitively pulls `feedback-cluster-repository` →
 * `work-item-repository`, and a static import would drag that whole graph
 * into every consumer of this module — including the SQL-mock suite
 * (`agent-job-repository.claim-sql.test.ts`), whose minimal drizzle mocks
 * cannot evaluate those modules and would poison bun's module cache for
 * the rest of the test run. The module is cached after the first call,
 * so the runtime cost is a one-time lookup.
 */
const cascadeTerminalJobToBugFixAttempt = async (
  jobId: string,
  terminalStatus: "cancelled" | "failed"
): Promise<void> => {
  try {
    const { failActiveAttemptForCancelledJob, failActiveAttemptForFailedJob } =
      await import("./bug-fix-attempt-repository");
    if (terminalStatus === "cancelled") {
      await failActiveAttemptForCancelledJob(jobId);
    } else {
      await failActiveAttemptForFailedJob(jobId);
    }
  } catch (err) {
    logger.warn(
      { err, jobId, terminalStatus, traceId: getCurrentTraceId() },
      "failed to cascade terminal job to bug_fix_attempts"
    );
  }
};

export type LegacyClaimOwnership = Readonly<{
  workerId: string | null;
  expectedStatus: AgentJobStatus;
  expectedUpdatedAt: Date;
}>;

/**
 * Receipt-free workers have no claim nonce, so their strongest safe fence is
 * the exact active row snapshot they observed plus worker ownership. This CAS
 * prevents a late legacy completion/failure from overwriting cancellation or
 * any newer row generation that won after the route/orchestrator pre-read.
 *
 * Ported from cloud (agent-job-repository.ts) without the site-build
 * execution-deadline branch: cloud races a `queued`/`paused` release against
 * `siteBuildJobExecutionWindowPredicate()` and downgrades to `failed` if the
 * deadline already passed. Community has no `site_build_runs` table (Shoutrz
 * only), so a fenced release here always applies the requested status.
 */
export const updateLegacyClaimedJobStatus = async (
  id: string,
  status: AgentJobStatus,
  ownership: LegacyClaimOwnership,
  data?: UpdateJobStatusData
): Promise<typeof agentJobs.$inferSelect | null> => {
  if (
    !ACTIVE_AGENT_JOB_STATUSES.includes(ownership.expectedStatus) ||
    Number.isNaN(ownership.expectedUpdatedAt.getTime()) ||
    (typeof ownership.workerId === "string" && !ownership.workerId.trim())
  ) {
    return null;
  }

  const [updated] = await db
    .update(agentJobs)
    .set(buildJobStatusPatch(status, data))
    .where(
      and(
        eq(agentJobs.id, id),
        eq(agentJobs.status, ownership.expectedStatus),
        eq(agentJobs.updatedAt, ownership.expectedUpdatedAt),
        ownership.workerId === null
          ? isNull(agentJobs.workerId)
          : eq(agentJobs.workerId, ownership.workerId),
        sql`COALESCE(${agentJobs.config} ->> 'claimAttemptId', '') = ''`,
        sql`${agentJobs.config} -> 'pendingTerminalIntent' IS NULL`
      )
    )
    .returning();

  if (updated && (updated.status === "cancelled" || updated.status === "failed")) {
    await cascadeTerminalJobToBugFixAttempt(id, updated.status);
  }

  return updated ?? null;
};

export type ClaimOwnership = Readonly<{
  workerId: string;
  claimAttemptId: string;
}>;

export type LiveAgentJobClaim = Readonly<{
  id: string;
  status: "running";
  workspaceId: string | null;
  workerId: string;
  config: AgentJobConfig;
}>;

type LiveAgentJobClaimDatabase = Pick<typeof db, "transaction">;

/** Hold the exact active claim under row lock while reading claim-bound data. */
export const withLiveAgentJobClaimWith = async <T>(
  database: LiveAgentJobClaimDatabase,
  ownership: Readonly<{
    jobId: string;
    workerId: string;
    claimAttemptId: string;
  }>,
  operation: (job: LiveAgentJobClaim) => Promise<T>,
): Promise<T | null> => {
  const jobId = ownership.jobId.trim();
  const workerId = ownership.workerId.trim();
  const claimAttemptId = ownership.claimAttemptId.trim();
  if (!jobId || !workerId || !claimAttemptId) return null;

  const claimPredicate = and(
    eq(agentJobClaimSequenceReceipts.jobId, jobId),
    eq(agentJobClaimSequenceReceipts.claimAttemptId, claimAttemptId),
    eq(agentJobClaimSequenceReceipts.workerId, workerId),
    eq(agentJobClaimSequenceReceipts.state, "active"),
    eq(agentJobs.id, jobId),
    eq(agentJobs.status, "running"),
    eq(agentJobs.workerId, workerId),
    sql`${agentJobs.config} ->> 'claimAttemptId' = ${claimAttemptId}`,
  );

  return database.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: agentJobs.id,
        status: agentJobs.status,
        workspaceId: agentJobs.workspaceId,
        workerId: agentJobs.workerId,
        config: agentJobs.config,
      })
      .from(agentJobClaimSequenceReceipts)
      .innerJoin(agentJobs, eq(agentJobs.id, agentJobClaimSequenceReceipts.jobId))
      .where(claimPredicate)
      .for("update")
      .limit(1);
    if (!locked || locked.status !== "running" || locked.workerId !== workerId) return null;

    const result = await operation({ ...locked, status: "running", workerId });

    const [stillAuthorized] = await tx
      .select({ id: agentJobs.id })
      .from(agentJobClaimSequenceReceipts)
      .innerJoin(agentJobs, eq(agentJobs.id, agentJobClaimSequenceReceipts.jobId))
      .where(claimPredicate)
      .limit(1);
    return stillAuthorized ? result : null;
  });
};

export const withLiveAgentJobClaim = <T>(
  ownership: Readonly<{
    jobId: string;
    workerId: string;
    claimAttemptId: string;
  }>,
  operation: (job: LiveAgentJobClaim) => Promise<T>,
): Promise<T | null> => withLiveAgentJobClaimWith(db, ownership, operation);

export type ClaimReleaseConfig = Readonly<{
  previousJobId?: string;
  sequenceHighWater?: NonNullable<AgentJobConfig["sequenceHighWater"]>;
}>;

export type ClaimedJobStatusUpdate = typeof agentJobs.$inferSelect & Readonly<{
  claimStatusOutcome?: "idempotent-replay";
}>;

const readPendingTerminalIntent = (
  config: AgentJobConfig | null | undefined
): AgentJobPendingTerminalIntent | null => {
  const value = config?.pendingTerminalIntent;
  if (
    !value ||
    (value.status !== "cancelled" && value.status !== "failed") ||
    typeof value.requestedAt !== "string" ||
    Number.isNaN(new Date(value.requestedAt).getTime())
  ) {
    return null;
  }
  return value;
};

const buildPendingTerminalIntent = (
  job: typeof agentJobs.$inferSelect,
  status: "cancelled" | "failed",
  data: UpdateJobStatusData | undefined,
  requestedAt: Date
): AgentJobPendingTerminalIntent => {
  const normalizedResult = normalizeAgentJobResult(data?.result);
  const currentSegmentMs = job.startedAt instanceof Date
    ? Math.max(0, requestedAt.getTime() - job.startedAt.getTime())
    : 0;
  const calculatedDurationMs = (job.cumulativeDurationMs ?? 0) + currentSegmentMs;
  const durationMs =
    typeof data?.durationMs === "number" && Number.isFinite(data.durationMs)
      ? Math.max(0, data.durationMs)
      : calculatedDurationMs > 0
        ? calculatedDurationMs
        : undefined;

  return {
    status,
    requestedAt: requestedAt.toISOString(),
    ...(normalizedResult && typeof normalizedResult === "object"
      ? { result: normalizedResult }
      : {}),
    ...(typeof data?.errorType === "string" ? { errorType: data.errorType } : {}),
    ...(typeof data?.errorMessage === "string"
      ? { errorMessage: data.errorMessage }
      : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
};

const pendingTerminalIntentData = (
  intent: AgentJobPendingTerminalIntent,
  fallback?: UpdateJobStatusData
): UpdateJobStatusData => {
  const requestedAt = new Date(intent.requestedAt);
  const fallbackResult = normalizeAgentJobResult(fallback?.result);
  const result = intent.result
    ? {
        ...(fallbackResult && typeof fallbackResult === "object" ? fallbackResult : {}),
        ...intent.result,
      }
    : fallbackResult;

  return {
    ...fallback,
    workerId: null,
    result,
    errorType: intent.errorType ?? fallback?.errorType,
    errorMessage: intent.errorMessage ?? fallback?.errorMessage,
    durationMs: intent.durationMs ?? fallback?.durationMs,
    completedAt: intent.status === "cancelled" ? requestedAt : fallback?.completedAt,
    failedAt: intent.status === "failed" ? requestedAt : fallback?.failedAt,
  };
};

const assertSequenceHighWater = (
  value: NonNullable<AgentJobConfig["sequenceHighWater"]>
): void => {
  if (
    value.protocolVersion !== 2 ||
    ![value.jobLogs, value.sessionEvents, value.nativeEvents].every(
      (item) => Number.isInteger(item) && item >= 0 && item <= MAX_DURABLE_SEQUENCE
    )
  ) {
    throw new Error("Invalid producer sequence high-water mark");
  }
};

/**
 * Update a runner-owned job only while the exact atomic claim attempt remains
 * current. Releases remove the nonce and merge sequence floors in the same SQL
 * statement, so a lost-response retry cannot mutate a later claim.
 *
 * Ported from cloud without the site-build execution-window CASE that can
 * downgrade a `queued`/`paused` release to `failed` (Shoutrz only, no
 * `site_build_runs` table in community): a fenced release here always applies
 * the requested status.
 */
export const updateClaimedJobStatus = async (
  id: string,
  status: AgentJobStatus,
  ownership: ClaimOwnership,
  data?: UpdateJobStatusData,
  releaseConfig?: ClaimReleaseConfig
): Promise<ClaimedJobStatusUpdate | null> => {
  if (!ownership.workerId.trim() || !ownership.claimAttemptId.trim()) {
    return null;
  }
  if ((status === "queued" || status === "paused") && !releaseConfig) {
    return null;
  }

  let patch = buildJobStatusPatch(status, data);
  if (releaseConfig) {
    let nextConfig = sql<AgentJobConfig>`(${agentJobs.config} - 'claimAttemptId')`;

    if (releaseConfig.previousJobId) {
      nextConfig = sql<AgentJobConfig>`jsonb_set(
        ${nextConfig},
        '{previousJobId}',
        to_jsonb(COALESCE(
          ${agentJobs.config} ->> 'previousJobId',
          ${releaseConfig.previousJobId}::text
        )),
        true
      )`;
    }

    if (releaseConfig.sequenceHighWater) {
      assertSequenceHighWater(releaseConfig.sequenceHighWater);
      const highWater = releaseConfig.sequenceHighWater;
      nextConfig = sql<AgentJobConfig>`jsonb_set(
        ${nextConfig},
        '{sequenceHighWater}',
        jsonb_build_object(
          'protocolVersion', 2,
          'jobLogs', GREATEST(
            ${highWater.jobLogs},
            CASE
              WHEN ${agentJobs.config} #>> '{sequenceHighWater,protocolVersion}' = '2'
                AND (${agentJobs.config} #>> '{sequenceHighWater,jobLogs}') ~ '^[0-9]{1,10}$'
              THEN CASE
                WHEN (${agentJobs.config} #>> '{sequenceHighWater,jobLogs}')::bigint <= 2147483647
                THEN (${agentJobs.config} #>> '{sequenceHighWater,jobLogs}')::int
                ELSE 0
              END
              ELSE 0
            END
          ),
          'sessionEvents', GREATEST(
            ${highWater.sessionEvents},
            CASE
              WHEN ${agentJobs.config} #>> '{sequenceHighWater,protocolVersion}' = '2'
                AND (${agentJobs.config} #>> '{sequenceHighWater,sessionEvents}') ~ '^[0-9]{1,10}$'
              THEN CASE
                WHEN (${agentJobs.config} #>> '{sequenceHighWater,sessionEvents}')::bigint <= 2147483647
                THEN (${agentJobs.config} #>> '{sequenceHighWater,sessionEvents}')::int
                ELSE 0
              END
              ELSE 0
            END
          ),
          'nativeEvents', GREATEST(
            ${highWater.nativeEvents},
            CASE
              WHEN ${agentJobs.config} #>> '{sequenceHighWater,protocolVersion}' = '2'
                AND (${agentJobs.config} #>> '{sequenceHighWater,nativeEvents}') ~ '^[0-9]{1,10}$'
              THEN CASE
                WHEN (${agentJobs.config} #>> '{sequenceHighWater,nativeEvents}')::bigint <= 2147483647
                THEN (${agentJobs.config} #>> '{sequenceHighWater,nativeEvents}')::int
                ELSE 0
              END
              ELSE 0
            END
          )
        ),
        true
      )`;
    }

    patch.config = nextConfig as never;
  }

  const requiresReadySequenceReceipt =
    releaseConfig !== undefined ||
    status === "completed" ||
    status === "incomplete" ||
    status === "failed" ||
    status === "cancelled";
  const requestsTerminalStatus =
    status === "completed" ||
    status === "incomplete" ||
    status === "failed" ||
    status === "cancelled";

  let updated: ClaimedJobStatusUpdate | null;
  if (requiresReadySequenceReceipt) {
    if (!releaseConfig) {
      // Terminal status clears ownership only after the exact receipt is ready.
      patch.workerId = null;
      patch.config = sql<AgentJobConfig>`(
        ${agentJobs.config} - 'claimAttemptId' - 'pendingTerminalIntent'
      )` as never;
    }

    updated = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          receipt: {
            state: agentJobClaimSequenceReceipts.state,
            jobLogs: agentJobClaimSequenceReceipts.jobLogEmittedThrough,
            sessionEvents: agentJobClaimSequenceReceipts.sessionEventEmittedThrough,
            nativeEvents: agentJobClaimSequenceReceipts.nativeEventEmittedThrough,
          },
          job: agentJobs,
        })
        .from(agentJobClaimSequenceReceipts)
        .innerJoin(agentJobs, eq(agentJobs.id, agentJobClaimSequenceReceipts.jobId))
        .where(
          and(
            eq(agentJobClaimSequenceReceipts.jobId, id),
            eq(agentJobClaimSequenceReceipts.claimAttemptId, ownership.claimAttemptId),
            eq(agentJobClaimSequenceReceipts.workerId, ownership.workerId)
          )
        )
        .for("update");

      if (!locked) return null;
      const { receipt, job } = locked;
      if (
        releaseConfig &&
        (!releaseConfig.sequenceHighWater ||
          receipt.jobLogs !== releaseConfig.sequenceHighWater.jobLogs ||
          receipt.sessionEvents !== releaseConfig.sequenceHighWater.sessionEvents ||
          receipt.nativeEvents !== releaseConfig.sequenceHighWater.nativeEvents)
      ) {
        return null;
      }

      if (
        (receipt.state === "released" && releaseConfig !== undefined) ||
        (receipt.state === "terminal" && requestsTerminalStatus)
      ) {
        return {
          ...job,
          claimStatusOutcome: "idempotent-replay" as const,
        };
      }

      const currentClaimAttemptId =
        typeof job.config?.claimAttemptId === "string"
          ? job.config.claimAttemptId.trim()
          : "";
      if (
        receipt.state !== "ready" ||
        !(CLAIM_RECEIPT_CURRENT_JOB_STATUSES as readonly AgentJobStatus[]).includes(
          job.status
        ) ||
        job.workerId !== ownership.workerId ||
        currentClaimAttemptId !== ownership.claimAttemptId
      ) {
        return null;
      }

      const pendingTerminalIntent = readPendingTerminalIntent(job.config);
      let finalizedReceiptState: "released" | "terminal" = releaseConfig
        ? "released"
        : "terminal";
      if (
        pendingTerminalIntent &&
        (releaseConfig !== undefined || requestsTerminalStatus)
      ) {
        patch = buildJobStatusPatch(
          pendingTerminalIntent.status,
          pendingTerminalIntentData(pendingTerminalIntent, data)
        );
        patch.config = sql<AgentJobConfig>`(
          ${agentJobs.config} - 'claimAttemptId' - 'pendingTerminalIntent'
        )` as never;
        finalizedReceiptState = "terminal";
      }

      const [statusUpdated] = await tx.update(agentJobs)
        .set(patch)
        .where(
          and(
            eq(agentJobs.id, id),
            inArray(agentJobs.status, CLAIM_RECEIPT_CURRENT_JOB_STATUSES),
            eq(agentJobs.workerId, ownership.workerId),
            sql`${agentJobs.config} ->> 'claimAttemptId' = ${ownership.claimAttemptId}`
          )
        )
        .returning();
      if (!statusUpdated) return null;

      await tx.update(agentJobClaimSequenceReceipts)
        .set({
          state: finalizedReceiptState,
          finalizedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentJobClaimSequenceReceipts.jobId, id),
            eq(agentJobClaimSequenceReceipts.claimAttemptId, ownership.claimAttemptId),
            eq(agentJobClaimSequenceReceipts.state, "ready")
          )
        );

      return statusUpdated;
    });
  } else {
    const [statusUpdated] = await db
      .update(agentJobs)
      .set(patch)
      .where(
        and(
          eq(agentJobs.id, id),
          inArray(agentJobs.status, CLAIM_RECEIPT_CURRENT_JOB_STATUSES),
          eq(agentJobs.workerId, ownership.workerId),
          sql`${agentJobs.config} ->> 'claimAttemptId' = ${ownership.claimAttemptId}`,
          sql`${agentJobs.config} -> 'pendingTerminalIntent' IS NULL`
        )
      )
      .returning();
    updated = statusUpdated ?? null;
  }

  if (
    updated &&
    updated.claimStatusOutcome !== "idempotent-replay" &&
    (updated.status === "cancelled" || updated.status === "failed")
  ) {
    await cascadeTerminalJobToBugFixAttempt(id, updated.status);
  }

  return updated;
};

/**
 * Request a terminal transition (`cancelled` | `failed`) while respecting an
 * in-flight durable claim: if the claim's sequence receipt is still
 * `active`/`draining`, the terminal request is held as `pendingTerminalIntent`
 * on a `finalizing` job instead of ripping the row out from under an
 * in-flight fenced write. `updateClaimedJobStatus` applies the held intent
 * once the receipt reaches `ready`. Receipt-free jobs keep the legacy
 * immediate terminal transition.
 *
 * Ported from cloud (agent-job-repository.ts) verbatim — this function has no
 * Shoutrz/site-build dependency.
 */
export const requestJobTerminalIntent = async (
  id: string,
  status: "cancelled" | "failed",
  data?: UpdateJobStatusData
): Promise<typeof agentJobs.$inferSelect | null> => {
  const requestedAt = new Date();
  const outcome = await db.transaction(async (tx) => {
    // Durable paths acquire receipt + job in the same order as persistence,
    // handoff and fenced status updates. This avoids a job→receipt lock
    // inversion while an ingress transaction holds receipt→job.
    const [claimed] = await tx
      .select({
        job: agentJobs,
        receipt: {
          state: agentJobClaimSequenceReceipts.state,
          workerId: agentJobClaimSequenceReceipts.workerId,
        },
      })
      .from(agentJobClaimSequenceReceipts)
      .innerJoin(agentJobs, eq(agentJobs.id, agentJobClaimSequenceReceipts.jobId))
      .where(
        and(
          eq(agentJobs.id, id),
          inArray(agentJobs.status, ACTIVE_AGENT_JOB_STATUSES),
          eq(agentJobClaimSequenceReceipts.workerId, agentJobs.workerId),
          sql`${agentJobClaimSequenceReceipts.claimAttemptId} = ${agentJobs.config} ->> 'claimAttemptId'`
        )
      )
      .for("update");

    let job: typeof agentJobs.$inferSelect;
    let receipt: Pick<
      typeof agentJobClaimSequenceReceipts.$inferSelect,
      "state" | "workerId"
    > | null = null;
    if (claimed) {
      job = claimed.job;
      receipt = claimed.receipt;
    } else {
      // Receipt-free jobs retain the legacy immediate terminal transition.
      // A row that does have a nonce but no matching receipt fails closed.
      const [locked] = await tx
        .select({ job: agentJobs })
        .from(agentJobs)
        .where(eq(agentJobs.id, id))
        .for("update");
      if (!locked || !ACTIVE_AGENT_JOB_STATUSES.includes(locked.job.status)) {
        return null;
      }
      const lockedClaimAttemptId =
        typeof locked.job.config?.claimAttemptId === "string"
          ? locked.job.config.claimAttemptId.trim()
          : "";
      if (lockedClaimAttemptId) return null;
      job = locked.job;
    }

    const existingIntent = readPendingTerminalIntent(job.config);
    const intent =
      existingIntent ??
      buildPendingTerminalIntent(job, status, data, requestedAt);
    const claimAttemptId =
      typeof job.config?.claimAttemptId === "string"
        ? job.config.claimAttemptId.trim()
        : "";

    const nextConfig = { ...job.config };
    delete nextConfig.claimAttemptId;
    delete nextConfig.pendingTerminalIntent;

    if (!claimAttemptId) {
      const [updated] = await tx
        .update(agentJobs)
        .set(buildJobStatusPatch(intent.status, {
          ...pendingTerminalIntentData(intent, data),
          config: nextConfig,
        }))
        .where(
          and(
            eq(agentJobs.id, id),
            inArray(agentJobs.status, ACTIVE_AGENT_JOB_STATUSES),
            sql`COALESCE(${agentJobs.config} ->> 'claimAttemptId', '') = ''`
          )
        )
        .returning();
      return updated
        ? { job: updated, terminalized: true as const }
        : null;
    }

    if (!receipt || !job.workerId || receipt.workerId !== job.workerId) return null;

    if (receipt.state === "active" || receipt.state === "draining") {
      const configWithIntent: AgentJobConfig = {
        ...job.config,
        pendingTerminalIntent: intent,
      };
      const [updated] = await tx
        .update(agentJobs)
        .set({
          status: "finalizing",
          config: configWithIntent,
          updatedAt: requestedAt,
        })
        .where(
          and(
            eq(agentJobs.id, id),
            inArray(agentJobs.status, ACTIVE_AGENT_JOB_STATUSES),
            eq(agentJobs.workerId, job.workerId),
            sql`${agentJobs.config} ->> 'claimAttemptId' = ${claimAttemptId}`
          )
        )
        .returning();
      return updated
        ? { job: updated, terminalized: false as const }
        : null;
    }

    if (receipt.state !== "ready") return null;
    const [updated] = await tx
      .update(agentJobs)
      .set(buildJobStatusPatch(intent.status, {
        ...pendingTerminalIntentData(intent, data),
        config: nextConfig,
      }))
      .where(
        and(
          eq(agentJobs.id, id),
          inArray(agentJobs.status, CLAIM_RECEIPT_CURRENT_JOB_STATUSES),
          eq(agentJobs.workerId, job.workerId),
          sql`${agentJobs.config} ->> 'claimAttemptId' = ${claimAttemptId}`
        )
      )
      .returning();
    if (!updated) return null;

    await tx
      .update(agentJobClaimSequenceReceipts)
      .set({
        state: "terminal",
        finalizedAt: requestedAt,
        updatedAt: requestedAt,
      })
      .where(
        and(
          eq(agentJobClaimSequenceReceipts.jobId, id),
          eq(agentJobClaimSequenceReceipts.claimAttemptId, claimAttemptId),
          eq(agentJobClaimSequenceReceipts.state, "ready")
        )
      );
    return { job: updated, terminalized: true as const };
  });

  if (!outcome) return null;
  if (outcome.terminalized) {
    await cascadeTerminalJobToBugFixAttempt(id, outcome.job.status as "cancelled" | "failed");
  }
  return outcome.job;
};

export const cancelJob = async (
  id: string,
  data?: UpdateJobStatusData
): Promise<typeof agentJobs.$inferSelect | null> =>
  requestJobTerminalIntent(id, "cancelled", data);

export const getActiveJobForWorkItem = async (
  workItemId: string
): Promise<typeof agentJobs.$inferSelect | null> => {
  const [row] = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.workItemId, workItemId),
        inArray(agentJobs.status, ACTIVE_AGENT_JOB_STATUSES)
      )
    )
    .orderBy(desc(agentJobs.createdAt))
    .limit(1);

  return row ?? null;
};

export const getRunningJobsForWorker = async (
  workerId: string
): Promise<typeof agentJobs.$inferSelect[]> => {
  return db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.workerId, workerId),
        inArray(agentJobs.status, EXECUTING_AGENT_JOB_STATUSES)
      )
    );
};

export const getActiveJobForPlanningSession = async (
  planningSessionId: string
): Promise<typeof agentJobs.$inferSelect | null> => {
  const [row] = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.planningSessionId, planningSessionId),
        inArray(agentJobs.status, ACTIVE_AGENT_JOB_STATUSES)
      )
    )
    .orderBy(desc(agentJobs.createdAt))
    .limit(1);

  return row ?? null;
};

export const hasAnyJobForPlanningSession = async (
  planningSessionId: string
): Promise<boolean> => {
  const [row] = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(eq(agentJobs.planningSessionId, planningSessionId))
    .limit(1);

  return !!row;
};

/**
 * Get the number of currently running jobs for a workspace.
 */
export const getOrgRunningJobCount = async (orgId: string): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.workspaceId, orgId),
        inArray(agentJobs.status, EXECUTING_AGENT_JOB_STATUSES)
      )
    );
  return row?.count ?? 0;
};

export type ClaimedJobRow = typeof agentJobs.$inferSelect & {
  estimatedMemoryMb: number | null;
  estimatedSubagents: number | null;
  childCount: number;
  /** Durable high-water marks captured atomically while the job row is claimed. */
  jobLogSequenceBase?: number;
  sessionEventSequenceBase?: number;
  nativeEventSequenceBase?: number;
  /** Inclusive ends of the claim's disjoint durable sequence reservations. */
  jobLogSequenceEnd?: number;
  sessionEventSequenceEnd?: number;
  nativeEventSequenceEnd?: number;
  claimAttemptId?: string;
};

export type ClaimJobsProtocol = Readonly<{
  durableSequenceReceipts: boolean;
}>;

export const claimJobs = async (
  workerId: string,
  count: number,
  acceptedCodingAgents?: readonly string[],
  protocol?: ClaimJobsProtocol
): Promise<ClaimedJobRow[]> => {
  const safeCount = Math.max(0, Math.min(count, 50));
  if (safeCount === 0) return [];

  const now = new Date().toISOString();
  const durableSequenceReceipts = protocol?.durableSequenceReceipts === true;

  return db.transaction(async (tx) => {
    // Lock the worker row to serialize concurrent claims for the same worker.
    // Without this, two overlapping transactions could both see runningCount=0
    // and each claim maxConcurrent jobs, exceeding the limit.
    await tx.execute(sql`
      SELECT id FROM worker_registrations WHERE worker_id = ${workerId} FOR UPDATE
    `);

    // Check how many running jobs this worker already has vs its max capacity.
    const capacityRows = (await tx.execute(sql`
      SELECT
        COALESCE(wr.max_concurrent_agents, 2) AS "maxConcurrent",
        COUNT(aj.id)::int AS "runningCount"
      FROM worker_registrations wr
      LEFT JOIN agent_jobs aj
        ON aj.worker_id = wr.worker_id
        AND aj.status IN ('running', 'finalizing')
      WHERE wr.worker_id = ${workerId}
      GROUP BY wr.max_concurrent_agents
    `)) as unknown as { maxConcurrent: number; runningCount: number }[];

    const capacity = capacityRows[0];
    const maxConcurrent = capacity?.maxConcurrent ?? 2;
    const runningCount = capacity?.runningCount ?? 0;
    const available = maxConcurrent - runningCount;

    if (available <= 0) return [];

    const actualCount = Math.min(safeCount, available);

    // Every claim is fenced by an effective coding-agent set. Direct legacy
    // callers that predate runner advertisement retain only the legacy three;
    // an explicitly empty effective set must fail closed rather than widen.
    const effectiveCodingAgents =
      acceptedCodingAgents ?? LEGACY_CLAIMABLE_CODING_AGENTS;
    const codingAgentFilter =
      effectiveCodingAgents.length > 0
        ? sql`AND aj.coding_agent::text = ANY(ARRAY[${sql.join(
            effectiveCodingAgents.map((codingAgent) => sql`${codingAgent}`),
            sql`, `,
          )}]::text[])`
        : sql`AND FALSE`;

    // Receipts rollout gate: while `durableSequenceReceipts` is off, exclude
    // jobs that already opted into the durable protocol (explicit requirement,
    // an existing receipt, or a persisted high-water mark) or already carry a
    // claim nonce — a legacy worker must never race a durable claimant onto
    // the same row. Ported from cloud minus the `siteBuildRunId` branch
    // (Shoutrz only, no equivalent column in community).
    const receiptCompatibilityFilter = durableSequenceReceipts
      ? sql``
      : sql`AND COALESCE(aj.config ->> 'sequenceProtocolRequirement', '') <> 'durable.v2.receipts'
          AND COALESCE(aj.config #>> '{sequenceHighWater,protocolVersion}', '') <> '2'
          AND COALESCE(aj.config ->> 'claimAttemptId', '') = ''
          AND NOT EXISTS (
            SELECT 1
            FROM agent_job_claim_sequence_receipts compatibility_receipt
            WHERE compatibility_receipt.job_id = aj.id
          )`;
    const claimAttemptIdExpression = durableSequenceReceipts
      ? sql`gen_random_uuid()::text`
      : sql`NULL::text`;
    const claimedConfigExpression = durableSequenceReceipts
      ? sql`jsonb_set(
          aj.config,
          '{claimAttemptId}',
          to_jsonb(p.claim_attempt_id),
          true
        )`
      : sql`aj.config`;

    // Raw SQL is required for FOR UPDATE SKIP LOCKED.
    // RETURNING * returns snake_case column names, so we select explicitly with camelCase aliases.
    // The picked CTE also excludes jobs from workspaces that have reached their
    // max_concurrent_jobs limit (from workspace_settings). A max_concurrent_jobs of 0
    // or NULL means no limit.
    //
    // A-1945: the picked CTE LEFT JOINs `work_item_effort_estimates` so we can
    //  - surface `estimated_memory_mb` / `estimated_subagents` for the runner, and
    //  - gate `runner-implement` / `runner-document` jobs on the estimate being
    //    present (or the job being older than 10 minutes — escape valve so the
    //    queue can never fully stall if the estimator is degraded).
    // The gate is guarded on two fronts:
    //  - it is skipped entirely when the estimator is disabled (no active
    //    effort_estimator_config); otherwise every gated job would wait out the
    //    10-minute escape when the feature is off.
    //  - skill_name / prompt_template are NULL-guarded because prompt-only
    //    (scheduled) jobs leave both NULL, and `NULL NOT IN (...)` = NULL in SQL.
    // The lock clause is narrowed to `FOR UPDATE OF aj SKIP LOCKED` so we only
    // lock `agent_jobs` rows; the estimates table stays unlocked and writers can
    // keep populating it without serializing against the claim path.
    //
    // Durable claims also compute each channel's sequence base atomically in
    // the same locked snapshot: GREATEST of the highest persisted row, the
    // highest prior receipt reservation end, and any producer high-water mark
    // fenced into the job by a same-job release. This guarantees a same-job
    // retry never reuses a sequence a previous execution already emitted.
    const rows = (await tx.execute(sql`
      WITH orgs_at_limit AS (
        SELECT os.workspace_id
        FROM workspace_settings os
        WHERE os.max_concurrent_jobs > 0
          AND (
            SELECT COUNT(*)
            FROM agent_jobs aj2
            WHERE aj2.workspace_id = os.workspace_id
              AND aj2.status IN ('running', 'finalizing')
          ) >= os.max_concurrent_jobs
      ),
      picked AS (
        SELECT
          aj.id,
          aj.work_item_id,
          ${claimAttemptIdExpression} AS claim_attempt_id,
          e.id AS estimate_id,
          e.estimated_memory_mb,
          e.estimated_subagents,
          GREATEST(
            COALESCE((
              SELECT MAX(ajl.seq)
              FROM agent_job_logs ajl
              WHERE ajl.job_id = aj.id
            ), 0)::int,
            COALESCE((
              SELECT MAX(receipts.job_log_sequence_end)
              FROM agent_job_claim_sequence_receipts receipts
              WHERE receipts.job_id = aj.id
            ), 0)::int,
            CASE
              WHEN aj.config #>> '{sequenceHighWater,protocolVersion}' = '2'
                AND (aj.config #>> '{sequenceHighWater,jobLogs}') ~ '^[0-9]{1,10}$'
              THEN CASE
                WHEN (aj.config #>> '{sequenceHighWater,jobLogs}')::bigint <= 2147483647
                THEN (aj.config #>> '{sequenceHighWater,jobLogs}')::int
                ELSE 0
              END
              ELSE 0
            END
          ) AS job_log_sequence_base,
          GREATEST(
            COALESCE((
              SELECT MAX(se.sequence_num)
              FROM session_events se
              WHERE se.agent_job_id = aj.id
            ), 0)::int,
            COALESCE((
              SELECT MAX(receipts.session_event_sequence_end)
              FROM agent_job_claim_sequence_receipts receipts
              WHERE receipts.job_id = aj.id
            ), 0)::int,
            CASE
              WHEN aj.config #>> '{sequenceHighWater,protocolVersion}' = '2'
                AND (aj.config #>> '{sequenceHighWater,sessionEvents}') ~ '^[0-9]{1,10}$'
              THEN CASE
                WHEN (aj.config #>> '{sequenceHighWater,sessionEvents}')::bigint <= 2147483647
                THEN (aj.config #>> '{sequenceHighWater,sessionEvents}')::int
                ELSE 0
              END
              ELSE 0
            END
          ) AS session_event_sequence_base,
          GREATEST(
            COALESCE((
              SELECT MAX(ane.sequence_num)
              FROM agent_native_events ane
              WHERE ane.agent_job_id = aj.id
            ), 0)::int,
            COALESCE((
              SELECT MAX(receipts.native_event_sequence_end)
              FROM agent_job_claim_sequence_receipts receipts
              WHERE receipts.job_id = aj.id
            ), 0)::int,
            CASE
              WHEN aj.config #>> '{sequenceHighWater,protocolVersion}' = '2'
                AND (aj.config #>> '{sequenceHighWater,nativeEvents}') ~ '^[0-9]{1,10}$'
              THEN CASE
                WHEN (aj.config #>> '{sequenceHighWater,nativeEvents}')::bigint <= 2147483647
                THEN (aj.config #>> '{sequenceHighWater,nativeEvents}')::int
                ELSE 0
              END
              ELSE 0
            END
          ) AS native_event_sequence_base
        FROM agent_jobs aj
        LEFT JOIN work_item_effort_estimates e ON e.work_item_id = aj.work_item_id
        WHERE aj.status = 'queued'
          ${receiptCompatibilityFilter}
          AND (aj.available_at IS NULL OR aj.available_at <= ${now})
          AND (
            aj.workspace_id IS NULL
            OR aj.workspace_id NOT IN (SELECT workspace_id FROM orgs_at_limit)
          )
          AND (
            -- CRITICAL: skip the estimate gate entirely when the estimator is
            -- disabled (no active effort_estimator_config — kill-switch or
            -- degraded estimator). With the estimator off no estimate rows are
            -- ever written, so gating would make every runner-implement/
            -- runner-document job wait out the 10-minute escape below — strictly
            -- worse than not gating at all.
            NOT EXISTS (
              SELECT 1 FROM effort_estimator_configs ec WHERE ec.is_active = true
            )
            -- NULL-guard skill_name / prompt_template (same pattern as the
            -- workspace_id guard above): both are NULL for prompt-only /
            -- scheduled jobs, and in SQL "NULL NOT IN (...)" evaluates to NULL
            -- (not TRUE), which would collapse the whole OR-chain to NULL and
            -- silently exclude the row until the 10-minute escape.
            OR (
              (aj.skill_name IS NULL OR aj.skill_name NOT IN ('runner-implement', 'runner-document'))
              AND (aj.prompt_template IS NULL OR aj.prompt_template NOT IN ('runner-implement', 'runner-document'))
            )
            OR e.id IS NOT NULL
            OR aj.created_at < NOW() - INTERVAL '10 minutes'
          )
          ${codingAgentFilter}
        ORDER BY aj.created_at ASC
        LIMIT ${actualCount}
        FOR UPDATE OF aj SKIP LOCKED
      )
      UPDATE agent_jobs aj
      SET status = 'running',
          worker_id = ${workerId},
          config = ${claimedConfigExpression},
          available_at = NULL,
          started_at = COALESCE(aj.started_at, ${now}::timestamptz),
          updated_at = ${now}::timestamptz
      FROM picked p
      WHERE aj.id = p.id
      RETURNING
        aj.id,
        aj.project_id AS "projectId",
        aj.work_item_id AS "workItemId",
        aj.board_id AS "boardId",
        aj.planning_session_id AS "planningSessionId",
        aj.created_by_user_id AS "createdByUserId",
        aj.workspace_id AS "workspaceId",
        aj.job_type AS "jobType",
        aj.status,
        aj.provider,
        aj.priority,
        aj.config,
        aj.result,
        aj.worker_id AS "workerId",
        aj.branch_name AS "branchName",
        aj.worktree_path AS "worktreePath",
        aj.retry_count AS "retryCount",
        aj.max_retries AS "maxRetries",
        aj.available_at AS "availableAt",
        aj.session_id AS "sessionId",
        aj.started_at AS "startedAt",
        aj.completed_at AS "completedAt",
        aj.failed_at AS "failedAt",
        aj.error_message AS "errorMessage",
        aj.error_type AS "errorType",
        aj.pr_url AS "prUrl",
        aj.pr_number AS "prNumber",
        aj.commit_sha AS "commitSha",
        aj.cost,
        aj.tokens_used AS "tokensUsed",
        aj.duration_ms AS "durationMs",
        aj.cumulative_duration_ms AS "cumulativeDurationMs",
        aj.created_at AS "createdAt",
        aj.updated_at AS "updatedAt",
        aj.coding_agent AS "codingAgent",
        aj.ai_provider AS "aiProvider",
        aj.model,
        aj.skill_name AS "skillName",
        aj.prompt,
        aj.prompt_template AS "promptTemplate",
        aj.trigger_type AS "triggerType",
        aj.interactive,
        p.estimated_memory_mb AS "estimatedMemoryMb",
        p.estimated_subagents AS "estimatedSubagents",
        p.job_log_sequence_base AS "jobLogSequenceBase",
        p.session_event_sequence_base AS "sessionEventSequenceBase",
        p.native_event_sequence_base AS "nativeEventSequenceBase",
        p.claim_attempt_id AS "claimAttemptId",
        (
          SELECT COUNT(*)::int
          FROM work_items wi
          WHERE wi.parent_id = aj.work_item_id
        ) AS "childCount"
    `)) as unknown as ClaimedJobRow[];

    const reservedRows: ClaimedJobRow[] = [];
    if (!durableSequenceReceipts) {
      for (const row of rows) {
        const {
          claimAttemptId: _claimAttemptId,
          jobLogSequenceBase: _jobLogSequenceBase,
          sessionEventSequenceBase: _sessionEventSequenceBase,
          nativeEventSequenceBase: _nativeEventSequenceBase,
          jobLogSequenceEnd: _jobLogSequenceEnd,
          sessionEventSequenceEnd: _sessionEventSequenceEnd,
          nativeEventSequenceEnd: _nativeEventSequenceEnd,
          ...legacyRow
        } = row;
        reservedRows.push(legacyRow as ClaimedJobRow);
      }
    } else {
      for (const row of rows) {
        if (
          row.jobLogSequenceBase === undefined ||
          row.sessionEventSequenceBase === undefined ||
          row.nativeEventSequenceBase === undefined ||
          !row.claimAttemptId ||
          row.jobLogSequenceBase >= MAX_DURABLE_SEQUENCE ||
          row.sessionEventSequenceBase >= MAX_DURABLE_SEQUENCE ||
          row.nativeEventSequenceBase >= MAX_DURABLE_SEQUENCE
        ) {
          throw new Error(`Durable sequence space exhausted for job ${row.id}`);
        }

        const jobLogSequenceEnd = calculateSequenceReservationEnd(
          row.jobLogSequenceBase,
          row.jobLogSequenceBase + 1
        );
        const sessionEventSequenceEnd = calculateSequenceReservationEnd(
          row.sessionEventSequenceBase,
          row.sessionEventSequenceBase + 1
        );
        const nativeEventSequenceEnd = calculateSequenceReservationEnd(
          row.nativeEventSequenceBase,
          row.nativeEventSequenceBase + 1
        );

        // The receipt insert shares the claim transaction. Any nonce collision
        // or schema failure rolls the job update back instead of exposing an
        // unfenced running claim.
        await tx.execute(sql`
          INSERT INTO agent_job_claim_sequence_receipts (
            job_id,
            claim_attempt_id,
            worker_id,
            state,
            job_log_sequence_start,
            job_log_sequence_end,
            session_event_sequence_start,
            session_event_sequence_end,
            native_event_sequence_start,
            native_event_sequence_end
          ) VALUES (
            ${row.id},
            ${row.claimAttemptId},
            ${workerId},
            'active',
            ${row.jobLogSequenceBase + 1},
            ${jobLogSequenceEnd},
            ${row.sessionEventSequenceBase + 1},
            ${sessionEventSequenceEnd},
            ${row.nativeEventSequenceBase + 1},
            ${nativeEventSequenceEnd}
          )
        `);

        reservedRows.push({
          ...row,
          jobLogSequenceEnd,
          sessionEventSequenceEnd,
          nativeEventSequenceEnd,
        });
      }
    }

    if (reservedRows.length < actualCount) {
      logger.debug(
        { workerId, requested: actualCount, claimed: reservedRows.length },
        "claimJobs: fewer jobs claimed than requested — some orgs may be at concurrency limit"
      );
    }

    // A-1945: emit a WARN for any runner-implement/runner-document job that
    // slipped through via the 10-minute escape (i.e. no estimate row). Runners
    // read this to apply fallback resource tiers instead of an oversized default.
    for (const row of reservedRows) {
      const skill = (row as unknown as { skillName: string | null }).skillName ?? null;
      const template = (row as unknown as { promptTemplate: string | null }).promptTemplate ?? null;
      const isGated =
        skill === "runner-implement" ||
        skill === "runner-document" ||
        template === "runner-implement" ||
        template === "runner-document";

      if (isGated && row.estimatedMemoryMb == null && row.estimatedSubagents == null) {
        logger.warn(
          {
            jobId: row.id,
            workItemId: row.workItemId,
            createdAt: row.createdAt,
          },
          "claimJobs: 10-minute estimate escape triggered — proceeding without estimate"
        );
      }
    }

    return reservedRows;
  });
};

export const getQueuedJobCount = async (): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.status, "queued"),
        sql`(${agentJobs.availableAt} IS NULL OR ${agentJobs.availableAt} <= NOW())`
      )
    );
  return row?.count ?? 0;
};

/**
 * Returns the count of jobs currently executing on workers (running/finalizing).
 * Used by the scaler to compute the desired total capacity.
 */
export const getExecutingJobCount = async (): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(agentJobs)
    .where(inArray(agentJobs.status, EXECUTING_AGENT_JOB_STATUSES));
  return row?.count ?? 0;
};

export const countActiveAgentJobsForLane = async (params: {
  workspaceId: string;
  projectId?: string | null;
  sources?: string[];
  skillNames?: string[];
  promptTemplates?: string[];
}): Promise<number> => {
  const conditions = [
    eq(agentJobs.workspaceId, params.workspaceId),
    inArray(agentJobs.status, ACTIVE_AGENT_JOB_STATUSES),
  ];

  if (params.projectId) {
    conditions.push(eq(agentJobs.projectId, params.projectId));
  }

  const laneConditions = [
    ...(params.sources ?? []).map((source) => sql`${agentJobs.config}->>'source' = ${source}`),
    ...((params.skillNames?.length ?? 0) > 0 ? [inArray(agentJobs.skillName, params.skillNames!)] : []),
    ...((params.promptTemplates?.length ?? 0) > 0 ? [inArray(agentJobs.promptTemplate, params.promptTemplates!)] : []),
  ];

  if (laneConditions.length > 0) {
    conditions.push(or(...laneConditions)!);
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(agentJobs)
    .where(and(...conditions));

  return Number(row?.count ?? 0);
};

/**
 * Returns the count of queued jobs grouped by coding_agent.
 * Used by the scaler to make per-pool scaling decisions.
 */
export const getQueuedJobCountByAgent = async (): Promise<Record<string, number>> => {
  const rows = await db
    .select({
      codingAgent: agentJobs.codingAgent,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.status, "queued"),
        sql`(${agentJobs.availableAt} IS NULL OR ${agentJobs.availableAt} <= NOW())`
      )
    )
    .groupBy(agentJobs.codingAgent);

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.codingAgent] = row.count;
  }
  return result;
};

export const getJobStats = async (
  workspaceId: string,
  projectId?: string
): Promise<Record<AgentJobStatus, number>> => {
  const conditions = [eq(agentJobs.workspaceId, workspaceId)];
  if (projectId) conditions.push(eq(agentJobs.projectId, projectId));

  const rows = await db
    .select({
      status: agentJobs.status,
      count: sql<number>`count(*)::int`,
    })
    .from(agentJobs)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(agentJobs.status)
    .orderBy(asc(agentJobs.status));

  const stats: Record<AgentJobStatus, number> = {
    queued: 0,
    running: 0,
    finalizing: 0,
    completed: 0,
    incomplete: 0,
    failed: 0,
    cancelled: 0,
    waiting_for_input: 0,
    paused: 0,
  };

  for (const r of rows) {
    stats[r.status as AgentJobStatus] = r.count;
  }

  return stats;
};

/**
 * Find work items that are stuck in AI processing state:
 * - isAiProcessing = true, OR
 * - metadata.aiReserved = true
 * but have NO active agent jobs (queued/running/waiting_for_input).
 * Optionally filter by workspaceId via project membership.
 */
export const getStuckAiWorkItems = async (
  workspaceId: string
): Promise<Array<{ id: string; isAiProcessing: boolean; metadata: Record<string, unknown> | null }>> => {
  // Subquery: work item IDs that DO have active jobs
  const activeJobWorkItemIds = db
    .select({ workItemId: agentJobs.workItemId })
    .from(agentJobs)
    .where(
      and(
        isNotNull(agentJobs.workItemId),
        inArray(agentJobs.status, ACTIVE_AGENT_JOB_STATUSES)
      )
    );

  const conditions = [
    or(
      eq(workItems.isAiProcessing, true),
      sql`(${workItems.metadata}->>'aiReserved')::boolean = true`
    ),
    sql`${workItems.id} NOT IN (${activeJobWorkItemIds})`,
  ];

  conditions.push(
    sql`${workItems.projectId} IN (
      SELECT id FROM projects WHERE workspace_id = ${workspaceId}
    )`
  );

  return db
    .select({
      id: workItems.id,
      isAiProcessing: workItems.isAiProcessing,
      metadata: workItems.metadata,
    })
    .from(workItems)
    .where(and(...conditions));
};

/**
 * Find an active prewarm job for a planning session.
 * A prewarm job is one with jobType = "prewarm" and an active status.
 */
export const getPrewarmJobForSession = async (
  planningSessionId: string
): Promise<typeof agentJobs.$inferSelect | null> => {
  const [row] = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.planningSessionId, planningSessionId),
        eq(agentJobs.jobType, "prewarm"),
        inArray(agentJobs.status, ["queued", "running", "finalizing", "paused"])
      )
    )
    .orderBy(desc(agentJobs.createdAt))
    .limit(1);

  return row ?? null;
};

/**
 * Convert a prewarm job into a real planning job by updating its type and config.
 */
export const convertPrewarmToPlanning = async (
  jobId: string,
  config: AgentJobConfig,
  overrides?: {
    provider?: "claude-code" | "codex" | "zipu" | "grok";
    codingAgent?: "claude-code" | "codex" | "opencode";
    model?: string;
    aiProvider?: "anthropic" | "openai" | "google" | "zai" | "xai";
    skillName?: string;
    prompt?: string | null;
    promptTemplate?: string | null;
    triggerType?: TriggerType;
    interactive?: boolean;
  },
): Promise<typeof agentJobs.$inferSelect | null> => {
  const resolvedSkillName =
    overrides?.skillName ??
    (typeof config.skillName === "string" ? config.skillName : "ideate");

  const [updated] = await db
    .update(agentJobs)
    .set({
      jobType: "planning",
      skillName: resolvedSkillName,
      prompt:
        overrides?.prompt !== undefined
          ? overrides.prompt
          : config.prompt ?? null,
      promptTemplate:
        overrides?.promptTemplate !== undefined
          ? overrides.promptTemplate
          : resolvedSkillName,
      triggerType: overrides?.triggerType ?? "event",
      interactive: overrides?.interactive ?? true,
      config,
      ...(overrides?.provider ? { provider: overrides.provider } : {}),
      ...(overrides?.codingAgent ? { codingAgent: overrides.codingAgent } : {}),
      ...(overrides?.model ? { model: overrides.model } : {}),
      ...(overrides?.aiProvider ? { aiProvider: overrides.aiProvider } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentJobs.id, jobId),
        eq(agentJobs.jobType, "prewarm")
      )
    )
    .returning();

  return updated ?? null;
};

// ── Admin cross-org listing ──────────────────────────────────────────

export type ListAdminAgentJobsFilters = {
  status?: AgentJobStatus;
  jobType?: AgentJobType;
  codingAgent?: CodingAgent;
  model?: string;
  workspaceId?: string;
  createdByUserId?: string;
  dateFrom?: string; // ISO date string
  dateTo?: string;   // ISO date string
};

export type AdminAgentJobRow = {
  job: typeof agentJobs.$inferSelect;
  workspaceName: string | null;
  createdByUserName: string | null;
  createdByUserImage: string | null;
  projectName: string | null;
  workItemTaskId: string | null;
  prompt: string | null;
};

export const listAdminAgentJobs = async (
  pagination: { limit: number; offset: number },
  filters?: ListAdminAgentJobsFilters,
): Promise<{ jobs: AdminAgentJobRow[]; total: number }> => {
  const conditions = [];

  if (filters?.status) conditions.push(eq(agentJobs.status, filters.status));
  if (filters?.jobType) conditions.push(eq(agentJobs.jobType, filters.jobType));
  if (filters?.codingAgent) conditions.push(eq(agentJobs.codingAgent, filters.codingAgent));
  if (filters?.model) conditions.push(eq(agentJobs.model, filters.model));
  if (filters?.workspaceId) conditions.push(eq(agentJobs.workspaceId, filters.workspaceId));
  if (filters?.createdByUserId) conditions.push(eq(agentJobs.createdByUserId, filters.createdByUserId));
  if (filters?.dateFrom) conditions.push(gte(agentJobs.createdAt, new Date(filters.dateFrom)));
  if (filters?.dateTo) conditions.push(lte(agentJobs.createdAt, new Date(filters.dateTo)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const selectFields = {
    job: agentJobs,
    workspaceName: workspace.name,
    createdByUserName: user.name,
    createdByUserImage: user.image,
    projectName: projects.name,
    workItemTaskId: workItems.taskId,
  };

  const baseQuery = db
    .select(selectFields)
    .from(agentJobs)
    .leftJoin(workspace, eq(agentJobs.workspaceId, workspace.id))
    .leftJoin(user, eq(agentJobs.createdByUserId, user.id))
    .leftJoin(projects, eq(agentJobs.projectId, projects.id))
    .leftJoin(workItems, eq(agentJobs.workItemId, workItems.id));

  const [rows, countResult] = await Promise.all([
    baseQuery
      .where(whereClause)
      .orderBy(desc(agentJobs.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentJobs)
      .where(whereClause),
  ]);

  const jobs: AdminAgentJobRow[] = rows.map((row) => ({
    job: row.job,
    workspaceName: row.workspaceName ?? null,
    createdByUserName: row.createdByUserName ?? null,
    createdByUserImage: row.createdByUserImage ?? null,
    projectName: row.projectName ?? null,
    workItemTaskId: row.workItemTaskId ?? null,
    prompt: (row.job.config as AgentJobConfig | null)?.userMessage ?? null,
  }));

  return {
    jobs,
    total: countResult[0]?.count ?? 0,
  };
};
