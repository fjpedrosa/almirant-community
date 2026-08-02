import { randomBytes } from "node:crypto";
import { db } from "../../client";
import { scheduledAgentConfigs, projects, skills } from "../../schema";
import { eq, and, ne, sql } from "drizzle-orm";
import type {
  ScheduledAgentConfigDb,
  NewScheduledAgentConfig,
} from "../../schema/scheduled-agent-configs";
import {
  normalizeScheduledAgentConfig,
  normalizeScheduledAgentConfigInput,
} from "./scheduled-agent-config-normalization";

// Generate a URL-safe random token for webhook agents.
const generateWebhookToken = (): string => randomBytes(32).toString("base64url");

// Ensure a webhook-triggered agent has a token (auto-generate when missing).
const ensureWebhookToken = <T extends Partial<NewScheduledAgentConfig>>(data: T): T => {
  if (data.trigger === "webhook" && !data.webhookToken) {
    return { ...data, webhookToken: generateWebhookToken() };
  }
  return data;
};

// ---------------------------------------------------------------------------
// dev-flow (issue #230): duplicate system-provisioning guard
// ---------------------------------------------------------------------------

/**
 * Thrown when a `createScheduledAgentConfig` insert violates
 * `scheduled_agent_configs_system_builtin_automation_uidx` (migration
 * 0223, ports cloud's 0237) — i.e. a concurrent `provisionDevFlowForProject`
 * call already created the system-managed config for this (projectId,
 * builtinAutomationId) pair. Callers (dev-flow-provisioning.ts) treat this
 * as "lost the race", re-read the winning row, and update it instead of
 * failing the whole provisioning call.
 */
export class DuplicateSystemAutomationConfigError extends Error {
  constructor(
    public readonly projectId: string | null,
    public readonly builtinAutomationId: string | null,
  ) {
    super(
      `A system-managed scheduled agent config already exists for projectId=${projectId ?? "null"} builtinAutomationId=${builtinAutomationId ?? "null"}`,
    );
    this.name = "DuplicateSystemAutomationConfigError";
  }
}

const SCHEDULED_AGENT_CONFIGS_SYSTEM_BUILTIN_AUTOMATION_UNIQUE_INDEX =
  "scheduled_agent_configs_system_builtin_automation_uidx";

/**
 * Narrowed shape of a pg unique-violation error. We only care about the
 * SQLSTATE code and the constraint name, and probe one level of `.cause`
 * unwrap since drizzle/postgres-js wrap driver errors inconsistently
 * across versions.
 */
interface PgUniqueViolationError {
  code?: string;
  constraint_name?: string;
  cause?: unknown;
}

