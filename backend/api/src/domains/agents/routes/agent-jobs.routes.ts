import { Elysia, t } from "elysia";
import {
  createJob,
  createBatchJobs,
  getJobById,
  listAgentJobs,
  getJobsByBoard,
  cancelJob,
  getActiveJobForWorkItem,
  getWorkItemById,
  getDependencies,
  getInteractionsByJobId,
  listAgentJobLogsByJobId,
  getTranscriptByJobId,
  respondToInteraction,
  createAgentJobLogBatch,
  updateJobStatus,
  setWorkItemAiProcessing,
  clearWorkItemAiState,
  getStuckAiWorkItems,
  getRepositories,
  insertSessionEventsBatch,
  getSessionEventsByJobId,
  insertAgentNativeEventsBatch,
  getAgentNativeEventsByJobId,
  getMetricsHistory,
  getAllWorkersMetricsHistory,
  getAccessibleProjectIds,
  getScheduledAgentConfigById,
  findClusterByAgentJobId,
  db,
  workItems,
  inArray,
  eq,
} from "@almirant/database";
import type { AgentJobConfig, AgentJobStatus, AgentJobType, CodingAgent, AiProvider, NewAgentNativeEvent } from "@almirant/database";
import { resolveRuntime, requiresInternalMcp } from "@almirant/shared";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";
import { enrichJobWithFingerprint, enrichJobsWithFingerprint } from "../services/agent-job-enrichment";
import {
  buildDefaultJobResourceEstimate,
  buildWorkItemResourceForecast,
  toJobResourceEstimate,
} from "../services/resource-forecast";
import {
  buildResourceTimeline,
  buildSubagentMemoryProfiles,
  type SubagentMemoryProfile,
} from "../services/resource-timeline";
import { wsConnectionManager } from "../../../shared/ws/ws-connection-manager";
import {
  createDiscordThread,
  isDiscordBridgeConfigured,
} from "../../integrations/discord/services/discord-thread";

const broadcastStatusChanged = (orgId: string, args: {
  jobId: string;
  status: string;
  workItemId: string | null;
  planningSessionId?: string | null;
}) => {
  wsConnectionManager.broadcastToWorkspace(orgId, {
    type: "agent-job:status-changed",
    payload: {
      jobId: args.jobId,
      status: args.status,
      workItemId: args.workItemId,
      planningSessionId: args.planningSessionId ?? null,
    },
  });
};

const getOrgIdFromContext = (ctx: { activeWorkspace?: { id: string } }): string | null => {
  return ctx.activeWorkspace?.id ?? null;
};

const hasWorkspaceWideProjectAccess = (ctx: { memberRole?: string | null }): boolean => {
  return ctx.memberRole === "owner" || ctx.memberRole === "admin";
};

const shouldIncludeRelations = (value: string | undefined): boolean => {
  if (!value) return false;
  return value === "true" || value === "1";
};

const getTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseCsvFilterParam = <T extends string>(
  value: string | undefined,
): T | T[] | undefined => {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as T[];

  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
};

const hydrateScheduledConfigNames = async <
  T extends { config?: AgentJobConfig | null }
>(
  jobs: T[],
  workspaceId: string
): Promise<T[]> => {
  const scheduledConfigIds = [
    ...new Set(
      jobs
        .filter((job) => !getTrimmedString(job.config?.scheduledConfigName))
        .map((job) => getTrimmedString(job.config?.scheduledConfigId))
        .filter((id): id is string => !!id)
    ),
  ];

  if (scheduledConfigIds.length === 0) {
    return jobs;
  }

  const scheduledConfigNames = new Map<string, string>();

  await Promise.all(
    scheduledConfigIds.map(async (scheduledConfigId) => {
      const config = await getScheduledAgentConfigById(
        scheduledConfigId,
        workspaceId
      );
      const configName = getTrimmedString(config?.name);
      if (configName) {
        scheduledConfigNames.set(scheduledConfigId, configName);
      }
    })
  );

  return jobs.map((job) => {
    const currentName = getTrimmedString(job.config?.scheduledConfigName);
    if (currentName || !job.config) {
      return job;
    }

    const scheduledConfigId = getTrimmedString(job.config.scheduledConfigId);
    if (!scheduledConfigId) {
      return job;
    }

    const resolvedName = scheduledConfigNames.get(scheduledConfigId);
    if (!resolvedName) {
      return job;
    }

    return {
      ...job,
      config: {
        ...job.config,
        scheduledConfigName: resolvedName,
      },
    };
  });
};

const RESOURCE_PROFILE_RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const resolveResourceProfileRange = (
  range: string | undefined,
): { range: string; sampleEvery?: number; from: Date; now: Date } => {
  const normalizedRange = range && RESOURCE_PROFILE_RANGE_MS[range] ? range : "7d";
  const now = new Date();
  const from = new Date(now.getTime() - RESOURCE_PROFILE_RANGE_MS[normalizedRange]!);

  return {
    range: normalizedRange,
    sampleEvery: normalizedRange === "30d" ? 30 : normalizedRange === "7d" ? 6 : undefined,
    from,
    now,
  };
};

const resolveResourceProfileLimit = (value: string | number | undefined): number => {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
};

const loadSubagentMemoryProfiles = async (
  workspaceId: string,
  options: { range?: string; limit?: number } = {},
): Promise<SubagentMemoryProfile[]> => {
  const { sampleEvery, from, now } = resolveResourceProfileRange(options.range);
  const limit = resolveResourceProfileLimit(options.limit);

  const [{ jobs }, allMetrics] = await Promise.all([
    listAgentJobs({ limit, offset: 0 }, { workspaceId }),
    getAllWorkersMetricsHistory(from, now, sampleEvery, workspaceId),
  ]);

  const timelines = await Promise.all(
    jobs.map(async (job) => {
      const start = job.startedAt ?? job.createdAt;
      const end = job.completedAt ?? job.failedAt ?? now;
      const metrics = allMetrics.filter((metric) =>
        metric.workerId === job.workerId &&
        metric.timestamp >= start &&
        metric.timestamp <= end
      );
      const events = await getSessionEventsByJobId(job.id, {
        kinds: ["agent.subagent.spawn", "agent.subagent.complete"],
        limit: 5000,
      });
      return buildResourceTimeline(job, metrics, events);
    })
  );

  return buildSubagentMemoryProfiles(timelines);
};

