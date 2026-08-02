/**
 * Read-only "why isn't this scheduled agent doing anything" explainer.
 *
 * WHY THIS EXISTS
 * ----------------
 * When a scheduled agent "does nothing", the reason today only exists as a
 * `logger.info(...)` line inside `scheduled-agent-dispatcher.ts`, invisible
 * to whoever is looking at the UI. This module walks the EXACT SAME gate
 * order the dispatcher uses (see `dispatchOneConfig` in
 * `scheduled-agent-dispatcher.ts`) and turns each gate into a human-readable
 * `{ gate, passed, detail }` entry, so "why didn't it run" has a direct
 * answer instead of a buried log line.
 *
 * GATE ORDER (mirrors scheduled-agent-dispatcher.ts's `dispatchOneConfig`)
 * -----------------------------------------------------------------------
 *   1. enabled          — config.enabled
 *   2. trigger          — config.trigger === "scheduled"
 *   3. schedule-type     — config.scheduleType !== "manual"
 *   4. paused-until      — config.pausedUntil not in the future
 *      (1-4 are the field-level decomposition of `isScheduledAgentRunnable`
 *      in scheduled-agent-due.ts — that function only returns one boolean,
 *      so each condition is re-checked here individually for per-gate detail)
 *   5. due               — isCronDue / isTimeWindowActive
 *   6. quota             — checkQuotaAvailable, same fail-open semantics as
 *                           the dispatcher's quota gate
 *   7. mode               — which deterministic mode (if any) is active,
 *                           resolved via the SAME `resolveEnabledBuiltinAutomation`
 *                           call `dispatchOneConfig` uses (see
 *                           @almirant/shared's builtin-automations.ts)
 *   8. project-rules      — which precedence branch resolved the mode's
 *                           project scope (explicit rules / derived from
 *                           config.projectId / workspace-wide sweep)
 *   9. board-columns      — does every board in scope actually have a
 *                           column whose `role` matches what the mode
 *                           needs (backlog / review / validating)
 *  10. candidates         — how many candidates the mode's own candidate
 *                           query found, with the `skipped` breakdown
 *                           translated to prose
 *
 * READ-ONLY — GUARANTEED
 * -----------------------------------------------------------------------
 * This module never calls `createJob`, `updateScheduledAgentConfigLastRunAt`,
 * `queueReleaseIntegration` (which itself creates jobs/batches), or any other
 * mutating function. Every dependency it imports is a plain SELECT-backed
 * repository read. Gates 8-10 (project-rules / board-columns / candidates)
 * are always computed — even after an earlier gate already failed — because
 * more diagnostic information is strictly better here; `blockedBy` still
 * reports the FIRST gate that failed, in gate order.
 */

import { Cron } from "croner";
import {
  checkQuotaAvailable,
  getAllBoards,
  getBacklogDrainCandidatesForConfigId,
  getDefinitionOfDoneReviewCandidates,
  getDodRemediationCandidatesForConfigId,
  getFixCandidates,
  getProjectById,
  getProjects,
  getScheduledAgentConfigById,
  getValidatingReleaseCandidates,
  getValidationCandidates,
  listBacklogDrainWorkItems,
  listScheduledAgentConfigsByWorkspace,
  type BacklogDrainCandidateResult,
  type BacklogDrainProjectRule,
  type ProviderQuotaDb,
  type ScheduledAgentConfigDb,
  type TargetConfig,
} from "@almirant/database";
import {
  resolveEnabledBuiltinAutomation,
  resolveScheduledAgentAiProvider,
  type BuiltinAutomationTargetConfigKey,
} from "@almirant/shared";
import { isCronDue, isOnceDue, isTimeWindowActive, type ScheduledAgentDueConfig } from "./scheduled-agent-due";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ScheduledAgentExplanationVerdict = "would-dispatch" | "blocked";

export interface ScheduledAgentExplanationGate {
  gate: string;
  passed: boolean;
  detail: string;
}

export interface ScheduledAgentExplanation {
  configId: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  verdict: ScheduledAgentExplanationVerdict;
  blockedBy: string | null;
  gates: ScheduledAgentExplanationGate[];
}

type ExplainableConfig = ScheduledAgentConfigDb & { projectName: string | null };

// Reuses @almirant/shared's BuiltinAutomationTargetConfigKey instead of a
// locally hardcoded union so this type can never list a mode the catalog
// doesn't know about (or omit one it does).
type DeterministicMode = BuiltinAutomationTargetConfigKey;
type SchedulerMode = DeterministicMode | "standalone" | "candidateBased";

