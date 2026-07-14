import {
  resolveScheduledRuntimePrecedence,
  type ScheduledRuntimeSource,
} from "@almirant/shared";

export type BacklogDrainCodingAgent = "claude-code" | "codex" | "opencode";
export type BacklogDrainAiProvider = "anthropic" | "openai" | "google" | "zai" | "xai";
export type BacklogDrainProvider = "claude-code" | "codex" | "zipu" | "grok";
export type BacklogDrainSelectionMode = "implementation" | "dod-remediation";
export type BacklogDrainSkillName = "runner-implement" | "runner-fix-dod";

export interface ProjectAgentDefaults {
  implementation?: {
    codingAgent?: BacklogDrainCodingAgent | null;
    aiProvider?: BacklogDrainAiProvider | null;
    model?: string | null;
    reasoningLevel?: string | null;
  } | null;
}

export interface BacklogDrainProjectRule {
  projectId: string;
  enabled?: boolean;
  maxConcurrentJobs?: number | null;
  excludedWorkItemIds?: string[];
  excludeDescendants?: boolean;
  codingAgent?: BacklogDrainCodingAgent | null;
  aiProvider?: BacklogDrainAiProvider | null;
  model?: string | null;
  reasoningLevel?: string | null;
}

export interface BacklogDrainConfig {
  enabled?: boolean;
  minAgeMinutes?: number | null;
  defaultMaxConcurrentJobs?: number | null;
  projects?: BacklogDrainProjectRule[];
}

export interface BacklogDrainWorkItemInput {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  parentId: string | null;
  projectId: string;
  boardId: string;
  position: number;
  columnRole: string | null;
  columnIsDone: boolean | null;
  columnOrder: number | null;
  updatedAt: Date | string | number | null;
  codingAgent?: BacklogDrainCodingAgent | null;
  aiModel?: string | null;
  metadata?: Record<string, unknown> | null;
  dodIncompleted?: boolean | null;
  dodReport?: string | null;
  dodReviewedAt?: string | null;
  dodRemediationAttemptCount?: number | null;
}

export interface BacklogDrainDependencyInput {
  workItemId: string;
  blockedByWorkItemId: string;
}

export interface BacklogDrainActiveJobInput {
  projectId: string | null;
  workItemId: string | null;
  countsForConcurrency?: boolean;
}

export interface BacklogDrainProjectInput {
  id: string;
  agentDefaults?: ProjectAgentDefaults | null;
}

export interface BacklogDrainSelectionInput {
  mode?: BacklogDrainSelectionMode;
  rules: BacklogDrainProjectRule[];
  defaultMaxConcurrentJobs?: number | null;
  workItems: BacklogDrainWorkItemInput[];
  dependencies: BacklogDrainDependencyInput[];
  activeJobs: BacklogDrainActiveJobInput[];
  projects?: BacklogDrainProjectInput[];
  now?: Date | string | number;
  stabilizationWindowMs?: number | null;
  fallbackRuntime?: {
    provider?: BacklogDrainProvider | null;
    codingAgent?: BacklogDrainCodingAgent | null;
    aiProvider?: BacklogDrainAiProvider | null;
    model?: string | null;
    reasoningLevel?: string | null;
  };
  /** Highest-priority active connection resolved from the same source as API validation. */
  connectionRuntime?: ScheduledRuntimeSource | null;
}

export interface BacklogDrainCandidate {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  parentId: string | null;
  projectId: string;
  boardId: string;
  codingAgent: BacklogDrainCodingAgent;
  aiProvider: BacklogDrainAiProvider;
  provider: BacklogDrainProvider;
  model: string;
  reasoningLevel?: string | null;
  skillName: BacklogDrainSkillName;
  dodReport?: string | null;
  dodReviewedAt?: string | null;
}

