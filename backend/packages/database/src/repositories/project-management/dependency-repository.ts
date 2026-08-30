import { db, type Database } from "../../client";
import { boards, deliveryPlanItems, workItemDependencies, workItems } from "../../schema";
import { eq, and, inArray } from "drizzle-orm";
import { loadDeliveryAuthorities } from "../planning/delivery-compatibility-repository";
import { NativePlanAuthorityError } from "./work-item-repository";

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

export type DependencyMutationExecutor = Pick<Database, "select" | "execute" | "insert" | "delete">;
type DependencyMutationContext = { workspaceId: string; executor?: DependencyMutationExecutor };
type DependencyMutationArgument = DependencyMutationContext | DependencyMutationExecutor;
type DependencyEndpoint = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  boardId: string;
  nativeItemId: string | null;
};
export type DependencyEndpointNotFoundError = Error & { code: "dependency_endpoint_not_found"; endpoint: "source" | "target" };
export const isDependencyEndpointNotFoundError = (error: unknown): error is DependencyEndpointNotFoundError =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "dependency_endpoint_not_found" &&
  ["source", "target"].includes((error as { endpoint?: string }).endpoint ?? "");
const endpointNotFound = (endpoint: "source" | "target") => Object.assign(new Error(
  `${endpoint === "source" ? "Work item" : "Blocking work item"} not found or does not belong to your workspace`), { code: "dependency_endpoint_not_found" as const, endpoint });

const resolveMutationContext = (argument: DependencyMutationArgument = db) =>
  "workspaceId" in argument
    ? { workspaceId: argument.workspaceId, executor: argument.executor ?? db }
    : { workspaceId: undefined, executor: argument };

const assertDependencyMutationAllowed = async (
  workItemIds: readonly [string, string],
  argument?: DependencyMutationArgument,
): Promise<DependencyMutationExecutor> => {
  const { workspaceId, executor } = resolveMutationContext(argument);
  const ids = [...new Set(workItemIds)];
  const endpoints = await executor.select({
    id: workItems.id,
    workspaceId: boards.workspaceId,
    projectId: workItems.projectId,
    boardId: workItems.boardId,
    nativeItemId: deliveryPlanItems.id,
  }).from(workItems)
    .innerJoin(boards, eq(boards.id, workItems.boardId))
    .leftJoin(deliveryPlanItems, eq(deliveryPlanItems.workItemId, workItems.id))
    .where(inArray(workItems.id, ids)) as DependencyEndpoint[];
  const first = endpoints.find(({ id }) => id === workItemIds[0]);
  const second = endpoints.find(({ id }) => id === workItemIds[1]);
  if (!first || !second || endpoints.length < ids.length) throw endpointNotFound(!first ? "source" : "target");
  const sameScope = endpoints.length === ids.length && first.workspaceId === second.workspaceId &&
    first.projectId === second.projectId && first.boardId === second.boardId &&
    (!workspaceId || first.workspaceId === workspaceId);
  if (!sameScope) throw new NativePlanAuthorityError();
  if (first.projectId === null) {
    if (first.nativeItemId || second.nativeItemId) throw new NativePlanAuthorityError();
    return executor;
  }
  const authorities = await loadDeliveryAuthorities(ids, {
    workspaceId: first.workspaceId,
    projectId: first.projectId,
    boardId: first.boardId,
  }, executor);
  if (ids.some((id) => authorities[id]?.kind !== "legacy")) throw new NativePlanAuthorityError();
  return executor;
};

// Add a dependency (workItemId is blocked by blockedByWorkItemId).
export const addDependency = async (
  workItemId: string,
  blockedByWorkItemId: string,
  argument?: DependencyMutationArgument,
) => {
  const executor = await assertDependencyMutationAllowed([workItemId, blockedByWorkItemId], argument);
  const results = await executor.insert(workItemDependencies)
    .values({ workItemId, blockedByWorkItemId }).returning();
  return results[0];
};

export const removeDependency = async (
  workItemId: string,
  blockedByWorkItemId: string,
  argument?: DependencyMutationArgument,
): Promise<boolean> => {
  const executor = await assertDependencyMutationAllowed([workItemId, blockedByWorkItemId], argument);
  const result = await executor.delete(workItemDependencies).where(and(
    eq(workItemDependencies.workItemId, workItemId),
    eq(workItemDependencies.blockedByWorkItemId, blockedByWorkItemId),
  )).returning();
  return result.length > 0;
};