const MODE_ROLE: Record<DeterministicMode, "backlog" | "review" | "validating"> = {
  backlogDrain: "backlog",
  dodRemediation: "backlog",
  dodReview: "review",
  releaseIntegration: "validating",
};

const describeMode = (mode: SchedulerMode, config: ExplainableConfig): string => {
  switch (mode) {
    case "backlogDrain":
      return "backlogDrain — targetConfig.backlogDrain.enabled=true (drenaje determinista de la columna con role 'backlog').";
    case "dodRemediation":
      return "dodRemediation — targetConfig.dodRemediation.enabled=true (remediación determinista de items con DoD incompleto).";
    case "dodReview":
      return "dodReview — targetConfig.dodReview.enabled=true (revisión determinista de DoD para items en columnas con role 'review').";
    case "releaseIntegration":
      return "releaseIntegration — targetConfig.releaseIntegration.enabled=true (integración determinista de items en columnas con role 'validating').";
    case "standalone":
      return "standalone — ningún modo determinista activo (backlogDrain/dodRemediation/dodReview/releaseIntegration) y jobType='scheduled': crea un job único con el prompt configurado, sin búsqueda de candidatos.";
    case "candidateBased":
      return `basado en candidatos genéricos — ningún modo determinista activo y jobType='${config.jobType}' (≠ 'scheduled').`;
    default:
      return mode;
  }
};

/**
 * Delegates to the SAME resolver `dispatchOneConfig` uses in
 * scheduled-agent-dispatcher.ts — `resolveEnabledBuiltinAutomation` from
 * @almirant/shared's builtin-automations catalog — instead of keeping an
 * independent copy of the precedence ladder. This is what makes gate 7 a
 * TRUSTWORTHY diagnostic: if it disagreed with the dispatcher about which
 * mode is active, the "why didn't it run" answer would be a lie. Falling
 * through to jobType==="scheduled" means standalone; anything else is routed
 * through the generic candidate-based branch (validation/bug-fix/etc) — both
 * fallbacks mirror the dispatcher's own fallthrough after the resolver
 * returns undefined.
 */
