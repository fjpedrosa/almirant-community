/**
 * Job Intent Resolution
 *
 * Replaces the overloaded skillName-based behavior with a clean model:
 *   - prompt: freeform text (for scheduled/custom agents)
 *   - promptTemplate: slug that maps to a SKILL.md file (implement, validate, etc.)
 *   - interactive: whether the session stays alive between turns (planning only)
 *   - triggerType: what fired the job (event, scheduled, recovery)
 *
 * Resource allocation, push eligibility, branch/PR creation, and completion
 * detection are all derived from these fields rather than magic string matching.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerType = "event" | "scheduled" | "recovery";

export type ResourceTier = "light" | "standard" | "heavy";
export type WorkspaceIntent = "read-only" | "write";
export type PostSessionPushPolicy = "never" | "on-success";

export interface JobIntent {
  /** Freeform prompt text (scheduled agents, custom prompts) */
  prompt: string | null;
  /** Reusable template slug — maps to .claude/skills/<slug>/SKILL.md */
  promptTemplate: string | null;
  /** Whether session is interactive (kept alive between turns). Only planning/ideate. */
  interactive: boolean;
  /** Whether the job needs a browser/Playwright MCP runtime. */
  needsBrowser: boolean;
  /** What triggered the job */
  triggerType: TriggerType;
}

export interface SkillResources {
  /** Base process memory (excludes tmpfs). Used as container limit in bind-mount mode. */
  memoryMb: number;
  tmpfs: { workspace: number; tmp: number; home: number };
}

type PushPolicyResolverInput = {
  promptTemplate?: string | null;
  skillName?: string | null;
  jobType?: string | null;
  interactive?: boolean | null;
  config?: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Resource tiers
// ---------------------------------------------------------------------------

const RESOURCE_TIERS: Record<ResourceTier, SkillResources> = {
  light: { memoryMb: 1024, tmpfs: { workspace: 1024, tmp: 512, home: 1280 } },
  standard: { memoryMb: 1536, tmpfs: { workspace: 2048, tmp: 512, home: 2048 } },
  heavy: { memoryMb: 3072, tmpfs: { workspace: 2048, tmp: 768, home: 2560 } },
};

/**
 * Auto-calculate resource tier from job characteristics.
 * Browser jobs need Chromium + MCP headroom, so they use heavy even if the
 * legacy job shape would otherwise look interactive/read-only.
 * Interactive (planning) → light. Everything else → standard.
 */
export const resolveResourceTier = (intent: JobIntent): ResourceTier => {
  if (intent.needsBrowser) return "heavy";
  if (intent.interactive) return "light";
  return "standard";
};

export const getResourcesForTier = (tier: ResourceTier): SkillResources =>
  RESOURCE_TIERS[tier];

const hasNestedBrowserRequirement = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.needsBrowser === true ||
    record.requiresBrowser === true ||
    record.enableBrowser === true
  );
};

const resolveNeedsBrowser = (
  config: Record<string, unknown> | null | undefined,
): boolean => {
  if (!config) return false;

  return (
    config.needsBrowser === true ||
    config.requiresBrowser === true ||
    config.enableBrowser === true ||
    hasNestedBrowserRequirement(config.resourceProfile) ||
    hasNestedBrowserRequirement(config.resourceRequirements)
  );
};

// ---------------------------------------------------------------------------
// Intent resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a job's intent from its columns.
 *
 * Reads new model columns (prompt, promptTemplate, triggerType, interactive)
 * with fallback to the old model (skillName, jobType, config) for backward
 * compatibility during migration.
 */
export const resolveJobIntent = (job: {
  prompt?: string | null;
  promptTemplate?: string | null;
  triggerType?: string | null;
  interactive?: boolean | null;
  // Old model fallback
  skillName?: string | null;
  jobType?: string | null;
  config?: Record<string, unknown> | null;
}): JobIntent => {
  // New model: columns are populated
  if (job.promptTemplate != null || job.prompt != null) {
    return {
      prompt: job.prompt ?? null,
      promptTemplate: job.promptTemplate ?? null,
      interactive: job.interactive ?? false,
      needsBrowser: resolveNeedsBrowser(job.config),
      triggerType: (job.triggerType as TriggerType) ?? "event",
    };
  }

  // Fallback: derive from old model (skillName + jobType + config)
  const skillName = job.skillName ?? (job.config?.skillName as string | undefined) ?? "implement";
  const jobType = job.jobType ?? "implementation";
  const configPrompt = typeof job.config?.prompt === "string" ? job.config.prompt : null;

  return {
    prompt: configPrompt,
    promptTemplate: skillName,
    // Interactivity is derived strictly from the persisted column. Skill-name
    // pattern matching has been removed: any job that needs to pause for
    // human turns must set agent_jobs.interactive = true at insert time.
    interactive: job.interactive === true,
    needsBrowser: resolveNeedsBrowser(job.config),
    triggerType: jobType === "scheduled" ? "scheduled" : "event",
  };
};

