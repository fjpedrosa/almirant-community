import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../client";
import {
  agentJobs,
  boardColumns,
  projects,
  scheduledAgentConfigs,
  workItemDependencies,
  workItems,
} from "../../schema";
import type { ScheduledAgentConfigDb, TargetConfig } from "../../schema/scheduled-agent-configs";
import {
  selectBacklogDrainCandidates,
  type BacklogDrainActiveJobInput,
  type BacklogDrainCandidate,
  type BacklogDrainConfig,
  type BacklogDrainProjectRule,
  type BacklogDrainSelectionMode,
  type ProjectAgentDefaults,
} from "./backlog-drain-selection";

export interface BacklogDrainCandidateResult {
  candidates: BacklogDrainCandidate[];
  skipped: ReturnType<typeof selectBacklogDrainCandidates>["skipped"];
}

export interface BacklogDrainWorkItemTreeItem {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  parentId: string | null;
  projectId: string;
  boardId: string;
  columnRole: string | null;
  columnIsDone: boolean;
}

export interface BacklogDrainActiveJobScopeInput {
  jobType: string | null;
  skillName: string | null;
  promptTemplate: string | null;
  config: Record<string, unknown> | null;
}

const normalizeString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const MAX_AUTOMATED_DOD_REMEDIATION_ATTEMPTS = 3;

const hasHumanInterventionMetadata = (metadata: Record<string, unknown> | null): boolean => {
  return metadata?.dod_human_action_required === true
    || metadata?.dod_human_review_required === true
    || metadata?.dod_auto_remediation_blocked === true
    || metadata?.dod_external_validation_required === true;
};

export const countsForBacklogDrainConcurrency = (
  job: BacklogDrainActiveJobScopeInput,
  mode: BacklogDrainSelectionMode = "implementation",
): boolean => {
  const source = normalizeString(job.config?.source);
  const skillName = normalizeString(job.skillName ?? job.config?.skillName);
  const promptTemplate = normalizeString(job.promptTemplate);

  const isDodRemediationJob =
    source === "dod-remediation" ||
    skillName === "runner-fix-dod" ||
    promptTemplate === "runner-fix-dod";

  if (mode === "dod-remediation") {
    return isDodRemediationJob;
  }

  if (isDodRemediationJob) return false;
  return (
    job.jobType === "implementation" ||
    source === "backlog-drain" ||
    skillName === "runner-implement" ||
    promptTemplate === "runner-implement"
  );
};

export const isBacklogDrainTargetConfig = (
  targetConfig: TargetConfig | null | undefined,
): boolean => {
  const backlogDrain = (targetConfig as { backlogDrain?: BacklogDrainConfig } | null | undefined)?.backlogDrain;
  return backlogDrain?.enabled === true;
};

export const isDodRemediationTargetConfig = (
  targetConfig: TargetConfig | null | undefined,
): boolean => {
  const dodRemediation = (targetConfig as { dodRemediation?: BacklogDrainConfig } | null | undefined)?.dodRemediation;
  return dodRemediation?.enabled === true;
};

const resolveBacklogStyleRules = (
  config: Pick<ScheduledAgentConfigDb, "projectId" | "targetConfig">,
  targetKey: "backlogDrain" | "dodRemediation",
): {
  rules: BacklogDrainProjectRule[];
  defaultMaxConcurrentJobs?: number | null;
  minAgeMinutes?: number | null;
  allProjects: boolean;
} => {
  const target = (config.targetConfig as Record<string, BacklogDrainConfig | undefined> | null | undefined)?.[targetKey];
  if (!target?.enabled) return { rules: [], allProjects: false };

  const explicitRules = (target.projects ?? []).filter((rule) => rule.projectId);
  if (explicitRules.length > 0) {
    return {
      rules: explicitRules,
      defaultMaxConcurrentJobs: target.defaultMaxConcurrentJobs,
      minAgeMinutes: target.minAgeMinutes,
      allProjects: false,
    };
  }

  if (!config.projectId) {
    return {
      rules: [],
      defaultMaxConcurrentJobs: target.defaultMaxConcurrentJobs,
      minAgeMinutes: target.minAgeMinutes,
      allProjects: true,
    };
  }
  return {
    rules: [{ projectId: config.projectId, enabled: true, maxConcurrentJobs: target.defaultMaxConcurrentJobs ?? null }],
    defaultMaxConcurrentJobs: target.defaultMaxConcurrentJobs,
    minAgeMinutes: target.minAgeMinutes,
    allProjects: false,
  };
};