const resolveMode = (config: ExplainableConfig): SchedulerMode => {
  const target = config.targetConfig as TargetConfig;
  const resolvedAutomation = resolveEnabledBuiltinAutomation(target);
  if (resolvedAutomation) return resolvedAutomation.targetConfigKey;
  if (config.jobType === "scheduled") return "standalone";
  return "candidateBased";
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const toDateOrNull = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const fmtDate = (date: Date | null): string => (date ? date.toISOString() : "nunca");

/** Append-only gate recorder. `blockedBy` is the FIRST gate recorded as failed. */
const createGateTracker = () => {
  const gates: ScheduledAgentExplanationGate[] = [];
  const state: { blockedBy: string | null } = { blockedBy: null };
  const record = (gate: string, passed: boolean, detail: string): void => {
    gates.push({ gate, passed, detail });
    if (!passed && state.blockedBy === null) state.blockedBy = gate;
  };
  return { gates, state, record };
};

// ---------------------------------------------------------------------------
// Gate 5: due
// ---------------------------------------------------------------------------

const describeCronDue = (
  config: ScheduledAgentDueConfig,
  now: Date,
): { passed: boolean; detail: string } => {
  const scheduleConfig = config.scheduleConfig as { expression?: string } | null;
  const expression = scheduleConfig?.expression;
  if (!expression) {
    return {
      passed: false,
      detail: "scheduleType='cron' pero scheduleConfig.expression está vacío — no se puede calcular cuándo toca.",
    };
  }

  let cron: InstanceType<typeof Cron>;
  try {
    cron = new Cron(expression, { timezone: config.timezone });
  } catch (error) {
    return {
      passed: false,
      detail: `La expresión cron '${expression}' (timezone ${config.timezone}) no es válida: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    };
  }

  const lastRun = toDateOrNull(config.lastRunAt);
  const due = isCronDue(config, now);

  if (due) {
    return {
      passed: true,
      detail: lastRun
        ? `Toca ahora: la última ejecución fue ${fmtDate(lastRun)} y ya pasó la siguiente ocurrencia de '${expression}'.`
        : `Toca ahora: nunca se ha ejecutado (lastRunAt vacío), así que el primer tick lo dispara.`,
    };
  }

  const nextRun = lastRun ? cron.nextRun(lastRun) : cron.nextRun(now);
  return {
    passed: false,
    detail: `No toca todavía. Última ejecución: ${fmtDate(lastRun)}. Próxima ejecución estimada (cron '${expression}', ${config.timezone}): ${fmtDate(
      nextRun,
    )}.`,
  };
};

// Bounded forward scan for the next time-window occurrence: 15-minute steps
// for up to 8 days, comfortably covering a weekly daysOfWeek cycle plus the
// dispatcher's 5-minute lastRunAt cooldown for non-deterministic-mode agents.
const TIME_WINDOW_SCAN_STEP_MS = 15 * 60 * 1000;
const TIME_WINDOW_SCAN_MAX_STEPS = 8 * 24 * 4;

const findNextTimeWindowDueAt = (config: ScheduledAgentDueConfig, now: Date): Date | null => {
  for (let step = 1; step <= TIME_WINDOW_SCAN_MAX_STEPS; step += 1) {
    const candidate = new Date(now.getTime() + step * TIME_WINDOW_SCAN_STEP_MS);
    if (isTimeWindowActive(config, candidate)) return candidate;
  }
  return null;
};

const describeTimeWindowDue = (
  config: ScheduledAgentDueConfig,
  now: Date,
): { passed: boolean; detail: string } => {
  const lastRun = toDateOrNull(config.lastRunAt);
  const due = isTimeWindowActive(config, now);

  if (due) {
    return {
      passed: true,
      detail: `Toca ahora: ${now.toISOString()} cae dentro de la ventana horaria/días configurada.`,
    };
  }

  const nextDueAt = findNextTimeWindowDueAt(config, now);
  return {
    passed: false,
    detail: nextDueAt
      ? `No toca todavía. Última ejecución: ${fmtDate(lastRun)}. Próxima ventana activa estimada: ${fmtDate(nextDueAt)}.`
      : `No toca todavía y no se encontró una próxima ventana activa en los próximos 8 días — revisa startHour/endHour/daysOfWeek. Última ejecución: ${fmtDate(
          lastRun,
        )}.`,
  };
};

// 'once' (issue T2.2) has three distinct narrations, unlike cron/time_window:
//   1. runAt is still in the future -> "aún no toca".
//   2. runAt has passed and the config is still enabled -> "toca ahora".
//   3. runAt has passed and the config is now disabled -> "ya ejecutado". This
//      third state overlaps with gate 1 ('enabled') also failing — that gate
//      still reports the FIRST-failing verdict (gate order is unchanged), but
//      this detail explains WHY it's disabled instead of leaving the reader to
//      infer it from lastRunAt alone.
const describeOnceDue = (
  config: ScheduledAgentDueConfig,
  now: Date,
): { passed: boolean; detail: string } => {
  const scheduleConfig = config.scheduleConfig as { runAt?: string } | null;
  const runAtRaw = scheduleConfig?.runAt;
  if (!runAtRaw) {
    return {
      passed: false,
      detail: "scheduleType='once' pero scheduleConfig.runAt está vacío — no se puede calcular cuándo toca.",
    };
  }

  const runAt = toDateOrNull(runAtRaw);
  if (!runAt) {
    return {
      passed: false,
      detail: `scheduleConfig.runAt ('${runAtRaw}') no es una fecha ISO-8601 válida.`,
    };
  }

  const lastRun = toDateOrNull(config.lastRunAt);
  const hasPassed = isOnceDue(config, now);

  if (hasPassed && !config.enabled && lastRun) {
    return {
      passed: false,
      detail: `Ya ejecutado — pasada única completada el ${fmtDate(lastRun)} (runAt era ${fmtDate(runAt)}). El agente se auto-deshabilitó tras el dispatch; ver gate 'enabled'.`,
    };
  }

  if (hasPassed) {
    return {
      passed: true,
      detail: `Toca ahora: runAt (${fmtDate(runAt)}) ya pasó.`,
    };
  }

  return {
    passed: false,
    detail: `No toca todavía. Ejecución única programada para ${fmtDate(runAt)}.`,
  };
};

const evaluateDueGate = (config: ScheduledAgentDueConfig, now: Date): { passed: boolean; detail: string } => {
  if (config.scheduleType === "cron") return describeCronDue(config, now);
  if (config.scheduleType === "time_window") return describeTimeWindowDue(config, now);
  if (config.scheduleType === "once") return describeOnceDue(config, now);
  return {
    passed: false,
    detail: `No aplica: scheduleType='${config.scheduleType}' no es 'cron', 'time_window' ni 'once' (ver gate 'schedule-type').`,
  };
};

// ---------------------------------------------------------------------------
// Gate 6: quota — mirrors dispatchOneConfig's quota gate verbatim, including
// its fail-open behavior when the AI provider can't be resolved.
// ---------------------------------------------------------------------------

const evaluateQuotaGate = async (
  config: ExplainableConfig,
): Promise<{ passed: boolean; detail: string }> => {
  if (!config.workspaceId) {
    return { passed: true, detail: "Sin workspaceId — no se pudo verificar cuota (no debería ocurrir en un config persistido)." };
  }

  const quotaProvider = resolveScheduledAgentAiProvider({
    provider: config.provider,
    aiProvider: config.aiProvider,
  });

  if (!quotaProvider) {
    return {
      passed: true,
      detail:
        "No se pudo resolver el proveedor de IA (provider/aiProvider) para comprobar la cuota — igual que el dispatcher, se continúa sin bloquear (fail-open).",
    };
  }

  const availability = await checkQuotaAvailable(config.workspaceId, quotaProvider as ProviderQuotaDb["provider"]);
  if (!availability.allowed) {
    return {
      passed: false,
      detail: `Cuota de '${quotaProvider}' agotada${availability.reason ? ` (${availability.reason})` : ""}. Se reinicia: ${
        availability.resetAt ?? "desconocido"
      }.`,
    };
  }

  return { passed: true, detail: `Cuota de '${quotaProvider}' disponible.` };
};

// ---------------------------------------------------------------------------
// Gates 8-9: project-rules / board-columns
// ---------------------------------------------------------------------------

type ProjectRuleBranch = "explicit" | "derived" | "workspace-wide";

interface ProjectScope {
  branch: ProjectRuleBranch;
  allProjects: boolean;
  /** Concrete, enabled project ids in scope. Empty + allProjects=true means "every workspace project". */
  enabledProjectIds: string[];
  /** Every rule's projectId, including disabled ones — used for narration only. */
  allRuleProjectIds: string[];
  disabledCount: number;
}

/**
 * Resolves which projects are in scope for a deterministic mode, and WHICH
 * precedence branch decided that. This mirrors two things that are
 * documented to be identical on purpose:
 *   - `resolveBacklogStyleRules` in
 *     backend/packages/database/src/repositories/agents/backlog-drain-repository.ts
 *     (exported for backlogDrain/dodRemediation via resolveBacklogDrainRules/
 *     resolveDodRemediationRules, but private as a combined helper)
 *   - the private `resolveProjectConcurrencyScopes` in
 *     scheduled-agent-dispatcher.ts, used for dodReview/releaseIntegration,
 *     whose own "DELIBERATE DIVERGENCE" comment states it intentionally
 *     mirrors the same 3-branch precedence.
 * Neither combined helper is exported, so this is a small, deliberately
 * faithful copy used ONLY for narration and for deciding which boards to
 * check in the board-columns gate below. Actual candidate correctness for
 * backlogDrain/dodRemediation still comes from the real, exported
 * `getBacklogDrainCandidatesForConfigId` / `getDodRemediationCandidatesForConfigId`.
 */
const resolveProjectScope = (
  agentProjectId: string | null,
  target: { projects?: BacklogDrainProjectRule[] } | null | undefined,
): ProjectScope => {
  const explicitRules = (target?.projects ?? []).filter(
    (rule) => typeof rule.projectId === "string" && rule.projectId.length > 0,
  );

  if (explicitRules.length > 0) {
    const allRuleProjectIds = Array.from(new Set(explicitRules.map((rule) => rule.projectId)));
    const enabledProjectIds = Array.from(
      new Set(explicitRules.filter((rule) => rule.enabled !== false).map((rule) => rule.projectId)),
    );
    return {
      branch: "explicit",
      allProjects: false,
      enabledProjectIds,
      allRuleProjectIds,
      disabledCount: allRuleProjectIds.length - enabledProjectIds.length,
    };
  }

  if (agentProjectId) {
    return {
      branch: "derived",
      allProjects: false,
      enabledProjectIds: [agentProjectId],
      allRuleProjectIds: [agentProjectId],
      disabledCount: 0,
    };
  }

  return {
    branch: "workspace-wide",
    allProjects: true,
    enabledProjectIds: [],
    allRuleProjectIds: [],
    disabledCount: 0,
  };
};

const resolveProjectNames = async (
  workspaceId: string,
  ids: string[] | "all",
): Promise<Map<string, string>> => {
  const { projects } = await getProjects(workspaceId, { page: 1, limit: 500, offset: 0 });
  const relevant = ids === "all" ? projects : projects.filter((project) => ids.includes(project.id));
  return new Map(relevant.map((project) => [project.id, project.name]));
};

const nameOrId = (id: string, names: Map<string, string>): string => names.get(id) ?? id;

const evaluateProjectRulesGate = (
  scope: ProjectScope,
  names: Map<string, string>,
): { passed: boolean; detail: string } => {
  if (scope.branch === "workspace-wide") {
    return {
      passed: true,
      detail:
        "Sin reglas de proyecto explícitas y el agente no está anclado a un proyecto (projectId=null) → barre TODO el workspace en busca de candidatos.",
    };
  }

  if (scope.branch === "derived") {
    const id = scope.enabledProjectIds[0]!;
    return {
      passed: true,
      detail: `Regla derivada del proyecto del agente (${nameOrId(id, names)}) — no hay reglas explícitas en targetConfig.<modo>.projects, así que se usa el projectId del propio agente.`,
    };
  }

  // explicit
  if (scope.enabledProjectIds.length === 0) {
    const ruleNames = scope.allRuleProjectIds.map((id) => nameOrId(id, names)).join(", ");
    return {
      passed: false,
      detail: `Reglas de proyecto explícitas presentes (${ruleNames}) pero TODAS tienen enabled=false — cero proyectos en scope, cero candidatos posibles.`,
    };
  }

  const enabledNames = scope.enabledProjectIds.map((id) => nameOrId(id, names)).join(", ");
  const extra = scope.disabledCount > 0 ? ` (+${scope.disabledCount} regla(s) adicional(es) desactivada(s), ignoradas)` : "";
  return {
    passed: true,
    detail: `Reglas de proyecto explícitas: ${enabledNames}${extra}.`,
  };
};

const evaluateBoardColumnsGate = async (
  workspaceId: string,
  scope: ProjectScope,
  requiredRole: "backlog" | "review" | "validating",
  names: Map<string, string>,
): Promise<{ passed: boolean; detail: string }> => {
  const projectIds = scope.allProjects ? Array.from(names.keys()) : scope.enabledProjectIds;
  if (projectIds.length === 0) {
    return {
      passed: true,
      detail: "No hay proyectos en scope para comprobar tableros (ver gate 'project-rules').",
    };
  }

  const items = await listBacklogDrainWorkItems(workspaceId, projectIds);
  const boardIdsByProject = new Map<string, Set<string>>();
  for (const item of items) {
    const set = boardIdsByProject.get(item.projectId) ?? new Set<string>();
    set.add(item.boardId);
    boardIdsByProject.set(item.projectId, set);
  }

  const allBoardIds = new Set<string>();
  for (const set of boardIdsByProject.values()) {
    for (const boardId of set) allBoardIds.add(boardId);
  }

  const projectsWithoutItems = projectIds.filter((id) => !boardIdsByProject.has(id));
  const missingNote =
    projectsWithoutItems.length > 0
      ? ` (${projectsWithoutItems.map((id) => nameOrId(id, names)).join(", ")}: sin work items activos, tablero no evaluado.)`
      : "";

  if (allBoardIds.size === 0) {
    return {
      passed: true,
      detail: `Ningún proyecto en scope (${projectIds.map((id) => nameOrId(id, names)).join(", ")}) tiene work items activos todavía — no se puede determinar su tablero.`,
    };
  }

  const boards = await getAllBoards(workspaceId);
  const boardById = new Map(boards.map((board) => [board.id, board]));

  const failing: string[] = [];
  const passing: string[] = [];
  for (const boardId of allBoardIds) {
    const board = boardById.get(boardId);
    if (!board) continue;
    const hasRole = board.columns.some((column) => column.role === requiredRole);
    if (hasRole) {
      passing.push(board.name);
      continue;
    }
    const columnsList =
      board.columns.length > 0
        ? board.columns.map((column) => `${column.name}(${column.role})`).join(", ")
        : "ninguna columna";
    failing.push(
      `el tablero '${board.name}' no tiene ninguna columna con role '${requiredRole}' — tiene: ${columnsList}. El filtro es por ROLE, no por nombre de columna.`,
    );
  }

  if (failing.length > 0) {
    return { passed: false, detail: `${failing.join(" ")}${missingNote}` };
  }

  return {
    passed: true,
    detail: `Todos los tableros en scope (${passing.join(", ")}) tienen una columna con role '${requiredRole}'.${missingNote}`,
  };
};

// ---------------------------------------------------------------------------
// Gate 10: candidates — one implementation per mode, same underlying reads
// the dispatcher itself uses (no job creation, no lastRunAt updates).
// ---------------------------------------------------------------------------

const DEFAULT_QUIET_PERIOD_MINUTES = 15;

/** Port of orchestrator/dispatcher's `resolveQuietPeriodMinutes` — narration only. */
const resolveQuietPeriodMinutes = (value: number | null | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_QUIET_PERIOD_MINUTES;
  return Math.max(0, Math.floor(value));
};

const describeBacklogStyleSkipped = (skipped: BacklogDrainCandidateResult["skipped"]): string[] => {
  const lines: string[] = [];
  if (skipped.excluded.length) lines.push(`${skipped.excluded.length} excluida(s) explícitamente por la regla del proyecto.`);
  if (skipped.blocked.length) lines.push(`${skipped.blocked.length} bloqueada(s) por dependencias abiertas.`);
  if (skipped.active.length) lines.push(`${skipped.active.length} con un job activo ya en curso.`);
  if (skipped.concurrency.length) lines.push(`${skipped.concurrency.length} proyecto(s) saltados por límite de concurrencia.`);
  if (skipped.recentlyModified.length)
    lines.push(`${skipped.recentlyModified.length} saltada(s) por ventana de estabilización (minAgeMinutes).`);
  if (skipped.dodIncomplete.length) lines.push(`${skipped.dodIncomplete.length} saltada(s) por DoD incompleto en su bloque.`);
  if (skipped.notDodRemediation.length)
    lines.push(`${skipped.notDodRemediation.length} descartada(s): no están marcadas como DoD incompleto.`);
  if (skipped.missingDodReport.length)
    lines.push(`${skipped.missingDodReport.length} sin informe de DoD (dod_report) para remediar.`);
  if (skipped.humanReviewRequired.length)
    lines.push(`${skipped.humanReviewRequired.length} requieren revisión humana (intentos de remediación agotados).`);
  return lines;
};

const evaluateBacklogStyleCandidatesGate = async (
  config: ExplainableConfig,
  mode: "backlogDrain" | "dodRemediation",
): Promise<{ passed: boolean; detail: string }> => {
  const result =
    mode === "backlogDrain"
      ? await getBacklogDrainCandidatesForConfigId(config.id, config.workspaceId)
      : await getDodRemediationCandidatesForConfigId(config.id, config.workspaceId);

  if (!result) {
    return {
      passed: false,
      detail: "El config no se encontró al recalcular candidatos (¿fue borrado o cambió de workspace durante la comprobación?).",
    };
  }

  const lines = describeBacklogStyleSkipped(result.skipped);
  if (result.candidates.length === 0) {
    return {
      passed: false,
      detail:
        lines.length > 0
          ? `0 candidatos listos. ${lines.join(" ")}`
          : "0 candidatos listos. No hay work items en columnas con role 'backlog' pendientes de procesar.",
    };
  }

  return {
    passed: true,
    detail: `${result.candidates.length} candidato(s) listo(s) para despachar.${
      lines.length > 0 ? ` También: ${lines.join(" ")}` : ""
    }`,
  };
};

const evaluateDodReviewCandidatesGate = async (
  config: ExplainableConfig,
  scope: ProjectScope,
): Promise<{ passed: boolean; detail: string }> => {
  const minAgeMinutes = resolveQuietPeriodMinutes((config.targetConfig as TargetConfig)?.dodReview?.minAgeMinutes);
  const projectIds: Array<string | undefined> = scope.allProjects ? [undefined] : scope.enabledProjectIds;

  const candidates: unknown[] = [];
  for (const projectId of projectIds) {
    const rows = await getDefinitionOfDoneReviewCandidates(config.workspaceId, projectId, undefined, { minAgeMinutes });
    candidates.push(...rows);
  }

  if (candidates.length === 0) {
    return {
      passed: false,
      detail:
        "0 candidatos en columnas con role 'review' pendientes de revisión DoD (o todos ya tienen dod_approved/dod_incompleted/revisión humana marcada). Este modo no expone desglose de descartes.",
    };
  }

  return { passed: true, detail: `${candidates.length} candidato(s) pendientes de revisión DoD.` };
};

const evaluateReleaseIntegrationCandidatesGate = async (
  config: ExplainableConfig,
  scope: ProjectScope,
): Promise<{ passed: boolean; detail: string }> => {
  const minAgeMinutes = resolveQuietPeriodMinutes(
    (config.targetConfig as TargetConfig)?.releaseIntegration?.minAgeMinutes,
  );
  const projectIds: Array<string | undefined> = scope.allProjects ? [undefined] : scope.enabledProjectIds;

  let candidateCount = 0;
  const aggregate = { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 };
  for (const projectId of projectIds) {
    const result = await getValidatingReleaseCandidates(config.workspaceId, projectId, undefined, { minAgeMinutes });
    candidateCount += result.candidates.length;
    aggregate.missingPullRequest += result.skipped.missingPullRequest;
    aggregate.unresolvedRepository += result.skipped.unresolvedRepository;
    aggregate.alreadyBatched += result.skipped.alreadyBatched;
  }

  const lines: string[] = [];
  if (aggregate.missingPullRequest) lines.push(`${aggregate.missingPullRequest} sin Pull Request asociado.`);
  if (aggregate.unresolvedRepository)
    lines.push(`${aggregate.unresolvedRepository} con repositorio no resuelto (sin instalación de GitHub vinculada).`);
  if (aggregate.alreadyBatched) lines.push(`${aggregate.alreadyBatched} ya agrupada(s) en un batch de release activo.`);

  if (candidateCount === 0) {
    return {
      passed: false,
      detail:
        lines.length > 0
          ? `0 candidatos listos. ${lines.join(" ")}`
          : "0 candidatos listos. No hay work items en columnas con role 'validating'.",
    };
  }

  return {
    passed: true,
    detail: `${candidateCount} candidato(s) en 'validating' listos para integración.${lines.length ? ` También: ${lines.join(" ")}` : ""}`,
  };
};

const evaluateCandidateBasedGate = async (
  config: ExplainableConfig,
): Promise<{ passed: boolean; detail: string }> => {
  const projectId = config.projectId ?? undefined;

  if (config.jobType === "bug-fix") {
    const rows = await getFixCandidates(config.workspaceId, projectId);
    return rows.length === 0
      ? {
          passed: false,
          detail: "0 candidatos en columnas con role 'needs_fix' (o 'in_progress' con metadata.lastValidationResult='fail').",
        }
      : { passed: true, detail: `${rows.length} candidato(s) listos para corrección.` };
  }

  const requireDodApproved = (config.targetConfig as TargetConfig)?.requireDodApproved === true;
  const rows = await getValidationCandidates(config.workspaceId, projectId, undefined, { requireDodApproved });
  return rows.length === 0
    ? {
        passed: false,
        detail: `0 candidatos en columnas con role 'review'${requireDodApproved ? " con dod_approved=true" : ""} para jobType='${config.jobType}'.`,
      }
    : { passed: true, detail: `${rows.length} candidato(s) en columnas con role 'review' listos para jobType='${config.jobType}'.` };
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const explainOneConfig = async (config: ExplainableConfig, now: Date): Promise<ScheduledAgentExplanation> => {
  const tracker = createGateTracker();

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

  // Gates 1-4: field-level decomposition of isScheduledAgentRunnable.
  tracker.record(
    "enabled",
    config.enabled,
    config.enabled ? "El agente está habilitado (enabled=true)." : "El agente está deshabilitado (enabled=false).",
  );

  tracker.record(
    "trigger",
    config.trigger === "scheduled",
    config.trigger === "scheduled"
      ? "trigger='scheduled' — lo dispara el scheduler."
      : `trigger='${config.trigger}' — este agente no lo dispara el scheduler (usa otro mecanismo, p. ej. webhook).`,
  );

  const scheduleTypeOk = config.scheduleType !== "manual";
  tracker.record(
    "schedule-type",
    scheduleTypeOk,
    scheduleTypeOk
      ? `scheduleType='${config.scheduleType}'.`
      : "scheduleType='manual' — el scheduler nunca lo dispara automáticamente, solo ejecución manual.",
  );

  const pausedUntil = toDateOrNull(config.pausedUntil);
  const pausedBlocking = pausedUntil !== null && pausedUntil.getTime() > now.getTime();
  tracker.record(
    "paused-until",
    !pausedBlocking,
    pausedBlocking
      ? `Pausado hasta ${fmtDate(pausedUntil)}.`
      : config.pausedUntil
        ? `pausedUntil (${fmtDate(pausedUntil)}) ya pasó — no bloquea.`
        : "No está pausado.",
  );

  // Gate 5: due.
  const dueResult = evaluateDueGate(dueConfig, now);
  tracker.record("due", dueResult.passed, dueResult.detail);

  // Gate 6: quota.
  const quotaResult = await evaluateQuotaGate(config);
  tracker.record("quota", quotaResult.passed, quotaResult.detail);

  // Gate 7: mode (always informational — it never blocks on its own).
  const mode = resolveMode(config);
  tracker.record("mode", true, `Modo activo: ${describeMode(mode, config)}`);

  // Gates 8-10.
  if (mode === "standalone") {
    tracker.record("project-rules", true, "No aplica (modo standalone).");
    tracker.record("board-columns", true, "No aplica (modo standalone).");
    tracker.record(
      "candidates",
      true,
      "Modo standalone: crea un job único con el prompt configurado; no hay búsqueda de candidatos.",
    );
  } else if (mode === "candidateBased") {
    tracker.record(
      "project-rules",
      true,
      `No aplica la precedencia de reglas de proyecto (solo modos backlogDrain/dodRemediation/dodReview/releaseIntegration la usan). Ámbito: ${
        config.projectId ? (config.projectName ?? config.projectId) : "todo el workspace"
      }.`,
    );
    tracker.record(
      "board-columns",
      true,
      "No aplica como gate propio en este modo — el filtro por role de columna ya está implícito en la consulta de 'candidates'.",
    );
    const candidatesResult = await evaluateCandidateBasedGate(config);
    tracker.record("candidates", candidatesResult.passed, candidatesResult.detail);
  } else {
    const target = (config.targetConfig as TargetConfig)?.[mode];
    const scope = resolveProjectScope(config.projectId, target);
    const names = await resolveProjectNames(config.workspaceId, scope.allProjects ? "all" : scope.allRuleProjectIds);

    const projectRulesResult = evaluateProjectRulesGate(scope, names);
    tracker.record("project-rules", projectRulesResult.passed, projectRulesResult.detail);

    const requiredRole = MODE_ROLE[mode];
    const boardColumnsResult = await evaluateBoardColumnsGate(config.workspaceId, scope, requiredRole, names);
    tracker.record("board-columns", boardColumnsResult.passed, boardColumnsResult.detail);

    const candidatesResult =
      mode === "backlogDrain" || mode === "dodRemediation"
        ? await evaluateBacklogStyleCandidatesGate(config, mode)
        : mode === "dodReview"
          ? await evaluateDodReviewCandidatesGate(config, scope)
          : await evaluateReleaseIntegrationCandidatesGate(config, scope);
    tracker.record("candidates", candidatesResult.passed, candidatesResult.detail);
  }

  return {
    configId: config.id,
    name: config.name,
    projectId: config.projectId,
    projectName: config.projectName,
    verdict: tracker.state.blockedBy === null ? "would-dispatch" : "blocked",
    blockedBy: tracker.state.blockedBy,
    gates: tracker.gates,
  };
};

const fetchExplainableConfigs = async (
  workspaceId: string,
  configId: string | undefined,
): Promise<ExplainableConfig[]> => {
  if (configId) {
    const config = await getScheduledAgentConfigById(configId, workspaceId);
    if (!config) return [];
    const project = config.projectId ? await getProjectById(workspaceId, config.projectId) : null;
    return [{ ...config, projectName: project?.name ?? null }];
  }
  return listScheduledAgentConfigsByWorkspace(workspaceId);
};

/**
 * Explain, gate by gate and in dispatcher order, why every scheduled agent in
 * a workspace (or just one, via `configId`) would or would not dispatch right
 * now. Purely read-only: no job is created, no `lastRunAt` is touched.
 */
export const explainScheduledAgentDispatch = async (input: {
  workspaceId: string;
  configId?: string;
  now?: Date;
}): Promise<ScheduledAgentExplanation[]> => {
  const now = input.now ?? new Date();
  const configs = await fetchExplainableConfigs(input.workspaceId, input.configId);

  const explanations: ScheduledAgentExplanation[] = [];
  for (const config of configs) {
    explanations.push(await explainOneConfig(config, now));
  }
  return explanations;
};