export interface BacklogDrainSelectionResult {
  candidates: BacklogDrainCandidate[];
  skipped: {
    excluded: string[];
    blocked: Array<{ workItemId: string; blockedBy: string[] }>;
    active: string[];
    concurrency: string[];
    recentlyModified: Array<{ workItemId: string; lastModifiedAt: string }>;
    dodIncomplete: string[];
    notDodRemediation: string[];
    missingDodReport: string[];
    humanReviewRequired: string[];
  };
}

const DEFAULT_MAX_CONCURRENT_PER_PROJECT = 1;
const DEFAULT_STABILIZATION_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTOMATED_DOD_INCOMPLETE_COUNT = 3;

const isTruthyEnabled = (enabled: boolean | undefined): boolean => enabled !== false;

const finitePositiveInt = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
};

const finiteNonNegativeNumber = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 0 ? value : null;
};

const toTimeMs = (value: Date | string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const timeMs = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
};

const toIsoString = (timeMs: number): string => new Date(timeMs).toISOString();

const getStringMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const getNumberMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): number | null => {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isDodIncomplete = (item: BacklogDrainWorkItemInput): boolean => {
  return item.dodIncompleted === true || item.metadata?.dod_incompleted === true;
};

const getDodReport = (item: BacklogDrainWorkItemInput): string | null => {
  if (typeof item.dodReport === "string" && item.dodReport.trim().length > 0) {
    return item.dodReport;
  }
  return getStringMetadata(item.metadata, "dod_report");
};

const getDodReviewedAt = (item: BacklogDrainWorkItemInput): string | null => {
  if (typeof item.dodReviewedAt === "string" && item.dodReviewedAt.trim().length > 0) {
    return item.dodReviewedAt;
  }
  return getStringMetadata(item.metadata, "dod_reviewed_at");
};

const getDodIncompleteCount = (item: BacklogDrainWorkItemInput): number => {
  return Math.max(0, Math.floor(getNumberMetadata(item.metadata, "dod_incompleted_count") ?? 0));
};

const getDodRemediationAttemptCount = (item: BacklogDrainWorkItemInput): number => {
  if (typeof item.dodRemediationAttemptCount === "number" && Number.isFinite(item.dodRemediationAttemptCount)) {
    return Math.max(0, Math.floor(item.dodRemediationAttemptCount));
  }
  return Math.max(0, Math.floor(getNumberMetadata(item.metadata, "dod_remediation_attempt_count") ?? 0));
};

const requiresHumanDodReview = (item: BacklogDrainWorkItemInput): boolean => {
  return item.metadata?.dod_human_action_required === true
    || item.metadata?.dod_human_review_required === true
    || item.metadata?.dod_auto_remediation_blocked === true
    || item.metadata?.dod_external_validation_required === true
    || getDodIncompleteCount(item) > MAX_AUTOMATED_DOD_INCOMPLETE_COUNT
    || getDodRemediationAttemptCount(item) > MAX_AUTOMATED_DOD_INCOMPLETE_COUNT;
};

const getDepth = (
  item: BacklogDrainWorkItemInput,
  itemById: Map<string, BacklogDrainWorkItemInput>,
): number => {
  let depth = 0;
  let current: BacklogDrainWorkItemInput | undefined = item;
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = itemById.get(current.parentId);
    if (!parent) break;
    depth++;
    current = parent;
  }
  return depth;
};

const buildPathKey = (
  item: BacklogDrainWorkItemInput,
  itemById: Map<string, BacklogDrainWorkItemInput>,
): string => {
  const chain: BacklogDrainWorkItemInput[] = [];
  let current: BacklogDrainWorkItemInput | undefined = item;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? itemById.get(current.parentId) : undefined;
  }
  return chain
    .reverse()
    .map((entry) => `${String(entry.position).padStart(8, "0")}:${entry.taskId ?? entry.title}:${entry.id}`)
    .join("/");
};

