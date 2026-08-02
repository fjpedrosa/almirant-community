/**
 * Dev-flow provisioning (issue #230, per-automation config issue #235).
 *
 * Converts the "automatic development flow" (the four built-in scheduled
 * automations — backlog drain, DoD remediation, DoD review, release
 * integration; see `@almirant/shared`'s builtin-automations.ts catalog) into
 * a per-project, minimally-configured feature instead of four hand-created
 * scheduled-agent configs.
 *
 * `provisionDevFlowForProject` idempotently upserts one `managedBy='system'`
 * `scheduled_agent_configs` row per catalog automation, identified by
 * (projectId, builtinAutomationId) — the same identity migration 0237's
 * partial unique index enforces. `getDevFlowStatus` is the read-only
 * counterpart used by GET /projects/:id/dev-flow.
 *
 * WHY managedBy='system' rows are never deleted on disable
 * -----------------------------------------------------------------------
 * Disabling dev-flow flips `enabled=false` on all four rows (dispatch reads
 * `enabled` — see `listEnabledScheduledAgentConfigs` in
 * scheduled-agent-config-repository.ts) rather than deleting them. This
 * preserves `lastRunAt`/history and means re-enabling never needs to
 * re-provision from scratch.
 *
 * WHY existing user-owned agents are never converted or duplicated
 * -----------------------------------------------------------------------
 * If a NON-system-managed config already activates the same built-in
 * automation mode for this project (`resolveEnabledBuiltinAutomation`
 * resolves it, and its scope covers this project), provisioning that mode's
 * system config is skipped entirely and reported in
 * `skippedExistingUserAgents`. Converting or duplicating a user's own agent
 * is a UI-driven decision the user must make explicitly — `adoptDevFlowAutomation`
 * (POST /projects/:id/dev-flow/adopt) is the authorized way to resolve it.
 *
 * PER-AUTOMATION CONFIG (issue #235)
 * -----------------------------------------------------------------------
 * Each of the 4 built-ins can carry its OWN runtime
 * (codingAgent/aiProvider/model/reasoningLevel), concurrency
 * (maxConcurrentJobs) and schedule (cron expression + timezone) override,
 * stored under `devFlow.automations.<automationId>` in the project's
 * `agentDefaults` JSONB (see `ProjectAgentDefaults` in
 * backlog-drain-selection.ts). A field absent from an automation's override
 * inherits the card-level devFlow default for that field — see
 * `resolveEffectiveRuntime`/`resolveEffectiveSchedule` below, shared by both
 * the write path (`buildRuntimePatch`, which writes the EFFECTIVE merged
 * value to the row on every provisioning call, not just at creation) and the
 * read path (`buildStatus`'s `overrides`/`effective` view).
 */

import {
  createScheduledAgentConfig,
  updateScheduledAgentConfig,
  listScheduledAgentConfigsByWorkspace,
  DuplicateSystemAutomationConfigError,
  type ScheduledAgentConfigDb,
  type TargetConfig,
} from "@almirant/database";
import {
  BUILTIN_AUTOMATIONS,
  BUILTIN_AUTOMATIONS_BY_ID,
  resolveEnabledBuiltinAutomation,
  type BuiltinAutomationDefinition,
  type BuiltinAutomationId,
  type BuiltinAutomationTargetConfigKey,
} from "@almirant/shared";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DevFlowCodingAgent = "claude-code" | "codex" | "opencode";
export type DevFlowAiProvider = "anthropic" | "openai" | "google" | "zai" | "xai";

/** A per-automation schedule override — see `DevFlowAutomationOverrideInput`. */
export interface DevFlowAutomationScheduleOverride {
  expression: string;
  timezone?: string | null;
}

/**
 * One automation's override entry under `devFlow.automations.<id>`. Every
 * field is independently optional/nullable — absent (or explicitly null)
 * means "inherit the card-level devFlow default for this field" (or, for
 * `schedule`, "use DEFAULT_CRON_EXPRESSION + the runtime default timezone").
 */
export interface DevFlowAutomationOverrideInput {
  enabled?: boolean | null;
  codingAgent?: DevFlowCodingAgent | null;
  aiProvider?: DevFlowAiProvider | null;
  model?: string | null;
  reasoningLevel?: string | null;
  maxConcurrentJobs?: number | null;
  schedule?: DevFlowAutomationScheduleOverride | null;
}