export const resolveBacklogDrainRules = (
  config: Pick<ScheduledAgentConfigDb, "projectId" | "targetConfig">,
): {
  rules: BacklogDrainProjectRule[];
  defaultMaxConcurrentJobs?: number | null;
  minAgeMinutes?: number | null;
  allProjects: boolean;
} => {
  return resolveBacklogStyleRules(config, "backlogDrain");
};

export const resolveDodRemediationRules = (
  config: Pick<ScheduledAgentConfigDb, "projectId" | "targetConfig">,
): {
  rules: BacklogDrainProjectRule[];
  defaultMaxConcurrentJobs?: number | null;
  minAgeMinutes?: number | null;
  allProjects: boolean;
} => {
  return resolveBacklogStyleRules(config, "dodRemediation");
};

const emptyCandidateResult = (): BacklogDrainCandidateResult => ({
  candidates: [],
  skipped: {
    excluded: [],
    blocked: [],
    active: [],
    concurrency: [],
    recentlyModified: [],
    dodIncomplete: [],
    notDodRemediation: [],
    missingDodReport: [],
    humanReviewRequired: [],
  },
});

const markRepeatedDodRemediationAttemptsForHumanIntervention = async (
  rows: Array<{
    id: string;
    taskId: string | null;
    boardId: string | null;
    columnRole: string | null;
    metadata: Record<string, unknown> | null;
    dodRemediationAttemptCount: number;
  }>,
): Promise<void> => {
  const now = new Date();

  // Resolve "review" board columns lazily, once per affected board, so we can
  // pull tasks out of Backlog when no automated agent will retry them. Leaving
  // them in Backlog buries them under tasks that are still being worked on, so
  // the human reviewer never sees that they need attention.
  const reviewColumnByBoardId = new Map<string, string | null>();
  const resolveReviewColumnId = async (boardId: string): Promise<string | null> => {
    const cached = reviewColumnByBoardId.get(boardId);
    if (cached !== undefined) return cached;
    const [column] = await db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(and(eq(boardColumns.boardId, boardId), eq(boardColumns.role, "review")))
      .limit(1);
    const id = column?.id ?? null;
    reviewColumnByBoardId.set(boardId, id);
    return id;
  };

  for (const row of rows) {
    if (row.dodRemediationAttemptCount <= MAX_AUTOMATED_DOD_REMEDIATION_ATTEMPTS) continue;
    if (hasHumanInterventionMetadata(row.metadata)) continue;

    const taskLabel = row.taskId ?? row.id;
    const message =
      `Automated DoD remediation has already run ${row.dodRemediationAttemptCount} times for ${taskLabel}. Human intervention is required before retrying.`;
    const patch = JSON.stringify({
      dod_human_action_required: true,
      dod_human_review_required: true,
      dod_auto_remediation_blocked: true,
      dod_human_action: message,
      dod_human_review_reason: message,
      dod_remediation_attempt_count: row.dodRemediationAttemptCount,
    });

    const reviewColumnId = row.boardId && row.columnRole === "backlog"
      ? await resolveReviewColumnId(row.boardId)
      : null;

    await db
      .update(workItems)
      .set({
        metadata: sql`coalesce(${workItems.metadata}, '{}') || ${patch}::jsonb`,
        updatedAt: now,
        ...(reviewColumnId ? { boardColumnId: reviewColumnId } : {}),
      })
      .where(eq(workItems.id, row.id));
  }
};