// ---------------------------------------------------------------------------
// Post-session push policy
// ---------------------------------------------------------------------------

const WRITE_CAPABLE_TEMPLATES = new Set([
  "implement",
  "runner-implement",
  "runner-fix-dod",
  "runner-release-integration",
  "fix",
  "nightly-fix",
  "feedback-bug-fix",
  "document",
  "runner-document",
]);

const READ_ONLY_JOB_TYPES = new Set([
  "planning",
  "prewarm",
  "validation",
  "review",
  "incident-analyze",
]);

const WRITE_CAPABLE_JOB_TYPES = new Set([
  "implementation",
  "bug-fix",
  "integration",
]);

const READ_ONLY_TEMPLATE_PATTERN =
  /(^|[-_])(plan|planning|ideate|prewarm|review|validate|analyze|analysis)([-_]|$)/i;

const normalizePolicyValue = (value: unknown): PostSessionPushPolicy | null => {
  if (value === "never" || value === "on-success") return value;
  return null;
};

const normalizeWorkspaceIntent = (value: unknown): WorkspaceIntent | null => {
  if (value === "read-only" || value === "write") return value;
  return null;
};

const normalizeTemplate = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * Whether the PR-first flow should be skipped for this job.
 *
 * Some skills (e.g. `feedback-bug-fix`) manage their own branch+PR lifecycle
 * via MCP tools. For those jobs, the runner must NOT create the pre-draft
 * `almirant/job-<shortId>` PR upfront, otherwise it produces an orphan draft
 * PR in addition to the real one opened by the skill.
 *
 * This flag is independent from `resolvePostSessionPushPolicy`: the
 * safety-net post-session push is still controlled by the push policy, so
 * skills that opt out of PR-first can still benefit from the final push if
 * applicable.
 */
export const shouldSkipPrFirstFlow = (
  job: PushPolicyResolverInput,
): boolean => {
  return job.config?.selfManagesPr === true;
};

export const resolvePostSessionPushPolicy = (
  job: PushPolicyResolverInput,
): PostSessionPushPolicy => {
  const explicitPolicy = normalizePolicyValue(job.config?.postSessionPushPolicy);
  if (explicitPolicy) return explicitPolicy;

  const explicitWorkspaceIntent = normalizeWorkspaceIntent(job.config?.workspaceIntent);
  if (explicitWorkspaceIntent === "read-only") return "never";
  if (explicitWorkspaceIntent === "write") return "on-success";

  if (job.config?.isPrewarm === true) return "never";
  if (job.interactive === true) return "never";

  const normalizedTemplate = normalizeTemplate(
    job.promptTemplate ?? job.skillName ?? job.config?.skillName,
  );
  if (WRITE_CAPABLE_TEMPLATES.has(normalizedTemplate)) return "on-success";
  if (READ_ONLY_TEMPLATE_PATTERN.test(normalizedTemplate)) return "never";

  const normalizedJobType = normalizeTemplate(job.jobType);
  if (READ_ONLY_JOB_TYPES.has(normalizedJobType)) return "never";
  if (WRITE_CAPABLE_JOB_TYPES.has(normalizedJobType)) return "on-success";

  return "never";
};

// ---------------------------------------------------------------------------
// Template labels (bilingual, replaces skillLabel)
// ---------------------------------------------------------------------------

