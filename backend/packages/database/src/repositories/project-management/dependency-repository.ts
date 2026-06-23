import { db } from "../../client";
import { workItemDependencies, workItems } from "../../schema";
import { eq, and, inArray } from "drizzle-orm";

export interface DependencyWithWorkItem {
  id: string;
  workItemId: string;
  blockedByWorkItemId: string;
  createdAt: Date;
  blockedByWorkItem: {
    id: string;
    taskId: string | null;
    title: string;
    type: string;
    priority: string;
  };
}

export interface DependentWithWorkItem {
  id: string;
  workItemId: string;
  blockedByWorkItemId: string;
  createdAt: Date;
  workItem: {
    id: string;
    taskId: string | null;
    title: string;
    type: string;
    priority: string;
  };
}

// Get all dependencies for a work item (what blocks this item)
export const getDependencies = async (
  workItemId: string
): Promise<DependencyWithWorkItem[]> => {
  const results = await db
    .select({
      id: workItemDependencies.id,
      workItemId: workItemDependencies.workItemId,
      blockedByWorkItemId: workItemDependencies.blockedByWorkItemId,
      createdAt: workItemDependencies.createdAt,
      blockedByWorkItem: {
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
      },
    })
    .from(workItemDependencies)
    .innerJoin(workItems, eq(workItemDependencies.blockedByWorkItemId, workItems.id))
    .where(eq(workItemDependencies.workItemId, workItemId));

  return results;
};

// Get all dependents of a work item (what this item blocks)
export const getDependents = async (
  workItemId: string
): Promise<DependentWithWorkItem[]> => {
  const results = await db
    .select({
      id: workItemDependencies.id,
      workItemId: workItemDependencies.workItemId,
      blockedByWorkItemId: workItemDependencies.blockedByWorkItemId,
      createdAt: workItemDependencies.createdAt,
      workItem: {
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
      },
    })
    .from(workItemDependencies)
    .innerJoin(workItems, eq(workItemDependencies.workItemId, workItems.id))
    .where(eq(workItemDependencies.blockedByWorkItemId, workItemId));

  return results;
};

// Get all dependencies for multiple work items (what blocks these items)
export const getDependenciesBatch = async (
  workItemIds: string[]
): Promise<DependencyWithWorkItem[]> => {
  const uniqueIds = Array.from(new Set(workItemIds)).filter(Boolean);
  if (uniqueIds.length === 0) return [];

  const results = await db
    .select({
      id: workItemDependencies.id,
      workItemId: workItemDependencies.workItemId,
      blockedByWorkItemId: workItemDependencies.blockedByWorkItemId,
      createdAt: workItemDependencies.createdAt,
      blockedByWorkItem: {
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
      },
    })
    .from(workItemDependencies)
    .innerJoin(workItems, eq(workItemDependencies.blockedByWorkItemId, workItems.id))
    .where(inArray(workItemDependencies.workItemId, uniqueIds));

  return results;
};

// Get all dependents for multiple work items (what these items block)
export const getDependentsBatch = async (
  workItemIds: string[]
): Promise<DependentWithWorkItem[]> => {
  const uniqueIds = Array.from(new Set(workItemIds)).filter(Boolean);
  if (uniqueIds.length === 0) return [];

  const results = await db
    .select({
      id: workItemDependencies.id,
      workItemId: workItemDependencies.workItemId,
      blockedByWorkItemId: workItemDependencies.blockedByWorkItemId,
      createdAt: workItemDependencies.createdAt,
      workItem: {
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
      },
    })
    .from(workItemDependencies)
    .innerJoin(workItems, eq(workItemDependencies.workItemId, workItems.id))
    .where(inArray(workItemDependencies.blockedByWorkItemId, uniqueIds));

  return results;
};

// Add a dependency (workItemId is blocked by blockedByWorkItemId)
export const addDependency = async (
  workItemId: string,
  blockedByWorkItemId: string
) => {
  const results = await db
    .insert(workItemDependencies)
    .values({ workItemId, blockedByWorkItemId })
    .returning();

  return results[0];
};

// Remove a dependency
export const removeDependency = async (
  workItemId: string,
  blockedByWorkItemId: string
): Promise<boolean> => {
  const result = await db
    .delete(workItemDependencies)
    .where(
      and(
        eq(workItemDependencies.workItemId, workItemId),
        eq(workItemDependencies.blockedByWorkItemId, blockedByWorkItemId)
      )
    )
    .returning();

  return result.length > 0;
};