const selectBacklogDrainForOrganization = async (params: {
  organizationId: string;
  mode?: BacklogDrainSelectionMode;
  rules: BacklogDrainProjectRule[];
  allProjects?: boolean;
  defaultMaxConcurrentJobs?: number | null;
  minAgeMinutes?: number | null;
  fallbackRuntime?: {
    provider?: string | null;
    codingAgent?: string | null;
    aiProvider?: string | null;
    model?: string | null;
    reasoningLevel?: string | null;
  };
}): Promise<BacklogDrainCandidateResult> => {
  if (params.rules.length === 0 && !params.allProjects) return emptyCandidateResult();
  const requestedProjectIds = Array.from(new Set(params.rules.map((rule) => rule.projectId)));
  const projectConditions = [eq(projects.organizationId, params.organizationId)];
  if (!params.allProjects) {
    if (requestedProjectIds.length === 0) return emptyCandidateResult();
    projectConditions.push(inArray(projects.id, requestedProjectIds));
  }

  const projectRows = await db
    .select({
      id: projects.id,
      agentDefaults: projects.agentDefaults,
    })
    .from(projects)
    .where(and(...projectConditions));

  const effectiveRules = params.rules.length > 0
    ? params.rules
    : projectRows.map((project) => ({
        projectId: project.id,
        enabled: true,
        maxConcurrentJobs: params.defaultMaxConcurrentJobs ?? null,
      }));

  const projectIds = Array.from(new Set(effectiveRules.map((rule) => rule.projectId)));
  if (projectIds.length === 0) return emptyCandidateResult();
  const stabilizationWindowMs =
    typeof params.minAgeMinutes === "number" && Number.isFinite(params.minAgeMinutes)
      ? Math.max(0, params.minAgeMinutes) * 60_000
      : undefined;

  const [itemRows, dependencyRows, activeJobRows, dodRemediationAttemptRows] = await Promise.all([
    db
      .select({
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        parentId: workItems.parentId,
        projectId: workItems.projectId,
        boardId: workItems.boardId,
        position: workItems.position,
        columnRole: boardColumns.role,
        columnIsDone: boardColumns.isDone,
        columnOrder: boardColumns.order,
        updatedAt: workItems.updatedAt,
        codingAgent: workItems.codingAgent,
        aiModel: workItems.aiModel,
        metadata: workItems.metadata,
      })
      .from(workItems)
      .innerJoin(projects, eq(workItems.projectId, projects.id))
      .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(
        and(
          eq(projects.organizationId, params.organizationId),
          inArray(workItems.projectId, projectIds),
          isNull(workItems.archivedAt),
        ),
      ),
    db
      .select({
        workItemId: workItemDependencies.workItemId,
        blockedByWorkItemId: workItemDependencies.blockedByWorkItemId,
      })
      .from(workItemDependencies)
      .innerJoin(workItems, eq(workItemDependencies.workItemId, workItems.id))
      .innerJoin(projects, eq(workItems.projectId, projects.id))
      .where(and(eq(projects.organizationId, params.organizationId), inArray(workItems.projectId, projectIds))),
    db
      .select({
        projectId: agentJobs.projectId,
        workItemId: agentJobs.workItemId,
        jobType: agentJobs.jobType,
        skillName: agentJobs.skillName,
        promptTemplate: agentJobs.promptTemplate,
        config: agentJobs.config,
      })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.organizationId, params.organizationId),
          inArray(agentJobs.projectId, projectIds),
          sql`${agentJobs.status} IN ('queued', 'running', 'finalizing', 'waiting_for_input', 'paused')`,
        ),
      ),
    params.mode === "dod-remediation"
      ? db
          .select({
            workItemId: agentJobs.workItemId,
            attemptCount: sql<number>`COUNT(*)::int`,
          })
          .from(agentJobs)
          .where(
            and(
              eq(agentJobs.organizationId, params.organizationId),
              inArray(agentJobs.projectId, projectIds),
              sql`${agentJobs.workItemId} IS NOT NULL`,
              sql`${agentJobs.status} IN ('completed', 'incomplete', 'failed', 'cancelled')`,
              sql`(
                ${agentJobs.config} ->> 'source' = 'dod-remediation'
                OR ${agentJobs.skillName} = 'runner-fix-dod'
                OR ${agentJobs.promptTemplate} = 'runner-fix-dod'
              )`,
            ),
          )
          .groupBy(agentJobs.workItemId)
      : Promise.resolve([]),
  ]);

  const dodRemediationAttemptCountByWorkItemId = new Map(
    dodRemediationAttemptRows
      .filter((row): row is typeof row & { workItemId: string } => typeof row.workItemId === "string")
      .map((row) => [row.workItemId, Number(row.attemptCount) || 0]),
  );

  const itemRowsWithDodRemediationAttempts = itemRows
    .filter((item): item is typeof item & { projectId: string } => typeof item.projectId === "string")
    .map((item) => ({
      ...item,
      projectId: item.projectId,
      metadata: item.metadata as Record<string, unknown> | null,
      dodRemediationAttemptCount: dodRemediationAttemptCountByWorkItemId.get(item.id) ?? 0,
    }));

  if (params.mode === "dod-remediation") {
    await markRepeatedDodRemediationAttemptsForHumanIntervention(
      itemRowsWithDodRemediationAttempts.map((item) => ({
        id: item.id,
        taskId: item.taskId,
        boardId: item.boardId,
        columnRole: item.columnRole,
        metadata: item.metadata,
        dodRemediationAttemptCount: item.dodRemediationAttemptCount,
      })),
    );
  }

  const activeJobs: BacklogDrainActiveJobInput[] = activeJobRows.map((job) => ({
    projectId: job.projectId,
    workItemId: job.workItemId,
    countsForConcurrency: countsForBacklogDrainConcurrency(
      {
        jobType: job.jobType,
        skillName: job.skillName,
        promptTemplate: job.promptTemplate,
        config: job.config as unknown as Record<string, unknown> | null,
      },
      params.mode,
    ),
  }));

  return selectBacklogDrainCandidates({
    mode: params.mode,
    rules: effectiveRules,
    defaultMaxConcurrentJobs: params.defaultMaxConcurrentJobs,
    stabilizationWindowMs,
    projects: projectRows.map((project) => ({
      id: project.id,
      agentDefaults: project.agentDefaults as ProjectAgentDefaults | null,
    })),
    workItems: itemRowsWithDodRemediationAttempts
      .map((item) => ({
        ...item,
        projectId: item.projectId,
        columnIsDone: item.columnIsDone ?? false,
        columnOrder: item.columnOrder ?? null,
      })),
    dependencies: dependencyRows,
    activeJobs,
    fallbackRuntime: {
      provider: params.fallbackRuntime?.provider as never,
      codingAgent: params.fallbackRuntime?.codingAgent as never,
      aiProvider: params.fallbackRuntime?.aiProvider as never,
      model: params.fallbackRuntime?.model ?? null,
      reasoningLevel: params.fallbackRuntime?.reasoningLevel ?? null,
    },
  });
};