const LABEL_MAP_ES: Record<string, { emoji: string; gerund: string; infinitive: string }> = {
  implement:          { emoji: "🔧", gerund: "Implementando", infinitive: "Implementar" },
  "runner-implement": { emoji: "🔧", gerund: "Implementando", infinitive: "Implementar" },
  "runner-fix-dod":   { emoji: "🔧", gerund: "Reparando DoD", infinitive: "Reparar DoD" },
  "runner-release-integration": { emoji: "🚀", gerund: "Integrando release", infinitive: "Integrar release" },
  integration:        { emoji: "🚀", gerund: "Integrando release", infinitive: "Integrar release" },
  validate:           { emoji: "🔧", gerund: "Validando",     infinitive: "Validar" },
  document:           { emoji: "🔧", gerund: "Documentando",  infinitive: "Documentar" },
  "runner-document":  { emoji: "🔧", gerund: "Documentando",  infinitive: "Documentar" },
  "nightly-fix":      { emoji: "🔧", gerund: "Reparando",     infinitive: "Reparar" },
  "bug-fix":          { emoji: "🔧", gerund: "Reparando",     infinitive: "Reparar" },
  fix:                { emoji: "🔧", gerund: "Reparando",     infinitive: "Reparar" },
  planning:           { emoji: "🔧", gerund: "Planificando",  infinitive: "Planificar" },
  recording:          { emoji: "🎬", gerund: "Grabando",      infinitive: "Grabar" },
  review:             { emoji: "🔧", gerund: "Revisando",     infinitive: "Revisar" },
  "dod-review":       { emoji: "✅", gerund: "Revisando DoD", infinitive: "Revisar DoD" },
  ideate:             { emoji: "💡", gerund: "Ideando",       infinitive: "Idear" },
  prewarm:            { emoji: "⏳", gerund: "Preparando",    infinitive: "Preparar" },
  scheduled:          { emoji: "📅", gerund: "Ejecutando",    infinitive: "Ejecutar" },
};

const LABEL_MAP_EN: Record<string, { emoji: string; gerund: string; infinitive: string }> = {
  implement:          { emoji: "🔧", gerund: "Implementing",  infinitive: "Implement" },
  "runner-implement": { emoji: "🔧", gerund: "Implementing",  infinitive: "Implement" },
  "runner-fix-dod":   { emoji: "🔧", gerund: "Fixing DoD",    infinitive: "Fix DoD" },
  "runner-release-integration": { emoji: "🚀", gerund: "Releasing",       infinitive: "Release" },
  integration:        { emoji: "🚀", gerund: "Releasing",       infinitive: "Release" },
  validate:           { emoji: "🔧", gerund: "Validating",    infinitive: "Validate" },
  document:           { emoji: "🔧", gerund: "Documenting",   infinitive: "Document" },
  "runner-document":  { emoji: "🔧", gerund: "Documenting",   infinitive: "Document" },
  "nightly-fix":      { emoji: "🔧", gerund: "Fixing",        infinitive: "Fix" },
  "bug-fix":          { emoji: "🔧", gerund: "Fixing",        infinitive: "Fix" },
  fix:                { emoji: "🔧", gerund: "Fixing",        infinitive: "Fix" },
  planning:           { emoji: "🔧", gerund: "Planning",      infinitive: "Plan" },
  recording:          { emoji: "🎬", gerund: "Recording",     infinitive: "Record" },
  review:             { emoji: "🔧", gerund: "Reviewing",     infinitive: "Review" },
  "dod-review":       { emoji: "✅", gerund: "Reviewing DoD", infinitive: "Review DoD" },
  ideate:             { emoji: "💡", gerund: "Ideating",      infinitive: "Ideate" },
  prewarm:            { emoji: "⏳", gerund: "Preparing",     infinitive: "Prepare" },
  scheduled:          { emoji: "📅", gerund: "Executing",     infinitive: "Execute" },
};

/**
 * Human-readable label for a prompt template slug.
 * Used for Discord thread names and progress messages.
 */
export const templateLabel = (
  slug: string | null | undefined,
  form: "gerund" | "infinitive",
  locale: string = "es",
): { emoji: string; text: string } => {
  const map = locale === "es" ? LABEL_MAP_ES : LABEL_MAP_EN;
  const fallback = locale === "es"
    ? { emoji: "🔧", gerund: "Ejecutando", infinitive: "Ejecutar" }
    : { emoji: "🔧", gerund: "Executing", infinitive: "Execute" };
  const entry = map[slug ?? ""] ?? fallback;
  return { emoji: entry.emoji, text: entry[form] };
};

/**
 * Whether this intent represents a prompt-only job (no SKILL.md template).
 * True when there's a freeform prompt but no template slug, or the template
 * is the generic "implement" default with an explicit prompt override.
 */
export const isPromptOnlyIntent = (intent: JobIntent): boolean =>
  !!intent.prompt && !intent.promptTemplate;