// Maps frontend-friendly names to runner SKILL.md slugs
const PROMPT_TEMPLATE_VARIANTS: Record<string, string> = {
  implement: "runner-implement",
  document: "runner-document",
  plan: "ideate",
};

const resolvePromptTemplate = (
  jobType: string,
  explicitName: string | undefined
): string | undefined => {
  if (explicitName) {
    return PROMPT_TEMPLATE_VARIANTS[explicitName] ?? explicitName;
  }
  switch (jobType) {
    case "implementation": return "runner-implement";
    case "validation": return "validate";
    case "bug-fix": return "bug-fix";
    case "review": return "review";
    case "planning": return "ideate";
    case "recording": return "record-video";
    default: return undefined;
  }
};

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

const buildRequiredImplementationResourceEstimate = async (
  workspaceId: string,
  workItemId: string,
  profiles?: SubagentMemoryProfile[],
): Promise<NonNullable<AgentJobConfig["resourceEstimate"]>> => {
  const forecast = await buildWorkItemResourceForecast(workspaceId, workItemId, {
    ...(profiles ? { profiles } : {}),
    persist: true,
  });

  if (!forecast) {
    throw new Error(`Unable to calculate resource forecast for workItemId=${workItemId}`);
  }

  return toJobResourceEstimate(forecast);
};