export const getBacklogDrainCandidatesForScheduledConfig = async (
  config: ScheduledAgentConfigDb,
): Promise<BacklogDrainCandidateResult> => {
  const { rules, allProjects, defaultMaxConcurrentJobs, minAgeMinutes } = resolveBacklogDrainRules(config);
  return selectBacklogDrainForOrganization({
    organizationId: config.organizationId,
    mode: "implementation",
    rules,
    allProjects,
    defaultMaxConcurrentJobs,
    minAgeMinutes,
    fallbackRuntime: {
      provider: config.provider,
      codingAgent: config.codingAgent,
      aiProvider: config.aiProvider,
      model: config.aiModel,
      reasoningLevel: config.reasoningLevel,
    },
  });
};

export const getDodRemediationCandidatesForScheduledConfig = async (
  config: ScheduledAgentConfigDb,
): Promise<BacklogDrainCandidateResult> => {
  const { rules, allProjects, defaultMaxConcurrentJobs, minAgeMinutes } = resolveDodRemediationRules(config);
  return selectBacklogDrainForOrganization({
    organizationId: config.organizationId,
    mode: "dod-remediation",
    rules,
    allProjects,
    defaultMaxConcurrentJobs,
    minAgeMinutes,
    fallbackRuntime: {
      provider: config.provider,
      codingAgent: config.codingAgent,
      aiProvider: config.aiProvider,
      model: config.aiModel,
      reasoningLevel: config.reasoningLevel,
    },
  });
};