export interface DevFlowRuntimeInput {
  enabled: boolean;
  codingAgent?: DevFlowCodingAgent | null;
  aiProvider?: DevFlowAiProvider | null;
  model?: string | null;
  reasoningLevel?: string | null;
  /** Applied to every automation's targetConfig.<mode>.defaultMaxConcurrentJobs
   *  unless that automation has its own maxConcurrentJobs override. */
  maxConcurrentJobs?: number | null;
  /** Per-automation overrides (issue #235), keyed by BuiltinAutomationId. */
  automations?: Partial<Record<BuiltinAutomationId, DevFlowAutomationOverrideInput | null>>;
}

export interface ProvisionDevFlowInput {
  workspaceId: string;
  projectId: string;
  devFlow: DevFlowRuntimeInput;
  actorUserId?: string | null;
  /** Project timezone if known; falls back to DEFAULT_TIMEZONE. */
  timezone?: string | null;
}

/** The raw override as persisted, normalized so every field is present
 *  (null when absent) — the GET /dev-flow response's `overrides` shape. */
export interface DevFlowAutomationOverridesView {
  enabled: boolean | null;
  codingAgent: string | null;
  aiProvider: string | null;
  model: string | null;
  reasoningLevel: string | null;
  maxConcurrentJobs: number | null;
  schedule: { expression: string; timezone: string | null } | null;
}

/** The computed override-over-card-default merge — the GET /dev-flow
 *  response's `effective` shape. Always fully resolved (schedule always has
 *  both an expression and a timezone), independent of whether a
 *  `scheduled_agent_configs` row was ever actually provisioned. */
export interface DevFlowAutomationEffectiveView {
  codingAgent: string | null;
  aiProvider: string | null;
  model: string | null;
  reasoningLevel: string | null;
  maxConcurrentJobs: number | null;
  schedule: { expression: string; timezone: string };
}

export interface DevFlowAutomationStatus {
  automationId: BuiltinAutomationId;
  targetConfigKey: BuiltinAutomationTargetConfigKey;
  name: string;
  description: string;
  configId: string | null;
  managedBy: "system" | null;
  enabled: boolean;
  lastRunAt: string | null;
  /** True when this mode was intentionally NOT provisioned because an
   *  existing user-owned agent already activates it for this project. */
  skippedForExistingUserAgent: boolean;
  overrides: DevFlowAutomationOverridesView | null;
  effective: DevFlowAutomationEffectiveView;
}

export interface SkippedExistingUserAgent {
  configId: string;
  automationId: BuiltinAutomationId;
}

