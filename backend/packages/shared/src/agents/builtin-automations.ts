/**
 * Single source of truth for the four built-in scheduled-agent automations
 * (the "modes" of the scheduled-agent dispatch flow): backlog drain, DoD
 * remediation, DoD review, and release integration.
 *
 * WHY THIS EXISTS
 * ----------------
 * The four automation identifiers and their behavior are duplicated across
 * several places that have to be kept in sync by hand:
 *
 *   - frontend/src/domains/scheduled-agents/domain/types.ts
 *     (BuiltinAutomationId union + BUILTIN_AUTOMATIONS UI options)
 *   - backend/api/src/domains/agents/routes/workers.routes.ts
 *     (the inline dispatch logic + hardcoded skill-name literals)
 *   - backend/api/src/domains/agents/services/scheduled-agent-demand.ts
 *     (the latent-demand endpoint's own copy of the four keys)
 *   - backend/api/src/mcp/tools/agents.tools.ts
 *     (the Zod targetConfig schema's four keys)
 *   - backend/packages/shared/src/agents/schedule-evaluation.ts
 *     (isBuiltinReconciler's own copy of the four keys)
 *
 * This module does not eliminate every one of those call sites in one pass
 * (the Zod schema, in particular, still needs a hand-written object literal
 * per key because each key validates a structurally different shape, and the
 * API-domain route/service call sites are out of scope for this port) — but
 * it gives them one place to read the id / targetConfig key / job type /
 * skill name / dispatch precedence from, and a place for contract tests to
 * pin parity against the ones that still can't derive directly (the
 * frontend, which is not a Bun workspace member — see the frontend types.ts
 * file for why it keeps its own local copy instead of importing this module
 * directly). `schedule-evaluation.ts`'s `isBuiltinReconciler` is the first
 * consumer, refactored alongside this catalog to derive from
 * `resolveEnabledBuiltinAutomation` instead of its own literal OR chain.
 *
 * This is a pure-data module with NO external imports (not even from
 * `zod`), specifically so it stays importable from anywhere — including,
 * for contract-test purposes only, a relative import from the frontend
 * package, which has no runtime dependency on `@almirant/shared`.
 */

/** Kebab-case identifier — the frontend's AutomationTarget union member and
 *  the "source" field stamped on jobs created by each mode. */
export type BuiltinAutomationId =
  | "backlog-drain"
  | "dod-remediation"
  | "dod-review"
  | "release-integration";

/** Key under `ScheduledAgentConfig.targetConfig` carrying this mode's
 *  `{ enabled, ... }` sub-config. */
export type BuiltinAutomationTargetConfigKey =
  | "backlogDrain"
  | "dodRemediation"
  | "dodReview"
  | "releaseIntegration";

/** `agent_jobs.job_type` stamped on jobs created by a given mode. */
export type BuiltinAutomationJobType = "implementation" | "review" | "integration";

export interface BuiltinAutomationDefinition {
  /** Kebab-case identifier (see BuiltinAutomationId). */
  id: BuiltinAutomationId;
  /** Key under targetConfig carrying this mode's `{ enabled }` sub-config. */
  targetConfigKey: BuiltinAutomationTargetConfigKey;
  /** job_type stamped on jobs this mode creates. */
  jobType: BuiltinAutomationJobType;
  /**
   * Default skill name used for this mode's created jobs
   * (`config.skillName` / `promptTemplate`). dod-remediation candidates may
   * still override this per-candidate — this is the fallback used when a
   * candidate does not specify one.
   */
  skillName: string;
  /**
   * Position in the dispatcher's if/else-if ladder (lower = checked first).
   * When multiple targetConfig flags are enabled simultaneously on the same
   * config, the automation with the LOWEST dispatchPrecedence wins — see
   * `resolveEnabledBuiltinAutomation` below.
   */
  dispatchPrecedence: number;
  /** UI label shown in the automation type selector. */
  name: string;
  /** UI description shown in the automation type selector. */
  description: string;
}

