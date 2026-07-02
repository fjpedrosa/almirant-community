import {
  loadDescendantLeafColumnsByParent,
  setWorkItemAiProcessing,
  type IntegrationBatchItem,
  type IntegrationBatchItemStatus,
  type IntegrationBatchStatus,
} from "@almirant/database";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";

const PROCESSING_ITEM_STATUSES = new Set<IntegrationBatchItemStatus>([
  "rebasing",
  "migrating",
  "type_checking",
  "testing",
]);

const BATCH_STATUSES_WITHOUT_CURRENT_ITEM = new Set<IntegrationBatchStatus>([
  "queued",
  "awaiting_release",
  "merging",
  "completed",
  "failed",
  "aborted",
]);

export const isReleaseIntegrationItemProcessingStatus = (
  status: IntegrationBatchItemStatus,
): boolean => PROCESSING_ITEM_STATUSES.has(status);

export const shouldClearReleaseIntegrationBatchItems = (
  status: IntegrationBatchStatus,
): boolean => BATCH_STATUSES_WITHOUT_CURRENT_ITEM.has(status);

const applyAiProcessingFlag = async (
  workspaceId: string,
  workItemId: string,
  isAiProcessing: boolean,
): Promise<boolean> => {
  const updated = await setWorkItemAiProcessing(
    workspaceId,
    workItemId,
    isAiProcessing,
  );

  if (updated) {
    wsConnectionManager.broadcastToWorkspace(workspaceId, {
      type: "work-item:updated",
      payload: {
        workItemId,
        changes: { isAiProcessing },
      },
    });
  }

  return updated;
};

/**
 * Apply the `isAiProcessing` flag to the batch item's owner work item AND to
 * its visible descendant leaves (children with a board column). The batch
 * item identifies the change at the parent (e.g. a feature) level, but the
 * cards the user sees in the board are the leaf descendants. Without
 * propagating, the user never sees the AI animation on the cards that are
 * actually moving through `Validating` while the runner integrates them.
 */
export const setReleaseIntegrationWorkItemAiProcessing = async (args: {
  workspaceId: string;
  workItemId: string;
  isAiProcessing: boolean;
}): Promise<boolean> => {
  const ownerUpdated = await applyAiProcessingFlag(
    args.workspaceId,
    args.workItemId,
    args.isAiProcessing,
  );

  const descendantsByParent = await loadDescendantLeafColumnsByParent([
    args.workItemId,
  ]);
  const leaves = descendantsByParent.get(args.workItemId) ?? [];
  if (leaves.length === 0) return ownerUpdated;

  const leafIds = [...new Set(leaves.map((leaf) => leaf.id))];
  const leafResults = await Promise.all(
    leafIds.map((leafId) =>
      applyAiProcessingFlag(args.workspaceId, leafId, args.isAiProcessing),
    ),
  );

  return ownerUpdated || leafResults.some((updated) => updated);
};

export const syncReleaseIntegrationItemAiProcessing = async (args: {
  workspaceId: string;
  workItemId: string;
  status: IntegrationBatchItemStatus;
}): Promise<boolean> =>
  setReleaseIntegrationWorkItemAiProcessing({
    workspaceId: args.workspaceId,
    workItemId: args.workItemId,
    isAiProcessing: isReleaseIntegrationItemProcessingStatus(args.status),
  });

export const clearReleaseIntegrationBatchItemsAiProcessing = async (args: {
  workspaceId: string;
  items: Array<Pick<IntegrationBatchItem, "workItemId">>;
}): Promise<boolean[]> => {
  const workItemIds = [...new Set(args.items.map((item) => item.workItemId))];

  return Promise.all(
    workItemIds.map((workItemId) =>
      setReleaseIntegrationWorkItemAiProcessing({
        workspaceId: args.workspaceId,
        workItemId,
        isAiProcessing: false,
      }),
    ),
  );
};
