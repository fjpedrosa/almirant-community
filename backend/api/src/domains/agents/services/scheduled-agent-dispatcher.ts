/**
 * Backend-native dispatcher for `scheduled_agent_configs`.
 *
 * WHY THIS EXISTS
 * ----------------
 * The scheduler tick used to live exclusively in the runner
 * (`services/runner/src/orchestration/orchestrator.ts` — `processScheduledConfigs` /
 * `processOneScheduledConfig` / `executeScheduledConfig`), which polled the
 * backend over HTTP. That created a circular dependency: no live runner ->
 * no jobs ever get created -> no queued jobs -> the scaler never has a
 * reason to boot a runner -> the system never recovers on its own.
 *
 * This module ports that same tick to run INSIDE the backend, as one more
 * `background.ts` sweeper, calling the underlying functions directly
 * (no HTTP hop, no runner required).
 *
 * PORTED FROM (read-only reference; do not import from services/runner)
 * -----------------------------------------------------------------------
 *   services/runner/src/orchestration/orchestrator.ts
 *     - processScheduledConfigs        (~961)
 *     - processOneScheduledConfig      (~984)
 *     - executeScheduledConfig         (~1099, the targetConfig router)
 *     - executeBacklogDrainConfig      (~1235)
 *     - executeDodRemediationConfig    (~1294)
 *     - executeDefinitionOfDoneReviewConfig (~1546)
 *     - executeReleaseIntegrationConfig     (~1627)
 *
 * DELIBERATE DIVERGENCE — project-scoping precedence bug in the runner
 * -----------------------------------------------------------------------
 * The runner's `resolveProjectConcurrencyScopes` / `resolveTargetProjectIds`
 * (orchestrator.ts ~1507-1543), used by its dodReview/releaseIntegration
 * branches, filters out `enabled: false` project rules BEFORE checking
 * whether any rules exist. That means disabling every project rule for a
 * mode makes `rules.length === 0`, which falls through to the
 * `config.projectId` fallback and silently RE-ENABLES the project the user
 * just turned off. This is a live bug — it is NOT replicated here.
 *
 * Instead, `resolveProjectConcurrencyScopes` below mirrors the precedence
 * already used (correctly) by `resolveBacklogStyleRules` in
 * `backend/packages/database/src/repositories/agents/backlog-drain-repository.ts`
 * (~141-181), which the backlogDrain/dodRemediation branches get for free via
 * `getBacklogDrainCandidatesForConfigId` / `getDodRemediationCandidatesForConfigId`:
 *
 *   1. `target.projects` has >=1 entry with a `projectId` -> those rules win,
 *      regardless of each rule's own `enabled` flag (an explicitly disabled
 *      rule must never be replaced by one derived from `config.projectId`).
 *   2. No rules AND `config.projectId` is set -> derive a single scope from it.
 *   3. No rules AND no `config.projectId` -> a single workspace-wide scope
 *      (`projectId: undefined`), matching this pair's existing "no scope ->
 *      whole workspace, one limit" semantics.
 *
 * Filtering by each rule's own `enabled` flag happens only AFTER step 1 has
 * already decided "yes, explicit rules exist" — so an all-disabled rule list
 * correctly produces zero scopes (zero candidates, zero jobs), never a
 * silent fallback to `config.projectId` re-enabling the mode.
 *
 * OTHER DOCUMENTED DIVERGENCES FROM THE RUNNER
 * -----------------------------------------------------------------------
 * - No HTTP-boundary "revalidate the payload against fresh state"
 *   (`revalidateScheduledWorkItemJob` in workers.routes.ts) step exists here.
 *   That revalidation defends against a stale/tampered request body arriving
 *   from a remote runner process after a network hop. This dispatcher has no
 *   such hop: candidates are read fresh from the DB and immediately used to
 *   create the job in the same in-process tick, so there is nothing to
 *   revalidate against.
 * - Candidate rows already carry `projectId`/`boardId` (backlog-drain and DoD
 *   review candidates both select them), so this dispatcher uses those
 *   directly instead of the HTTP route's redundant `getWorkItemById` lookup.
 * - `config.agentPlugins`, referenced by the runner's job-config spreads, is
 *   not a column on `scheduled_agent_configs` (confirmed against the schema
 *   and the wire type in `@almirant/remote-agent`) — it is always `undefined`
 *   on every config the runner ever saw for these branches, i.e. dead code.
 *   It is intentionally omitted here.
 * - `runScheduledAgentDispatchOnce` takes an optional second `options`
 *   parameter (`{ maxConfigsPerTick }`) beyond the `(now: Date)` signature
 *   in the design brief, purely to make the per-tick cap configurable and
 *   unit-testable without mutating `process.env` mid-test. Callers that only
 *   pass `now` are unaffected.
 */