export const getBacklogDrainCandidatesForConfigId = async (
  configId: string,
  organizationId: string,
): Promise<BacklogDrainCandidateResult | null> => {
  const [config] = await db
    .select()
    .from(scheduledAgentConfigs)
    .where(and(eq(scheduledAgentConfigs.id, configId), eq(scheduledAgentConfigs.organizationId, organizationId)))
    .limit(1);

  if (!config) return null;
  return getBacklogDrainCandidatesForScheduledConfig(config);
};

export const getDodRemediationCandidatesForConfigId = async (
  configId: string,
  organizationId: string,
): Promise<BacklogDrainCandidateResult | null> => {
  const [config] = await db
    .select()
    .from(scheduledAgentConfigs)
    .where(and(eq(scheduledAgentConfigs.id, configId), eq(scheduledAgentConfigs.organizationId, organizationId)))
    .limit(1);

  if (!config) return null;
  return getDodRemediationCandidatesForScheduledConfig(config);
};

export const previewBacklogDrainCandidates = async (params: {
  organizationId: string;
  targetConfig: TargetConfig;
  projectId?: string | null;
  codingAgent?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  reasoningLevel?: string | null;
}): Promise<BacklogDrainCandidateResult> => {
  const isDodRemediation = isDodRemediationTargetConfig(params.targetConfig);
  const { rules, allProjects, defaultMaxConcurrentJobs, minAgeMinutes } = (isDodRemediation ? resolveDodRemediationRules : resolveBacklogDrainRules)({
    projectId: params.projectId ?? null,
    targetConfig: params.targetConfig,
  });
  return selectBacklogDrainForOrganization({
    organizationId: params.organizationId,
    mode: isDodRemediation ? "dod-remediation" : "implementation",
    rules,
    allProjects,
    defaultMaxConcurrentJobs,
    minAgeMinutes,
    fallbackRuntime: {
      codingAgent: params.codingAgent,
      aiProvider: params.aiProvider,
      model: params.aiModel,
      reasoningLevel: params.reasoningLevel,
    },
  });
};

export const listBacklogDrainWorkItems = async (
  organizationId: string,
  projectIds: string[],
): Promise<BacklogDrainWorkItemTreeItem[]> => {
  const uniqueProjectIds = Array.from(new Set(projectIds.filter(Boolean)));
  if (uniqueProjectIds.length === 0) return [];

  const rows = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      parentId: workItems.parentId,
      projectId: workItems.projectId,
      boardId: workItems.boardId,
      columnRole: boardColumns.role,
      columnIsDone: boardColumns.isDone,
    })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        inArray(workItems.projectId, uniqueProjectIds),
        isNull(workItems.archivedAt),
      ),
    );

  return rows
    .filter((row): row is typeof row & { projectId: string } => typeof row.projectId === "string")
    .map((row) => ({
      ...row,
      projectId: row.projectId,
      columnIsDone: row.columnIsDone ?? false,
    }));
};