const descendantsOf = (
  rootId: string,
  childrenByParent: Map<string, BacklogDrainWorkItemInput[]>,
): string[] => {
  const result: string[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const item = stack.pop()!;
    result.push(item.id);
    stack.push(...(childrenByParent.get(item.id) ?? []));
  }
  return result;
};

const latestUpdatedAtInBlock = (
  root: BacklogDrainWorkItemInput,
  childrenByParent: Map<string, BacklogDrainWorkItemInput[]>,
): number | null => {
  let latest = toTimeMs(root.updatedAt);
  const seen = new Set<string>();
  const stack: BacklogDrainWorkItemInput[] = [root];

  while (stack.length > 0) {
    const item = stack.pop()!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const itemUpdatedAt = toTimeMs(item.updatedAt);
    if (itemUpdatedAt !== null && (latest === null || itemUpdatedAt > latest)) {
      latest = itemUpdatedAt;
    }

    stack.push(...(childrenByParent.get(item.id) ?? []));
  }

  return latest;
};

const dodIncompleteIdsInBlock = (
  root: BacklogDrainWorkItemInput,
  childrenByParent: Map<string, BacklogDrainWorkItemInput[]>,
): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  const stack: BacklogDrainWorkItemInput[] = [root];

  while (stack.length > 0) {
    const item = stack.pop()!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    if (isDodIncomplete(item)) {
      result.push(item.id);
    }

    stack.push(...(childrenByParent.get(item.id) ?? []));
  }

  return result;
};

const humanReviewRequiredIdsInBlock = (
  root: BacklogDrainWorkItemInput,
  childrenByParent: Map<string, BacklogDrainWorkItemInput[]>,
): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  const stack: BacklogDrainWorkItemInput[] = [root];

  while (stack.length > 0) {
    const item = stack.pop()!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    if (isDodIncomplete(item) && requiresHumanDodReview(item)) {
      result.push(item.id);
    }

    stack.push(...(childrenByParent.get(item.id) ?? []));
  }

  return result;
};

const humanReviewRequiredIdsInAncestorBlocks = (
  item: BacklogDrainWorkItemInput,
  itemById: Map<string, BacklogDrainWorkItemInput>,
  childrenByParent: Map<string, BacklogDrainWorkItemInput[]>,
): string[] => {
  const result = new Set<string>();
  const seenAncestors = new Set<string>();
  let current = item.parentId ? itemById.get(item.parentId) : undefined;

  while (current && !seenAncestors.has(current.id)) {
    seenAncestors.add(current.id);
    for (const humanId of humanReviewRequiredIdsInBlock(current, childrenByParent)) {
      result.add(humanId);
    }
    current = current.parentId ? itemById.get(current.parentId) : undefined;
  }

  return [...result];
};

const pushUnique = (target: string[], ids: string[]): void => {
  for (const id of ids) {
    if (!target.includes(id)) target.push(id);
  }
};

const computeStatusMaps = (
  workItems: BacklogDrainWorkItemInput[],
  childrenByParent: Map<string, BacklogDrainWorkItemInput[]>,
): Map<string, { role: string | null; isDone: boolean; order: number }> => {
  const memo = new Map<string, { role: string | null; isDone: boolean; order: number }>();
  const itemById = new Map(workItems.map((item) => [item.id, item]));

  const compute = (item: BacklogDrainWorkItemInput): { role: string | null; isDone: boolean; order: number } => {
    const cached = memo.get(item.id);
    if (cached) return cached;

    if (item.columnRole) {
      const direct = {
        role: item.columnRole,
        isDone: item.columnIsDone === true,
        order: item.columnOrder ?? Number.MAX_SAFE_INTEGER,
      };
      memo.set(item.id, direct);
      return direct;
    }

    const children = childrenByParent.get(item.id) ?? [];
    if (children.length === 0) {
      const emptyParent = { role: "backlog", isDone: false, order: 0 };
      memo.set(item.id, emptyParent);
      return emptyParent;
    }

    const childStatuses = children.map(compute);
    if (childStatuses.every((status) => status.isDone)) {
      const done = childStatuses.slice().sort((a, b) => a.order - b.order)[0] ?? {
        role: "done",
        isDone: true,
        order: Number.MAX_SAFE_INTEGER,
      };
      const resolved = { ...done, isDone: true };
      memo.set(item.id, resolved);
      return resolved;
    }

    const leastAdvanced = childStatuses
      .filter((status) => !status.isDone)
      .sort((a, b) => a.order - b.order)[0] ?? { role: "backlog", isDone: false, order: 0 };
    const resolved = { ...leastAdvanced, isDone: false };
    memo.set(item.id, resolved);
    return resolved;
  };

  for (const item of itemById.values()) compute(item);
  return memo;
};