import { logger } from "@almirant/config";
import {
  checkQuotaAvailable,
  consumeOnceScheduleOccurrence,
  countActiveAgentJobsForLane,
  createJob,
  DuplicateActiveJobError,
  getBacklogDrainCandidatesForConfigId,
  getDefinitionOfDoneReviewCandidates,
  getDodRemediationCandidatesForConfigId,
  getFixCandidates,
  getValidationCandidates,
  getWorkspaceOwnerUserId,
  listEnabledScheduledAgentConfigs,
  updateScheduledAgentConfigLastRunAt,
  type AiProvider,
  type BacklogDrainProjectRule,
  type CodingAgent,
  type EnabledScheduledAgentConfig,
  type ProviderQuotaDb,
} from "@almirant/database";
import {
  BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY,
  resolveEnabledBuiltinAutomation,
  resolveScheduledAgentAiProvider,
} from "@almirant/shared";
import {
  isCronDue,
  isOnceDue,
  isScheduledAgentRunnable,
  isTimeWindowActive,
  resolveScheduledDispatchDueKey,
  type ScheduledAgentDueConfig,
} from "./scheduled-agent-due";
import { queueReleaseIntegration } from "./release-integration-queue-service";
import { executeScheduledAgentConfigWithResult } from "./execute-scheduled-agent-config";
import { resolveScheduledDispatchCreatedByUserId } from "./scheduled-agent-identity";

// ---------------------------------------------------------------------------
// Small pure helpers, ported from orchestrator.ts's module scope.
// ---------------------------------------------------------------------------

const DEFAULT_DOD_REVIEW_MIN_AGE_MINUTES = 15;
const DEFAULT_PROJECT_OPEN_TICKET_LIMIT = 1;
const DEFAULT_MAX_CONFIGS_PER_TICK = 200;

/** Port of orchestrator.ts's `finitePositiveInt` (~163-167). */
const finitePositiveInt = (value: number | null | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
};

/** Port of orchestrator.ts's `resolveQuietPeriodMinutes` (~179-184). */
const resolveQuietPeriodMinutes = (value: number | null | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DOD_REVIEW_MIN_AGE_MINUTES;
  }
  return Math.max(0, Math.floor(value));
};

/** Port of orchestrator.ts's `resolveScheduledWorkItemSkillName` (~107-114). */
const resolveScheduledWorkItemSkillName = (jobType: string): string => {
  if (jobType === "validation") return "validate";
  if (jobType === "bug-fix") return "nightly-fix";
  if (jobType === "planning") return "ideate";
  if (jobType === "review") return "review";
  if (jobType === "integration") return "runner-release-integration";
  return "runner-implement";
};

type ProjectConcurrencyScope = {
  projectId?: string;
  maxActiveItems: number;
};

type ProjectConcurrencyModeConfig = {
  defaultMaxConcurrentJobs?: number | null;
  projects?: BacklogDrainProjectRule[];
} | null | undefined;

/**
 * Resolve per-project concurrency scopes for the dodReview / releaseIntegration
 * modes. See the "DELIBERATE DIVERGENCE" note at the top of this file — this
 * intentionally does NOT port the runner's `resolveProjectConcurrencyScopes` /
 * `resolveTargetProjectIds` verbatim; it fixes the enabled-filter ordering bug.
 */
const resolveProjectConcurrencyScopes = (
  config: Pick<EnabledScheduledAgentConfig, "projectId">,
  target: ProjectConcurrencyModeConfig,
): ProjectConcurrencyScope[] => {
  const defaultMaxActive =
    finitePositiveInt(target?.defaultMaxConcurrentJobs) ?? DEFAULT_PROJECT_OPEN_TICKET_LIMIT;

  const explicitRules = (target?.projects ?? []).filter(
    (rule) => typeof rule.projectId === "string" && rule.projectId.length > 0,
  );

  if (explicitRules.length > 0) {
    // Enabled/disabled filtering happens HERE, after we've already decided
    // explicit rules exist — an all-disabled list must produce zero scopes,
    // never fall through to the config.projectId/workspace-wide cases below.
    return explicitRules
      .filter((rule) => rule.enabled !== false)
      .map((rule) => ({
        projectId: rule.projectId,
        maxActiveItems: finitePositiveInt(rule.maxConcurrentJobs) ?? defaultMaxActive,
      }));
  }

  if (config.projectId) {
    return [{ projectId: config.projectId, maxActiveItems: defaultMaxActive }];
  }

  return [{ projectId: undefined, maxActiveItems: defaultMaxActive }];
};

/**
 * Fairness: round-robin configs across workspaces before applying the
 * per-tick cap, so a workspace with 200 configs cannot starve every other
 * workspace's configs out of a single tick.
 */