export interface DevFlowStatusResult {
  automations: DevFlowAutomationStatus[];
  skippedExistingUserAgents: SkippedExistingUserAgent[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CRON_EXPRESSION = "*/5 * * * *";
// Matches scheduledAgentConfigs.timezone's own column default and
// nightlyValidation's default — see projects.ts / scheduled-agent-configs.ts.
const DEFAULT_TIMEZONE = "Europe/Madrid";

// ---------------------------------------------------------------------------
// Per-automation override resolution (issue #235) — shared by the write
// path (buildRuntimePatch) and the read path (buildStatus).
// ---------------------------------------------------------------------------

const resolveAutomationOverride = (
  devFlow: DevFlowRuntimeInput | null | undefined,
  automationId: BuiltinAutomationId,
): DevFlowAutomationOverrideInput | null => devFlow?.automations?.[automationId] ?? null;

const resolveEffectiveRuntime = (
  devFlow: DevFlowRuntimeInput | null | undefined,
  override: DevFlowAutomationOverrideInput | null,
): Omit<DevFlowAutomationEffectiveView, "schedule"> => ({
  codingAgent: override?.codingAgent ?? devFlow?.codingAgent ?? null,
  aiProvider: override?.aiProvider ?? devFlow?.aiProvider ?? null,
  model: override?.model ?? devFlow?.model ?? null,
  reasoningLevel: override?.reasoningLevel ?? devFlow?.reasoningLevel ?? null,
  maxConcurrentJobs: override?.maxConcurrentJobs ?? devFlow?.maxConcurrentJobs ?? null,
});

const resolveEffectiveSchedule = (
  override: DevFlowAutomationOverrideInput | null,
  timezone: string,
): { expression: string; timezone: string } => ({
  expression: override?.schedule?.expression?.trim() || DEFAULT_CRON_EXPRESSION,
  timezone: override?.schedule?.timezone?.trim() || timezone,
});

/** Master `devFlow.enabled` always wins when false (all four off). When
 *  true, an automation's own `enabled:false` override turns just that one
 *  off; absent/null inherits "on" (the pre-#235 default for every
 *  automation once the master switch is on). */
const resolveEffectiveEnabled = (
  devFlow: DevFlowRuntimeInput | null | undefined,
  override: DevFlowAutomationOverrideInput | null,
): boolean => Boolean(devFlow?.enabled) && (override?.enabled ?? true);

// ---------------------------------------------------------------------------
// Project-scope detection (shared by conflict detection and status lookup)
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const configModeProjectRules = (
  targetConfig: unknown,
  targetConfigKey: BuiltinAutomationTargetConfigKey,
): Array<{ projectId?: string }> => {
  if (!isRecord(targetConfig)) return [];
  const modeConfig = targetConfig[targetConfigKey];
  if (!isRecord(modeConfig)) return [];
  const projects = modeConfig.projects;
  return Array.isArray(projects) ? (projects as Array<{ projectId?: string }>) : [];
};

/**
 * True when a scheduled-agent config's scope covers `projectId` for the
 * given automation mode: an explicit `config.projectId` match, an explicit
 * per-project rule in `targetConfig.<mode>.projects[]`, or — mirroring the
 * dispatcher's own "no scope -> whole workspace" fallback (see
 * `resolveProjectConcurrencyScopes` in scheduled-agent-dispatcher.ts, and
 * the equivalent backlogDrain/dodRemediation precedence in
 * backlog-drain-repository.ts) — no scoping at all anywhere on the config.
 */
const configCoversProject = (
  config: Pick<ScheduledAgentConfigDb, "projectId" | "targetConfig">,
  projectId: string,
  targetConfigKey: BuiltinAutomationTargetConfigKey,
): boolean => {
  if (config.projectId === projectId) return true;
  const rules = configModeProjectRules(config.targetConfig, targetConfigKey);
  if (rules.some((rule) => rule.projectId === projectId)) return true;
  return !config.projectId && rules.length === 0;
};

const detectConflictsFromConfigs = (
  configs: readonly ScheduledAgentConfigDb[],
  projectId: string,
): SkippedExistingUserAgent[] => {
  const conflicts: SkippedExistingUserAgent[] = [];
  for (const config of configs) {
    if (config.managedBy === "system") continue;
    // Fix 3 (review): a disabled user-owned config isn't actually running —
    // its targetConfig.<mode>.enabled flag can still read true (nothing
    // clears it on a plain disable through the generic scheduled-agent
    // routes), so the DB-level `enabled` column must ALSO be true for this
    // config to genuinely "cover" the automation. Without this,
    // adoptDevFlowAutomation's disable (which flips this column) never stops
    // the config from being reported as a conflict, and the next
    // provisionDevFlowForProject call silently re-disables the automation it
    // just adopted.
    if (!config.enabled) continue;
    const automation = resolveEnabledBuiltinAutomation(
      config.targetConfig as Parameters<typeof resolveEnabledBuiltinAutomation>[0],
    );
    if (!automation) continue;
    if (!configCoversProject(config, projectId, automation.targetConfigKey)) continue;
    conflicts.push({ configId: config.id, automationId: automation.id });
  }
  return conflicts;
};

/**
 * Read-only: does ANY existing non-system-managed config in the workspace
 * already activate a built-in automation mode for `projectId`? Used both to
 * gate provisioning (skip creating that mode's system config) and by the
 * read-only GET /projects/:id/dev-flow status endpoint.
 */
export const detectDevFlowUserAgentConflicts = async (input: {
  workspaceId: string;
  projectId: string;
}): Promise<SkippedExistingUserAgent[]> => {
  const configs = await listScheduledAgentConfigsByWorkspace(input.workspaceId);
  return detectConflictsFromConfigs(configs, input.projectId);
};

// ---------------------------------------------------------------------------
// Persisted devFlow parsing (issue #235) — shared by GET /dev-flow and
// POST /dev-flow/adopt, both of which need to read the project's persisted
// `agentDefaults.devFlow` before computing overrides/effective views.
// ---------------------------------------------------------------------------

/**
 * Light, trusting parse of `projects.agentDefaults.devFlow` (already
 * validated at PATCH /projects/:id/ai-config write time — see
 * projects.routes.ts). Returns null when devFlow was never configured.
 */
export const parsePersistedDevFlow = (agentDefaults: unknown): DevFlowRuntimeInput | null => {
  if (!isRecord(agentDefaults)) return null;
  const devFlow = agentDefaults.devFlow;
  if (!isRecord(devFlow)) return null;
  return devFlow as unknown as DevFlowRuntimeInput;
};

// ---------------------------------------------------------------------------
// Status building
// ---------------------------------------------------------------------------

const buildOverridesView = (
  override: DevFlowAutomationOverrideInput | null,
): DevFlowAutomationOverridesView | null => {
  if (!override) return null;
  return {
    enabled: override.enabled ?? null,
    codingAgent: override.codingAgent ?? null,
    aiProvider: override.aiProvider ?? null,
    model: override.model ?? null,
    reasoningLevel: override.reasoningLevel ?? null,
    maxConcurrentJobs: override.maxConcurrentJobs ?? null,
    schedule: override.schedule
      ? { expression: override.schedule.expression, timezone: override.schedule.timezone ?? null }
      : null,
  };
};

const buildStatus = (
  automation: BuiltinAutomationDefinition,
  match: ScheduledAgentConfigDb | undefined,
  skippedForExistingUserAgent: boolean,
  devFlow: DevFlowRuntimeInput | null | undefined,
  timezone: string,
): DevFlowAutomationStatus => {
  const override = resolveAutomationOverride(devFlow, automation.id);
  return {
    automationId: automation.id,
    targetConfigKey: automation.targetConfigKey,
    name: automation.name,
    description: automation.description,
    configId: match?.id ?? null,
    managedBy: match ? "system" : null,
    enabled: match?.enabled ?? false,
    lastRunAt: match?.lastRunAt ? new Date(match.lastRunAt).toISOString() : null,
    skippedForExistingUserAgent,
    overrides: buildOverridesView(override),
    effective: {
      ...resolveEffectiveRuntime(devFlow, override),
      schedule: resolveEffectiveSchedule(override, timezone),
    },
  };
};

const findSystemConfig = (
  configs: readonly ScheduledAgentConfigDb[],
  automationId: BuiltinAutomationId,
): ScheduledAgentConfigDb | undefined =>
  configs.find(
    (config) => config.managedBy === "system" && config.builtinAutomationId === automationId,
  );

/**
 * Read-only status for GET /projects/:id/dev-flow: the four automations'
 * current system-config state (if provisioned) plus any conflicting
 * user-owned agents — computed live, never from a cached provisioning
 * result, so it stays correct even if dev-flow was never provisioned.
 * `devFlow`/`timezone` (issue #235) drive the `overrides`/`effective` view
 * on each automation entry — pass the project's persisted devFlow (see
 * `parsePersistedDevFlow`) so the response reflects the CURRENT desired
 * config even for automations that were never actually provisioned yet.
 */
export const getDevFlowStatus = async (input: {
  workspaceId: string;
  projectId: string;
  devFlow?: DevFlowRuntimeInput | null;
  timezone?: string | null;
}): Promise<DevFlowStatusResult> => {
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  const [projectConfigs, conflicts] = await Promise.all([
    listScheduledAgentConfigsByWorkspace(input.workspaceId, { projectId: input.projectId }),
    detectDevFlowUserAgentConflicts(input),
  ]);
  const conflictedAutomationIds = new Set(conflicts.map((conflict) => conflict.automationId));

  const automations = BUILTIN_AUTOMATIONS.map((automation) =>
    buildStatus(
      automation,
      findSystemConfig(projectConfigs, automation.id),
      conflictedAutomationIds.has(automation.id),
      input.devFlow,
      timezone,
    ),
  );

  return { automations, skippedExistingUserAgents: conflicts };
};

// ---------------------------------------------------------------------------
// Provisioning (write path)
// ---------------------------------------------------------------------------

/** Each of the four modes shares the same `{enabled, defaultMaxConcurrentJobs, ...}`
 *  shape (BacklogDrainConfig-like) — built per-key rather than via a generic
 *  computed-property loop, mirroring the established convention documented in
 *  scheduled-agents.routes.ts / agents.tools.ts's targetConfigSchema comments
 *  (each key validates/serializes as a structurally distinct shape). */
const buildAutomationTargetConfig = (
  automation: BuiltinAutomationDefinition,
  maxConcurrentJobs: number | null | undefined,
): TargetConfig => {
  const modeConfig = {
    enabled: true,
    ...(typeof maxConcurrentJobs === "number" ? { defaultMaxConcurrentJobs: maxConcurrentJobs } : {}),
  };
  switch (automation.targetConfigKey) {
    case "backlogDrain":
      return { backlogDrain: modeConfig };
    case "dodRemediation":
      return { dodRemediation: modeConfig };
    case "dodReview":
      return { dodReview: modeConfig };
    case "releaseIntegration":
      return { releaseIntegration: modeConfig };
  }
};

/**
 * Small local mirror of scheduled-runtime-precedence.ts's provider
 * inference, used ONLY to fill the NOT NULL `provider` column. The
 * codingAgent/aiProvider/aiModel columns below keep the raw (possibly null)
 * EFFECTIVE (override-over-card-default, issue #235) devFlow values so
 * dispatch-time precedence (project rule > scheduled config > work item >
 * project defaults > active connection > provider default) still applies
 * normally when neither devFlow nor its per-automation override sets them.
 */
const inferProvider = (
  codingAgent: string | null | undefined,
  aiProvider: string | null | undefined,
): "claude-code" | "codex" | "zipu" | "grok" => {
  if (aiProvider === "zai") return "zipu";
  if (aiProvider === "xai") return "grok";
  if (aiProvider === "openai") return "codex";
  if (aiProvider === "anthropic") return "claude-code";
  return codingAgent === "codex" ? "codex" : "claude-code";
};

/**
 * Computes the EFFECTIVE (override-over-card-default, issue #235) patch for
 * one automation's row. Always includes scheduleType/scheduleConfig/timezone
 * — unlike the pre-#235 version, which only set those at creation — so a
 * schedule override actually updates an already-provisioned row, not just a
 * brand-new one. `forceEnabled` is used by `adoptDevFlowAutomation`, which
 * must turn the row on regardless of the master devFlow.enabled flag or this
 * automation's own enabled override (adopting IS the "turn it on" action).
 */
const buildRuntimePatch = (
  automation: BuiltinAutomationDefinition,
  devFlow: DevFlowRuntimeInput,
  override: DevFlowAutomationOverrideInput | null,
  timezone: string,
  options?: { forceEnabled?: boolean },
) => {
  const runtime = resolveEffectiveRuntime(devFlow, override);
  const schedule = resolveEffectiveSchedule(override, timezone);
  return {
    codingAgent: runtime.codingAgent,
    aiProvider: runtime.aiProvider,
    aiModel: runtime.model,
    reasoningLevel: runtime.reasoningLevel,
    enabled: options?.forceEnabled ? true : resolveEffectiveEnabled(devFlow, override),
    targetConfig: buildAutomationTargetConfig(automation, runtime.maxConcurrentJobs),
    scheduleType: "cron" as const,
    scheduleConfig: { expression: schedule.expression },
    timezone: schedule.timezone,
  };
};

const upsertSystemAutomationConfig = async (params: {
  workspaceId: string;
  projectId: string;
  timezone: string;
  devFlow: DevFlowRuntimeInput;
  automation: BuiltinAutomationDefinition;
  override: DevFlowAutomationOverrideInput | null;
  existing: ScheduledAgentConfigDb | undefined;
  forceEnabled?: boolean;
}): Promise<ScheduledAgentConfigDb> => {
  const { workspaceId, projectId, timezone, devFlow, automation, override, existing, forceEnabled } = params;
  const runtimePatch = buildRuntimePatch(automation, devFlow, override, timezone, { forceEnabled });

  if (existing) {
    const updated = await updateScheduledAgentConfig(existing.id, workspaceId, runtimePatch);
    return updated ?? existing;
  }

  try {
    return await createScheduledAgentConfig({
      workspaceId,
      projectId,
      ownerUserId: null,
      managedBy: "system",
      builtinAutomationId: automation.id,
      name: automation.name,
      description: automation.description,
      prompt: null,
      jobType: automation.jobType,
      provider: inferProvider(runtimePatch.codingAgent, runtimePatch.aiProvider),
      trigger: "scheduled",
      ...runtimePatch,
    });
  } catch (error) {
    if (error instanceof DuplicateSystemAutomationConfigError) {
      // Race: a concurrent provisionDevFlowForProject call for this exact
      // (projectId, builtinAutomationId) pair won — see migration 0237's
      // partial unique index. Re-read and update the winning row instead of
      // failing this call, mirroring DuplicateActiveJobError /
      // DuplicateOpenBatchError's established skip-and-continue pattern.
      const configs = await listScheduledAgentConfigsByWorkspace(workspaceId, { projectId });
      const raced = findSystemConfig(configs, automation.id);
      if (raced) {
        const updated = await updateScheduledAgentConfig(raced.id, workspaceId, runtimePatch);
        return updated ?? raced;
      }
    }
    throw error;
  }
};

/**
 * Idempotently upserts the four built-in automations as `managedBy='system'`
 * scheduled_agent_configs rows for `projectId`, skipping (and reporting) any
 * mode already active on an existing user-owned config for this project.
 * Safe to call repeatedly with the same input (same end state, no
 * duplicates) — see the class docstring above for the concurrency story.
 */
export const provisionDevFlowForProject = async (
  input: ProvisionDevFlowInput,
): Promise<DevFlowStatusResult> => {
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;

  const [existingProjectConfigs, conflicts] = await Promise.all([
    listScheduledAgentConfigsByWorkspace(input.workspaceId, { projectId: input.projectId }),
    detectDevFlowUserAgentConflicts({ workspaceId: input.workspaceId, projectId: input.projectId }),
  ]);
  const conflictedAutomationIds = new Set(conflicts.map((conflict) => conflict.automationId));

  const automations: DevFlowAutomationStatus[] = [];

  // Stable catalog order (not dispatchPrecedence) for deterministic,
  // reproducible provisioning ordering across repeated calls.
  for (const automation of BUILTIN_AUTOMATIONS) {
    if (conflictedAutomationIds.has(automation.id)) {
      // Fix 2 (review): a conflict can arrive AFTER this automation's
      // system-managed row was already successfully provisioned (e.g. the
      // user creates their own agent activating the same mode/scope later).
      // `continue`-ing here without touching that row would leave it
      // enabled=true forever — dispatch reads `enabled` directly (see
      // `listEnabledScheduledAgentConfigs`), so a stale enabled system row
      // keeps firing alongside the user's own agent. It would also make
      // `buildStatus` report `configId: null`, lying about a row that still
      // exists. Force the row off (minimal update — skip entirely if it is
      // already disabled) and report its REAL post-disable state instead of
      // pretending the automation was never provisioned.
      const existingSystemConfig = findSystemConfig(existingProjectConfigs, automation.id);
      if (existingSystemConfig?.enabled) {
        const disabled = await updateScheduledAgentConfig(existingSystemConfig.id, input.workspaceId, {
          enabled: false,
        });
        automations.push(buildStatus(automation, disabled ?? existingSystemConfig, true, input.devFlow, timezone));
      } else {
        automations.push(buildStatus(automation, existingSystemConfig, true, input.devFlow, timezone));
      }
      continue;
    }

    const saved = await upsertSystemAutomationConfig({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      timezone,
      devFlow: input.devFlow,
      automation,
      override: resolveAutomationOverride(input.devFlow, automation.id),
      existing: findSystemConfig(existingProjectConfigs, automation.id),
    });

    automations.push(buildStatus(automation, saved, false, input.devFlow, timezone));
  }

  return { automations, skippedExistingUserAgents: conflicts };
};

// ---------------------------------------------------------------------------
// Adopt (issue #235) — POST /projects/:id/dev-flow/adopt
// ---------------------------------------------------------------------------

/** Thrown when adopt is called for an automation that currently has no
 *  conflicting user-owned agent to adopt — the route maps this to 409. */
export class DevFlowAutomationNotConflictedError extends Error {
  constructor(public readonly automationId: BuiltinAutomationId) {
    super(`No conflicting user-owned agent to adopt for automation '${automationId}'.`);
    this.name = "DevFlowAutomationNotConflictedError";
  }
}

export interface AdoptDevFlowAutomationInput {
  workspaceId: string;
  projectId: string;
  automationId: BuiltinAutomationId;
  devFlow: DevFlowRuntimeInput;
  timezone?: string | null;
}

export interface AdoptDevFlowAutomationResult {
  disabledUserConfigIds: string[];
  automation: DevFlowAutomationStatus;
}

/**
 * Returns a copy of `targetConfig` with `<targetConfigKey>.enabled` forced to
 * false, preserving every other key — both other mode sub-objects and any
 * other field already on that mode's own sub-object (e.g. `projects`). Used
 * by `adoptDevFlowAutomation` (Fix 3, review) to keep a just-disabled user
 * config's JSONB internally coherent: a disabled agent shouldn't still claim
 * to activate a mode, even though `detectConflictsFromConfigs` no longer
 * depends on this flag alone (it also requires the DB-level `enabled` column
 * — see above).
 */
const disableTargetConfigMode = (
  targetConfig: unknown,
  targetConfigKey: BuiltinAutomationTargetConfigKey,
): TargetConfig => {
  const base = isRecord(targetConfig) ? targetConfig : {};
  const modeConfig = isRecord(base[targetConfigKey]) ? base[targetConfigKey] : {};
  return {
    ...base,
    [targetConfigKey]: { ...modeConfig, enabled: false },
  } as TargetConfig;
};

/**
 * Resolves a dev-flow conflict for ONE automation: disables every
 * conflicting user-owned config that currently activates it for this
 * project (they stay `managedBy='user'`, not deleted — same "disable, never
 * delete" convention as the rest of this module), then upserts/enables the
 * system-managed automation with its effective runtime/schedule.
 *
 * Unlike normal provisioning, adopting always forces `enabled: true` on the
 * adopted automation — regardless of the project's master `devFlow.enabled`
 * flag or this automation's own `enabled` override. The whole point of
 * calling this endpoint is "activate this automation now that the conflict
 * blocking it is gone"; leaving it off would silently defeat that intent
 * whenever the caller hadn't already turned dev-flow on globally.
 *
 * Throws `DevFlowAutomationNotConflictedError` (mapped to 409 by the route)
 * when there is nothing to adopt — this must only run against a REAL
 * conflict, the same one `getDevFlowStatus`/`provisionDevFlowForProject`
 * would report via `skippedForExistingUserAgent`.
 */
export const adoptDevFlowAutomation = async (
  input: AdoptDevFlowAutomationInput,
): Promise<AdoptDevFlowAutomationResult> => {
  const automation = BUILTIN_AUTOMATIONS_BY_ID[input.automationId];
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;

  // Fetch once, workspace-wide: both to find the conflicts (the SAME pure
  // detection logic GET /dev-flow and provisioning use, via
  // detectConflictsFromConfigs directly) AND to have each full config row
  // (not just its id) so we can also clear its OWN targetConfig mode flag
  // below (Fix 3, review) — detectDevFlowUserAgentConflicts only exposes
  // {configId, automationId}, not the record itself.
  const workspaceConfigs = await listScheduledAgentConfigsByWorkspace(input.workspaceId);
  const allConflicts = detectConflictsFromConfigs(workspaceConfigs, input.projectId);
  const conflictsToAdopt = allConflicts.filter((conflict) => conflict.automationId === input.automationId);
  if (conflictsToAdopt.length === 0) {
    throw new DevFlowAutomationNotConflictedError(input.automationId);
  }

  const configById = new Map(workspaceConfigs.map((config) => [config.id, config]));

  const disabledUserConfigIds: string[] = [];
  for (const conflict of conflictsToAdopt) {
    const conflictingConfig = configById.get(conflict.configId);
    const updated = await updateScheduledAgentConfig(conflict.configId, input.workspaceId, {
      enabled: false,
      // Fix 3 (review): also clear the JSONB mode flag that made this config
      // "cover" the automation in the first place — belt-and-suspenders, not
      // load-bearing for the fix itself (detectConflictsFromConfigs above
      // already stops depending on this flag alone).
      ...(conflictingConfig
        ? { targetConfig: disableTargetConfigMode(conflictingConfig.targetConfig, automation.targetConfigKey) }
        : {}),
    });
    if (updated) disabledUserConfigIds.push(conflict.configId);
  }

  const existingProjectConfigs = await listScheduledAgentConfigsByWorkspace(input.workspaceId, {
    projectId: input.projectId,
  });
  const override = resolveAutomationOverride(input.devFlow, input.automationId);
  const saved = await upsertSystemAutomationConfig({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    timezone,
    devFlow: input.devFlow,
    automation,
    override,
    existing: findSystemConfig(existingProjectConfigs, input.automationId),
    forceEnabled: true,
  });

  return {
    disabledUserConfigIds,
    automation: buildStatus(automation, saved, false, input.devFlow, timezone),
  };
};
