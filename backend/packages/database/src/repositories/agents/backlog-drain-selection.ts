import {
  getDefaultAgentModel,
  resolveScheduledRuntimePrecedence,
  type BuiltinAutomationId,
  type ScheduledRuntimeSource,
} from "@almirant/shared";

export type BacklogDrainCodingAgent = "claude-code" | "codex" | "opencode" | "pi";
export type BacklogDrainAiProvider = "anthropic" | "openai" | "google" | "zai" | "xai";
export type BacklogDrainProvider = "claude-code" | "codex" | "zipu" | "grok";
export type BacklogDrainSelectionMode = "implementation" | "dod-remediation";
export type BacklogDrainSkillName = "runner-implement" | "runner-fix-dod";

/**
 * Dev-flow (issue #230) per-automation config (issue #235): one automation's
 * override entry under `devFlow.automations.<automationId>`. Every field is
 * independently optional/nullable — absent (or explicitly null) means
 * "inherit the card-level devFlow default for this field" (or, for
 * `schedule`, "use the runtime's default cron expression/timezone"). See
 * `dev-flow-provisioning.ts`'s `resolveEffectiveRuntime`/
 * `resolveEffectiveSchedule` for the merge semantics.
 */
export interface DevFlowAutomationOverride {
  enabled?: boolean | null;
  codingAgent?: BacklogDrainCodingAgent | null;
  aiProvider?: BacklogDrainAiProvider | null;
  model?: string | null;
  reasoningLevel?: string | null;
  maxConcurrentJobs?: number | null;
  /** `schedule: null` explicitly clears a previously-saved schedule
   *  override (back to inheriting the runtime default). */
  schedule?: { expression: string; timezone?: string | null } | null;
}

export interface ProjectAgentDefaults {
  implementation?: {
    codingAgent?: BacklogDrainCodingAgent | null;
    aiProvider?: BacklogDrainAiProvider | null;
    model?: string | null;
    reasoningLevel?: string | null;
  } | null;
  /**
   * Dev-flow (issue #230): activates the four built-in automations
   * (backlog drain, DoD remediation, DoD review, release integration) for
   * this project with minimal configuration, instead of the user
   * hand-creating four scheduled-agent configs. Persisted here (rather than
   * a new column) so it follows the same PATCH /projects/:id/ai-config
   * surface as `implementation`. Runtime overrides below are optional —
   * omitted fields fall through to the normal scheduled-runtime precedence
   * (project rule > scheduled config > work item > project defaults >
   * active connection > provider default; see
   * `scheduled-runtime-precedence.ts`) at dispatch time, exactly like
   * `implementation`. See `dev-flow-provisioning.ts` for the idempotent
   * upsert that turns this into four `scheduled_agent_configs` rows.
   */
  devFlow?: {
    enabled: boolean;
    codingAgent?: BacklogDrainCodingAgent | null;
    aiProvider?: BacklogDrainAiProvider | null;
    model?: string | null;
    reasoningLevel?: string | null;
    /**
     * Optional per-project concurrency cap applied uniformly to all four
     * automations' `targetConfig.<mode>.defaultMaxConcurrentJobs` (NOT
     * `scheduled_agent_configs.maxJobsPerRun`, which stays at its normal
     * default — see dev-flow-provisioning.ts), unless an automation has its
     * own `maxConcurrentJobs` override below.
     */
    maxConcurrentJobs?: number | null;
    /**
     * Per-automation config (issue #235): each of the 4 built-ins can
     * override its own runtime/concurrency/schedule/enabled flag,
     * inheriting the card-level fields above when absent. Keyed by
     * `BuiltinAutomationId` (`@almirant/shared`'s builtin-automations.ts
     * catalog) — validated against the catalog at the route layer
     * (PATCH /projects/:id/ai-config), not here.
     */
    automations?: Partial<Record<BuiltinAutomationId, DevFlowAutomationOverride | null>>;
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
  startDate?: Date | string | number | null;
  codingAgent?: BacklogDrainCodingAgent | null;
  aiModel?: string | null;
  metadata?: Record<string, unknown> | null;
  dodIncompleted?: boolean | null;
  dodReport?: string | null;
  dodReviewedAt?: string | null;
  dodRemediationAttemptCount?: number | null;
  /** Scheduled agent config this item is dedicated to, if any. Null/undefined means unassigned. */
  scheduledAgentConfigId?: string | null;
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
  /**
   * Id of the scheduled agent config running this drain. Items already
   * dedicated to a different agent config are never eligible for it; items
   * with no assignment at all are eligible for any agent config, including
   * one still unsaved (drainingAgentConfigId left null/undefined).
   */
  drainingAgentConfigId?: string | null;
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
    /** start_date is set and still in the future. */
    scheduledForLater: string[];
    /** scheduled_agent_config_id is set to a different agent config than the one draining. */
    assignedToOtherAgent: string[];
  };
}

