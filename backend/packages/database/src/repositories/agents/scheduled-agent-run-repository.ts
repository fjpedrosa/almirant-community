import { db } from "../../client";
import { scheduledAgentRuns } from "../../schema";
import { eq, and, desc, count } from "drizzle-orm";
import type { ScheduledAgentRunDb, NewScheduledAgentRun } from "../../schema/scheduled-agent-runs";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createScheduledAgentRun = async (
  data: Omit<NewScheduledAgentRun, "id" | "createdAt" | "updatedAt">
): Promise<ScheduledAgentRunDb> => {
  const [run] = await db
    .insert(scheduledAgentRuns)
    .values(data)
    .returning();

  if (!run) throw new Error("Failed to create scheduled agent run");
  return run;
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateScheduledAgentRun = async (
  id: string,
  organizationId: string,
  data: Partial<Pick<NewScheduledAgentRun, "status" | "completedAt" | "itemsProcessed" | "itemsSucceeded" | "itemsFailed" | "errorMessage" | "metadata">>
): Promise<ScheduledAgentRunDb> => {
  const [updated] = await db
    .update(scheduledAgentRuns)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(scheduledAgentRuns.id, id), eq(scheduledAgentRuns.organizationId, organizationId)))
    .returning();

  if (!updated) throw new Error("Scheduled agent run not found");
  return updated;
};

// ---------------------------------------------------------------------------
// Get by ID
// ---------------------------------------------------------------------------

export const getScheduledAgentRunById = async (
  id: string,
  organizationId: string,
): Promise<ScheduledAgentRunDb | null> => {
  const [run] = await db
    .select()
    .from(scheduledAgentRuns)
    .where(and(eq(scheduledAgentRuns.id, id), eq(scheduledAgentRuns.organizationId, organizationId)))
    .limit(1);

  return run ?? null;
};

// ---------------------------------------------------------------------------
// List by config ID (paginated)
// ---------------------------------------------------------------------------

export const getScheduledAgentRunsByConfigId = async (
  configId: string,
  options: { limit: number; offset: number }
): Promise<{ runs: ScheduledAgentRunDb[]; total: number }> => {
  const [runs, [totalRow]] = await Promise.all([
    db
      .select()
      .from(scheduledAgentRuns)
      .where(eq(scheduledAgentRuns.configId, configId))
      .orderBy(desc(scheduledAgentRuns.startedAt))
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ count: count() })
      .from(scheduledAgentRuns)
      .where(eq(scheduledAgentRuns.configId, configId)),
  ]);

  return { runs, total: totalRow?.count ?? 0 };
};
