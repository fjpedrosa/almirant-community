import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../client";
import { boardColumns, milestoneWorkItems, milestones, projects, workItems } from "../../schema";

export interface MilestoneProgress {
  total: number;
  completed: number;
  percentage: number;
}

export interface MilestoneWorkItemDetail {
  id: string;
  taskId: string | null;
  title: string;
  type: "epic" | "feature" | "story" | "task" | "idea";
  priority: "low" | "medium" | "high" | "urgent";
  boardColumnId: string | null;
  boardColumnName: string | null;
  isDone: boolean;
  assignee: string | null;
}

export interface MilestoneWithProgress {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: "planned" | "in_progress" | "completed" | "on_hold" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  targetDate: Date | null;
  completedAt: Date | null;
  createdByUserId: string | null;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
  totalItems: number;
  completedItems: number;
  progress: number;
}

export interface MilestoneDetail extends MilestoneWithProgress {
  workItems: MilestoneWorkItemDetail[];
}

export interface CreateMilestoneInput {
  projectId: string;
  title: string;
  description?: string | null;
  status?: "planned" | "in_progress" | "completed" | "on_hold" | "cancelled";
  priority?: "low" | "medium" | "high" | "urgent";
  targetDate?: Date | null;
  completedAt?: Date | null;
  createdByUserId?: string | null;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  status?: "planned" | "in_progress" | "completed" | "on_hold" | "cancelled";
  priority?: "low" | "medium" | "high" | "urgent";
  targetDate?: Date | null;
  completedAt?: Date | null;
}

const toPercentage = (completed: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
};

const getMilestoneBaseById = async (orgId: string, milestoneId: string) => {
  const [milestone] = await db
    .select({
      id: milestones.id,
      projectId: milestones.projectId,
      title: milestones.title,
      description: milestones.description,
      status: milestones.status,
      priority: milestones.priority,
      targetDate: milestones.targetDate,
      completedAt: milestones.completedAt,
      createdByUserId: milestones.createdByUserId,
      organizationId: milestones.organizationId,
      createdAt: milestones.createdAt,
      updatedAt: milestones.updatedAt,
    })
    .from(milestones)
    .innerJoin(projects, eq(milestones.projectId, projects.id))
    .where(
      and(
        eq(milestones.id, milestoneId),
        eq(milestones.organizationId, orgId),
        eq(projects.organizationId, orgId)
      )
    )
    .limit(1);

  return milestone ?? null;
};

export const getMilestoneProgress = async (
  milestoneId: string
): Promise<MilestoneProgress> => {
  const [row] = await db
    .select({
      total: sql<number>`count(${milestoneWorkItems.id})::int`,
      completed: sql<number>`
        coalesce(
          sum(case when ${boardColumns.isDone} = true then 1 else 0 end),
          0
        )::int
      `,
    })
    .from(milestoneWorkItems)
    .leftJoin(workItems, eq(milestoneWorkItems.workItemId, workItems.id))
    .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(eq(milestoneWorkItems.milestoneId, milestoneId));

  const total = row?.total ?? 0;
  const completed = row?.completed ?? 0;

  return {
    total,
    completed,
    percentage: toPercentage(completed, total),
  };
};

export const getMilestonesByProject = async (
  orgId: string,
  projectId: string
): Promise<MilestoneWithProgress[]> => {
  const projectScope = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1);

  if (projectScope.length === 0) {
    return [];
  }

  const milestoneRows = await db
    .select({
      id: milestones.id,
      projectId: milestones.projectId,
      title: milestones.title,
      description: milestones.description,
      status: milestones.status,
      priority: milestones.priority,
      targetDate: milestones.targetDate,
      completedAt: milestones.completedAt,
      createdByUserId: milestones.createdByUserId,
      organizationId: milestones.organizationId,
      createdAt: milestones.createdAt,
      updatedAt: milestones.updatedAt,
    })
    .from(milestones)
    .where(and(eq(milestones.organizationId, orgId), eq(milestones.projectId, projectId)))
    .orderBy(milestones.targetDate, milestones.createdAt);

  if (milestoneRows.length === 0) {
    return [];
  }

  const milestoneIds = milestoneRows.map((item) => item.id);
  const progressRows = await db
    .select({
      milestoneId: milestoneWorkItems.milestoneId,
      total: sql<number>`count(${milestoneWorkItems.id})::int`,
      completed: sql<number>`
        coalesce(
          sum(case when ${boardColumns.isDone} = true then 1 else 0 end),
          0
        )::int
      `,
    })
    .from(milestoneWorkItems)
    .leftJoin(workItems, eq(milestoneWorkItems.workItemId, workItems.id))
    .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(inArray(milestoneWorkItems.milestoneId, milestoneIds))
    .groupBy(milestoneWorkItems.milestoneId);

  const progressByMilestoneId = new Map(
    progressRows.map((row) => [row.milestoneId, { total: row.total, completed: row.completed }])
  );

  return milestoneRows.map((milestone) => {
    const progress = progressByMilestoneId.get(milestone.id) ?? { total: 0, completed: 0 };
    return {
      ...milestone,
      totalItems: progress.total,
      completedItems: progress.completed,
      progress: toPercentage(progress.completed, progress.total),
    } satisfies MilestoneWithProgress;
  });
};