const roundRobinByWorkspace = (
  configs: EnabledScheduledAgentConfig[],
): EnabledScheduledAgentConfig[] => {
  const buckets = new Map<string, EnabledScheduledAgentConfig[]>();
  const workspaceOrder: string[] = [];

  for (const config of configs) {
    let bucket = buckets.get(config.workspaceId);
    if (!bucket) {
      bucket = [];
      buckets.set(config.workspaceId, bucket);
      workspaceOrder.push(config.workspaceId);
    }
    bucket.push(config);
  }

  const ordered: EnabledScheduledAgentConfig[] = [];
  let remaining = configs.length;
  while (remaining > 0) {
    for (const workspaceId of workspaceOrder) {
      const bucket = buckets.get(workspaceId);
      if (!bucket || bucket.length === 0) continue;
      const next = bucket.shift();
      if (!next) continue;
      ordered.push(next);
      remaining -= 1;
    }
  }
  return ordered;
};

// ---------------------------------------------------------------------------
// Tick summary types
// ---------------------------------------------------------------------------

export interface ScheduledAgentDispatchSkipCounts {
  notRunnable: number;
  notDue: number;
  noQuota: number;
  /**
   * A `scheduleType='once'` config's single occurrence was already consumed
   * by another dispatch authority (a concurrent replica of this same
   * dispatcher, or a crash that left the row `enabled=false` with
   * `lastRunAt` still null) before this call's `consumeOnceScheduleOccurrence`
   * could win the atomic UPDATE. See that function's docstring in
   * `scheduled-agent-config-repository.ts` for the full at-most-once
   * contract.
   */
  onceAlreadyConsumed: number;
}

export interface ScheduledAgentDispatchModeCounts {
  backlogDrain: number;
  dodRemediation: number;
  dodReview: number;
  releaseIntegration: number;
  standalone: number;
  candidateBased: number;
}

export interface DispatchTickSummary {
  startedAt: string;
  finishedAt: string;
  configsSeen: number;
  configsProcessed: number;
  skipped: ScheduledAgentDispatchSkipCounts;
  jobsCreated: number;
  jobsCreatedByMode: ScheduledAgentDispatchModeCounts;
  /**
   * Candidates skipped because `createJob` hit
   * `agent_jobs_work_item_job_type_active_uidx` (migration 0236) — another
   * dispatch authority (the runner scheduler over /workers/*, or this same
   * dispatcher on a different backend replica) already created an active job
   * for that (work_item_id, job_type) pair in the same window. This is a
   * benign concurrency outcome, tracked separately from `errors`.
   */
  duplicateSkipped: number;
  errors: number;
  capReached: boolean;
}

type DispatchMode = keyof ScheduledAgentDispatchModeCounts;

type DispatchOneConfigResult =
  | { outcome: "skipped"; reason: keyof ScheduledAgentDispatchSkipCounts }
  | { outcome: "dispatched"; mode: DispatchMode; jobsCreated: number; duplicateSkipped?: number };

// ---------------------------------------------------------------------------
// Per-mode execution — job creation calls the repository directly, no HTTP.
// ---------------------------------------------------------------------------

interface ModeExecutionResult {
  created: number;
  /** Candidates skipped on a duplicate-active-job race — see DispatchTickSummary.duplicateSkipped. */
  duplicateSkipped: number;
}