export const agentJobsRoutes = new Elysia({ prefix: "/agent-jobs" })
  // POST /api/agent-jobs — enqueue a job
  .post(
    "/",
    async (ctx) => {
      const { body, set } = ctx;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      const userId = (ctx as { user?: { id?: string } }).user?.id ?? null;
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      const jobType = body.jobType ?? "implementation";

      // Validate required fields based on job type
      if (jobType === "planning") {
        if (!body.planningSessionId) {
          set.status = 400;
          return errorResponse("planningSessionId is required for planning jobs");
        }
        // Planning jobs do not require a workItemId
      } else {
        // implementation or review: workItemId is required
        if (!body.workItemId) {
          set.status = 400;
          return errorResponse("workItemId is required for implementation jobs");
        }
      }

      let projectId: string | null = null;
      let boardId: string | null = null;
      let workItemId: string | null = null;
      let workItem: Awaited<ReturnType<typeof getWorkItemById>> | null = null;

      if (body.workItemId) {
        workItem = await getWorkItemById(body.workItemId, orgId);
        if (!workItem) {
          set.status = 404;
          return notFoundResponse("Work item");
        }

        const active = await getActiveJobForWorkItem(body.workItemId);
        if (active) {
          set.status = 409;
          return errorResponse("An active job already exists for this work item");
        }

        projectId = workItem.projectId ?? null;
        boardId = workItem.boardId;
        workItemId = workItem.id;
      }

      // For planning jobs, allow projectId/boardId from body if not derived from workItem
      if (body.planningSessionId && !projectId && body.config?.projectId) {
        projectId = body.config.projectId;
      }

      // Resolve primary repository for the project
      let repoUrl: string | undefined;
      let repositoryId: string | undefined;
      let baseBranch = "main";

      if (projectId && orgId) {
        try {
          const repos = await getRepositories(orgId, projectId);
          const primary = repos[0];
          if (primary) {
            repoUrl = primary.url;
            repositoryId = primary.id;
          }
        } catch {
          // Non-fatal: runner will resolve via API fallback
        }
      }

      const baseConfig = {
        repoPath: ".",
        baseBranch,
        ...body.config,
        ...(repoUrl ? { repoUrl } : {}),
        ...(repositoryId ? { repositoryId } : {}),
        ...(projectId ? { projectId } : {}),
      } as AgentJobConfig;
      const configWithWorkItem: AgentJobConfig =
        workItemId && workItem
          ? {
              ...baseConfig,
              ...(workItem.taskId ? { taskId: workItem.taskId } : {}),
              ...(typeof workItem.title === "string" && workItem.title.trim().length > 0
                ? { workItemTitle: workItem.title }
                : {}),
            }
          : baseConfig;
      const inferredSkillName = resolvePromptTemplate(jobType, configWithWorkItem.skillName);
      // Security guard: reject any attempt to enqueue a job bound to an
      // internal-only skill. These skills are reserved for system-initiated
      // flows (feedback triage, bug auto-fix, failed-job debugging) and their
      // containers receive tokens with `mcp:internal` — granting a user the
      // ability to pick them would be a cross-org privilege escalation.
      if (
        requiresInternalMcp(inferredSkillName) ||
        requiresInternalMcp(jobType) ||
        requiresInternalMcp(configWithWorkItem.skillName)
      ) {
        set.status = 403;
        return errorResponse(
          "This skill is reserved for internal system flows and cannot be invoked via the public API"
        );
      }
      const configWithSkill: AgentJobConfig = inferredSkillName
        ? { ...configWithWorkItem, skillName: inferredSkillName }
        : configWithWorkItem;
      // Create Discord thread via discord-bridge so the user sees it right away.
      // The bridge handles thread creation + initial message. The runner reuses the threadId.
      let discordThreadId: string | null = null;
      if (isDiscordBridgeConfigured()) {
        const humanId = workItem?.taskId ?? workItemId ?? "job";
        discordThreadId = await createDiscordThread({ jobType, taskId: humanId });
      }

      const userLocale = (ctx as { user?: { locale?: string } }).user?.locale ?? 'es';
      let resourceEstimate = configWithSkill.resourceEstimate;
      if (!resourceEstimate && workItemId && jobType === "implementation") {
        try {
          const profiles = await loadSubagentMemoryProfiles(orgId, { range: "30d" });
          resourceEstimate = await buildRequiredImplementationResourceEstimate(
            orgId,
            workItemId,
            profiles,
          );
        } catch (error) {
          console.error(
            `[agent-jobs] Failed to calculate required resource forecast for workItemId=${workItemId}`,
            error,
          );
          set.status = 500;
          return errorResponse(
            "Unable to calculate resource forecast for implementation job",
            500,
          );
        }
      }
      resourceEstimate ??= buildDefaultJobResourceEstimate({
        jobType,
        skillName: configWithSkill.skillName,
        promptTemplate: inferredSkillName,
      });

      const jobConfig: AgentJobConfig = {
        ...configWithSkill,
        ...(resourceEstimate ? { resourceEstimate } : {}),
        source: "api",
        locale: userLocale,
        ...(userId ? { requestedByUserId: userId } : {}),
        ...(discordThreadId ? { threadId: discordThreadId } : {}),
        ...(body.codingAgent ? { codingAgent: body.codingAgent } : {}),
        ...(body.model ? { model: body.model } : {}),
      };

      const job = await createJob({
        projectId,
        boardId,
        workItemId,
        planningSessionId: body.planningSessionId ?? null,
        createdByUserId: userId,
        workspaceId: orgId,
        jobType,
        provider: body.provider,
        priority: body.priority ?? "medium",
        config: jobConfig,
        codingAgent: (body.codingAgent as CodingAgent | undefined) ?? jobConfig.codingAgent ?? "claude-code",
        aiProvider: (body.aiProvider as AiProvider | undefined) ?? resolveRuntime({ provider: body.provider }).aiProvider as AiProvider,
        model: body.model ?? jobConfig.model ?? resolveRuntime({ provider: body.provider }).model,
        ...(jobConfig.skillName ? { skillName: jobConfig.skillName } : {}),
        // New model fields
        prompt: jobConfig.prompt ?? null,
        promptTemplate: inferredSkillName ?? null,
        triggerType: "event",
        interactive: jobType === "planning",
      });

      // Flip isAiProcessing on the linked work item as soon as the job is
      // enqueued so cards animate immediately. Without this, the flag only
      // turns on once the runner-side skill calls move_work_item, leaving a
      // gap where the user sees a session in /sessions but no card animation.
      if (job.workItemId) {
        await setWorkItemAiProcessing(orgId, job.workItemId, true);
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "work-item:updated",
          payload: {
            workItemId: job.workItemId,
            boardId: job.boardId ?? undefined,
            changes: { isAiProcessing: true },
          },
        });
      }

      broadcastStatusChanged(orgId, {
        jobId: job.id,
        status: job.status,
        workItemId: job.workItemId ?? null,
        planningSessionId: job.planningSessionId ?? null,
      });

      set.status = 201;
      return successResponse(job);
    },
    {
      body: t.Object({
        workItemId: t.Optional(t.String()),
        planningSessionId: t.Optional(t.String()),
        jobType: t.Optional(
          t.Union([
            t.Literal("implementation"),
            t.Literal("planning"),
            t.Literal("review"),
            t.Literal("validation"),
            t.Literal("bug-fix"),
            t.Literal("recording"),
          ]),
        ),
        provider: t.Union([t.Literal("claude-code"), t.Literal("codex"), t.Literal("zipu"), t.Literal("grok")]),
        codingAgent: t.Optional(t.Union([
          t.Literal("claude-code"),
          t.Literal("codex"),
          t.Literal("opencode"),
        ])),
        aiProvider: t.Optional(t.String()),
        model: t.Optional(t.String()),
        priority: t.Optional(t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high"), t.Literal("urgent")])),
        config: t.Optional(
          t.Object({
            repoPath: t.Optional(t.String()),
            baseBranch: t.Optional(t.String()),
            workspace: t.Optional(agentWorkspaceSchema),
            mcpServerUrl: t.Optional(t.String()),
            projectId: t.Optional(t.String()),
            skillName: t.Optional(t.String()),
            source: t.Optional(t.String()),
            needsBrowser: t.Optional(t.Boolean()),
            resourceEstimate: t.Optional(resourceEstimateSchema),
          })
        ),
      }),
    }
  )

  // POST /api/agent-jobs/batch — enqueue multiple jobs
  .post(
    "/batch",
    async (ctx) => {
      const { body, set } = ctx;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      const userId = (ctx as { user?: { id?: string } }).user?.id ?? null;
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      if (body.workItemIds.length === 0) {
        set.status = 400;
        return errorResponse("workItemIds cannot be empty");
      }
      if (body.jobType && body.jobType !== "implementation") {
        set.status = 400;
        return errorResponse("Batch operations only support implementation jobs in this phase");
      }
      // Security guard (fail fast): reject internal-only skills before any DB
      // query runs. Same rationale as POST /agent-jobs.
      if (
        requiresInternalMcp(body.jobType) ||
        requiresInternalMcp(body.config?.skillName)
      ) {
        set.status = 403;
        return errorResponse(
          "This skill is reserved for internal system flows and cannot be invoked via the public API"
        );
      }

      const rows = await db
        .select({ id: workItems.id, projectId: workItems.projectId, boardId: workItems.boardId, taskId: workItems.taskId })
        .from(workItems)
        .where(inArray(workItems.id, body.workItemIds));

      const foundIds = new Set(rows.map((r) => r.id));
      const missing = body.workItemIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        set.status = 404;
        return errorResponse(`Missing work items: ${missing.join(", ")}`);
      }

      // Prevent duplicate active jobs in batch (best-effort, per item).
      for (const id of body.workItemIds) {
        const active = await getActiveJobForWorkItem(id);
        if (active) {
          set.status = 409;
          return errorResponse(`Active job already exists for workItemId=${id}`);
        }
      }

      // Pre-calculate topological order based on dependencies.
      // Fetch dependencies for all work items in the batch, then sort by dependency order.
      const batchIds = new Set(body.workItemIds);
      const depMap = new Map<string, string[]>(); // workItemId -> blockedByWorkItemIds (within batch)
      await Promise.all(
        body.workItemIds.map(async (id) => {
          try {
            const deps = await getDependencies(id);
            // Only consider dependencies that are within the batch
            const inBatchDeps = deps
              .map((d) => d.blockedByWorkItemId)
              .filter((depId) => batchIds.has(depId));
            depMap.set(id, inBatchDeps);
          } catch {
            depMap.set(id, []);
          }
        })
      );

      // Kahn's algorithm for topological sort within the batch
      const inDegree = new Map<string, number>();
      for (const id of body.workItemIds) inDegree.set(id, 0);
      for (const [, deps] of depMap) {
        for (const depId of deps) {
          inDegree.set(depId, (inDegree.get(depId) ?? 0)); // ensure blockers exist
        }
      }
      for (const [id, deps] of depMap) {
        inDegree.set(id, (inDegree.get(id) ?? 0) + deps.length);
      }
      // Reset and recompute: in-degree = number of things blocking this item
      for (const id of body.workItemIds) inDegree.set(id, 0);
      for (const [, deps] of depMap) {
        // Each dep means "this item depends on dep" so this item's in-degree increases
      }
      // Actually: depMap[id] = items that block id, so id's in-degree = depMap[id].length
      const sortedIds: string[] = [];
      const queue: string[] = [];
      const inDeg = new Map<string, number>();
      for (const id of body.workItemIds) {
        const deg = (depMap.get(id) ?? []).length;
        inDeg.set(id, deg);
        if (deg === 0) queue.push(id);
      }

      // Build reverse adjacency: blocker -> items it unblocks
      const reverseAdj = new Map<string, string[]>();
      for (const [id, deps] of depMap) {
        for (const depId of deps) {
          const list = reverseAdj.get(depId) ?? [];
          list.push(id);
          reverseAdj.set(depId, list);
        }
      }

      while (queue.length > 0) {
        const current = queue.shift()!;
        sortedIds.push(current);
        for (const dependent of reverseAdj.get(current) ?? []) {
          const newDeg = (inDeg.get(dependent) ?? 1) - 1;
          inDeg.set(dependent, newDeg);
          if (newDeg === 0) queue.push(dependent);
        }
      }

      // If there are cycles, append remaining items at the end
      for (const id of body.workItemIds) {
        if (!sortedIds.includes(id)) sortedIds.push(id);
      }

      // Build a lookup for row data
      const rowMap = new Map(rows.map((r) => [r.id, r]));

      // Resolve primary repositories for all unique projects in the batch
      const uniqueProjectIds = [...new Set(rows.map(r => r.projectId).filter(Boolean))] as string[];
      const projectRepoMap = new Map<string, { repoUrl: string; repositoryId: string }>();

      await Promise.all(
        uniqueProjectIds.map(async (pid) => {
          try {
            const repos = await getRepositories(orgId, pid);
            const primary = repos[0];
            if (primary) {
              projectRepoMap.set(pid, { repoUrl: primary.url, repositoryId: primary.id });
            }
          } catch {
            // Non-fatal per project: runner will resolve via API fallback
          }
        })
      );

      const batchJobType = body.jobType ?? "implementation";
      const batchBaseConfig = { repoPath: ".", baseBranch: "main", ...body.config } as AgentJobConfig;
      const batchJobConfig: AgentJobConfig = {
        ...batchBaseConfig,
        source: "api",
        ...(userId ? { requestedByUserId: userId } : {}),
        ...(body.codingAgent ? { codingAgent: body.codingAgent } : {}),
        ...(body.model ? { model: body.model } : {}),
      };
      const batchInferredSkillName = resolvePromptTemplate(batchJobType, batchJobConfig.skillName);
      // Defense in depth: the fail-fast guard above already rejects internal
      // skills; re-check the inferred value in case a future edit changes the
      // template resolution in a way the early guard doesn't see.
      if (requiresInternalMcp(batchInferredSkillName)) {
        set.status = 403;
        return errorResponse(
          "This skill is reserved for internal system flows and cannot be invoked via the public API"
        );
      }
      const batchConfigWithSkill: AgentJobConfig = batchInferredSkillName
        ? { ...batchJobConfig, skillName: batchInferredSkillName }
        : batchJobConfig;

      const batchResourceEstimateByWorkItemId = new Map<
        string,
        NonNullable<AgentJobConfig["resourceEstimate"]>
      >();
      if (!batchConfigWithSkill.resourceEstimate && batchJobType === "implementation") {
        try {
          const profiles = await loadSubagentMemoryProfiles(orgId, { range: "30d" });
          await Promise.all(
            sortedIds.map(async (id) => {
              const resourceEstimate = await buildRequiredImplementationResourceEstimate(
                orgId,
                id,
                profiles,
              );
              batchResourceEstimateByWorkItemId.set(id, resourceEstimate);
            })
          );
        } catch (error) {
          console.error(
            "[agent-jobs] Failed to calculate required resource forecast for implementation batch",
            error,
          );
          set.status = 500;
          return errorResponse(
            "Unable to calculate resource forecasts for implementation batch",
            500,
          );
        }
      }

      // Create Discord threads via bridge in parallel for all batch items
      const threadMap = new Map<string, string>(); // workItemId -> threadId
      if (isDiscordBridgeConfigured()) {
        const threadResults = await Promise.all(
          sortedIds.map(async (id) => {
            const r = rowMap.get(id);
            const humanId = r?.taskId ?? id;
            const threadId = await createDiscordThread({ jobType: batchJobType, taskId: humanId });
            return { id, threadId };
          })
        );
        for (const { id, threadId } of threadResults) {
          if (threadId) threadMap.set(id, threadId);
        }
      }

      // Create jobs in topological (dependency) order
      const created = await createBatchJobs(
        sortedIds.map((id) => {
          const r = rowMap.get(id)!;
          const threadId = threadMap.get(id);
          const repoInfo = r.projectId ? projectRepoMap.get(r.projectId) : undefined;
          const resourceEstimate =
            batchConfigWithSkill.resourceEstimate ??
            batchResourceEstimateByWorkItemId.get(id) ??
            buildDefaultJobResourceEstimate({
              jobType: batchJobType,
              skillName: batchConfigWithSkill.skillName,
              promptTemplate: batchInferredSkillName,
            });
          return {
            projectId: r.projectId ?? null,
            boardId: r.boardId,
            workItemId: r.id,
            createdByUserId: userId,
            workspaceId: orgId,
            provider: body.provider,
            priority: body.priority ?? "medium",
            config: {
              ...batchConfigWithSkill,
              ...(resourceEstimate ? { resourceEstimate } : {}),
              ...(threadId ? { threadId } : {}),
              ...(r.taskId ? { taskId: r.taskId } : {}),
              ...(repoInfo ? { repoUrl: repoInfo.repoUrl, repositoryId: repoInfo.repositoryId } : {}),
              ...(r.projectId ? { projectId: r.projectId } : {}),
            },
            codingAgent: (body.codingAgent as CodingAgent | undefined) ?? batchConfigWithSkill.codingAgent ?? "claude-code",
            aiProvider: (body.aiProvider as AiProvider | undefined) ?? resolveRuntime({ provider: body.provider }).aiProvider as AiProvider,
            model: body.model ?? batchConfigWithSkill.model ?? resolveRuntime({ provider: body.provider }).model,
            ...(batchConfigWithSkill.skillName ? { skillName: batchConfigWithSkill.skillName } : {}),
            // New model fields
            promptTemplate: batchInferredSkillName ?? null,
            triggerType: "event",
            interactive: false,
          };
        })
      );

      for (const job of created) {
        broadcastStatusChanged(orgId, { jobId: job.id, status: job.status, workItemId: job.workItemId ?? null, planningSessionId: job.planningSessionId ?? null });
      }

      set.status = 201;
      return successResponse({ created: created.length, jobs: created, executionOrder: sortedIds });
    },
    {
      body: t.Object({
        workItemIds: t.Array(t.String()),
        jobType: t.Optional(
          t.Union([
            t.Literal("implementation"),
            t.Literal("planning"),
            t.Literal("review"),
            t.Literal("validation"),
            t.Literal("bug-fix"),
            t.Literal("recording"),
          ]),
        ),
        provider: t.Union([t.Literal("claude-code"), t.Literal("codex"), t.Literal("zipu"), t.Literal("grok")]),
        codingAgent: t.Optional(t.Union([
          t.Literal("claude-code"),
          t.Literal("codex"),
          t.Literal("opencode"),
        ])),
        aiProvider: t.Optional(t.String()),
        model: t.Optional(t.String()),
        priority: t.Optional(t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high"), t.Literal("urgent")])),
        config: t.Optional(
          t.Object({
            repoPath: t.Optional(t.String()),
            baseBranch: t.Optional(t.String()),
            workspace: t.Optional(agentWorkspaceSchema),
            mcpServerUrl: t.Optional(t.String()),
            projectId: t.Optional(t.String()),
            skillName: t.Optional(t.String()),
            resourceEstimate: t.Optional(resourceEstimateSchema),
            needsBrowser: t.Optional(t.Boolean()),
          })
        ),
      }),
    }
  )

  // GET /api/agent-jobs — list with pagination
  .get(
    "/",
    async (ctx) => {
      const { query, set } = ctx;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      const pagination = parsePaginationParams(query);
      const includeRelations = shouldIncludeRelations(query.includeRelations);
      const userId = (ctx as { user?: { id?: string } }).user?.id;
      const canSeeAllWorkspaceProjects = hasWorkspaceWideProjectAccess(
        ctx as { memberRole?: string | null }
      );
      const isPlanningSessionScoped = !!query.planningSessionId;
      const accessibleProjectIds =
        !isPlanningSessionScoped && userId && !canSeeAllWorkspaceProjects
          ? await getAccessibleProjectIds(userId, orgId)
          : undefined;
      const filters = {
        workspaceId: orgId,
        status: parseCsvFilterParam<AgentJobStatus>(query.status),
        projectId: parseCsvFilterParam(query.projectId),
        boardId: query.boardId || undefined,
        workItemId: query.workItemId || undefined,
        taskId: query.taskId || undefined,
        planningSessionId: query.planningSessionId || undefined,
        jobType: parseCsvFilterParam<AgentJobType>(query.jobType),
        accessibleProjectIds,
      };

      const { jobs, total } = await listAgentJobs(pagination, filters);
      const jobsWithScheduledNames = await hydrateScheduledConfigNames(
        jobs,
        orgId
      );
      const meta = buildPaginationMeta(pagination.page, pagination.limit, total);
      if (!includeRelations) {
        return successResponse(enrichJobsWithFingerprint(jobsWithScheduledNames), meta);
      }

      const enrichedJobs = await Promise.all(
        jobsWithScheduledNames.map(async (job) => {
          const detail = await getJobById(job.id);
          const detailScheduledName = getTrimmedString(
            detail?.job.config?.scheduledConfigName
          );
          const fallbackScheduledName = getTrimmedString(
            job.config?.scheduledConfigName
          );
          const detailJob =
            detail?.job && fallbackScheduledName && !detailScheduledName
              ? {
                  ...detail.job,
                  config: {
                    ...detail.job.config,
                    scheduledConfigName: fallbackScheduledName,
                  },
                }
              : detail?.job;
          return {
            ...(detailJob ?? job),
            workItemTitle: detail?.workItem?.title ?? null,
            workItemTaskId: detail?.workItem?.taskId ?? null,
            projectName: detail?.project?.name ?? null,
            boardName: detail?.board?.name ?? null,
            planningSessionTitle: detail?.planningSession?.title ?? null,
            feedbackItemTitle: detail?.feedbackItem?.title ?? null,
            createdByUserName: detail?.createdByUser?.name ?? null,
            createdByUserImage: detail?.createdByUser?.image ?? null,
            requestedByUserName: detail?.requestedByUser?.name ?? null,
            requestedByUserImage: detail?.requestedByUser?.image ?? null,
          };
        })
      );

      return successResponse(enrichJobsWithFingerprint(enrichedJobs), meta);
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        boardId: t.Optional(t.String()),
        workItemId: t.Optional(t.String()),
        taskId: t.Optional(t.String()),
        planningSessionId: t.Optional(t.String()),
        jobType: t.Optional(t.String()),
        includeRelations: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/agent-jobs/resource-profiles — empirical memory profiles by subagent type
  .get(
    "/resource-profiles",
    async (ctx) => {
      const { query, set } = ctx;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }

      const limit = resolveResourceProfileLimit(query.limit);
      const { range } = resolveResourceProfileRange(query.range);
      const profiles = await loadSubagentMemoryProfiles(orgId, { range, limit });

      return successResponse({
        range,
        profiles,
      });
    },
    {
      query: t.Object({
        range: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/agent-jobs/:id — get by id
  .get(
    "/:id/output",
    async (ctx) => {
      const { params, query, set } = ctx;
      const job = await getJobById(params.id);
      if (!job) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      if (!job.job.workspaceId || job.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const limitRaw = query.limit ? Number.parseInt(query.limit, 10) : 500;
      if (!Number.isFinite(limitRaw) || limitRaw < 1) {
        set.status = 400;
        return errorResponse("limit must be a positive integer");
      }

      const cursorRaw = query.cursor ? Number.parseInt(query.cursor, 10) : undefined;
      if (query.cursor && (!Number.isFinite(cursorRaw) || (cursorRaw ?? 0) < 0)) {
        set.status = 400;
        return errorResponse("cursor must be a non-negative integer");
      }

      const result = await listAgentJobLogsByJobId(params.id, {
        cursor: cursorRaw,
        limit: Math.min(limitRaw, 5000),
      });

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
        jobId: job.job.id,
        sessionId: job.job.sessionId ?? null,
        status: job.job.status,
        chunks,
        text: chunks.map((chunk) => chunk.message).join("\n"),
        nextCursor: result.nextCursor,
        hasMore: result.nextCursor !== null,
        lastSeq: chunks.at(-1)?.seq ?? cursorRaw ?? null,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/agent-jobs/:id/transcript — reconstructable raw transcript
  .get(
    "/:id/transcript",
    async (ctx) => {
      const { params, query, set } = ctx;
      const job = await getJobById(params.id);
      if (!job) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      if (!job.job.workspaceId || job.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const limitRaw = query.limit ? Number.parseInt(query.limit, 10) : 500;
      if (!Number.isFinite(limitRaw) || limitRaw < 1) {
        set.status = 400;
        return errorResponse("limit must be a positive integer");
      }

      const cursorRaw = query.cursor ? Number.parseInt(query.cursor, 10) : undefined;
      if (query.cursor && (!Number.isFinite(cursorRaw) || (cursorRaw ?? 0) < 0)) {
        set.status = 400;
        return errorResponse("cursor must be a non-negative integer");
      }

      const result = await getTranscriptByJobId(params.id, {
        cursor: cursorRaw,
        limit: Math.min(limitRaw, 1000),
      });

      const chunks = result.logs.map((log) => ({
        seq: log.seq,
        message: log.message,
        contentType: log.contentType,
        timestamp:
          log.timestamp instanceof Date
            ? log.timestamp.toISOString()
            : new Date(log.timestamp).toISOString(),
      }));

      return successResponse({
        jobId: job.job.id,
        status: job.job.status,
        transcript: chunks.map((c) => c.message).join(""),
        chunks,
        nextCursor: result.nextCursor,
        hasMore: result.nextCursor !== null,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/agent-jobs/:id/logs — filtered structured logs
  .get(
    "/:id/logs",
    async (ctx) => {
      const { params, query, set } = ctx;
      const job = await getJobById(params.id);
      if (!job) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      if (!job.job.workspaceId || job.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const limitRaw = query.limit ? Number.parseInt(query.limit, 10) : 100;
      if (!Number.isFinite(limitRaw) || limitRaw < 1) {
        set.status = 400;
        return errorResponse("limit must be a positive integer");
      }
      const limit = Math.min(limitRaw, 500);

      const cursorRaw = query.cursor ? Number.parseInt(query.cursor, 10) : undefined;
      if (query.cursor && (!Number.isFinite(cursorRaw) || (cursorRaw ?? 0) < 0)) {
        set.status = 400;
        return errorResponse("cursor must be a non-negative integer");
      }

      const from = query.from ? new Date(query.from) : undefined;
      if (from && Number.isNaN(from.getTime())) {
        set.status = 400;
        return errorResponse("from must be a valid ISO date string");
      }

      const to = query.to ? new Date(query.to) : undefined;
      if (to && Number.isNaN(to.getTime())) {
        set.status = 400;
        return errorResponse("to must be a valid ISO date string");
      }

      const level =
        query.level &&
        ["debug", "info", "warn", "error"].includes(query.level)
          ? (query.level as "debug" | "info" | "warn" | "error")
          : undefined;
      if (query.level && !level) {
        set.status = 400;
        return errorResponse("level must be one of: debug, info, warn, error");
      }

      const result = await listAgentJobLogsByJobId(params.id, {
        level,
        phase: query.phase || undefined,
        eventType: query.eventType || undefined,
        from,
        to,
        cursor: cursorRaw,
        limit,
      });

      return successResponse(result.logs, {
        nextCursor: result.nextCursor,
        hasMore: result.nextCursor !== null,
        limit,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        level: t.Optional(t.String()),
        phase: t.Optional(t.String()),
        eventType: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/agent-jobs/:id/resource-timeline — RAM and subagent timeline for a job
  .get(
    "/:id/resource-timeline",
    async (ctx) => {
      const { params, set } = ctx;
      const job = await getJobById(params.id);
      if (!job) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      if (!job.job.workspaceId || job.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const start = job.job.startedAt ?? job.job.createdAt;
      const end = job.job.completedAt ?? job.job.failedAt ?? new Date();
      const [metrics, events] = await Promise.all([
        job.job.workerId
          ? getMetricsHistory(job.job.workerId, start, end, undefined, orgId)
          : Promise.resolve([]),
        getSessionEventsByJobId(job.job.id, {
          kinds: [
            "agent.subagent.spawn",
            "agent.subagent.complete",
            "agent.text",
            "agent.text.complete",
            "agent.wave.start",
            "agent.wave.end",
          ],
          limit: 10000,
        }),
      ]);

      return successResponse(buildResourceTimeline(job.job, metrics, events));
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )

  // GET /api/agent-jobs/:id — get by id
  .get(
    "/:id",
    async (ctx) => {
      const { params, set } = ctx;
      const job = await getJobById(params.id);
      if (!job) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      if (!job.job.workspaceId || job.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const [hydratedJob] = await hydrateScheduledConfigNames([job.job], orgId);
      if (!hydratedJob) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }
      const enrichment = enrichJobWithFingerprint(hydratedJob);

      const enrichedJob = {
        ...hydratedJob,
        workItemTitle: job.workItem?.title ?? null,
        workItemTaskId: job.workItem?.taskId ?? null,
        projectName: job.project?.name ?? null,
        boardName: job.board?.name ?? null,
        planningSessionTitle: job.planningSession?.title ?? null,
        feedbackItemTitle: job.feedbackItem?.title ?? null,
        createdByUserName: job.createdByUser?.name ?? null,
        createdByUserImage: job.createdByUser?.image ?? null,
        requestedByUserName: job.requestedByUser?.name ?? null,
        requestedByUserImage: job.requestedByUser?.image ?? null,
      };

      const cluster = await findClusterByAgentJobId(params.id);

      return successResponse({
        ...job,
        job: enrichedJob,
        cluster,
        ...enrichment,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /api/agent-jobs/board/:boardId — active jobs for a board
  .get(
    "/board/:boardId",
    async ({ params }) => {
      const jobs = await getJobsByBoard(params.boardId);
      const active = jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "finalizing" || j.status === "waiting_for_input" || j.status === "paused");
      return successResponse(active);
    },
    {
      params: t.Object({
        boardId: t.String(),
      }),
    }
  )

  // POST /api/agent-jobs/:id/cancel — cancel queued/running
  .post(
    "/:id/cancel",
    async (ctx) => {
      const { params, set } = ctx;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }
      if (!existing.job.workspaceId || existing.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const updated = await cancelJob(params.id);
      if (!updated) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      broadcastStatusChanged(orgId, { jobId: updated.id, status: updated.status, workItemId: updated.workItemId ?? null, planningSessionId: updated.planningSessionId ?? null });

      // Clear all AI processing state on the linked work item (isAiProcessing + metadata.aiReserved)
      if (updated.workItemId) {
        try {
          await clearWorkItemAiState(updated.workItemId);
          wsConnectionManager.broadcastToWorkspace(orgId, {
            type: "work-item:updated",
            payload: {
              workItemId: updated.workItemId,
              changes: { isAiProcessing: false, metadata: { aiReserved: false, aiReservationProvider: null } },
            },
          });
        } catch (err) {
          console.error(`[cancel-job] Failed to clear AI state for work item ${updated.workItemId}:`, err);
        }
      }

      return successResponse(updated);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /api/agent-jobs/reset-stuck — clear AI state on work items stuck without active jobs
  .post(
    "/reset-stuck",
    async (ctx) => {
      const { set } = ctx;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }

      const stuckItems = await getStuckAiWorkItems(orgId);
      if (stuckItems.length === 0) {
        return successResponse({ reset: 0, items: [] });
      }

      const resetIds: string[] = [];
      for (const item of stuckItems) {
        const cleared = await clearWorkItemAiState(item.id);
        if (cleared) {
          resetIds.push(item.id);
          wsConnectionManager.broadcastToWorkspace(orgId, {
            type: "work-item:updated",
            payload: {
              workItemId: item.id,
              changes: { isAiProcessing: false, metadata: { aiReserved: false, aiReservationProvider: null } },
            },
          });
        }
      }

      return successResponse({ reset: resetIds.length, items: resetIds });
    }
  )

  // GET /api/agent-jobs/:id/interactions — list interactions for a job
  .get(
    "/:id/interactions",
    async (ctx) => {
      const { params, set } = ctx;
      const job = await getJobById(params.id);
      if (!job) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      if (!job.job.workspaceId || job.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const interactions = await getInteractionsByJobId(params.id);
      return successResponse(interactions);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /api/agent-jobs/:id/interactions/:interactionId/respond — user answers a question
  .post(
    "/:id/interactions/:interactionId/respond",
    async (ctx) => {
      const { params, body, set } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }

      const job = await getJobById(params.id);
      if (!job) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      const updated = await respondToInteraction(
        params.interactionId,
        body.answerText,
        user?.id ?? "anonymous",
        (body.answerMetadata ?? null) as Record<string, unknown> | null
      );

      if (!updated) {
        set.status = 404;
        return errorResponse("Interaction not found or already answered");
      }

      if (job.job.planningSessionId) {
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "planning:answer-received",
          payload: {
            sessionId: job.job.planningSessionId,
            questionId: params.interactionId,
            answer: body.answerText,
          },
        });
      }

      // Dual-write: persist user answer in agent_job_logs for unified event store
      void createAgentJobLogBatch([{
        jobId: params.id,
        orgId,
        seq: Date.now(),
        level: "info",
        phase: "transcript",
        eventType: "user_input",
        message: body.answerText,
        contentType: "user_input",
        payload: {
          questionId: params.interactionId,
          ...(body.answerMetadata ?? {}),
        },
        timestamp: new Date(),
      }]).catch(() => { /* best-effort dual-write */ });

      // Transition job back to running
      const jobUpdated = await updateJobStatus(params.id, "running");
      if (jobUpdated) {
        broadcastStatusChanged(orgId, { jobId: jobUpdated.id, status: jobUpdated.status, workItemId: jobUpdated.workItemId ?? null, planningSessionId: jobUpdated.planningSessionId ?? null });
      }

      // Notify connected clients
      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "worker-interaction:responded",
        payload: {
          interactionId: updated.id,
          jobId: params.id,
          workItemId: updated.workItemId ?? "",
        },
      });

      return successResponse(updated);
    },
    {
      params: t.Object({
        id: t.String(),
        interactionId: t.String(),
      }),
      body: t.Object({
        answerText: t.String(),
        answerMetadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  )

  // POST /api/agent-jobs/:id/retry — retry failed job
  .post(
    "/:id/retry",
    async (ctx) => {
      const { params, set } = ctx;
      const orgId = getOrgIdFromContext(ctx as { activeWorkspace?: { id: string } });
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }
      const existing = await getJobById(params.id);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      if (!existing.job.workspaceId || existing.job.workspaceId !== orgId) {
        set.status = 404;
        return notFoundResponse("Agent job");
      }

      if (existing.job.status !== "failed") {
        set.status = 400;
        return errorResponse("Only failed jobs can be retried");
      }

      // For implementation/review jobs, workItemId is required and must not have an active job
      if (existing.job.jobType !== "planning") {
        if (!existing.job.workItemId) {
          set.status = 400;
          return errorResponse("Cannot retry job without workItemId");
        }

        const active = await getActiveJobForWorkItem(existing.job.workItemId);
        if (active) {
          set.status = 409;
          return errorResponse("An active job already exists for this work item");
        }
      }

      // Create a fresh Discord thread for the retry via discord-bridge
      let retryThreadId: string | null = null;
      if (isDiscordBridgeConfigured()) {
        const humanId = existing.job.config?.taskId ?? existing.workItem?.taskId ?? "job";
        retryThreadId = await createDiscordThread({
          jobType: existing.job.jobType ?? "implementation",
          taskId: humanId,
          initialMessage: `🔄 Retry encolado para ${humanId}. Esperando runner disponible...`,
        });
      }

      // Strip old threadId from config and replace with new one
      const { threadId: _oldThreadId, ...retryBaseConfig } = existing.job.config ?? {} as AgentJobConfig;
      const retryUserLocale = (ctx as { user?: { locale?: string } }).user?.locale
        ?? (typeof retryBaseConfig.locale === 'string' ? retryBaseConfig.locale : 'es');
      const retryConfig: AgentJobConfig = {
        ...retryBaseConfig,
        locale: retryUserLocale,
        ...(retryThreadId ? { threadId: retryThreadId } : {}),
      } as AgentJobConfig;

      if (existing.job.jobType === "implementation" && existing.job.workItemId) {
        try {
          const profiles = await loadSubagentMemoryProfiles(orgId, { range: "30d" });
          retryConfig.resourceEstimate = await buildRequiredImplementationResourceEstimate(
            orgId,
            existing.job.workItemId,
            profiles,
          );
        } catch (error) {
          console.error(
            `[agent-jobs] Failed to calculate required resource forecast for retry workItemId=${existing.job.workItemId}`,
            error,
          );
          set.status = 500;
          return errorResponse(
            "Unable to calculate resource forecast for retry job",
            500,
          );
        }
      }

      const retryPrompt = getTrimmedString(existing.job.prompt);
      const retryPromptTemplate = getTrimmedString(existing.job.promptTemplate);
      const retryLegacySkillName = getTrimmedString(existing.job.skillName);
      const retrySkillName =
        retryPromptTemplate === null && retryPrompt
          ? null
          : (retryPromptTemplate ?? retryLegacySkillName);

      retryConfig.resourceEstimate ??= buildDefaultJobResourceEstimate({
        jobType: existing.job.jobType,
        skillName: retrySkillName,
        promptTemplate: retryPromptTemplate,
      });

      const job = await createJob({
        projectId: existing.job.projectId ?? null,
        boardId: existing.job.boardId ?? null,
        workItemId: existing.job.workItemId ?? null,
        planningSessionId: existing.job.planningSessionId ?? null,
        createdByUserId: existing.job.createdByUserId ?? null,
        workspaceId: existing.job.workspaceId ?? orgId,
        jobType: existing.job.jobType ?? "implementation",
        provider: existing.job.provider,
        priority: existing.job.priority,
        config: retryConfig,
        codingAgent: existing.job.codingAgent ?? "claude-code",
        aiProvider: existing.job.aiProvider ?? "anthropic",
        model: existing.job.model ?? resolveRuntime({ provider: existing.job.provider }).model,
        ...(retrySkillName ? { skillName: retrySkillName } : {}),
        prompt: existing.job.prompt ?? null,
        promptTemplate: retryPromptTemplate,
        triggerType: existing.job.triggerType ?? "event",
        interactive: existing.job.interactive ?? existing.job.jobType === "planning",
      });

      broadcastStatusChanged(orgId, { jobId: job.id, status: job.status, workItemId: job.workItemId ?? null, planningSessionId: job.planningSessionId ?? null });

      set.status = 201;
      return successResponse(job);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /api/agent-jobs/:id/session-events — batch persist session events
  .post(
    "/:id/session-events",
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

  // GET /api/agent-jobs/:id/session-events — load session events for replay
  .get(
    "/:id/session-events",
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

  // POST /api/agent-jobs/:id/native-events — batch persist native runtime events
  .post(
    "/:id/native-events",
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

  // GET /api/agent-jobs/:id/native-events — load native runtime events for diagnostics
  .get(
    "/:id/native-events",
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
