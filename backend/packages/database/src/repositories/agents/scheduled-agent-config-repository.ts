import { randomBytes } from "node:crypto";
import { db } from "../../client";
import { scheduledAgentConfigs, projects, skills } from "../../schema";
import { eq, and, ne } from "drizzle-orm";
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

export const createScheduledAgentConfig = async (
  data: NewScheduledAgentConfig,
): Promise<ScheduledAgentConfigDb> => {
  const [created] = await db
    .insert(scheduledAgentConfigs)
    .values(ensureWebhookToken(normalizeScheduledAgentConfigInput(data)))
    .returning();
  return normalizeScheduledAgentConfig(created!);
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

export const updateScheduledAgentConfigLastRunAt = async (
  id: string,
): Promise<void> => {
  await db
    .update(scheduledAgentConfigs)
    .set({ lastRunAt: new Date(), updatedAt: new Date() })
    .where(eq(scheduledAgentConfigs.id, id));
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
