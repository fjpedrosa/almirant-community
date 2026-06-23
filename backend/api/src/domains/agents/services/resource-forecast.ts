import {
  getDependenciesBatch,
  getWorkItemById,
  getWorkItemHierarchy,
  updateWorkItem,
} from "@almirant/database";
import {
  BASE_RUNNER_MEMORY_MB,
  DEFAULT_SUBAGENT_MEMORY_MB,
  MAX_CONCURRENT_SUBAGENTS,
  getSkillMemoryMb,
  type ResourceConfidence,
  type ResourceEstimate,
} from "@almirant/shared";

type WorkItemLike = {
  id: string;
  taskId?: string | null;
  title: string;
  description?: string | null;
  type: string;
  metadata?: Record<string, unknown> | null;
};

export type ForecastTask = WorkItemLike & {
  inferredSubagentType: string;
  estimatedMemoryMb: number;
  estimateSource: "profile" | "heuristic" | "skill-default";
  confidence: ResourceConfidence;
};

export type ResourceForecastWave = {
  wave: number;
  taskIds: string[];
  estimatedMemoryMb: number;
  tasks: Array<{
    id: string;
    taskId: string | null;
    title: string;
    inferredSubagentType: string;
    estimatedMemoryMb: number;
    confidence: ResourceConfidence;
  }>;
};

export type ResourceForecast = {
  workItemId: string;
  generatedAt: string;
  baseMemoryMb: number;
  estimatedPeakMemoryMb: number;
  estimatedConcurrentTasks: number;
  estimatedSubagentTypes: string[];
  bottleneckWave: number | null;
  confidence: ResourceConfidence;
  source: "wave-forecast";
  assumptions: string[];
  waves: ResourceForecastWave[];
};

export type SubagentMemoryProfileInput = {
  subagentType: string;
  p95MemoryDeltaMb: number;
  p50MemoryDeltaMb?: number;
  sampleCount: number;
};

const MIN_TASK_MEMORY_MB = 512;
const MIN_PROFILE_SAMPLE_COUNT = 10;
const MAX_EMPIRICAL_PROFILE_MEMORY_MULTIPLIER = 2;
const MIN_IMPLEMENTATION_JOB_MEMORY_MB = 3072;
const MEMORY_ALLOCATION_QUANTUM_MB = 1024;

const SUBAGENT_MEMORY_FALLBACKS: Record<string, number> = {
  // Production lower-bound estimates from runner telemetry, rounded upward.
  // Container-level metrics cannot perfectly isolate subagent RSS, so prefer
  // safe cgroup sizing over optimistic packing.
  "api-documenter": 1024,
  "docusaurus-expert": 1024,
  "frontend-developer": 1280,
  "backend-architect": 1280,
  "general-purpose": 1280,
  "ui-ux-designer": 1280,
  "clean-architecture-expert": 1280,
  "frontend-clean-architect": 1280,
  "database-architect": 1536,
  "javascript-pro": 1536,
  "error-detective": 1536,
  "ai-engineer": 1536,
};

const clampMemory = (value: number): number =>
  Math.max(MIN_TASK_MEMORY_MB, Math.ceil(value));

const roundUpMemory = (value: number): number =>
  Math.ceil(value / MEMORY_ALLOCATION_QUANTUM_MB) * MEMORY_ALLOCATION_QUANTUM_MB;

const normalizeForecastJobMemory = (value: number): number =>
  roundUpMemory(Math.max(MIN_IMPLEMENTATION_JOB_MEMORY_MB, value));

const capEmpiricalProfileMemory = (
  value: number,
  inferredSubagentType: string,
): number => {
  const fallbackMemory =
    SUBAGENT_MEMORY_FALLBACKS[inferredSubagentType] ?? DEFAULT_SUBAGENT_MEMORY_MB;
  const profileCeiling = fallbackMemory * MAX_EMPIRICAL_PROFILE_MEMORY_MULTIPLIER;

  return Math.min(clampMemory(value), profileCeiling);
};

const hasAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