export const BUILTIN_AUTOMATIONS: readonly BuiltinAutomationDefinition[] = [
  {
    id: "backlog-drain",
    targetConfigKey: "backlogDrain",
    jobType: "implementation",
    skillName: "runner-implement",
    dispatchPrecedence: 0,
    name: "Backlog drain",
    description: "Picks ready Backlog work items on each tick and enqueues implementation jobs.",
  },
  {
    id: "dod-remediation",
    targetConfigKey: "dodRemediation",
    jobType: "implementation",
    skillName: "runner-fix-dod",
    dispatchPrecedence: 1,
    name: "DoD remediation",
    description:
      "Repairs Backlog work items that failed Definition of Done review, using the saved DoD report.",
  },
  {
    id: "dod-review",
    targetConfigKey: "dodReview",
    jobType: "review",
    skillName: "dod-review",
    dispatchPrecedence: 2,
    name: "Definition of Done review",
    description: "Reviews To Review tasks against their Definition of Done after a quiet period.",
  },
  {
    id: "release-integration",
    targetConfigKey: "releaseIntegration",
    jobType: "integration",
    skillName: "runner-release-integration",
    dispatchPrecedence: 3,
    name: "Release integration",
    description: "Batches Validating tasks into the shared release integration PR.",
  },
] as const;

/** Precomputed, sorted by dispatchPrecedence ascending — used internally so
 *  callers don't need to re-sort on every resolution. */
const BUILTIN_AUTOMATIONS_BY_PRECEDENCE: readonly BuiltinAutomationDefinition[] = [
  ...BUILTIN_AUTOMATIONS,
].sort((a, b) => a.dispatchPrecedence - b.dispatchPrecedence);

export const BUILTIN_AUTOMATION_IDS: readonly BuiltinAutomationId[] = BUILTIN_AUTOMATIONS.map(
  (automation) => automation.id,
);

export const BUILTIN_AUTOMATION_TARGET_CONFIG_KEYS: readonly BuiltinAutomationTargetConfigKey[] =
  BUILTIN_AUTOMATIONS.map((automation) => automation.targetConfigKey);

export const BUILTIN_AUTOMATIONS_BY_ID: Readonly<
  Record<BuiltinAutomationId, BuiltinAutomationDefinition>
> = Object.fromEntries(
  BUILTIN_AUTOMATIONS.map((automation) => [automation.id, automation]),
) as Record<BuiltinAutomationId, BuiltinAutomationDefinition>;

export const BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY: Readonly<
  Record<BuiltinAutomationTargetConfigKey, BuiltinAutomationDefinition>
> = Object.fromEntries(
  BUILTIN_AUTOMATIONS.map((automation) => [automation.targetConfigKey, automation]),
) as Record<BuiltinAutomationTargetConfigKey, BuiltinAutomationDefinition>;

export const isBuiltinAutomationId = (value: unknown): value is BuiltinAutomationId =>
  typeof value === "string" &&
  (BUILTIN_AUTOMATION_IDS as readonly string[]).includes(value);

/** Generic `{ enabled }` flags shape shared by all four targetConfig
 *  sub-objects — the minimum shape `resolveEnabledBuiltinAutomation` needs. */
export type BuiltinAutomationTargetFlags = Partial<
  Record<BuiltinAutomationTargetConfigKey, { enabled?: boolean } | null | undefined>
>;

/**
 * Resolve which built-in automation (if any) a targetConfig activates,
 * respecting the SAME precedence as the dispatcher's if/else-if ladder: when
 * multiple flags are enabled simultaneously, the automation with the lowest
 * dispatchPrecedence wins. Returns undefined when none are enabled (a
 * "candidate-based" or "standalone" config).
 */
export const resolveEnabledBuiltinAutomation = (
  targetConfig: BuiltinAutomationTargetFlags | null | undefined,
): BuiltinAutomationDefinition | undefined => {
  if (!targetConfig) return undefined;
  return BUILTIN_AUTOMATIONS_BY_PRECEDENCE.find(
    (automation) => targetConfig[automation.targetConfigKey]?.enabled === true,
  );
};
