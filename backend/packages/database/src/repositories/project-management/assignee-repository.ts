import { db } from "../../client";
import { workItemAssignees, workItems } from "../../schema";
import { user } from "../../schema/auth";
import { eq, and, inArray } from "drizzle-orm";
import type { AssigneeRole, WorkItemAssignee } from "../../domain/types";

export const getAssigneesByWorkItem = async (
  workItemId: string
): Promise<WorkItemAssignee[]> => {
  const rows = await db
    .select({
      id: workItemAssignees.id,
      workItemId: workItemAssignees.workItemId,
      userId: workItemAssignees.userId,
      role: workItemAssignees.role,
      assignedAt: workItemAssignees.assignedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(workItemAssignees)
    .leftJoin(user, eq(workItemAssignees.userId, user.id))
    .where(eq(workItemAssignees.workItemId, workItemId))
    .orderBy(workItemAssignees.assignedAt);

  return rows as WorkItemAssignee[];
};

/**
 * Sync the legacy `assignee` text field on the work_items table.
 * Sets it to the name of the first "responsible" assignee (or first assignee if none is responsible).
 * If no assignees remain, clears the field to null.
 * Fire-and-forget — errors are silently caught.
 */
const syncLegacyAssigneeField = async (workItemId: string): Promise<void> => {
  try {
    const assignees = await db
      .select({
        role: workItemAssignees.role,
        userName: user.name,
      })
      .from(workItemAssignees)
      .leftJoin(user, eq(workItemAssignees.userId, user.id))
      .where(eq(workItemAssignees.workItemId, workItemId))
      .orderBy(workItemAssignees.assignedAt);

    const responsible = assignees.find((a) => a.role === "responsible");
    const primaryName = responsible?.userName ?? assignees[0]?.userName ?? null;

    await db
      .update(workItems)
      .set({ assignee: primaryName, updatedAt: new Date() })
      .where(eq(workItems.id, workItemId));
  } catch {
    // Silently ignore sync errors to avoid breaking main operations
  }
};

/**
 * Batch-fetch assignees for multiple work items in a single query.
 * Returns a Map of workItemId -> WorkItemAssignee[].
 */
export const getAssigneesByWorkItemIds = async (
  workItemIds: string[]
): Promise<Map<string, WorkItemAssignee[]>> => {
  if (workItemIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: workItemAssignees.id,
      workItemId: workItemAssignees.workItemId,
      userId: workItemAssignees.userId,
      role: workItemAssignees.role,
      assignedAt: workItemAssignees.assignedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(workItemAssignees)
    .leftJoin(user, eq(workItemAssignees.userId, user.id))
    .where(inArray(workItemAssignees.workItemId, workItemIds))
    .orderBy(workItemAssignees.assignedAt);

  const map = new Map<string, WorkItemAssignee[]>();
  for (const row of rows) {
    const list = map.get(row.workItemId);
    if (list) {
      list.push(row as WorkItemAssignee);
    } else {
      map.set(row.workItemId, [row as WorkItemAssignee]);
    }
  }
  return map;
};

export const assignUserToWorkItem = async (
  workItemId: string,
  userId: string,
  role: AssigneeRole = "responsible"
): Promise<WorkItemAssignee | null> => {
  const [result] = await db
    .insert(workItemAssignees)
    .values({ workItemId, userId, role })
    .onConflictDoNothing({
      target: [workItemAssignees.workItemId, workItemAssignees.userId],
    })
    .returning();

  if (!result) return null;

  // Fetch with user data
  const [full] = await db
    .select({
      id: workItemAssignees.id,
      workItemId: workItemAssignees.workItemId,
      userId: workItemAssignees.userId,
      role: workItemAssignees.role,
      assignedAt: workItemAssignees.assignedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(workItemAssignees)
    .leftJoin(user, eq(workItemAssignees.userId, user.id))
    .where(eq(workItemAssignees.id, result.id));

  // Sync legacy assignee field (fire-and-forget)
  syncLegacyAssigneeField(workItemId);

  return full as WorkItemAssignee;
};

export const unassignUserFromWorkItem = async (
  workItemId: string,
  userId: string
): Promise<boolean> => {
  const result = await db
    .delete(workItemAssignees)
    .where(
      and(
        eq(workItemAssignees.workItemId, workItemId),
        eq(workItemAssignees.userId, userId)
      )
    )
    .returning();

  if (result.length > 0) {
    // Sync legacy assignee field (fire-and-forget)
    syncLegacyAssigneeField(workItemId);
  }

  return result.length > 0;
};

export const updateAssigneeRole = async (
  workItemId: string,
  userId: string,
  role: AssigneeRole
): Promise<WorkItemAssignee | null> => {
  const [result] = await db
    .update(workItemAssignees)
    .set({ role })
    .where(
      and(
        eq(workItemAssignees.workItemId, workItemId),
        eq(workItemAssignees.userId, userId)
      )
    )
    .returning();

  if (!result) return null;

  // Fetch with user data
  const [full] = await db
    .select({
      id: workItemAssignees.id,
      workItemId: workItemAssignees.workItemId,
      userId: workItemAssignees.userId,
      role: workItemAssignees.role,
      assignedAt: workItemAssignees.assignedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(workItemAssignees)
    .leftJoin(user, eq(workItemAssignees.userId, user.id))
    .where(eq(workItemAssignees.id, result.id));

  return full as WorkItemAssignee;
};