const DEFAULT_MAX_CONCURRENT_PER_PROJECT = 1;
const DEFAULT_STABILIZATION_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTOMATED_DOD_INCOMPLETE_COUNT = 3;

type LegacyBacklogDrainCodingAgent = Exclude<BacklogDrainCodingAgent, "pi">;
type BacklogDrainRuntimeField =
  | "codingAgent"
  | "aiProvider"
  | "model"
  | "reasoningLevel";

type ResolvedBacklogDrainRuntime = {
  provider: BacklogDrainProvider;
  codingAgent: BacklogDrainCodingAgent;
  aiProvider: BacklogDrainAiProvider;
  model: string;
  reasoningLevel: string | null;
};

const runtimeValue = (input: string | null | undefined): string | null => {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const firstRuntimeValue = (
  sources: readonly (ScheduledRuntimeSource | null | undefined)[],
  key: BacklogDrainRuntimeField,
): string | null => {
  for (const source of sources) {
    const candidate = runtimeValue(source?.[key]);
    if (candidate) return candidate;
  }
  return null;
};

const isLegacyBacklogDrainCodingAgent = (
  value: string,
): value is LegacyBacklogDrainCodingAgent =>
  value === "claude-code" || value === "codex" || value === "opencode";

const isBacklogDrainAiProvider = (
  value: string,
): value is BacklogDrainAiProvider =>
  value === "anthropic" ||
  value === "openai" ||
  value === "google" ||
  value === "zai" ||
  value === "xai";

const inferAiProvider = (model: string | null): BacklogDrainAiProvider | null => {
  if (!model) return null;
  if (model.startsWith("glm-")) return "zai";
  if (model.startsWith("grok-")) return "xai";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("codex-")) return "openai";
  if (model.startsWith("gemini-")) return "google";
  return null;
};

const aiProviderForCodingAgent = (
  codingAgent: LegacyBacklogDrainCodingAgent,
): BacklogDrainAiProvider => {
  if (codingAgent === "codex") return "openai";
  if (codingAgent === "opencode") return "zai";
  return "anthropic";
};

const providerForRuntime = (
  codingAgent: BacklogDrainCodingAgent,
  aiProvider: BacklogDrainAiProvider,
): BacklogDrainProvider => {
  if (aiProvider === "zai") return "zipu";
  if (aiProvider === "xai") return "grok";
  if (aiProvider === "openai") return "codex";
  if (aiProvider === "anthropic") return "claude-code";
  return codingAgent === "codex" ? "codex" : "claude-code";
};

/**
 * Keep the backlog drain's historical mixed-agent runtime behavior while
 * applying authoritative capability admission to Pi. The modern registry is
 * intentionally fail-closed for Pi, but its narrower legacy tuple catalog must
 * not reject combinations that unattended backlog execution already supports.
 */