export const inferSubagentTypeForTask = (task: Pick<WorkItemLike, "title" | "description">): string => {
  const text = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();

  if (hasAny(text, [/\b(doc|docs|documentation|readme|docusaurus|manual|guide)\b/])) {
    return "api-documenter";
  }
  if (hasAny(text, [/\b(db|database|postgres|sql|drizzle|migration|schema)\b/])) {
    return "database-architect";
  }
  if (hasAny(text, [/\b(api|backend|server|elysia|endpoint|route|repository)\b/])) {
    return "backend-architect";
  }
  if (hasAny(text, [/\b(frontend|ui|ux|react|next|tailwind|component|tsx|page|layout)\b/])) {
    return "frontend-developer";
  }
  if (hasAny(text, [/\b(test|vitest|jest|playwright|coverage|spec)\b/])) {
    return "javascript-pro";
  }

  return "general-purpose";
};

const profileConfidence = (sampleCount: number): ResourceConfidence => {
  if (sampleCount >= 30) return "high";
  if (sampleCount >= 10) return "medium";
  return "low";
};

const combineConfidence = (values: ResourceConfidence[]): ResourceConfidence => {
  if (values.includes("low")) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
};

export const estimateTaskMemory = (
  task: WorkItemLike,
  profiles: SubagentMemoryProfileInput[] = [],
): ForecastTask => {
  const inferredSubagentType = inferSubagentTypeForTask(task);
  const profile = profiles.find((entry) => entry.subagentType === inferredSubagentType);

  if (
    profile &&
    profile.sampleCount >= MIN_PROFILE_SAMPLE_COUNT &&
    profile.p95MemoryDeltaMb > 0
  ) {
    return {
      ...task,
      inferredSubagentType,
      estimatedMemoryMb: capEmpiricalProfileMemory(
        profile.p95MemoryDeltaMb,
        inferredSubagentType,
      ),
      estimateSource: "profile",
      confidence: profileConfidence(profile.sampleCount),
    };
  }

  const fallbackMemory = SUBAGENT_MEMORY_FALLBACKS[inferredSubagentType];
  if (fallbackMemory) {
    return {
      ...task,
      inferredSubagentType,
      estimatedMemoryMb: fallbackMemory,
      estimateSource: "heuristic",
      confidence: "low",
    };
  }

  return {
    ...task,
    inferredSubagentType,
    estimatedMemoryMb: DEFAULT_SUBAGENT_MEMORY_MB,
    estimateSource: "skill-default",
    confidence: "low",
  };
};

const calculateCappedWaveMemory = (tasks: ForecastTask[]): number => {
  if (tasks.length === 0) return BASE_RUNNER_MEMORY_MB;

  const sortedTaskMemory = [...tasks]
    .map((task) => task.estimatedMemoryMb)
    .sort((a, b) => b - a);
  const mostExpensiveConcurrentBatch = sortedTaskMemory
    .slice(0, MAX_CONCURRENT_SUBAGENTS)
    .reduce((sum, memoryMb) => sum + memoryMb, 0);

  return BASE_RUNNER_MEMORY_MB + mostExpensiveConcurrentBatch;
};

export const buildExecutionWaves = (
  taskIds: string[],
  dependencies: Array<{ workItemId: string; blockedByWorkItemId: string }>,
): Array<{ wave: number; taskIds: string[] }> => {
  const uniqueTaskIds = Array.from(new Set(taskIds));
  const validSet = new Set(uniqueTaskIds);
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of uniqueTaskIds) {
    adjacency.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const dep of dependencies) {
    if (!validSet.has(dep.workItemId) || !validSet.has(dep.blockedByWorkItemId)) continue;
    const outs = adjacency.get(dep.blockedByWorkItemId);
    if (outs && !outs.has(dep.workItemId)) {
      outs.add(dep.workItemId);
      inDegree.set(dep.workItemId, (inDegree.get(dep.workItemId) ?? 0) + 1);
    }
  }

  const waves: Array<{ wave: number; taskIds: string[] }> = [];
  const remaining = new Set(uniqueTaskIds);
  let waveIndex = 1;

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => (inDegree.get(id) ?? 0) === 0);
    const current = ready.length > 0 ? ready : [...remaining];
    waves.push({ wave: waveIndex, taskIds: current });

    for (const id of current) {
      remaining.delete(id);
      for (const out of adjacency.get(id) ?? []) {
        inDegree.set(out, (inDegree.get(out) ?? 0) - 1);
      }
    }

    if (ready.length === 0) break;
    waveIndex += 1;
  }

  return waves;
};