const executeBacklogDrain = async (
  config: EnabledScheduledAgentConfig,
): Promise<ModeExecutionResult> => {
  const result = await getBacklogDrainCandidatesForConfigId(config.id, config.workspaceId);
  if (!result) {
    logger.warn(
      { configId: config.id, workspaceId: config.workspaceId },
      "scheduled-agent-dispatcher: backlog-drain config vanished mid-tick",
    );
    return { created: 0, duplicateSkipped: 0 };
  }

  if (result.candidates.length === 0) {
    logger.info(
      {
        configId: config.id,
        workspaceId: config.workspaceId,
        blocked: result.skipped.blocked.length,
        excluded: result.skipped.excluded.length,
        active: result.skipped.active.length,
        concurrency: result.skipped.concurrency.length,
        recentlyModified: result.skipped.recentlyModified.length,
      },
      "scheduled-agent-dispatcher: backlog-drain — no ready candidates",
    );
    await updateScheduledAgentConfigLastRunAt(config.id);
    return { created: 0, duplicateSkipped: 0 };
  }

  const limit = Math.min(result.candidates.length, config.maxJobsPerRun);
  let created = 0;
  let duplicateSkipped = 0;

  // Resolved once for the whole dispatch, not once per candidate — see
  // `resolveScheduledDispatchCreatedByUserId`'s docstring.
  const createdByUserId = await resolveScheduledDispatchCreatedByUserId(
    config.ownerUserId,
    config.workspaceId,
    getWorkspaceOwnerUserId,
  );

  for (const candidate of result.candidates.slice(0, limit)) {
    try {
      await createJob({
        workspaceId: config.workspaceId,
        projectId: candidate.projectId,
        boardId: candidate.boardId,
        workItemId: candidate.id,
        createdByUserId,
        provider: candidate.provider,
        jobType: "implementation",
        codingAgent: candidate.codingAgent,
        aiProvider: candidate.aiProvider,
        model: candidate.model,
        config: {
          repoPath: ".",
          baseBranch: "main",
          projectId: candidate.projectId,
          scheduledConfigId: config.id,
          scheduledConfigName: config.name,
          skillName: BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY.backlogDrain.skillName,
          source: "backlog-drain",
          reasoningLevel: candidate.reasoningLevel ?? undefined,
          ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
        },
      });
      created += 1;
    } catch (error) {
      if (error instanceof DuplicateActiveJobError) {
        duplicateSkipped += 1;
        logger.info(
          { configId: config.id, workItemId: candidate.id, jobType: "implementation" },
          "scheduled-agent-dispatcher: backlog-drain skipped candidate — another dispatch authority already created an active job for it",
        );
        continue;
      }
      logger.error(
        { error, configId: config.id, workItemId: candidate.id },
        "scheduled-agent-dispatcher: backlog-drain failed to create job",
      );
    }
  }

  logger.info(
    {
      configId: config.id,
      workspaceId: config.workspaceId,
      candidates: result.candidates.length,
      created,
      duplicateSkipped,
    },
    "scheduled-agent-dispatcher: backlog-drain tick",
  );
  await updateScheduledAgentConfigLastRunAt(config.id);
  return { created, duplicateSkipped };
};

const executeDodRemediation = async (
  config: EnabledScheduledAgentConfig,
): Promise<ModeExecutionResult> => {
  const result = await getDodRemediationCandidatesForConfigId(config.id, config.workspaceId);
  if (!result) {
    logger.warn(
      { configId: config.id, workspaceId: config.workspaceId },
      "scheduled-agent-dispatcher: dod-remediation config vanished mid-tick",
    );
    return { created: 0, duplicateSkipped: 0 };
  }

  if (result.candidates.length === 0) {
    logger.info(
      {
        configId: config.id,
        workspaceId: config.workspaceId,
        blocked: result.skipped.blocked.length,
        excluded: result.skipped.excluded.length,
        active: result.skipped.active.length,
        concurrency: result.skipped.concurrency.length,
        recentlyModified: result.skipped.recentlyModified.length,
        missingReport: result.skipped.missingDodReport.length,
      },
      "scheduled-agent-dispatcher: dod-remediation — no ready candidates",
    );
    await updateScheduledAgentConfigLastRunAt(config.id);
    return { created: 0, duplicateSkipped: 0 };
  }

  const limit = Math.min(result.candidates.length, config.maxJobsPerRun);
  let created = 0;
  let duplicateSkipped = 0;

  // Resolved once for the whole dispatch, not once per candidate — see
  // `resolveScheduledDispatchCreatedByUserId`'s docstring.
  const createdByUserId = await resolveScheduledDispatchCreatedByUserId(
    config.ownerUserId,
    config.workspaceId,
    getWorkspaceOwnerUserId,
  );

  for (const candidate of result.candidates.slice(0, limit)) {
    const skillName =
      candidate.skillName ?? BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY.dodRemediation.skillName;
    try {
      await createJob({
        workspaceId: config.workspaceId,
        projectId: candidate.projectId,
        boardId: candidate.boardId,
        workItemId: candidate.id,
        createdByUserId,
        provider: candidate.provider,
        jobType: "implementation",
        codingAgent: candidate.codingAgent,
        aiProvider: candidate.aiProvider,
        model: candidate.model,
        config: {
          repoPath: ".",
          baseBranch: "main",
          projectId: candidate.projectId,
          scheduledConfigId: config.id,
          scheduledConfigName: config.name,
          skillName,
          source: "dod-remediation",
          dodReport: candidate.dodReport ?? undefined,
          dodReviewedAt: candidate.dodReviewedAt ?? undefined,
          reasoningLevel: candidate.reasoningLevel ?? undefined,
          ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
        },
      });
      created += 1;
    } catch (error) {
      if (error instanceof DuplicateActiveJobError) {
        duplicateSkipped += 1;
        logger.info(
          { configId: config.id, workItemId: candidate.id, jobType: "implementation" },
          "scheduled-agent-dispatcher: dod-remediation skipped candidate — another dispatch authority already created an active job for it",
        );
        continue;
      }
      logger.error(
        { error, configId: config.id, workItemId: candidate.id },
        "scheduled-agent-dispatcher: dod-remediation failed to create job",
      );
    }
  }

  logger.info(
    {
      configId: config.id,
      workspaceId: config.workspaceId,
      candidates: result.candidates.length,
      created,
      duplicateSkipped,
    },
    "scheduled-agent-dispatcher: dod-remediation tick",
  );
  await updateScheduledAgentConfigLastRunAt(config.id);
  return { created, duplicateSkipped };
};