const resolveBacklogDrainRuntime = (input: {
  rule?: ScheduledRuntimeSource | null;
  schedule?: ScheduledRuntimeSource | null;
  workItem?: ScheduledRuntimeSource | null;
  project?: ScheduledRuntimeSource | null;
  connection?: ScheduledRuntimeSource | null;
}): ResolvedBacklogDrainRuntime => {
  const sources = [
    input.rule,
    input.schedule,
    input.workItem,
    input.project,
    input.connection,
  ];
  const selectedCodingAgent = firstRuntimeValue(sources, "codingAgent");
  const normalizedCodingAgent = selectedCodingAgent === "codex-cli"
    ? "codex"
    : selectedCodingAgent ?? "claude-code";
  const selectedAiProvider = firstRuntimeValue(sources, "aiProvider");

  if (
    isLegacyBacklogDrainCodingAgent(normalizedCodingAgent) &&
    (selectedAiProvider === null || isBacklogDrainAiProvider(selectedAiProvider))
  ) {
    const selectedModel = firstRuntimeValue(sources, "model");
    const aiProvider = selectedAiProvider ??
      inferAiProvider(selectedModel) ??
      aiProviderForCodingAgent(normalizedCodingAgent);
    const model = selectedModel ??
      getDefaultAgentModel(aiProvider) ??
      getDefaultAgentModel(aiProviderForCodingAgent(normalizedCodingAgent)) ??
      "claude-opus-4-8";

    return {
      provider: providerForRuntime(normalizedCodingAgent, aiProvider),
      codingAgent: normalizedCodingAgent,
      aiProvider,
      model,
      reasoningLevel: firstRuntimeValue(sources, "reasoningLevel"),
    };
  }

  const runtime = resolveScheduledRuntimePrecedence(input);
  return {
    provider: providerForRuntime(runtime.codingAgent, runtime.aiProvider),
    codingAgent: runtime.codingAgent,
    aiProvider: runtime.aiProvider,
    model: runtime.model,
    reasoningLevel: runtime.reasoningLevel,
  };
};

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

// A null/undefined start_date, or one already in the past, leaves the item
// eligible immediately — matching how the roadmap treats an empty start_date.
const isScheduledForLater = (
  item: BacklogDrainWorkItemInput,
  currentTimeMs: number,
): boolean => {
  const startMs = toTimeMs(item.startDate);
  return startMs !== null && startMs > currentTimeMs;
};

// An unassigned item (null/undefined) is eligible for any agent config's
// drain; an assigned item is only eligible for the one it's assigned to.
const isAssignedToOtherAgent = (
  item: BacklogDrainWorkItemInput,
  drainingAgentConfigId: string | null,
): boolean => {
  const assignedId = item.scheduledAgentConfigId ?? null;
  return assignedId !== null && assignedId !== drainingAgentConfigId;
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
    scheduledForLater: [],
    assignedToOtherAgent: [],
  };
  const drainingAgentConfigId = input.drainingAgentConfigId ?? null;

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
        if (!isScheduledForLater(item, currentTimeMs)) return true;
        skipped.scheduledForLater.push(item.id);
        return false;
      })
      .filter((item) => {
        if (!isAssignedToOtherAgent(item, drainingAgentConfigId)) return true;
        skipped.assignedToOtherAgent.push(item.id);
        return false;
      })
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

      const runtime = resolveBacklogDrainRuntime({
        rule,
        schedule: input.fallbackRuntime,
        workItem: {
          codingAgent: item.codingAgent,
          model: item.aiModel,
        },
        project: projectDefaults,
        connection: input.connectionRuntime,
      });

      selected.push({
        id: item.id,
        taskId: item.taskId,
        title: item.title,
        type: item.type,
        parentId: item.parentId,
        projectId: item.projectId,
        boardId: item.boardId,
        codingAgent: runtime.codingAgent,
        aiProvider: runtime.aiProvider,
        provider: runtime.provider,
        model: runtime.model,
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