export const calculateResourceForecast = (
  args: {
    workItemId: string;
    tasks: WorkItemLike[];
    dependencies: Array<{ workItemId: string; blockedByWorkItemId: string }>;
    profiles?: SubagentMemoryProfileInput[];
    generatedAt?: Date;
  },
): ResourceForecast => {
  const generatedAt = args.generatedAt ?? new Date();
  const estimatedTasks = args.tasks.map((task) => estimateTaskMemory(task, args.profiles));
  const taskById = new Map(estimatedTasks.map((task) => [task.id, task]));
  const waves = buildExecutionWaves(estimatedTasks.map((task) => task.id), args.dependencies)
    .map<ResourceForecastWave>((wave) => {
      const tasks = wave.taskIds
        .map((id) => taskById.get(id))
        .filter((task): task is ForecastTask => !!task);
      const estimatedMemoryMb = normalizeForecastJobMemory(calculateCappedWaveMemory(tasks));
      return {
        wave: wave.wave,
        taskIds: wave.taskIds,
        estimatedMemoryMb,
        tasks: tasks.map((task) => ({
          id: task.id,
          taskId: task.taskId ?? null,
          title: task.title,
          inferredSubagentType: task.inferredSubagentType,
          estimatedMemoryMb: task.estimatedMemoryMb,
          confidence: task.confidence,
        })),
      };
    });

  const bottleneck = waves.reduce<ResourceForecastWave | null>(
    (current, wave) => !current || wave.estimatedMemoryMb > current.estimatedMemoryMb ? wave : current,
    null,
  );
  const confidence = estimatedTasks.length > 0
    ? combineConfidence(estimatedTasks.map((task) => task.confidence))
    : "low";

  return {
    workItemId: args.workItemId,
    generatedAt: generatedAt.toISOString(),
    baseMemoryMb: BASE_RUNNER_MEMORY_MB,
    estimatedPeakMemoryMb: bottleneck?.estimatedMemoryMb ?? BASE_RUNNER_MEMORY_MB,
    estimatedConcurrentTasks: bottleneck
      ? Math.min(bottleneck.tasks.length, MAX_CONCURRENT_SUBAGENTS)
      : 0,
    estimatedSubagentTypes: Array.from(new Set(estimatedTasks.map((task) => task.inferredSubagentType))).sort(),
    bottleneckWave: bottleneck?.wave ?? null,
    confidence,
    source: "wave-forecast",
    assumptions: [
      "Peak RAM is estimated as base runner memory plus concurrent task/subagent memory in the most expensive wave.",
      `Implementation job forecasts are rounded to ${MEMORY_ALLOCATION_QUANTUM_MB}MB blocks with a ${MIN_IMPLEMENTATION_JOB_MEMORY_MB}MB safety floor.`,
      `Each execution wave is capped at ${MAX_CONCURRENT_SUBAGENTS} concurrent subagents to match runner-implement orchestration limits.`,
      "Exact per-subagent attribution is not assumed when subagents share a process or container.",
      `Empirical per-subagent profiles are capped at ${MAX_EMPIRICAL_PROFILE_MEMORY_MULTIPLIER}x the heuristic fallback to avoid double-counting shared runner/container memory during concurrent subagent waves.`,
      `Low-confidence estimates start at ${DEFAULT_SUBAGENT_MEMORY_MB}MB per subagent until at least ${MIN_PROFILE_SAMPLE_COUNT} empirical samples exist for that subagent type.`,
    ],
    waves,
  };
};

const resolveLeafTasks = async (
  organizationId: string,
  item: NonNullable<Awaited<ReturnType<typeof getWorkItemById>>>,
  seen: Set<string>,
): Promise<WorkItemLike[]> => {
  if (seen.has(item.id)) return [];
  seen.add(item.id);

  const children = await getWorkItemHierarchy(organizationId, item.id);
  if (item.type === "task" && children.length === 0) {
    return [item as WorkItemLike];
  }

  const leaves: WorkItemLike[] = [];
  for (const child of children) {
    const hydrated = await getWorkItemById(child.id, organizationId);
    if (!hydrated) continue;
    leaves.push(...await resolveLeafTasks(organizationId, hydrated, seen));
  }
  return leaves;
};