const executeDodReview = async (
  config: EnabledScheduledAgentConfig,
): Promise<ModeExecutionResult> => {
  const minAgeMinutes = resolveQuietPeriodMinutes(config.targetConfig?.dodReview?.minAgeMinutes);
  const projectScopes = resolveProjectConcurrencyScopes(config, config.targetConfig?.dodReview);

  const candidates: Array<Awaited<ReturnType<typeof getDefinitionOfDoneReviewCandidates>>[number]> = [];

  for (const scope of projectScopes) {
    const remaining = config.maxJobsPerRun - candidates.length;
    if (remaining <= 0) break;
    const requestLimit = Math.min(remaining, scope.maxActiveItems);

    const activeCount = await countActiveAgentJobsForLane({
      workspaceId: config.workspaceId,
      projectId: scope.projectId,
      sources: ["dod-review"],
      skillNames: ["dod-review"],
      promptTemplates: ["dod-review"],
    });
    const availableSlots = Math.max(0, scope.maxActiveItems - activeCount);
    if (availableSlots <= 0) continue;
    const effectiveLimit = Math.min(requestLimit, availableSlots);

    const projectCandidates = await getDefinitionOfDoneReviewCandidates(
      config.workspaceId,
      scope.projectId,
      effectiveLimit,
      { minAgeMinutes },
    );
    candidates.push(...projectCandidates);
  }

  if (candidates.length === 0) {
    logger.info(
      { configId: config.id, workspaceId: config.workspaceId },
      "scheduled-agent-dispatcher: dod-review — no candidates",
    );
    await updateScheduledAgentConfigLastRunAt(config.id);
    return { created: 0, duplicateSkipped: 0 };
  }

  const limit = Math.min(candidates.length, config.maxJobsPerRun);
  let created = 0;
  let duplicateSkipped = 0;

  // Resolved once for the whole dispatch, not once per candidate — see
  // `resolveScheduledDispatchCreatedByUserId`'s docstring.
  const createdByUserId = await resolveScheduledDispatchCreatedByUserId(
    config.ownerUserId,
    config.workspaceId,
    getWorkspaceOwnerUserId,
  );

  for (const candidate of candidates.slice(0, limit)) {
    try {
      await createJob({
        workspaceId: config.workspaceId,
        projectId: candidate.projectId ?? config.projectId ?? undefined,
        boardId: candidate.boardId ?? undefined,
        workItemId: candidate.id,
        createdByUserId,
        provider: config.provider,
        jobType: "review",
        codingAgent: (config.codingAgent ?? undefined) as CodingAgent | undefined,
        aiProvider: (config.aiProvider ?? undefined) as AiProvider | undefined,
        model: config.aiModel ?? undefined,
        config: {
          repoPath: ".",
          baseBranch: "main",
          projectId: candidate.projectId ?? config.projectId ?? undefined,
          scheduledConfigId: config.id,
          scheduledConfigName: config.name,
          skillName: BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY.dodReview.skillName,
          source: "dod-review",
          workspaceIntent: "read-only",
          postSessionPushPolicy: "never",
          reasoningLevel: config.reasoningLevel ?? undefined,
          ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
        },
      });
      created += 1;
    } catch (error) {
      if (error instanceof DuplicateActiveJobError) {
        duplicateSkipped += 1;
        logger.info(
          { configId: config.id, workItemId: candidate.id, jobType: "review" },
          "scheduled-agent-dispatcher: dod-review skipped candidate — another dispatch authority already created an active job for it",
        );
        continue;
      }
      logger.error(
        { error, configId: config.id, workItemId: candidate.id },
        "scheduled-agent-dispatcher: dod-review failed to create job",
      );
    }
  }

  logger.info(
    {
      configId: config.id,
      workspaceId: config.workspaceId,
      candidates: candidates.length,
      created,
      duplicateSkipped,
    },
    "scheduled-agent-dispatcher: dod-review tick",
  );
  await updateScheduledAgentConfigLastRunAt(config.id);
  return { created, duplicateSkipped };
};