const isDuplicateSystemAutomationViolation = (err: unknown): boolean => {
  const probe = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    const pg = candidate as PgUniqueViolationError;
    return (
      pg.code === "23505" &&
      pg.constraint_name === SCHEDULED_AGENT_CONFIGS_SYSTEM_BUILTIN_AUTOMATION_UNIQUE_INDEX
    );
  };
  if (!err || typeof err !== "object") return false;
  if (probe(err)) return true;
  return probe((err as PgUniqueViolationError).cause);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduledAgentConfigFilters = {
  projectId?: string;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const listScheduledAgentConfigsByWorkspace = async (
  workspaceId: string,
  filters?: ScheduledAgentConfigFilters,
): Promise<
  (ScheduledAgentConfigDb & {
    projectName: string | null;
    skillName: string | null;
  })[]
> => {
  const conditions = [eq(scheduledAgentConfigs.workspaceId, workspaceId)];

  if (filters?.projectId) {
    conditions.push(eq(scheduledAgentConfigs.projectId, filters.projectId));
  }

  const rows = await db
    .select({
      config: scheduledAgentConfigs,
      projectName: projects.name,
      skillName: skills.name,
    })
    .from(scheduledAgentConfigs)
    .leftJoin(projects, eq(scheduledAgentConfigs.projectId, projects.id))
    .leftJoin(skills, eq(scheduledAgentConfigs.skillId, skills.id))
    .where(and(...conditions))
    .orderBy(scheduledAgentConfigs.createdAt);

  return rows.map((row) => ({
    ...normalizeScheduledAgentConfig(row.config),
    projectName: row.projectName,
    skillName: row.skillName,
  }));
};

export const getScheduledAgentConfigById = async (
  id: string,
  workspaceId: string,
): Promise<ScheduledAgentConfigDb | undefined> => {
  const [row] = await db
    .select()
    .from(scheduledAgentConfigs)
    .where(and(eq(scheduledAgentConfigs.id, id), eq(scheduledAgentConfigs.workspaceId, workspaceId)))
    .limit(1);

  return row ? normalizeScheduledAgentConfig(row) : row;
};

// Global lookup for the worker plane (workers.routes.ts): the runner is
// shared instance infrastructure, not scoped to one workspace — the same
// trust boundary as /workers/jobs/claim. The config's own workspaceId is the
// attribution source of truth for job creation and billing, so this
// intentionally does not filter by any caller-supplied workspace.
export const getScheduledAgentConfigByIdUnscoped = async (
  id: string,
): Promise<ScheduledAgentConfigDb | undefined> => {
  const [row] = await db
    .select()
    .from(scheduledAgentConfigs)
    .where(eq(scheduledAgentConfigs.id, id))
    .limit(1);

  return row ? normalizeScheduledAgentConfig(row) : row;
};

export const createScheduledAgentConfig = async (
  data: NewScheduledAgentConfig,
): Promise<ScheduledAgentConfigDb> => {
  const values = ensureWebhookToken(normalizeScheduledAgentConfigInput(data));
  try {
    const [created] = await db.insert(scheduledAgentConfigs).values(values).returning();
    return normalizeScheduledAgentConfig(created!);
  } catch (error) {
    if (isDuplicateSystemAutomationViolation(error)) {
      throw new DuplicateSystemAutomationConfigError(
        values.projectId ?? null,
        values.builtinAutomationId ?? null,
      );
    }
    throw error;
  }
};

export const updateScheduledAgentConfig = async (
  id: string,
  workspaceId: string,
  data: Partial<Omit<NewScheduledAgentConfig, "id" | "workspaceId" | "createdAt">>,
): Promise<ScheduledAgentConfigDb | undefined> => {
  const [updated] = await db
    .update(scheduledAgentConfigs)
    .set({ ...ensureWebhookToken(normalizeScheduledAgentConfigInput(data)), updatedAt: new Date() })
    .where(and(eq(scheduledAgentConfigs.id, id), eq(scheduledAgentConfigs.workspaceId, workspaceId)))
    .returning();
  return updated ? normalizeScheduledAgentConfig(updated) : updated;
};

// Public lookup for the webhook endpoint: token is the only auth factor.
export const getScheduledAgentConfigByIdAndToken = async (
  id: string,
  token: string,
): Promise<(ScheduledAgentConfigDb & { skillName: string | null }) | undefined> => {
  const [row] = await db
    .select({
      config: scheduledAgentConfigs,
      skillName: skills.name,
    })
    .from(scheduledAgentConfigs)
    .leftJoin(skills, eq(scheduledAgentConfigs.skillId, skills.id))
    .where(
      and(
        eq(scheduledAgentConfigs.id, id),
        eq(scheduledAgentConfigs.webhookToken, token),
        eq(scheduledAgentConfigs.trigger, "webhook"),
      ),
    )
    .limit(1);

  if (!row) return undefined;
  return {
    ...normalizeScheduledAgentConfig(row.config),
    skillName: row.skillName,
  };
};

export const deleteScheduledAgentConfig = async (id: string, workspaceId: string): Promise<boolean> => {
  const result = await db
    .delete(scheduledAgentConfigs)
    .where(and(eq(scheduledAgentConfigs.id, id), eq(scheduledAgentConfigs.workspaceId, workspaceId)))
    .returning({ id: scheduledAgentConfigs.id });
  return result.length > 0;
};

// ---------------------------------------------------------------------------
// Workers / Scheduler
// ---------------------------------------------------------------------------

export type EnabledScheduledAgentConfig = ScheduledAgentConfigDb & {
  projectName: string | null;
};

export const listEnabledScheduledAgentConfigs = async (): Promise<
  EnabledScheduledAgentConfig[]
> => {
  const rows = await db
    .select({
      config: scheduledAgentConfigs,
      projectName: projects.name,
    })
    .from(scheduledAgentConfigs)
    .leftJoin(projects, eq(scheduledAgentConfigs.projectId, projects.id))
    .where(
      and(
        eq(scheduledAgentConfigs.enabled, true),
        eq(scheduledAgentConfigs.trigger, "scheduled"),
        ne(scheduledAgentConfigs.scheduleType, "manual"),
      ),
    );

  return rows.map((row) => ({
    ...normalizeScheduledAgentConfig(row.config),
    projectName: row.projectName,
  }));
};

/**
 * Records that a dispatch attempt happened for this config. This is the
 * SINGLE choke point every dispatch path funnels through — the dispatcher's
 * five deterministic-mode branches call it directly
 * (`scheduled-agent-dispatcher.ts`), and the standalone/candidate-based path
 * calls it via `executeScheduledAgentConfigWithResult`. That makes it the one
 * place that can auto-disable a one-shot ('once') config after its single
 * dispatch, uniformly, regardless of which caller fired it.
 *
 * The `enabled` column is updated via a single atomic `CASE WHEN` in the SAME
 * UPDATE statement as `lastRunAt` — not a read-then-write — so this stays
 * correct under concurrent dispatch authorities (this backend's own
 * dispatcher tick running on multiple replicas) without needing a
 * transaction: whichever UPDATE lands, lands whole. The condition reads the
 * row's OWN `schedule_type` column, so callers never need to know or pass
 * the config's schedule type — every existing call site keeps its current
 * `(id: string) => Promise<void>` signature unchanged.
 */
export const updateScheduledAgentConfigLastRunAt = async (
  id: string,
): Promise<void> => {
  await db
    .update(scheduledAgentConfigs)
    .set({
      lastRunAt: new Date(),
      updatedAt: new Date(),
      enabled: sql`CASE WHEN ${scheduledAgentConfigs.scheduleType} = 'once' THEN false ELSE ${scheduledAgentConfigs.enabled} END`,
    })
    .where(eq(scheduledAgentConfigs.id, id));
};

/**
 * At-most-once PRE-dispatch consumption for a `scheduleType='once'` config.
 * Unlike `updateScheduledAgentConfigLastRunAt` (which auto-disables AFTER a
 * job is created), this is the guard the dispatcher calls BEFORE routing to
 * ANY dispatch branch — the 4 deterministic modes
 * (backlogDrain/dodRemediation/dodReview/releaseIntegration) and the
 * candidateBased path never went through a reservation (only the standalone
 * `jobType='scheduled'` branch does, via `executeScheduledAgentConfigWithResult`),
 * so a POST-dispatch-only disable left a window where two concurrent dispatch
 * authorities (this backend's own dispatcher tick on two replicas) could both
 * observe `isOnceDue()===true` and both create jobs before either one's
 * disable landed.
 *
 * The single `UPDATE ... WHERE enabled=true AND schedule_type='once'
 * RETURNING id` is the atomic compare-and-swap: only the replica whose
 * UPDATE actually flips a row gets `true` back and is allowed to proceed to
 * job creation. Every other concurrent caller (or a later tick, once the
 * row is enabled=false) gets `false` and must skip without dispatching.
 *
 * Deliberately scoped to `schedule_type='once'` only — do NOT reuse this for
 * cron/time_window configs, which must keep being re-evaluated on every
 * tick by their own reconcilers; a one-time "consume" would break that.
 *
 * Semantics are pure at-most-once, not exactly-once: a crash between a
 * successful consume here and the `createJob` call(s) in the caller's
 * dispatch branch permanently loses that occurrence. That is intentional —
 * the alternative (consuming AFTER job creation) is exactly the race this
 * function exists to close. The lost occurrence stays visible/debuggable as
 * `(enabled=false, lastRunAt=null)` on the row, rather than silently
 * retried (which could double-dispatch) or silently hidden.
 */
export const consumeOnceScheduleOccurrence = async (id: string): Promise<boolean> => {
  const [row] = await db
    .update(scheduledAgentConfigs)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(scheduledAgentConfigs.id, id),
        eq(scheduledAgentConfigs.enabled, true),
        eq(scheduledAgentConfigs.scheduleType, "once"),
      ),
    )
    .returning({ id: scheduledAgentConfigs.id });
  return row !== undefined;
};