export const buildWorkItemResourceForecast = async (
  organizationId: string,
  workItemId: string,
  options: { profiles?: SubagentMemoryProfileInput[]; persist?: boolean } = {},
): Promise<ResourceForecast | null> => {
  const root = await getWorkItemById(workItemId, organizationId);
  if (!root) return null;

  const tasks = await resolveLeafTasks(organizationId, root, new Set<string>());
  const leafTasks = tasks.length > 0 ? tasks : [root as WorkItemLike];
  const dependencies = await getDependenciesBatch(leafTasks.map((task) => task.id));
  const forecast = calculateResourceForecast({
    workItemId,
    tasks: leafTasks,
    dependencies: dependencies.map((dep) => ({
      workItemId: dep.workItemId,
      blockedByWorkItemId: dep.blockedByWorkItemId,
    })),
    profiles: options.profiles,
  });

  if (options.persist) {
    const metadata = {
      ...((root.metadata as Record<string, unknown> | null) ?? {}),
      resourceForecast: forecast,
    };
    await updateWorkItem(organizationId, workItemId, { metadata });
  }

  return forecast;
};


export type ResourceForecastRefreshResult = {
  requestedWorkItemIds: string[];
  affectedBlockIds: string[];
  refreshed: ResourceForecast[];
  skipped: string[];
  failed: Array<{ workItemId: string; errorMessage: string }>;
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));

const resolveWorkItemAndAncestors = async (
  organizationId: string,
  workItemId: string,
): Promise<string[]> => {
  const ids: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null = workItemId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const item = await getWorkItemById(currentId, organizationId);
    if (!item) break;

    ids.push(item.id);
    currentId = item.parentId ?? null;
  }

  return ids;
};

/**
 * Resolve every implementation block whose cached forecast may be affected by
 * changes to the given work items. A block can be the item itself or any of its
 * ancestors because users may enqueue implementation at task, story, feature,
 * or epic level.
 */
export const resolveAffectedResourceForecastBlockIds = async (
  organizationId: string,
  workItemIds: string[],
): Promise<string[]> => {
  const affectedIds = new Set<string>();

  for (const workItemId of uniqueStrings(workItemIds)) {
    const ancestors = await resolveWorkItemAndAncestors(organizationId, workItemId);
    for (const id of ancestors) {
      affectedIds.add(id);
    }
  }

  return Array.from(affectedIds);
};

/**
 * Refresh persisted RAM forecasts for every affected implementation block.
 *
 * This function is intentionally best-effort per block: a single stale/missing
 * work item must not make the user-facing create/update operation fail. Enqueue
 * still recalculates when a job has no resourceEstimate, so this eager refresh
 * is a freshness optimization for scheduler preflight and runner reservation.
 */
export const refreshResourceForecastForAffectedBlocks = async (
  organizationId: string,
  workItemIds: string[],
): Promise<ResourceForecastRefreshResult> => {
  const requestedWorkItemIds = uniqueStrings(workItemIds);
  const refreshed: ResourceForecast[] = [];
  const skipped: string[] = [];
  const failed: Array<{ workItemId: string; errorMessage: string }> = [];
  let affectedBlockIds: string[] = [];

  try {
    affectedBlockIds = await resolveAffectedResourceForecastBlockIds(
      organizationId,
      requestedWorkItemIds,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      requestedWorkItemIds,
      affectedBlockIds,
      refreshed,
      skipped,
      failed: requestedWorkItemIds.map((workItemId) => ({ workItemId, errorMessage })),
    };
  }

  for (const blockId of affectedBlockIds) {
    try {
      const forecast = await buildWorkItemResourceForecast(organizationId, blockId, { persist: true });
      if (forecast) {
        refreshed.push(forecast);
      } else {
        skipped.push(blockId);
      }
    } catch (error) {
      failed.push({
        workItemId: blockId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    requestedWorkItemIds,
    affectedBlockIds,
    refreshed,
    skipped,
    failed,
  };
};


export const buildDefaultJobResourceEstimate = (args: {
  jobType?: string | null;
  skillName?: string | null;
  promptTemplate?: string | null;
}): ResourceEstimate => {
  const skillOrType =
    args.promptTemplate?.trim() ||
    args.skillName?.trim() ||
    args.jobType?.trim() ||
    "job";

  return {
    estimatedMemoryMb: getSkillMemoryMb(skillOrType),
    source: "skill-default",
    confidence: "low",
    reason: `Default ${skillOrType} estimate: ${BASE_RUNNER_MEMORY_MB}MB base runner plus expected subagent overhead`,
  };
};

export const toJobResourceEstimate = (forecast: ResourceForecast): ResourceEstimate => ({
  estimatedMemoryMb: forecast.estimatedPeakMemoryMb,
  source: "forecast",
  confidence: forecast.confidence,
  reason: `Peak wave ${forecast.bottleneckWave ?? "n/a"} with ${forecast.estimatedConcurrentTasks} concurrent task(s)`,
});