const executeReleaseIntegration = async (config: EnabledScheduledAgentConfig): Promise<number> => {
  const projectScopes = resolveProjectConcurrencyScopes(config, config.targetConfig?.releaseIntegration);
  const minAgeMinutes = resolveQuietPeriodMinutes(config.targetConfig?.releaseIntegration?.minAgeMinutes);

  let created = 0;
  let batchCount = 0;

  for (const scope of projectScopes) {
    const remaining = config.maxJobsPerRun - created;
    if (remaining <= 0) break;
    const requestLimit = Math.min(remaining, scope.maxActiveItems);

    const result = await queueReleaseIntegration({
      workspaceId: config.workspaceId,
      projectId: scope.projectId,
      scheduledConfigId: config.id,
      limit: requestLimit,
      maxActiveItems: scope.maxActiveItems,
      minAgeMinutes,
    });

    if (!result) {
      logger.warn(
        { configId: config.id, workspaceId: config.workspaceId },
        "scheduled-agent-dispatcher: release-integration config vanished mid-tick",
      );
      continue;
    }

    created += result.batches.reduce((sum, batch) => sum + batch.enqueuedItemCount, 0);
    batchCount += result.batches.length;
  }

  logger.info(
    { configId: config.id, workspaceId: config.workspaceId, created, batchCount },
    "scheduled-agent-dispatcher: release-integration tick",
  );
  await updateScheduledAgentConfigLastRunAt(config.id);
  return created;
};

const executeCandidateBased = async (
  config: EnabledScheduledAgentConfig,
): Promise<ModeExecutionResult> => {
  const inferredSkillName = resolveScheduledWorkItemSkillName(config.jobType);

  let candidates: Array<{ id: string; projectId: string | null; boardId: string | null }> = [];
  if (config.jobType === "validation") {
    const rows = await getValidationCandidates(
      config.workspaceId,
      config.projectId ?? undefined,
      undefined,
      { requireDodApproved: config.targetConfig?.requireDodApproved === true },
    );
    candidates = rows.map((row) => ({ id: row.id, projectId: row.projectId, boardId: row.boardId ?? null }));
  } else if (config.jobType === "bug-fix") {
    const rows = await getFixCandidates(config.workspaceId, config.projectId ?? undefined);
    candidates = rows.map((row) => ({ id: row.id, projectId: row.projectId, boardId: row.boardId ?? null }));
  } else {
    const rows = await getValidationCandidates(config.workspaceId, config.projectId ?? undefined);
    candidates = rows.map((row) => ({ id: row.id, projectId: row.projectId, boardId: row.boardId ?? null }));
  }

  if (candidates.length === 0) {
    logger.info(
      { configId: config.id, workspaceId: config.workspaceId, jobType: config.jobType },
      "scheduled-agent-dispatcher: no candidates found",
    );
    return { created: 0, duplicateSkipped: 0 };
  }

  const limit = Math.min(candidates.length, config.maxJobsPerRun);
  let created = 0;
  let duplicateSkipped = 0;

  // Resolved once for the whole dispatch, not once per candidate — see
  // `resolveScheduledDispatchCreatedByUserId`'s docstring.
  const createdByUserId = await resolveScheduledDispatchCreatedByUserId(
    config.ownerUserId,
    config.workspaceId,
    getWorkspaceOwnerUserId,
  );

  for (const candidate of candidates.slice(0, limit)) {
    try {
      await createJob({
        workspaceId: config.workspaceId,
        projectId: candidate.projectId ?? undefined,
        boardId: candidate.boardId ?? undefined,
        workItemId: candidate.id,
        createdByUserId,
        provider: config.provider,
        jobType: config.jobType,
        codingAgent: (config.codingAgent ?? undefined) as CodingAgent | undefined,
        aiProvider: (config.aiProvider ?? undefined) as AiProvider | undefined,
        model: config.aiModel ?? undefined,
        config: {
          repoPath: ".",
          baseBranch: "main",
          projectId: config.projectId ?? undefined,
          scheduledConfigId: config.id,
          scheduledConfigName: config.name,
          skillName: inferredSkillName,
          source: "scheduled-config",
          reasoningLevel: config.reasoningLevel ?? undefined,
          ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
        },
      });
      created += 1;
    } catch (error) {
      if (error instanceof DuplicateActiveJobError) {
        duplicateSkipped += 1;
        logger.info(
          { configId: config.id, workItemId: candidate.id, jobType: config.jobType },
          "scheduled-agent-dispatcher: candidate-based skipped candidate — another dispatch authority already created an active job for it",
        );
        continue;
      }
      logger.error(
        { error, configId: config.id, workItemId: candidate.id },
        "scheduled-agent-dispatcher: failed to create job for candidate",
      );
    }
  }

  logger.info(
    {
      configId: config.id,
      workspaceId: config.workspaceId,
      candidates: candidates.length,
      created,
      duplicateSkipped,
    },
    "scheduled-agent-dispatcher: candidate-based tick",
  );
  await updateScheduledAgentConfigLastRunAt(config.id);
  return { created, duplicateSkipped };
};