export const getMilestoneById = async (
  orgId: string,
  id: string
): Promise<MilestoneDetail | null> => {
  const milestone = await getMilestoneBaseById(orgId, id);
  if (!milestone) return null;

  const [progress, workItemsRows] = await Promise.all([
    getMilestoneProgress(id),
    db
      .select({
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
        boardColumnId: workItems.boardColumnId,
        boardColumnName: boardColumns.name,
        isDone: boardColumns.isDone,
        assignee: workItems.assignee,
      })
      .from(milestoneWorkItems)
      .innerJoin(workItems, eq(milestoneWorkItems.workItemId, workItems.id))
      .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(eq(milestoneWorkItems.milestoneId, id))
      .orderBy(workItems.position, workItems.createdAt),
  ]);

  return {
    ...milestone,
    totalItems: progress.total,
    completedItems: progress.completed,
    progress: progress.percentage,
    workItems: workItemsRows.map((item) => ({
      ...item,
      boardColumnName: item.boardColumnName ?? null,
      isDone: item.isDone ?? false,
    })),
  };
};

export const createMilestone = async (
  orgId: string,
  data: CreateMilestoneInput
): Promise<MilestoneWithProgress | null> => {
  const [projectScope] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, data.projectId), eq(projects.organizationId, orgId)))
    .limit(1);

  if (!projectScope) {
    return null;
  }

  const [created] = await db
    .insert(milestones)
    .values({
      projectId: data.projectId,
      title: data.title,
      description: data.description ?? null,
      status: data.status ?? "planned",
      priority: data.priority ?? "medium",
      targetDate: data.targetDate ?? null,
      completedAt: data.completedAt ?? null,
      createdByUserId: data.createdByUserId ?? null,
      organizationId: orgId,
    })
    .returning();

  if (!created) return null;

  return {
    ...created,
    totalItems: 0,
    completedItems: 0,
    progress: 0,
  };
};

export const updateMilestone = async (
  orgId: string,
  id: string,
  data: UpdateMilestoneInput
): Promise<MilestoneWithProgress | null> => {
  const existing = await getMilestoneBaseById(orgId, id);
  if (!existing) return null;

  const [updated] = await db
    .update(milestones)
    .set({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.targetDate !== undefined ? { targetDate: data.targetDate } : {}),
      ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(milestones.id, id), eq(milestones.organizationId, orgId)))
    .returning();

  if (!updated) return null;

  const progress = await getMilestoneProgress(id);

  return {
    ...updated,
    totalItems: progress.total,
    completedItems: progress.completed,
    progress: progress.percentage,
  };
};

export const deleteMilestone = async (
  orgId: string,
  id: string
): Promise<boolean> => {
  const deleted = await db
    .delete(milestones)
    .where(and(eq(milestones.id, id), eq(milestones.organizationId, orgId)))
    .returning({ id: milestones.id });

  return deleted.length > 0;
};

export const addWorkItemsToMilestone = async (
  milestoneId: string,
  workItemIds: string[]
): Promise<number> => {
  const uniqueWorkItemIds = Array.from(new Set(workItemIds)).filter(Boolean);
  if (uniqueWorkItemIds.length === 0) return 0;

  const inserted = await db
    .insert(milestoneWorkItems)
    .values(
      uniqueWorkItemIds.map((workItemId) => ({
        milestoneId,
        workItemId,
      }))
    )
    .onConflictDoNothing({
      target: [milestoneWorkItems.milestoneId, milestoneWorkItems.workItemId],
    })
    .returning({ id: milestoneWorkItems.id });

  return inserted.length;
};

export const removeWorkItemFromMilestone = async (
  milestoneId: string,
  workItemId: string
): Promise<boolean> => {
  const removed = await db
    .delete(milestoneWorkItems)
    .where(
      and(
        eq(milestoneWorkItems.milestoneId, milestoneId),
        eq(milestoneWorkItems.workItemId, workItemId)
      )
    )
    .returning({ id: milestoneWorkItems.id });

  return removed.length > 0;
};
