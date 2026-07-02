import { db } from "../../client";
import {
  planningSessions,
  planningSessionSeeds,
  planningSessionWorkItems,
  seeds,
  workItems,
  projects,
  boards,
  user,
} from "../../schema";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { PaginationParams } from "../../domain/types";
import { hydrateSeedRelations } from "./seed-repository";
import type {
  PlanningSession,
  NewPlanningSession,
  PlanningSessionConfig,
  PlanningSessionResult,
  InterruptionContext,
} from "../../schema/planning-sessions";
// ---------------------------------------------------------------------------
// Domain types (inline to avoid conflicts with concurrent edits to domain/types.ts)
// ---------------------------------------------------------------------------

export type PlanningSessionStatus = "active" | "interrupted" | "completed" | "archived";

export interface PlanningSessionWithMeta {
  id: string;
  workspaceId: string;
  projectId: string | null;
  boardId: string | null;
  title: string;
  status: PlanningSessionStatus;
  config: PlanningSessionConfig | null;
  result: PlanningSessionResult | null;
  createdByUserId: string | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  estimatedCost: string | null;
  durationMs: number | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Computed
  seedCount: number;
  workItemCount: number;
  createdByUserName: string | null;
  createdByUserImage: string | null;
  projectName: string | null;
  boardName: string | null;
}

export interface PlanningSessionFilters {
  status?: PlanningSessionStatus;
  createdByUserId?: string;
}