// ---------------------------------------------------------------------------
// Gates + router for a single config
// ---------------------------------------------------------------------------

const dispatchOneConfig = async (
  config: EnabledScheduledAgentConfig,
  now: Date,
): Promise<DispatchOneConfigResult> => {
  const dueConfig: ScheduledAgentDueConfig = {
    configId: config.id,
    name: config.name,
    enabled: config.enabled,
    trigger: config.trigger,
    scheduleType: config.scheduleType,
    scheduleConfig: config.scheduleConfig,
    timezone: config.timezone,
    lastRunAt: config.lastRunAt,
    pausedUntil: config.pausedUntil,
    targetConfig: config.targetConfig,
  };

  if (!isScheduledAgentRunnable(dueConfig, now)) {
    return { outcome: "skipped", reason: "notRunnable" };
  }

  const isDue =
    config.scheduleType === "cron"
      ? isCronDue(dueConfig, now)
      : config.scheduleType === "once"
        ? isOnceDue(dueConfig, now)
        : isTimeWindowActive(dueConfig, now);
  if (!isDue) {
    return { outcome: "skipped", reason: "notDue" };
  }

  const dueResult = resolveScheduledDispatchDueKey(dueConfig, now);
  if (!dueResult.due) {
    // Defensive: should not happen given the gates above already agreed the
    // config is due, but a sweeper must never let one bad config throw.
    return { outcome: "skipped", reason: "notDue" };
  }
  const dueKey = dueResult.dueKey;

  // Quota gate: refuse to create jobs the scaler would boot machines for and
  // that would immediately bounce on the provider's own quota. Mirrors
  // workers.routes.ts's GET /workers/quota-check criterion, including its
  // fail-open behavior when the thing needed to check quota can't be
  // resolved (there: an unresolvable org; here: workspaceId is always
  // present on a persisted config, so the equivalent unresolvable case is an
  // AI provider that can't be derived from provider/aiProvider).
  if (config.workspaceId) {
    const quotaProvider = resolveScheduledAgentAiProvider({
      provider: config.provider,
      aiProvider: config.aiProvider,
    });

    if (quotaProvider) {
      const availability = await checkQuotaAvailable(
        config.workspaceId,
        quotaProvider as ProviderQuotaDb["provider"],
      );
      if (!availability.allowed) {
        logger.info(
          {
            configId: config.id,
            workspaceId: config.workspaceId,
            provider: quotaProvider,
            reason: availability.reason,
          },
          "scheduled-agent-dispatcher: skipped — quota exhausted",
        );
        return { outcome: "skipped", reason: "noQuota" };
      }
    } else {
      logger.warn(
        { configId: config.id, workspaceId: config.workspaceId },
        "scheduled-agent-dispatcher: could not resolve AI provider for quota gate — failing open",
      );
    }
  }

  // At-most-once PRE-dispatch consumption for 'once' configs (review Fix 1).
  // MUST run before the router below, for every mode — the 4 deterministic
  // modes and candidateBased never went through `reserveScheduledAgentRun`
  // (only the standalone branch does, via
  // `executeScheduledAgentConfigWithResult`), so without this gate the only
  // guard for 'once' was the POST-dispatch auto-disable in
  // `updateScheduledAgentConfigLastRunAt` — leaving a window where a crash
  // between createJob and that disable, or two concurrent dispatch
  // authorities both observing `isOnceDue()===true`, could double-dispatch.
  //
  // Deliberately scoped to scheduleType='once' only: do NOT extend this
  // reservation to cron/time_window configs, which must keep being
  // re-evaluated every tick by their own reconcilers.
  if (config.scheduleType === "once") {
    const consumed = await consumeOnceScheduleOccurrence(config.id);
    if (!consumed) {
      logger.info(
        { configId: config.id, workspaceId: config.workspaceId },
        "scheduled-agent-dispatcher: 'once' occurrence already consumed by another dispatch authority",
      );
      return { outcome: "skipped", reason: "onceAlreadyConsumed" };
    }
  }

  const targetConfig = config.targetConfig;

  // Router: which built-in automation (if any) does this targetConfig
  // activate, respecting the catalog's dispatchPrecedence — see the
  // "DELIBERATE DIVERGENCE" / ladder-order note at the top of this file for
  // why order matters when multiple flags are enabled simultaneously.
  const resolvedAutomation = resolveEnabledBuiltinAutomation(targetConfig);
  if (resolvedAutomation) {
    switch (resolvedAutomation.targetConfigKey) {
      case "backlogDrain": {
        const { created, duplicateSkipped } = await executeBacklogDrain(config);
        return { outcome: "dispatched", mode: "backlogDrain", jobsCreated: created, duplicateSkipped };
      }
      case "dodRemediation": {
        const { created, duplicateSkipped } = await executeDodRemediation(config);
        return { outcome: "dispatched", mode: "dodRemediation", jobsCreated: created, duplicateSkipped };
      }
      case "dodReview": {
        const { created, duplicateSkipped } = await executeDodReview(config);
        return { outcome: "dispatched", mode: "dodReview", jobsCreated: created, duplicateSkipped };
      }
      case "releaseIntegration": {
        const jobsCreated = await executeReleaseIntegration(config);
        return { outcome: "dispatched", mode: "releaseIntegration", jobsCreated };
      }
    }
  }

  if (config.jobType === "scheduled") {
    // DIVERGENCE FROM CLOUD -- community's executeScheduledAgentConfigWithResult
    // takes `createdByUserId` directly (already resolved) instead of cloud's
    // `requestedByUserId` + internal resolveScheduledAgentExecutionIdentity /
    // resolveScheduledDispatchCreatedByUserId chain. Resolve it here, same
    // as every other mode branch in this file.
    const standaloneCreatedByUserId = await resolveScheduledDispatchCreatedByUserId(
      config.ownerUserId,
      config.workspaceId,
      getWorkspaceOwnerUserId,
    );
    const { created } = await executeScheduledAgentConfigWithResult(config, {
      createdByUserId: standaloneCreatedByUserId ?? null,
      trigger: "schedule",
      dueKey,
    });
    logger.info(
      { configId: config.id, workspaceId: config.workspaceId, created },
      "scheduled-agent-dispatcher: standalone tick",
    );
    return { outcome: "dispatched", mode: "standalone", jobsCreated: created ? 1 : 0 };
  }

  const { created, duplicateSkipped } = await executeCandidateBased(config);
  return { outcome: "dispatched", mode: "candidateBased", jobsCreated: created, duplicateSkipped };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const runScheduledAgentDispatchOnce = async (
  now: Date,
  options: { maxConfigsPerTick?: number } = {},
): Promise<DispatchTickSummary> => {
  const maxConfigsPerTick = options.maxConfigsPerTick ?? DEFAULT_MAX_CONFIGS_PER_TICK;

  const summary: DispatchTickSummary = {
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    configsSeen: 0,
    configsProcessed: 0,
    skipped: { notRunnable: 0, notDue: 0, noQuota: 0, onceAlreadyConsumed: 0 },
    jobsCreated: 0,
    jobsCreatedByMode: {
      backlogDrain: 0,
      dodRemediation: 0,
      dodReview: 0,
      releaseIntegration: 0,
      standalone: 0,
      candidateBased: 0,
    },
    duplicateSkipped: 0,
    errors: 0,
    capReached: false,
  };

  let configs: EnabledScheduledAgentConfig[];
  try {
    configs = await listEnabledScheduledAgentConfigs();
  } catch (error) {
    summary.errors += 1;
    summary.finishedAt = new Date().toISOString();
    logger.error({ error }, "scheduled-agent-dispatcher: failed to list enabled scheduled agent configs");
    return summary;
  }

  summary.configsSeen = configs.length;

  const ordered = roundRobinByWorkspace(configs);
  const scheduled = ordered.slice(0, maxConfigsPerTick);
  summary.capReached = scheduled.length < ordered.length;

  for (const config of scheduled) {
    summary.configsProcessed += 1;
    try {
      // Every config gets its own try/catch: one bad config (bad cron
      // expression, a DB hiccup on its candidate query, a quota lookup
      // failure) must never abort the tick or bleed into another config's
      // workspace/tenant.
      const result = await dispatchOneConfig(config, now);
      if (result.outcome === "skipped") {
        summary.skipped[result.reason] += 1;
      } else {
        summary.jobsCreated += result.jobsCreated;
        summary.jobsCreatedByMode[result.mode] += result.jobsCreated;
        summary.duplicateSkipped += result.duplicateSkipped ?? 0;
      }
    } catch (error) {
      summary.errors += 1;
      logger.error(
        { error, configId: config.id, workspaceId: config.workspaceId, configName: config.name },
        "scheduled-agent-dispatcher: config processing failed",
      );
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
};

export const startScheduledAgentDispatcher = (opts: { intervalMs: number }): (() => void) => {
  const safeIntervalMs = Math.max(opts.intervalMs, 10_000);
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const summary = await runScheduledAgentDispatchOnce(new Date());
      logger.info({ summary }, "scheduled-agent-dispatcher: tick complete");
    } catch (error) {
      logger.error({ error }, "scheduled-agent-dispatcher: tick failed; will retry");
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeout(() => void tick(), 5_000);
  const interval = setInterval(() => void tick(), safeIntervalMs);

  return () => {
    stopped = true;
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
};