// ---------------------------------------------------------------------------
// Pause / Resume
// ---------------------------------------------------------------------------

export const pauseScheduledAgentConfig = async (
  id: string,
  workspaceId: string,
  until: Date | null,
): Promise<ScheduledAgentConfigDb | undefined> => {
  const [updated] = await db
    .update(scheduledAgentConfigs)
    .set({ pausedUntil: until, updatedAt: new Date() })
    .where(and(eq(scheduledAgentConfigs.id, id), eq(scheduledAgentConfigs.workspaceId, workspaceId)))
    .returning();
  return updated;
};

// ---------------------------------------------------------------------------
// Trigger (returns config for job creation)
// ---------------------------------------------------------------------------

export const triggerScheduledAgentConfig = async (
  id: string,
  workspaceId: string,
): Promise<ScheduledAgentConfigDb | undefined> => {
  const config = await getScheduledAgentConfigById(id, workspaceId);
  if (!config) return undefined;

  // Update lastRunAt to reflect the manual trigger
  await db
    .update(scheduledAgentConfigs)
    .set({ lastRunAt: new Date(), updatedAt: new Date() })
    .where(and(eq(scheduledAgentConfigs.id, id), eq(scheduledAgentConfigs.workspaceId, workspaceId)));

  return config ? normalizeScheduledAgentConfig(config) : config;
};