export interface PlanningSessionArchiveCandidate {
  id: string;
  status: Extract<PlanningSessionStatus, "completed" | "archived">;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface CreatePlanningSessionInput {
  projectId?: string;
  boardId?: string;
  title: string;
  config?: PlanningSessionConfig;
  createdByUserId: string;
}

export interface UpdatePlanningSessionInput {
  title?: string;
  status?: PlanningSessionStatus;
  config?: PlanningSessionConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sessionSelectWithMeta = {
  id: planningSessions.id,
  workspaceId: planningSessions.workspaceId,
  projectId: planningSessions.projectId,
  boardId: planningSessions.boardId,
  title: planningSessions.title,
  status: planningSessions.status,
  config: planningSessions.config,
  result: planningSessions.result,
  createdByUserId: planningSessions.createdByUserId,
  totalInputTokens: planningSessions.totalInputTokens,
  totalOutputTokens: planningSessions.totalOutputTokens,
  estimatedCost: planningSessions.estimatedCost,
  durationMs: planningSessions.durationMs,
  completedAt: planningSessions.completedAt,
  createdAt: planningSessions.createdAt,
  updatedAt: planningSessions.updatedAt,
  // Computed counts via correlated subqueries
  seedCount: sql<number>`(
    SELECT count(*)::int FROM planning_session_seeds
    WHERE planning_session_seeds.session_id = ${planningSessions.id}
  )`,
  workItemCount: sql<number>`(
    SELECT count(*)::int FROM planning_session_work_items
    WHERE planning_session_work_items.session_id = ${planningSessions.id}
  )`,
  // Joined fields
  createdByUserName: user.name,
  createdByUserImage: user.image,
  projectName: projects.name,
  boardName: boards.name,
};

// ---------------------------------------------------------------------------
// List planning sessions (paginated)
// ---------------------------------------------------------------------------

export const getPlanningSessions = async (
  workspaceId: string,
  projectId: string | undefined,
  pagination: PaginationParams,
  filters?: PlanningSessionFilters
): Promise<{ items: PlanningSessionWithMeta[]; total: number }> => {
  const conditions = [eq(planningSessions.workspaceId, workspaceId)];

  if (projectId) {
    conditions.push(eq(planningSessions.projectId, projectId));
  }

  if (filters?.status) {
    conditions.push(eq(planningSessions.status, filters.status));
  }

  if (filters?.createdByUserId) {
    conditions.push(eq(planningSessions.createdByUserId, filters.createdByUserId));
  }

  const whereClause = and(...conditions);

  const [itemsResult, countResult] = await Promise.all([
    db
      .select(sessionSelectWithMeta)
      .from(planningSessions)
      .leftJoin(user, eq(planningSessions.createdByUserId, user.id))
      .leftJoin(projects, eq(planningSessions.projectId, projects.id))
      .leftJoin(boards, eq(planningSessions.boardId, boards.id))
      .where(whereClause)
      .orderBy(desc(planningSessions.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(planningSessions)
      .where(whereClause),
  ]);

  return {
    items: itemsResult as PlanningSessionWithMeta[],
    total: countResult[0]?.count ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Get single session by ID
// ---------------------------------------------------------------------------

export const getPlanningSessionById = async (
  id: string
): Promise<PlanningSessionWithMeta | null> => {
  const [result] = await db
    .select(sessionSelectWithMeta)
    .from(planningSessions)
    .leftJoin(user, eq(planningSessions.createdByUserId, user.id))
    .leftJoin(projects, eq(planningSessions.projectId, projects.id))
    .leftJoin(boards, eq(planningSessions.boardId, boards.id))
    .where(eq(planningSessions.id, id))
    .limit(1);

  return (result as PlanningSessionWithMeta) ?? null;
};

// ---------------------------------------------------------------------------
// Create planning session
// ---------------------------------------------------------------------------

export const createPlanningSession = async (
  workspaceId: string,
  data: CreatePlanningSessionInput
): Promise<PlanningSessionWithMeta> => {
  // Check if user already has an active session in this workspace
  const existing = await getActiveSessionForUser(workspaceId, data.createdByUserId);
  if (existing) {
    throw new Error("User already has an active planning session");
  }

  const [created] = await db
    .insert(planningSessions)
    .values({
      workspaceId,
      projectId: data.projectId ?? null,
      boardId: data.boardId ?? null,
      title: data.title.trim(),
      status: "active",
      config: data.config ?? {},
      createdByUserId: data.createdByUserId,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create planning session");
  }

  return getPlanningSessionById(created.id) as Promise<PlanningSessionWithMeta>;
};

// ---------------------------------------------------------------------------
// Update planning session
// ---------------------------------------------------------------------------

export const updatePlanningSession = async (
  id: string,
  data: UpdatePlanningSessionInput
): Promise<PlanningSessionWithMeta | null> => {
  const updateValues: Partial<NewPlanningSession> = {
    updatedAt: new Date(),
  };

  if (data.title !== undefined) updateValues.title = data.title.trim();
  if (data.status !== undefined) updateValues.status = data.status;
  if (data.config !== undefined) updateValues.config = data.config;

  const [updated] = await db
    .update(planningSessions)
    .set(updateValues)
    .where(eq(planningSessions.id, id))
    .returning();

  if (!updated) return null;

  return getPlanningSessionById(id);
};

// ---------------------------------------------------------------------------
// Complete planning session
// ---------------------------------------------------------------------------

export const completePlanningSession = async (
  id: string,
  result: PlanningSessionResult
): Promise<PlanningSessionWithMeta | null> => {
  const now = new Date();

  // Fetch current session to calculate duration
  const [current] = await db
    .select({ createdAt: planningSessions.createdAt })
    .from(planningSessions)
    .where(eq(planningSessions.id, id))
    .limit(1);

  if (!current) return null;

  const durationMs = now.getTime() - current.createdAt.getTime();

  const [updated] = await db
    .update(planningSessions)
    .set({
      status: "completed",
      result,
      completedAt: now,
      durationMs,
      updatedAt: now,
    })
    .where(eq(planningSessions.id, id))
    .returning();

  if (!updated) return null;

  return getPlanningSessionById(id);
};

// ---------------------------------------------------------------------------
// Resume planning session (completed/archived → active)
// ---------------------------------------------------------------------------

export const resumePlanningSession = async (
  id: string
): Promise<PlanningSessionWithMeta | null> => {
  const now = new Date();

  const [updated] = await db
    .update(planningSessions)
    .set({
      status: "active",
      completedAt: null,
      result: sql`coalesce(${planningSessions.result}, '{}'::jsonb) - 'interruptionContext'`,
      updatedAt: now,
    })
    .where(eq(planningSessions.id, id))
    .returning();

  if (!updated) return null;

  return getPlanningSessionById(id);
};

// ---------------------------------------------------------------------------
// Delete planning session (hard delete, cascade handled by FK)
// ---------------------------------------------------------------------------

export const deletePlanningSession = async (id: string): Promise<boolean> => {
  const deleted = await db
    .delete(planningSessions)
    .where(eq(planningSessions.id, id))
    .returning({ id: planningSessions.id });

  return deleted.length > 0;
};

// ---------------------------------------------------------------------------
// Seeds junction
// ---------------------------------------------------------------------------

export const addSeedToSession = async (
  sessionId: string,
  seedId: string
): Promise<void> => {
  await db
    .insert(planningSessionSeeds)
    .values({ sessionId, seedId })
    .onConflictDoNothing();
};

export const removeSeedFromSession = async (
  sessionId: string,
  seedId: string
): Promise<boolean> => {
  const deleted = await db
    .delete(planningSessionSeeds)
    .where(
      and(
        eq(planningSessionSeeds.sessionId, sessionId),
        eq(planningSessionSeeds.seedId, seedId)
      )
    )
    .returning({ id: planningSessionSeeds.id });

  return deleted.length > 0;
};

export const getSeedsBySession = async (
  sessionId: string
) => {
  const rows = await db
    .select()
    .from(planningSessionSeeds)
    .innerJoin(seeds, eq(planningSessionSeeds.seedId, seeds.id))
    .where(eq(planningSessionSeeds.sessionId, sessionId))
    .orderBy(asc(planningSessionSeeds.addedAt));

  return Promise.all(
    rows.map((row) => hydrateSeedRelations(row.seeds, false))
  );
};

// ---------------------------------------------------------------------------
// Work items junction
// ---------------------------------------------------------------------------

export const addWorkItemToSession = async (
  sessionId: string,
  workItemId: string,
): Promise<void> => {
  await db
    .insert(planningSessionWorkItems)
    .values({
      sessionId,
      workItemId,
    })
    .onConflictDoNothing();
};

export const getWorkItemsBySession = async (
  sessionId: string
): Promise<
  {
    id: string;
    workItemId: string;
    title: string;
    type: string;
    taskId: string | null;
    proposedInMessageId: string | null;
    createdAt: Date;
  }[]
> => {
  return db
    .select({
      id: planningSessionWorkItems.id,
      workItemId: workItems.id,
      title: workItems.title,
      type: workItems.type,
      taskId: workItems.taskId,
      proposedInMessageId: planningSessionWorkItems.proposedInMessageId,
      createdAt: planningSessionWorkItems.createdAt,
    })
    .from(planningSessionWorkItems)
    .innerJoin(workItems, eq(planningSessionWorkItems.workItemId, workItems.id))
    .where(eq(planningSessionWorkItems.sessionId, sessionId))
    .orderBy(asc(planningSessionWorkItems.createdAt));
};

// ---------------------------------------------------------------------------
// Token usage (INCREMENT, not overwrite)
// ---------------------------------------------------------------------------

export const updateSessionTokenUsage = async (
  id: string,
  inputTokens: number,
  outputTokens: number,
  cost: string
): Promise<void> => {
  await db
    .update(planningSessions)
    .set({
      totalInputTokens: sql`coalesce(${planningSessions.totalInputTokens}, 0) + ${inputTokens}`,
      totalOutputTokens: sql`coalesce(${planningSessions.totalOutputTokens}, 0) + ${outputTokens}`,
      estimatedCost: sql`(coalesce(${planningSessions.estimatedCost}::numeric, 0) + ${cost}::numeric)::text`,
      updatedAt: new Date(),
    })
    .where(eq(planningSessions.id, id));
};

// ---------------------------------------------------------------------------
// Active session lookup
// ---------------------------------------------------------------------------

export const getActiveSessionForUser = async (
  workspaceId: string,
  userId: string
): Promise<PlanningSessionWithMeta | null> => {
  const [result] = await db
    .select(sessionSelectWithMeta)
    .from(planningSessions)
    .leftJoin(user, eq(planningSessions.createdByUserId, user.id))
    .leftJoin(projects, eq(planningSessions.projectId, projects.id))
    .leftJoin(boards, eq(planningSessions.boardId, boards.id))
    .where(
      and(
        eq(planningSessions.workspaceId, workspaceId),
        eq(planningSessions.createdByUserId, userId),
        eq(planningSessions.status, "active")
      )
    )
    .limit(1);

  return (result as PlanningSessionWithMeta) ?? null;
};

export const getInactiveActivePlanningSessions = async (
  inactiveBefore: Date
): Promise<PlanningSessionWithMeta[]> => {
  const results = await db
    .select(sessionSelectWithMeta)
    .from(planningSessions)
    .leftJoin(user, eq(planningSessions.createdByUserId, user.id))
    .leftJoin(projects, eq(planningSessions.projectId, projects.id))
    .leftJoin(boards, eq(planningSessions.boardId, boards.id))
    .where(
      and(
        eq(planningSessions.status, "active"),
        lt(planningSessions.updatedAt, inactiveBefore)
      )
    )
    .orderBy(asc(planningSessions.updatedAt));

  return results as PlanningSessionWithMeta[];
};

export const getPlanningSessionsEligibleForArchive = async (
  before: Date,
  limit: number,
): Promise<PlanningSessionArchiveCandidate[]> => {
  return db
    .select({
      id: planningSessions.id,
      status: planningSessions.status,
      completedAt: planningSessions.completedAt,
      updatedAt: planningSessions.updatedAt,
    })
    .from(planningSessions)
    .where(
      and(
        inArray(planningSessions.status, ["completed", "archived"]),
        lt(sql`coalesce(${planningSessions.completedAt}, ${planningSessions.updatedAt})`, before),
      ),
    )
    .orderBy(asc(sql`coalesce(${planningSessions.completedAt}, ${planningSessions.updatedAt})`))
    .limit(limit) as Promise<PlanningSessionArchiveCandidate[]>;
};

export const getActivePlanningSessions = async (): Promise<PlanningSessionWithMeta[]> => {
  const results = await db
    .select(sessionSelectWithMeta)
    .from(planningSessions)
    .leftJoin(user, eq(planningSessions.createdByUserId, user.id))
    .leftJoin(projects, eq(planningSessions.projectId, projects.id))
    .leftJoin(boards, eq(planningSessions.boardId, boards.id))
    .where(eq(planningSessions.status, "active"))
    .orderBy(asc(planningSessions.updatedAt));

  return results as PlanningSessionWithMeta[];
};

// ---------------------------------------------------------------------------
// Get seed IDs by session (for batch operations)
// ---------------------------------------------------------------------------

export const getSeedIdsBySession = async (
  sessionId: string
): Promise<string[]> => {
  const results = await db
    .select({ seedId: planningSessionSeeds.seedId })
    .from(planningSessionSeeds)
    .where(eq(planningSessionSeeds.sessionId, sessionId));

  return results.map((r) => r.seedId);
};

// ---------------------------------------------------------------------------
// Interrupt planning session
// ---------------------------------------------------------------------------

export const interruptPlanningSession = async (
  id: string,
  context: InterruptionContext
): Promise<PlanningSessionWithMeta | null> => {
  const now = new Date();

  const [updated] = await db
    .update(planningSessions)
    .set({
      status: "interrupted",
      result: sql`jsonb_set(coalesce(${planningSessions.result}, '{}'::jsonb), '{interruptionContext}', ${JSON.stringify(context)}::jsonb)`,
      updatedAt: now,
    })
    .where(eq(planningSessions.id, id))
    .returning();

  if (!updated) return null;

  return getPlanningSessionById(id);
};

// ---------------------------------------------------------------------------
// Build session recovery summary (markdown)
// ---------------------------------------------------------------------------

export const buildSessionRecoverySummary = async (
  sessionId: string
): Promise<string | null> => {
  const session = await getPlanningSessionById(sessionId);
  if (!session) return null;

  const sessionSeeds = await getSeedsBySession(sessionId);
  const sessionWorkItems = await getWorkItemsBySession(sessionId);

  const result = session.result as PlanningSessionResult | null;
  const ctx = result?.interruptionContext as InterruptionContext | undefined;

  const lines: string[] = [];

  lines.push("# Session Recovery Summary");
  lines.push("");
  lines.push(`## Session: ${session.title}`);

  if (ctx) {
    lines.push(`**Interrupted**: ${ctx.reason} at ${ctx.interruptedAt}`);
    lines.push(`**Last Phase**: ${ctx.lastPhase}`);
  }

  lines.push("");
  lines.push(`## Seeds (${sessionSeeds.length})`);
  if (sessionSeeds.length === 0) {
    lines.push("_No seeds in this session._");
  } else {
    for (const seed of sessionSeeds) {
      lines.push(`- ${seed.title} (${seed.status})`);
    }
  }

  lines.push("");
  lines.push(`## Work Items Created (${sessionWorkItems.length})`);
  if (sessionWorkItems.length === 0) {
    lines.push("_No work items created yet._");
  } else {
    for (const wi of sessionWorkItems) {
      const taskLabel = wi.taskId ? `[${wi.taskId}] ` : "";
      lines.push(`- ${taskLabel}${wi.title} (${wi.type})`);
    }
  }

  if (ctx?.pendingQuestionText) {
    lines.push("");
    lines.push("## Pending Question");
    lines.push(ctx.pendingQuestionText);
    if (ctx.pendingQuestionOptions && ctx.pendingQuestionOptions.length > 0) {
      lines.push(`Options: ${ctx.pendingQuestionOptions.join(", ")}`);
    }
  }

  return lines.join("\n");
};