export const selectBacklogDrainCandidates = (
  input: BacklogDrainSelectionInput,
): BacklogDrainSelectionResult => {
  const mode = input.mode ?? "implementation";
  const currentTimeMs = toTimeMs(input.now) ?? Date.now();
  const stabilizationWindowMs = finiteNonNegativeNumber(input.stabilizationWindowMs)
    ?? DEFAULT_STABILIZATION_WINDOW_MS;
  const itemById = new Map(input.workItems.map((item) => [item.id, item]));
  const childrenByParent = new Map<string, BacklogDrainWorkItemInput[]>();
  for (const item of input.workItems) {
    if (!item.parentId) continue;
    const list = childrenByParent.get(item.parentId) ?? [];
    list.push(item);
    childrenByParent.set(item.parentId, list);
  }

  const statusById = computeStatusMaps(input.workItems, childrenByParent);
  const activeWorkItemIds = new Set(input.activeJobs.map((job) => job.workItemId).filter(Boolean) as string[]);
  const activeCountByProject = new Map<string, number>();
  for (const job of input.activeJobs) {
    if (!job.projectId) continue;
    if (job.countsForConcurrency === false) continue;
    activeCountByProject.set(job.projectId, (activeCountByProject.get(job.projectId) ?? 0) + 1);
  }

  const dependenciesByWorkItem = new Map<string, string[]>();
  for (const dependency of input.dependencies) {
    const list = dependenciesByWorkItem.get(dependency.workItemId) ?? [];
    list.push(dependency.blockedByWorkItemId);
    dependenciesByWorkItem.set(dependency.workItemId, list);
  }

  const projectDefaultsById = new Map(input.projects?.map((project) => [project.id, project.agentDefaults ?? null]) ?? []);
  const selected: BacklogDrainCandidate[] = [];
  const skipped: BacklogDrainSelectionResult["skipped"] = {
    excluded: [],
    blocked: [],
    active: [],
    concurrency: [],
    recentlyModified: [],
    dodIncomplete: [],
    notDodRemediation: [],
    missingDodReport: [],
    humanReviewRequired: [],
  };

  for (const rule of input.rules.filter((r) => isTruthyEnabled(r.enabled))) {
    const projectItems = input.workItems.filter((item) => item.projectId === rule.projectId);
    const excluded = new Set<string>();
    for (const excludedId of rule.excludedWorkItemIds ?? []) {
      excluded.add(excludedId);
      if (rule.excludeDescendants !== false) {
        for (const descendantId of descendantsOf(excludedId, childrenByParent)) {
          excluded.add(descendantId);
        }
      }
    }

    for (const id of excluded) skipped.excluded.push(id);

    const maxConcurrent = finitePositiveInt(rule.maxConcurrentJobs)
      ?? finitePositiveInt(input.defaultMaxConcurrentJobs)
      ?? DEFAULT_MAX_CONCURRENT_PER_PROJECT;
    let availableSlots = Math.max(0, maxConcurrent - (activeCountByProject.get(rule.projectId) ?? 0));

    if (availableSlots <= 0) {
      skipped.concurrency.push(rule.projectId);
      continue;
    }

    const readyItems = projectItems
      .filter((item) => !excluded.has(item.id))
      .filter((item) => {
        if (!activeWorkItemIds.has(item.id)) return true;
        skipped.active.push(item.id);
        return false;
      })
      .filter((item) => statusById.get(item.id)?.role === "backlog")
      .filter((item) => {
        if (mode === "dod-remediation") {
          if (!isDodIncomplete(item)) {
            skipped.notDodRemediation.push(item.id);
            return false;
          }

          const humanReviewIds = [
            ...humanReviewRequiredIdsInBlock(item, childrenByParent),
            ...humanReviewRequiredIdsInAncestorBlocks(item, itemById, childrenByParent),
          ];
          if (humanReviewIds.length > 0) {
            pushUnique(skipped.humanReviewRequired, [item.id, ...humanReviewIds]);
            return false;
          }

          if (!getDodReport(item)) {
            skipped.missingDodReport.push(item.id);
            return false;
          }
          return true;
        }

        const dodIncompleteIds = dodIncompleteIdsInBlock(item, childrenByParent);
        if (dodIncompleteIds.length === 0) return true;
        skipped.dodIncomplete.push(item.id, ...dodIncompleteIds);
        return false;
      })
      .filter((item) => {
        const blockers = dependenciesByWorkItem.get(item.id) ?? [];
        const openBlockers = blockers.filter((blockerId) => statusById.get(blockerId)?.isDone !== true);
        if (openBlockers.length === 0) return true;
        skipped.blocked.push({ workItemId: item.id, blockedBy: openBlockers });
        return false;
      });

    const readyIds = new Set(readyItems.map((item) => item.id));
    const highestReadyItems = readyItems.filter((item) => {
      let current = item.parentId ? itemById.get(item.parentId) : undefined;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (readyIds.has(current.id) && !excluded.has(current.id)) return false;
        current = current.parentId ? itemById.get(current.parentId) : undefined;
      }
      return true;
    });

    highestReadyItems.sort((a, b) => {
      const depthDiff = getDepth(a, itemById) - getDepth(b, itemById);
      if (depthDiff !== 0) return depthDiff;
      return buildPathKey(a, itemById).localeCompare(buildPathKey(b, itemById));
    });

    const projectDefaults = projectDefaultsById.get(rule.projectId)?.implementation ?? null;
    for (const item of highestReadyItems) {
      if (availableSlots <= 0) break;

      const latestUpdatedAt = latestUpdatedAtInBlock(item, childrenByParent);
      if (latestUpdatedAt !== null && currentTimeMs - latestUpdatedAt < stabilizationWindowMs) {
        skipped.recentlyModified.push({
          workItemId: item.id,
          lastModifiedAt: toIsoString(latestUpdatedAt),
        });
        continue;
      }

      const runtime = resolveScheduledRuntimePrecedence({
        rule,
        schedule: input.fallbackRuntime,
        workItem: {
          codingAgent: item.codingAgent,
          model: item.aiModel,
        },
        project: projectDefaults,
        connection: input.connectionRuntime,
      });
      const codingAgent = runtime.codingAgent as BacklogDrainCodingAgent;
      const aiProvider = runtime.aiProvider as BacklogDrainAiProvider;
      const model = runtime.model;
      const provider = runtime.provider as BacklogDrainProvider;

      selected.push({
        id: item.id,
        taskId: item.taskId,
        title: item.title,
        type: item.type,
        parentId: item.parentId,
        projectId: item.projectId,
        boardId: item.boardId,
        codingAgent,
        aiProvider,
        provider,
        model,
        reasoningLevel: runtime.reasoningLevel,
        skillName: mode === "dod-remediation" ? "runner-fix-dod" : "runner-implement",
        ...(mode === "dod-remediation"
          ? {
              dodReport: getDodReport(item),
              dodReviewedAt: getDodReviewedAt(item),
            }
          : {}),
      });
      availableSlots--;
    }
  }

  return { candidates: selected, skipped };
};
