import type { ApiClient } from "./api-client.js";
import { logger } from "@almirant/config";

export interface DependencyCheckResult {
  status: "ready" | "blocked";
  blockedBy: string[]; // work item IDs that are still blocking
}

/**
 * Check if a work item's dependencies are satisfied (all blocking items are done).
 * A work item is considered "done" if it sits in a board column where `columnIsDone` is true.
 *
 * Uses the MC API to fetch dependency info and blocker work item details.
 */
export const checkWorkItemDependencies = async (
  apiClient: ApiClient,
  workItemId: string
): Promise<DependencyCheckResult> => {
  // Fetch dependencies for the work item via the worker API
  let deps: Array<{ blockedByWorkItemId: string }>;
  try {
    const result = await apiClient.getWorkItemDependencies(workItemId);
    deps = result?.dependencies ?? [];
  } catch (err) {
    logger.debug({ workItemId, err }, "Failed to fetch dependencies, treating as ready");
    return { status: "ready", blockedBy: [] };
  }

  if (deps.length === 0) {
    return { status: "ready", blockedBy: [] };
  }

  // Check each blocker: fetch its details and check if its column is marked as done
  const blockedBy: string[] = [];

  for (const dep of deps) {
    const blockerId = dep.blockedByWorkItemId;
    try {
      const blocker = await apiClient.getWorkItemDetails(blockerId);
      // columnIsDone is now part of the WorkItemWithRelations response
      const isDone = (blocker as Record<string, unknown>).columnIsDone === true;
      if (!isDone) {
        blockedBy.push(blockerId);
      }
    } catch {
      // If we can't fetch the blocker, treat it as still blocking (safe default)
      blockedBy.push(blockerId);
    }
  }

  return {
    status: blockedBy.length === 0 ? "ready" : "blocked",
    blockedBy,
  };
};
