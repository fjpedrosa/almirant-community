import {
  upsertCommit,
  upsertPullRequest,
  upsertWorkflowRun,
  createGithubEvent,
  upsertInstallation,
  deleteInstallationByGithubId,
  getInstallationByGithubId,
  getRepoIdByGithubFullName,
  getWorkspaceIdByRepoId,
  getProjectIdByRepoId,
  updatePullRequestReviewStatus,
  updatePullRequestCiStatus,
  getWorkItemsByTaskIds,
  updateWorkItem,
  moveWorkItem,
  linkCommitToWorkItem,
  getMembersByWorkspaceId,
  getWorkspaceMemberUserIdByGithubLogin,
  getBoardColumns,
  getBugFixAttemptsByFixPrUrl,
  getLatestBugFixAttemptByFeedbackItemId,
  updateBugFixAttempt,
  updateFeedbackItem,
  getFeedbackItemById,
  getFeedbackClusterById,
  transitionCluster,
  getBatchByFinalPrNumber,
  updateBatchStatus,
  updateReleasePullRequestStateForBatch,
  hasIncompleteChecklist,
  db,
  workItems as workItemsTable,
} from "@almirant/database";
import { and, inArray, isNull } from "drizzle-orm";
import { getActivityLogger } from "@almirant/shared";
import { logger } from "@almirant/config";
import { handleDocSync } from "./github-docs-sync-handler";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";
import { upsertNotificationBySource } from "../../../../shared/services/notification-service";
import {
  broadcastFeedbackItemUpdated,
  resolveFeedbackWorkspaceId,
} from "../../../../shared/ws/feedback-events";


// ---- Helper functions ----

const extractBranch = (ref: string): string => {
  return ref.replace("refs/heads/", "");
};

const resolvePrState = (pr: {
  merged: boolean;
  state: string;
}): "open" | "closed" | "merged" => {
  if (pr.merged) return "merged";
  return pr.state === "closed" ? "closed" : "open";
};

const mapReviewState = (
  state: string
): "approved" | "changes_requested" | "commented" | "dismissed" => {
  const mapping: Record<
    string,
    "approved" | "changes_requested" | "commented" | "dismissed"
  > = {
    approved: "approved",
    changes_requested: "changes_requested",
    commented: "commented",
    dismissed: "dismissed",
  };
  return mapping[state] || "commented";
};

type AttemptWorkflowGuards = {
  errorSave?: {
    performedAt?: string;
  };
};

type ReleaseDoneMoveItem = {
  id: string;
  taskId: string | null;
  boardId: string | null;
  boardColumnId: string | null;
  metadata?: Record<string, unknown> | null;
  type?: string | null;
};

type ReleaseDoneMoveFailure = {
  taskId: string | null;
  workItemId: string;
  reason: string;
};

const isParentWorkItemType = (type: string | null | undefined): boolean =>
  type === "epic" || type === "feature" || type === "story";

const hasAttemptErrorSave = (
  metadata: Record<string, unknown> | null | undefined
): boolean => {
  const workflowGuards = (metadata?.workflowGuards ?? undefined) as
    | AttemptWorkflowGuards
    | undefined;
  return Boolean(workflowGuards?.errorSave?.performedAt);
};

const loadLeafDescendantsForReleaseDoneMove = async (
  parentIds: string[],
): Promise<ReleaseDoneMoveItem[]> => {
  const leaves: ReleaseDoneMoveItem[] = [];
  let currentToSource = new Map<string, string>(
    parentIds.map((parentId) => [parentId, parentId]),
  );

  for (let level = 0; level < 4 && currentToSource.size > 0; level++) {
    const currentIds = [...currentToSource.keys()];
    const children = await db
      .select({
        sourceWorkItemId: workItemsTable.parentId,
        id: workItemsTable.id,
        taskId: workItemsTable.taskId,
        boardId: workItemsTable.boardId,
        boardColumnId: workItemsTable.boardColumnId,
        metadata: workItemsTable.metadata,
        type: workItemsTable.type,
      })
      .from(workItemsTable)
      .where(
        and(
          inArray(workItemsTable.parentId, currentIds),
          isNull(workItemsTable.archivedAt),
        ),
      );

    const nextLevel = new Map<string, string>();
    for (const child of children) {
      if (!child.sourceWorkItemId) continue;
      const sourceParentId = currentToSource.get(child.sourceWorkItemId);
      if (!sourceParentId) continue;

      if (child.boardColumnId) {
        leaves.push({
          id: child.id,
          taskId: child.taskId,
          boardId: child.boardId,
          boardColumnId: child.boardColumnId,
          metadata: child.metadata,
          type: child.type,
        });
      } else {
        nextLevel.set(child.id, sourceParentId);
      }
    }

    currentToSource = nextLevel;
  }

  return leaves;
};

const buildReleaseDoneReconciliationMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  batchId: string,
  pr: { number: number; html_url: string },
): Record<string, unknown> | null => {
  const currentMetadata = metadata ?? {};
  const checklistResult = hasIncompleteChecklist(currentMetadata);
  if (!checklistResult.hasIncomplete) return null;

  const now = new Date().toISOString();
  const previousReconciliation =
    typeof currentMetadata.releaseDoneReconciliation === "object" &&
    currentMetadata.releaseDoneReconciliation !== null &&
    !Array.isArray(currentMetadata.releaseDoneReconciliation)
      ? (currentMetadata.releaseDoneReconciliation as Record<string, unknown>)
      : {};
  const marker = `Release Done reconciliation (${now}): Release PR #${pr.number} was merged. Original deploy checklist/user actions are preserved in metadata.releaseDoneReconciliation.`;
  const existingDocumentationNotes =
    typeof currentMetadata.documentationNotes === "string"
      ? currentMetadata.documentationNotes.trim()
      : "";

  return {
    ...currentMetadata,
    releaseDoneReconciliation: {
      ...previousReconciliation,
      batchId,
      releasePrNumber: pr.number,
      finalPrUrl: pr.html_url,
      reconciledAt: now,
      reason:
        "Release PR merged to base branch; preserving operational notes while allowing the shipped work item to move to Done.",
      originalDeployChecklist: currentMetadata.deployChecklist ?? null,
      originalUserActions: currentMetadata.userActions ?? null,
      originalDocumentationNotes: currentMetadata.documentationNotes ?? null,
    },
    deployChecklist: `- [x] Release PR #${pr.number} merged; original deploy checklist preserved in metadata.releaseDoneReconciliation.`,
    userActions: `No deploy actions pending after Release PR #${pr.number} merge. Original operational notes preserved in metadata.releaseDoneReconciliation.`,
    documentationNotes: existingDocumentationNotes
      ? `${existingDocumentationNotes}\n\n${marker}`
      : marker,
  };
};

/**
 * Extract task IDs from a string.
 *
 * Supported formats (generated by `getNextTaskId`):
 *   - Tasks:    PREFIX-NUMBER        e.g. "MC-123", "A-1014"
 *   - Epics:    PREFIX-E-NUMBER      e.g. "A-E-44", "MC-E-3"
 *   - Features: PREFIX-F-NUMBER      e.g. "A-F-244"
 *   - Stories:  PREFIX-S-NUMBER      e.g. "MC-S-1"
 *   - Ideas:    PREFIX-I-NUMBER      e.g. "A-I-5"
 *
 * PREFIX = 1-10 uppercase letters.
 */
export const extractTaskIds = (text: string): string[] => {
  if (!text) return [];
  const matches = text.match(/\b[A-Z]{1,10}-(?:[EFSI]-)?\d+\b/g);
  return matches ? Array.from(new Set(matches)) : [];
};

/**
 * Auto-link a PR to work items by extracting task IDs from the PR title and branch name.
 * Updates the work item metadata with pullRequest reference (fire-and-forget).
 */
export const autoLinkPrToWorkItems = async (
  workspaceId: string,
  pr: {
    title: string;
    head: { ref: string } | null;
    html_url: string;
    number: number;
    merged: boolean;
    state: string;
    draft?: boolean;
  }
): Promise<void> => {
  const sources = [pr.title, pr.head?.ref ?? ""].join(" ");
  const taskIds = extractTaskIds(sources);
  if (taskIds.length === 0) return;

  const workItems = await getWorkItemsByTaskIds(workspaceId, taskIds);
  if (workItems.length === 0) return;

  const state = resolvePrState(pr);
  const pullRequestRef = {
    url: pr.html_url,
    number: pr.number,
    state,
    isDraft: pr.draft ?? false,
    branch: pr.head?.ref ?? "",
  };

  const results = await Promise.allSettled(
    workItems.map((wi) => {
      const existingMetadata = (wi.metadata ?? {}) as Record<string, unknown>;
      const merged = { ...existingMetadata, pullRequest: pullRequestRef };
      return updateWorkItem(workspaceId, wi.id, { metadata: merged });
    })
  );

  for (let i = 0; i < workItems.length; i++) {
    const result = results[i];
    const wi = workItems[i];
    if (result && wi && result.status === "fulfilled") {
      wsConnectionManager.broadcastToWorkspace(workspaceId, {
        type: "work-item:updated",
        payload: {
          workItemId: wi.id,
          changes: { metadata: { pullRequest: pullRequestRef } },
        },
      });
    }
  }

  logger.info(
    `[github-webhook] Auto-linked PR #${pr.number} to ${workItems.length} work item(s): ${taskIds.join(", ")}`
  );
};

/**
 * Move linked work items to the "To Review" column when a PR is merged.
 * Only moves items whose current column order is less than the review column order.
 * Updates metadata.pullRequest.state to "merged", creates work_item_event, and broadcasts WS update.
 */
/**
 * Lifecycle handler for release PRs (created by the integration runner).
 * Idempotent: safe to run multiple times for the same merged release PR.
 *
 * Effects:
 *   1. Reconciles merged batch items into `done`, even on webhook redelivery.
 *   2. Moves every successfully-merged work item in the batch to the board's
 *      `done` column (skipping items already there or boards without one).
 *   3. Updates `metadata.releasePullRequest.state` to `"merged"` on each item.
 *   4. Marks the integration batch as `completed` after reconciliation.
 */
export const handleReleasePrMerged = async (
  workspaceId: string,
  batch: Awaited<ReturnType<typeof getBatchByFinalPrNumber>>,
  pr: { number: number; html_url: string },
): Promise<void> => {
  if (!batch) return;

  const shouldMarkBatchCompleted = batch.status !== "completed";
  const markBatchCompletedIfNeeded = async () => {
    if (!shouldMarkBatchCompleted) return;
    await updateBatchStatus(batch.id, "completed", {
      completedAt: new Date(),
    });
  };

  if (!shouldMarkBatchCompleted) {
    // Idempotency: completed batches are still reconciled because a previous
    // webhook delivery may have marked the batch completed before all board
    // moves finished. `moveWorkItem` is skipped for items already in Done.
    logger.info(
      `[github-webhook] Release PR #${pr.number} already marked completed (batch ${batch.id}); reconciling Done state`,
    );
  }

  // Update metadata.releasePullRequest.state on every linked item so the cards
  // flip from blue (open) to purple (merged).
  await updateReleasePullRequestStateForBatch(batch.id, "merged").catch((e) =>
    logger.error(
      `[github-webhook] Failed to update releasePullRequest state for batch ${batch.id}: ${e instanceof Error ? e.message : String(e)}`,
    ),
  );

  const mergedItems = batch.items.filter((it) => it.status === "merged");
  if (mergedItems.length === 0) {
    await markBatchCompletedIfNeeded();
    return;
  }

  const workItemIds = mergedItems.map((it) => it.workItemId);
  const items = await db
    .select({
      id: workItemsTable.id,
      taskId: workItemsTable.taskId,
      boardId: workItemsTable.boardId,
      boardColumnId: workItemsTable.boardColumnId,
      metadata: workItemsTable.metadata,
      type: workItemsTable.type,
    })
    .from(workItemsTable)
    .where(inArray(workItemsTable.id, workItemIds));

  const parentItems = items.filter((wi) => isParentWorkItemType(wi.type));
  const descendantLeafItems =
    parentItems.length > 0
      ? await loadLeafDescendantsForReleaseDoneMove(parentItems.map((wi) => wi.id))
      : [];
  const itemsToMoveById = new Map<string, ReleaseDoneMoveItem>();
  for (const wi of items) {
    if (!isParentWorkItemType(wi.type)) {
      itemsToMoveById.set(wi.id, wi);
    }
  }
  for (const leaf of descendantLeafItems) {
    itemsToMoveById.set(leaf.id, leaf);
  }
  const itemsToMove = [...itemsToMoveById.values()];

  // Cache columns per board.
  const boardColumnsCache = new Map<
    string,
    Awaited<ReturnType<typeof getBoardColumns>>
  >();
  const getColumns = async (boardId: string) => {
    if (boardColumnsCache.has(boardId)) return boardColumnsCache.get(boardId)!;
    const cols = await getBoardColumns(boardId, workspaceId);
    boardColumnsCache.set(boardId, cols);
    return cols;
  };

  const failures: ReleaseDoneMoveFailure[] = [];
  let movedCount = 0;
  let alreadyDoneCount = 0;

  for (const wi of itemsToMove) {
    try {
      if (!wi.boardId) {
        failures.push({
          workItemId: wi.id,
          taskId: wi.taskId,
          reason: "Work item has no boardId",
        });
        continue;
      }
      const columns = (await getColumns(wi.boardId)) ?? [];
      const doneColumn = columns.find((c) => c.role === "done");
      if (!doneColumn) {
        failures.push({
          workItemId: wi.id,
          taskId: wi.taskId,
          reason: `No "done" column on board ${wi.boardId}`,
        });
        continue;
      }
      if (wi.boardColumnId === doneColumn.id) {
        alreadyDoneCount += 1;
        continue;
      }

      const reconciledMetadata = buildReleaseDoneReconciliationMetadata(
        wi.metadata,
        batch.id,
        pr,
      );
      if (reconciledMetadata) {
        await updateWorkItem(workspaceId, wi.id, {
          metadata: reconciledMetadata,
        });
      }

      await moveWorkItem(
        wi.id,
        doneColumn.id,
        0,
        { triggeredBy: "websocket", triggeredByUserId: undefined },
        workspaceId,
      );
      movedCount += 1;
    } catch (e) {
      failures.push({
        workItemId: wi.id,
        taskId: wi.taskId,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (failures.length > 0) {
    const failureSummary = failures
      .map((f) => `${f.taskId ?? f.workItemId}: ${f.reason}`)
      .join("; ");
    logger.error(
      `[github-webhook] Release PR #${pr.number} merged but ${failures.length}/${itemsToMove.length} work items could not be moved to Done (batch ${batch.id}): ${failureSummary}`,
    );
    if (shouldMarkBatchCompleted) {
      await updateBatchStatus(batch.id, "failed", {
        errorMessage: `Release PR #${pr.number} merged, but Done reconciliation failed for ${failures.length}/${itemsToMove.length} work items: ${failureSummary}`,
      });
    }
    return;
  }

  logger.info(
    `[github-webhook] Release PR #${pr.number} merged → moved ${movedCount} work items to Done, ${alreadyDoneCount} already Done (batch ${batch.id})`,
  );

  await markBatchCompletedIfNeeded();
};

export const moveWorkItemsOnPrMerge = async (
  workspaceId: string,
  pr: {
    title: string;
    head: { ref: string } | null;
    html_url: string;
    number: number;
    draft?: boolean;
  }
): Promise<void> => {
  const sources = [pr.title, pr.head?.ref ?? ""].join(" ");
  const taskIds = extractTaskIds(sources);
  if (taskIds.length === 0) return;

  const workItems = await getWorkItemsByTaskIds(workspaceId, taskIds);
  if (workItems.length === 0) return;

  // Cache board columns per board to avoid redundant queries
  const boardColumnsCache = new Map<
    string,
    Awaited<ReturnType<typeof getBoardColumns>>
  >();

  const getColumns = async (boardId: string) => {
    if (boardColumnsCache.has(boardId)) return boardColumnsCache.get(boardId)!;
    const columns = await getBoardColumns(boardId, workspaceId);
    boardColumnsCache.set(boardId, columns);
    return columns;
  };

  const pullRequestRef = {
    url: pr.html_url,
    number: pr.number,
    state: "merged" as const,
    isDraft: pr.draft ?? false,
    branch: pr.head?.ref ?? "",
  };

  const results = await Promise.allSettled(
    workItems.map(async (wi) => {
      if (!wi.boardId) return null;

      const columns = (await getColumns(wi.boardId)) ?? [];
      const reviewColumn = columns.find((col) => col.role === "review");
      if (!reviewColumn) {
        logger.warn(
          `[github-webhook] No "review" column found on board ${wi.boardId}, skipping move for ${wi.taskId}`
        );
        return null;
      }

      // Find current column order
      const currentColumn = columns.find(
        (col) => col.id === wi.boardColumnId
      );
      const currentOrder = currentColumn?.order ?? -1;

      // Don't move if already at or past the review column
      if (currentOrder >= reviewColumn.order) {
        logger.info(
          `[github-webhook] Work item ${wi.taskId} already at or past review column (order ${currentOrder} >= ${reviewColumn.order}), skipping move`
        );
        return null;
      }

      const existingMetadata = (wi.metadata ?? {}) as Record<string, unknown>;
      const mergedMetadata = {
        ...existingMetadata,
        pullRequest: pullRequestRef,
      };

      const oldColumnName = currentColumn?.name ?? "unknown";

      // 1. Move column via moveWorkItem (enforces parent-type guard)
      await moveWorkItem(
        wi.id,
        reviewColumn.id,
        0,
        { triggeredBy: "websocket", triggeredByUserId: undefined },
        workspaceId
      );

      // 2. Update metadata separately (pullRequest.state = "merged")
      await updateWorkItem(workspaceId, wi.id, {
        metadata: mergedMetadata,
      });

      getActivityLogger().log({
        actorUserId: null as unknown as string,
        workspaceId,
        action: "moved",
        resourceType: "work_item",
        resourceId: wi.id,
        metadata: {
          triggeredBy: "websocket",
          fieldName: "boardColumnId",
          oldValue: oldColumnName,
          newValue: reviewColumn.name,
          reason: "pr_merged",
          prNumber: pr.number,
          prUrl: pr.html_url,
        },
      });

      wsConnectionManager.broadcastToWorkspace(workspaceId, {
        type: "work-item:updated",
        payload: {
          workItemId: wi.id,
          changes: {
            boardColumnId: reviewColumn.id,
            metadata: mergedMetadata,
          },
        },
      });

      return wi.taskId;
    })
  );

  const movedItems = results
    .filter(
      (r): r is PromiseFulfilledResult<string | null> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);

  if (movedItems.length > 0) {
    logger.info(
      `[github-webhook] PR #${pr.number} merged: moved ${movedItems.length} work item(s) to review: ${movedItems.join(", ")}`
    );
  }

  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) {
    logger.error(
      `[github-webhook] Failed to move work item on PR merge: ${(f as PromiseRejectedResult).reason}`
    );
  }
};

/**
 * When a bug-fix PR is merged, mark the related attempt as merged and move the
 * linked feedback item to pending_validation. This relation is structured via
 * bug_fix_attempts.fix_pr_url, so it does not depend on task IDs being present
 * in the PR title or branch name.
 */
export const moveFeedbackBugsToPendingValidationOnPrMerge = async (pr: {
  html_url?: string | null;
  number: number;
}): Promise<void> => {
  const prUrl = pr.html_url?.trim();
  if (!prUrl) return;

  const attempts = await getBugFixAttemptsByFixPrUrl(prUrl);
  if (attempts.length === 0) return;

  // Track attempts whose cluster should move to `resolved`. We collect them
  // here and fire the transitions after the feedback-item updates so the
  // cluster-status history row records the attempt that "caused" the
  // resolution (triggeredByAttemptId is what wires up resolved_by_attempt_id
  // on the cluster — see transitionCluster + A-1835).
  const attemptsToResolveCluster: Array<{ attemptId: string; clusterId: string }> = [];

  const results = await Promise.allSettled(
    attempts.map(async (attempt) => {
      const mergedAttempt =
        attempt.status === "merged"
          ? attempt
          : await updateBugFixAttempt(attempt.id, { status: "merged" });

      if (!mergedAttempt) {
        logger.warn(
          `[github-webhook] Could not mark bug-fix attempt ${attempt.id} as merged for PR #${pr.number}`
        );
        return null;
      }

      // Queue cluster auto-transition to `resolved`. The helper is
      // idempotent and validates the source status, so duplicate webhook
      // deliveries are safe.
      if (attempt.clusterId) {
        attemptsToResolveCluster.push({
          attemptId: attempt.id,
          clusterId: attempt.clusterId,
        });
      }

      const feedbackItemId = attempt.feedbackItemId;
      if (!feedbackItemId) return null;

      const latestAttempt = await getLatestBugFixAttemptByFeedbackItemId(
        feedbackItemId
      );

      if (!latestAttempt || latestAttempt.id !== attempt.id) {
        logger.info(
          `[github-webhook] PR #${pr.number} merged for stale bug-fix attempt ${attempt.id}; feedback ${feedbackItemId} stays unchanged`
        );
        return null;
      }

      if (
        !hasAttemptErrorSave(
          (latestAttempt.metadata ?? null) as Record<string, unknown> | null
        )
      ) {
        logger.warn(
          `[github-webhook] PR #${pr.number} merged for bug-fix attempt ${attempt.id} without error_save; skipping feedback transition`
        );
        return null;
      }

      const feedbackItem = await getFeedbackItemById(feedbackItemId);
      if (!feedbackItem) {
        logger.warn(
          `[github-webhook] Could not load feedback ${feedbackItemId} for merged PR #${pr.number}`
        );
        return null;
      }

      if (
        feedbackItem.status !== "implementing" &&
        feedbackItem.status !== "in_progress"
      ) {
        logger.info(
          `[github-webhook] PR #${pr.number} merged for feedback ${feedbackItemId} already in status ${feedbackItem.status}; skipping pending_validation transition`
        );
        return null;
      }

      const updatedFeedback = await updateFeedbackItem(feedbackItemId, {
        status: "pending_validation",
      });

      if (!updatedFeedback) {
        logger.warn(
          `[github-webhook] Could not move feedback ${feedbackItemId} to pending_validation after PR #${pr.number} merge`
        );
        return null;
      }

      broadcastFeedbackItemUpdated({
        item: updatedFeedback,
        workspaceId: resolveFeedbackWorkspaceId(
          updatedFeedback,
          resolveFeedbackWorkspaceId(feedbackItem)
        ),
        changes: { status: "pending_validation" },
      });

      return updatedFeedback.id;
    })
  );

  const transitionedFeedbackIds = results
    .filter(
      (result): result is PromiseFulfilledResult<string | null> =>
        result.status === "fulfilled" && result.value !== null
    )
    .map((result) => result.value);

  if (transitionedFeedbackIds.length > 0) {
    logger.info(
      `[github-webhook] PR #${pr.number} merged: moved ${transitionedFeedbackIds.length} feedback bug(s) to pending_validation: ${transitionedFeedbackIds.join(", ")}`
    );
  }

  const failed = results.filter((result) => result.status === "rejected");
  for (const failure of failed) {
    logger.error(
      `[github-webhook] Failed to transition feedback bug on PR merge: ${(failure as PromiseRejectedResult).reason}`
    );
  }

  // Hook 2: PR merged → cluster fix_ready → resolved. Runs after the feedback
  // item transitions so we only touch the cluster once per attempt, and uses
  // `triggeredByAttemptId` so `resolved_by_attempt_id` is set on the cluster.
  const clusterResults = await Promise.allSettled(
    attemptsToResolveCluster.map(async ({ attemptId, clusterId }) => {
      const cluster = await getFeedbackClusterById(clusterId);
      if (!cluster) {
        logger.warn(
          `[github-webhook] Could not load cluster ${clusterId} for merged PR #${pr.number}`
        );
        return null;
      }

      // Only auto-resolve from fix_ready. Skipping investigating/open prevents
      // a redeployed "closed (merged=false)" → "merged" race from overwriting
      // human intent.
      if (cluster.status !== "fix_ready") {
        logger.info(
          `[github-webhook] PR #${pr.number} merged for cluster ${clusterId} already in status ${cluster.status}; skipping resolved transition`
        );
        return null;
      }

      const result = await transitionCluster(clusterId, "resolved", {
        triggeredByKind: "webhook",
        reason: "pr_merged",
        triggeredByAttemptId: attemptId,
        metadata: {
          prNumber: pr.number,
          prUrl,
        },
      });

      if (!result.success) {
        logger.warn(
          `[github-webhook] Cluster ${clusterId} transition to resolved rejected on PR #${pr.number} merge: ${result.reason}`
        );
        return null;
      }

      logger.info(
        `[github-webhook] Cluster ${clusterId} transitioned ${result.from} → ${result.to} after PR #${pr.number} merge (attempt ${attemptId})`
      );
      return clusterId;
    })
  );

  const resolvedClusterFailures = clusterResults.filter(
    (result) => result.status === "rejected"
  );
  for (const failure of resolvedClusterFailures) {
    logger.error(
      `[github-webhook] Failed to resolve cluster on PR merge: ${(failure as PromiseRejectedResult).reason}`
    );
  }
};

/**
 * When a bug-fix PR is closed without a merge, mark the related attempt as
 * failed and (if the cluster was awaiting the fix) move the cluster back to
 * `open` so triage can retry. Mirrors moveFeedbackBugsToPendingValidationOnPrMerge
 * but for the PR-rejected / PR-abandoned path.
 */
export const markFeedbackBugsAsFailedOnPrClosed = async (pr: {
  html_url?: string | null;
  number: number;
}): Promise<void> => {
  const prUrl = pr.html_url?.trim();
  if (!prUrl) return;

  const attempts = await getBugFixAttemptsByFixPrUrl(prUrl);
  if (attempts.length === 0) return;

  const results = await Promise.allSettled(
    attempts.map(async (attempt) => {
      // Idempotent: skip attempts that are already terminal.
      if (attempt.status === "merged" || attempt.status === "failed") {
        logger.info(
          `[github-webhook] PR #${pr.number} closed without merge for attempt ${attempt.id}; already ${attempt.status}, skipping`
        );
        return null;
      }

      const failedAttempt = await updateBugFixAttempt(attempt.id, {
        status: "failed",
        failureReason: `PR #${pr.number} closed without merge`,
        failureDetectedBy: "webhook",
      });

      if (!failedAttempt) {
        logger.warn(
          `[github-webhook] Could not mark bug-fix attempt ${attempt.id} as failed for closed PR #${pr.number}`
        );
        return null;
      }

      // Hook 3: cluster fix_ready → open so triage/agent can retry.
      if (attempt.clusterId) {
        const cluster = await getFeedbackClusterById(attempt.clusterId);
        if (!cluster) {
          logger.warn(
            `[github-webhook] Could not load cluster ${attempt.clusterId} for closed PR #${pr.number}`
          );
        } else if (cluster.status !== "fix_ready") {
          logger.info(
            `[github-webhook] PR #${pr.number} closed without merge for cluster ${attempt.clusterId} already in status ${cluster.status}; skipping reopen`
          );
        } else {
          const result = await transitionCluster(attempt.clusterId, "open", {
            triggeredByKind: "webhook",
            reason: "pr_closed_without_merge",
            triggeredByAttemptId: attempt.id,
            metadata: {
              prNumber: pr.number,
              prUrl,
            },
          });
          if (!result.success) {
            logger.warn(
              `[github-webhook] Cluster ${attempt.clusterId} reopen rejected on PR #${pr.number} close: ${result.reason}`
            );
          } else {
            logger.info(
              `[github-webhook] Cluster ${attempt.clusterId} transitioned ${result.from} → ${result.to} after PR #${pr.number} closed without merge (attempt ${attempt.id})`
            );
          }
        }
      }

      return attempt.id;
    })
  );

  const failedAttemptIds = results
    .filter(
      (result): result is PromiseFulfilledResult<string | null> =>
        result.status === "fulfilled" && result.value !== null
    )
    .map((result) => result.value);

  if (failedAttemptIds.length > 0) {
    logger.info(
      `[github-webhook] PR #${pr.number} closed without merge: marked ${failedAttemptIds.length} bug-fix attempt(s) as failed: ${failedAttemptIds.join(", ")}`
    );
  }

  const rejected = results.filter((result) => result.status === "rejected");
  for (const failure of rejected) {
    logger.error(
      `[github-webhook] Failed to transition feedback bug on PR close: ${(failure as PromiseRejectedResult).reason}`
    );
  }
};

/**
 * Auto-link commits to work items by extracting task IDs from commit messages
 * and the branch name. Creates entries in the work_item_commits junction table.
 * Idempotent: linkCommitToWorkItem uses onConflictDoNothing.
 */
export const autoLinkCommitsToWorkItems = async (
  repoId: string,
  branch: string,
  upsertedCommits: Array<{ commitId: string; message: string }>
): Promise<void> => {
  if (upsertedCommits.length === 0) return;

  const workspaceId = await getWorkspaceIdByRepoId(repoId);
  if (!workspaceId) {
    logger.warn(`[github-webhook] No workspaceId found for repo ${repoId}, skipping commit auto-link`);
    return;
  }

  // Build a map of taskId -> set of commitIds that reference it
  const taskIdToCommitIds = new Map<string, Set<string>>();
  const branchTaskIds = extractTaskIds(branch);

  for (const { commitId, message } of upsertedCommits) {
    const messageTaskIds = extractTaskIds(message);
    // Merge task IDs from commit message and branch name
    const allTaskIds = new Set([...messageTaskIds, ...branchTaskIds]);

    for (const taskId of allTaskIds) {
      if (!taskIdToCommitIds.has(taskId)) {
        taskIdToCommitIds.set(taskId, new Set());
      }
      taskIdToCommitIds.get(taskId)!.add(commitId);
    }
  }

  const allTaskIds = Array.from(taskIdToCommitIds.keys());
  if (allTaskIds.length === 0) return;

  const workItems = await getWorkItemsByTaskIds(workspaceId, allTaskIds);
  if (workItems.length === 0) return;

  // Build a lookup from taskId -> workItemId
  const taskIdToWorkItemId = new Map<string, string>();
  for (const wi of workItems) {
    if (wi.taskId) {
      taskIdToWorkItemId.set(wi.taskId, wi.id);
    }
  }

  // Create all links in parallel (idempotent via onConflictDoNothing)
  const linkPromises: Promise<unknown>[] = [];
  for (const [taskId, commitIds] of taskIdToCommitIds) {
    const workItemId = taskIdToWorkItemId.get(taskId);
    if (!workItemId) continue;

    for (const commitId of commitIds) {
      linkPromises.push(linkCommitToWorkItem(workItemId, commitId, true));
    }
  }

  await Promise.allSettled(linkPromises);

  const linkedCount = linkPromises.length;
  logger.info(
    `[github-webhook] Auto-linked ${linkedCount} commit-workitem pair(s) for task IDs: ${allTaskIds.join(", ")}`
  );
};

const mapCheckConclusion = (conclusion: string | null): string => {
  if (!conclusion) return "pending";

  const mapping: Record<string, string> = {
    success: "success",
    failure: "failure",
    cancelled: "cancelled",
    skipped: "skipped",
    neutral: "neutral",
    timed_out: "failure",
    action_required: "pending",
    stale: "cancelled",
  };
  return mapping[conclusion] || "pending";
};

const buildPrNotificationSourceType = (prNumber: number): string =>
  `github_pr:${prNumber}`;

const buildWorkflowRunSourceType = (runId: number): string =>
  `github_wfr:${runId}`;

const buildCheckSuiteSourceType = (checkSuiteId: number): string =>
  `github_crs:${checkSuiteId}`;

const buildCheckRunSourceType = (checkRunId: number): string =>
  `github_cr:${checkRunId}`;

const buildPullRequestReviewSourceType = (prNumber: number): string =>
  `github_prr:${prNumber}`;

const getGithubNotificationContext = async (repoId: string): Promise<{
  workspaceId: string;
  projectId: string;
  recipientUserIds: string[];
} | null> => {
  const [workspaceId, projectId] = await Promise.all([
    getWorkspaceIdByRepoId(repoId),
    getProjectIdByRepoId(repoId),
  ]);

  if (!workspaceId || !projectId) return null;

  const members = await getMembersByWorkspaceId(workspaceId);
  const recipientUserIds = members.map((m) => m.userId);
  if (recipientUserIds.length === 0) return null;

  return { workspaceId, projectId, recipientUserIds };
};

/**
 * Resolve task IDs from text (PR title, branch name) into a human-readable
 * label like `A-F-289: "Mi feature"`. Returns null when no tasks are found.
 */
const resolveTaskLabel = async (
  workspaceId: string,
  ...sources: string[]
): Promise<string | null> => {
  const taskIds = extractTaskIds(sources.join(" "));
  if (taskIds.length === 0) return null;

  const workItems = await getWorkItemsByTaskIds(workspaceId, taskIds);
  if (workItems.length === 0) return null;

  return workItems
    .map((wi) => `${wi.taskId}: "${wi.title}"`)
    .join(" · ");
};

const notifyPullRequestLifecycle = async (args: {
  repoId: string;
  repoFullName: string;
  action: string;
  pr: {
    number: number;
    title: string;
    state: string;
    merged: boolean;
    draft?: boolean;
    user?: { login?: string } | null;
    html_url?: string | null;
    head?: { ref?: string } | null;
  };
}) => {
  if (
    ![
      "opened",
      "reopened",
      "closed",
      "ready_for_review",
      "converted_to_draft",
    ].includes(args.action)
  ) return;

  const ctx = await getGithubNotificationContext(args.repoId);
  if (!ctx) return;

  const prState = resolvePrState({
    merged: args.pr.merged,
    state: args.pr.state,
  });

  const lifecycleLabel =
    prState === "merged"
      ? "mergeada"
      : prState === "closed"
        ? "cerrada"
        : "abierta";

  const title = `PR #${args.pr.number} ${lifecycleLabel}`;
  const body = args.pr.title;
  const link = `/projects/${ctx.projectId}`;
  const sourceEntityType = buildPrNotificationSourceType(args.pr.number);
  const metadata = {
    kind: "github_pr_lifecycle",
    repoFullName: args.repoFullName,
    prNumber: args.pr.number,
    prState,
    prDraft: args.pr.draft ?? false,
    action: args.action,
    githubUrl: args.pr.html_url ?? null,
    authorLogin: args.pr.user?.login ?? null,
  };

  await Promise.allSettled(
    ctx.recipientUserIds.map((recipientUserId) =>
      upsertNotificationBySource({
        recipientUserId,
        workspaceId: ctx.workspaceId,
        type: "status_changed",
        title,
        body,
        link,
        sourceEntityType,
        sourceEntityId: args.repoId,
        metadata,
        bumpToUnreadOnUpdate: true,
      })
    )
  );
};

const notifyWorkflowRunResult = async (args: {
  repoId: string;
  repoFullName: string;
  workflowRun: {
    id: number;
    name?: string | null;
    head_branch?: string | null;
    conclusion?: string | null;
    html_url?: string | null;
  };
  action: string;
}) => {
  if (args.action !== "completed") return;

  const conclusion = (args.workflowRun.conclusion ?? "").toLowerCase();
  const failingConclusions = new Set([
    "failure",
    "timed_out",
    "startup_failure",
    "action_required",
  ]);

  const isFailure = failingConclusions.has(conclusion);
  if (!isFailure) return;

  const ctx = await getGithubNotificationContext(args.repoId);
  if (!ctx) return;

  const workflowName = args.workflowRun.name || "Workflow";
  const branch = args.workflowRun.head_branch || "unknown";
  const taskLabel = await resolveTaskLabel(ctx.workspaceId, branch);
  const title = `Workflow fallido: ${workflowName}`;
  const body = taskLabel
    ? `${args.repoFullName} · ${branch} · ${taskLabel}`
    : `${args.repoFullName} · ${branch} · ${conclusion}`;
  const link = `/projects/${ctx.projectId}`;
  const sourceEntityType = buildWorkflowRunSourceType(args.workflowRun.id);
  const metadata = {
    kind: "github_workflow_failure" as const,
    repoFullName: args.repoFullName,
    workflowRunId: args.workflowRun.id,
    workflowName,
    branch,
    conclusion,
    githubUrl: args.workflowRun.html_url ?? null,
  };

  await Promise.allSettled(
    ctx.recipientUserIds.map((recipientUserId) =>
      upsertNotificationBySource({
        recipientUserId,
        workspaceId: ctx.workspaceId,
        type: "status_changed",
        title,
        body,
        link,
        sourceEntityType,
        sourceEntityId: args.repoId,
        metadata,
        bumpToUnreadOnUpdate: true,
      })
    )
  );
};

const notifyPullRequestReview = async (args: {
  repoId: string;
  repoFullName: string;
  review: {
    state?: string | null;
    html_url?: string | null;
    user?: { login?: string } | null;
  };
  pr: {
    number: number;
    title: string;
    html_url?: string | null;
    user?: { login?: string } | null;
    head?: { ref?: string } | null;
  };
}) => {
  const reviewState = mapReviewState((args.review.state ?? "").toLowerCase());
  if (reviewState === "dismissed") return;

  const ctx = await getGithubNotificationContext(args.repoId);
  if (!ctx) return;

  const prAuthorLogin = args.pr.user?.login?.trim();
  if (!prAuthorLogin) return;

  const recipientUserId = await getWorkspaceMemberUserIdByGithubLogin(
    ctx.workspaceId,
    prAuthorLogin
  );
  if (!recipientUserId) {
    logger.warn(
      `[github-webhook] Could not resolve PR author "${prAuthorLogin}" to an org member, skipping review notification`
    );
    return;
  }

  const reviewer = args.review.user?.login ?? "unknown";
  const title =
    reviewState === "approved"
      ? `PR #${args.pr.number} aprobada`
      : reviewState === "changes_requested"
        ? `PR #${args.pr.number} requiere cambios`
        : `Nuevo comentario en PR #${args.pr.number}`;
  const kind =
    reviewState === "approved"
      ? "github_pr_review_approved"
      : reviewState === "changes_requested"
        ? "github_pr_review_changes_requested"
        : "github_pr_review_commented";
  const taskLabel = await resolveTaskLabel(ctx.workspaceId, args.pr.title, args.pr.head?.ref ?? "");
  const body = taskLabel
    ? `${taskLabel} · ${reviewer}`
    : `${args.pr.title} · ${reviewer}`;
  const link = `/projects/${ctx.projectId}`;
  const sourceEntityType = buildPullRequestReviewSourceType(args.pr.number);
  const metadata = {
    kind,
    repoFullName: args.repoFullName,
    prNumber: args.pr.number,
    prTitle: args.pr.title,
    reviewState,
    reviewerLogin: reviewer,
    prAuthorLogin,
    githubUrl: args.review.html_url ?? args.pr.html_url ?? null,
  };

  await upsertNotificationBySource({
    recipientUserId,
    workspaceId: ctx.workspaceId,
    type: "status_changed",
    title,
    body,
    link,
    sourceEntityType,
    sourceEntityId: args.repoId,
    metadata,
    bumpToUnreadOnUpdate: reviewState === "changes_requested",
  });
};

const notifyCheckRunFailure = async (args: {
  repoId: string;
  repoFullName: string;
  action: string;
  checkRun: {
    id: number;
    name?: string | null;
    conclusion?: string | null;
    html_url?: string | null;
    check_suite?: {
      id?: number;
      head_branch?: string | null;
    } | null;
  };
}) => {
  if (args.action !== "completed") return;

  const conclusion = (args.checkRun.conclusion ?? "").toLowerCase();
  const failingConclusions = new Set(["failure", "timed_out"]);
  if (!failingConclusions.has(conclusion)) return;

  const ctx = await getGithubNotificationContext(args.repoId);
  if (!ctx) return;

  const branch = args.checkRun.check_suite?.head_branch || "unknown";
  const checkName = args.checkRun.name || "Check run";
  const taskLabel = await resolveTaskLabel(ctx.workspaceId, branch);
  const title = `Check fallido: ${checkName}`;
  const body = taskLabel
    ? `${args.repoFullName} · ${branch} · ${taskLabel}`
    : `${args.repoFullName} · ${branch} · ${conclusion}`;
  const link = `/projects/${ctx.projectId}`;
  const sourceEntityType = args.checkRun.check_suite?.id
    ? buildCheckSuiteSourceType(args.checkRun.check_suite.id)
    : buildCheckRunSourceType(args.checkRun.id);
  const metadata = {
    kind: "github_check_run_failure",
    repoFullName: args.repoFullName,
    checkRunId: args.checkRun.id,
    checkSuiteId: args.checkRun.check_suite?.id ?? null,
    checkName,
    branch,
    conclusion,
    githubUrl: args.checkRun.html_url ?? null,
  };

  await Promise.allSettled(
    ctx.recipientUserIds.map((recipientUserId) =>
      upsertNotificationBySource({
        recipientUserId,
        workspaceId: ctx.workspaceId,
        type: "status_changed",
        title,
        body,
        link,
        sourceEntityType,
        sourceEntityId: args.repoId,
        metadata,
        bumpToUnreadOnUpdate: true,
      })
    )
  );
};

/**
 * Propagate CI status from GitHub check_run / workflow_run events
 * to work items linked via task IDs in the branch name.
 * Updates metadata.ciStatus and broadcasts WebSocket updates.
 */
const propagateCiStatusToWorkItems = async (
  repoId: string,
  branch: string,
  ciStatusData: {
    status: string;
    conclusion: string | null;
    url: string | null;
    workflowName: string | null;
  }
): Promise<void> => {
  const workspaceId = await getWorkspaceIdByRepoId(repoId);
  if (!workspaceId) return;

  const taskIds = extractTaskIds(branch);
  if (taskIds.length === 0) return;

  const workItems = await getWorkItemsByTaskIds(workspaceId, taskIds);
  if (workItems.length === 0) return;

  const ciStatus = {
    status: ciStatusData.status,
    conclusion: ciStatusData.conclusion,
    url: ciStatusData.url,
    workflowName: ciStatusData.workflowName,
    updatedAt: new Date().toISOString(),
  };

  const results = await Promise.allSettled(
    workItems.map((wi) => {
      const existingMetadata = (wi.metadata ?? {}) as Record<string, unknown>;
      const merged = { ...existingMetadata, ciStatus };
      return updateWorkItem(workspaceId, wi.id, { metadata: merged });
    })
  );

  for (let i = 0; i < workItems.length; i++) {
    const result = results[i];
    const wi = workItems[i];
    if (result && wi && result.status === "fulfilled") {
      wsConnectionManager.broadcastToWorkspace(workspaceId, {
        type: "work-item:updated",
        payload: {
          workItemId: wi.id,
          changes: { metadata: { ciStatus } },
        },
      });
    }
  }

  logger.info(
    `[github-webhook] Propagated CI status "${ciStatusData.status}" to ${workItems.length} work item(s): ${taskIds.join(", ")}`
  );
};

// ---- Webhook event handlers ----

export const handlePushEvent = async (
  payload: any,
  deliveryId: string
): Promise<void> => {
  try {
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      logger.warn("[github-webhook] Push event missing repository.full_name");
      return;
    }

    const repoId = await getRepoIdByGithubFullName(repoFullName);
    if (!repoId) {
      logger.warn(
        `[github-webhook] No linked repo found for ${repoFullName}, skipping push event`
      );
      return;
    }

    const branch = extractBranch(payload.ref);
    const commits = payload.commits || [];

    // Upsert each commit and capture the returned DB row (with its UUID id)
    const upsertedCommits: Array<{ commitId: string; message: string }> = [];
    for (const commit of commits) {
      const row = await upsertCommit({
        repoId,
        sha: commit.id,
        message: commit.message,
        authorLogin: commit.author?.username || null,
        authorName: commit.author?.name || null,
        branch,
        committedAt: new Date(commit.timestamp),
      });
      if (row) {
        upsertedCommits.push({ commitId: row.id, message: commit.message });
      }
    }

    await createGithubEvent({
      repoId,
      eventType: "push",
      action: "pushed",
      actorLogin: payload.sender?.login || null,
      actorAvatarUrl: payload.sender?.avatar_url || null,
      summary: `Pushed ${commits.length} commit${commits.length !== 1 ? "s" : ""} to ${branch}`,
      payload: {
        ref: payload.ref,
        commitCount: commits.length,
        headCommit: payload.head_commit?.id || null,
      },
      githubDeliveryId: deliveryId,
    });

    logger.info(
      `[github-webhook] Processed push: ${commits.length} commits to ${branch} in ${repoFullName}`
    );

    // Auto-link commits to work items by extracting task IDs (fire-and-forget)
    autoLinkCommitsToWorkItems(repoId, branch, upsertedCommits).catch((e) =>
      logger.error(
        `[github-webhook] Auto-link commits failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );

    // Trigger doc sync for files under docs/ (fire-and-forget within the handler)
    handleDocSync(
      repoFullName,
      repoId,
      commits,
      payload.head_commit?.id || null,
      deliveryId
    ).catch((e) =>
      logger.error(
        `[github-webhook] Doc sync failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  } catch (error) {
    logger.error(
      `[github-webhook] Error handling push event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const handlePullRequestEvent = async (
  payload: any,
  deliveryId: string
): Promise<void> => {
  try {
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      logger.warn(
        "[github-webhook] Pull request event missing repository.full_name"
      );
      return;
    }

    const repoId = await getRepoIdByGithubFullName(repoFullName);
    if (!repoId) {
      logger.warn(
        `[github-webhook] No linked repo found for ${repoFullName}, skipping pull_request event`
      );
      return;
    }

    const pr = payload.pull_request;
    const action = payload.action;
    const state = resolvePrState(pr);
    const labels = (pr.labels || []).map(
      (label: { name: string }) => label.name
    );

    await upsertPullRequest({
      repoId,
      number: pr.number,
      title: pr.title,
      body: pr.body || null,
      state,
      authorLogin: pr.user?.login || null,
      authorAvatarUrl: pr.user?.avatar_url || null,
      labels,
      baseBranch: pr.base?.ref || null,
      headBranch: pr.head?.ref || null,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      htmlUrl: pr.html_url || null,
      isDraft: pr.draft ?? false,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    });

    await createGithubEvent({
      repoId,
      eventType: "pull_request",
      action,
      actorLogin: payload.sender?.login || null,
      actorAvatarUrl: payload.sender?.avatar_url || null,
      summary: `${action} PR #${pr.number}: ${pr.title}`,
      payload: {
        prNumber: pr.number,
        state,
        action,
      },
      githubDeliveryId: deliveryId,
    });

    logger.info(
      `[github-webhook] Processed pull_request: ${action} PR #${pr.number} in ${repoFullName}`
    );

    notifyPullRequestLifecycle({
      repoId,
      repoFullName,
      action,
      pr,
    }).catch((e) =>
      logger.error(
        `[github-webhook] PR notification failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );

    // Auto-link PR to work items and handle merge transition (fire-and-forget, single org lookup)
    getWorkspaceIdByRepoId(repoId).then(async (orgId) => {
      if (!orgId) {
        logger.warn(`[github-webhook] No workspaceId found for repo ${repoId}, skipping PR auto-link`);
        return;
      }
      await autoLinkPrToWorkItems(orgId, pr);

      if (action === "closed" && pr.merged === true) {
        // First, check if this is the release PR of an integration batch.
        // Release PRs follow a different lifecycle: tasks go to Done (not To
        // Review), and we propagate the merge state to the metadata.
        const releaseBatch = await getBatchByFinalPrNumber(repoId, pr.number);
        if (releaseBatch) {
          await handleReleasePrMerged(orgId, releaseBatch, pr);
        } else {
          // Standard task PR: move work items to "To Review".
          await Promise.all([
            moveWorkItemsOnPrMerge(orgId, pr),
            moveFeedbackBugsToPendingValidationOnPrMerge(pr),
          ]);
        }
      }

      // Hook 3: PR closed WITHOUT merge → fail bug-fix attempts and reopen cluster
      if (action === "closed" && pr.merged === false) {
        await markFeedbackBugsAsFailedOnPrClosed(pr);
      }
    }).catch((e) =>
      logger.error(
        `[github-webhook] PR auto-link/merge transition failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  } catch (error) {
    logger.error(
      `[github-webhook] Error handling pull_request event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const handlePullRequestReviewEvent = async (
  payload: any,
  deliveryId: string
): Promise<void> => {
  try {
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      logger.warn(
        "[github-webhook] Pull request review event missing repository.full_name"
      );
      return;
    }

    const repoId = await getRepoIdByGithubFullName(repoFullName);
    if (!repoId) {
      logger.warn(
        `[github-webhook] No linked repo found for ${repoFullName}, skipping pull_request_review event`
      );
      return;
    }

    const review = payload.review;
    const pr = payload.pull_request;
    const reviewState = mapReviewState(review.state);
    const reviewer = review.user?.login || "unknown";

    await updatePullRequestReviewStatus(repoId, pr.number, reviewState);

    await createGithubEvent({
      repoId,
      eventType: "pull_request_review",
      action: review.state,
      actorLogin: review.user?.login || null,
      actorAvatarUrl: review.user?.avatar_url || null,
      summary: `${reviewer} ${reviewState} PR #${pr.number}`,
      payload: {
        prNumber: pr.number,
        reviewState,
        reviewer,
      },
      githubDeliveryId: deliveryId,
    });

    logger.info(
      `[github-webhook] Processed pull_request_review: ${reviewer} ${reviewState} PR #${pr.number} in ${repoFullName}`
    );

    notifyPullRequestReview({
      repoId,
      repoFullName,
      review,
      pr,
    }).catch((e) =>
      logger.error(
        `[github-webhook] PR review notification failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  } catch (error) {
    logger.error(
      `[github-webhook] Error handling pull_request_review event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const handleCheckRunEvent = async (
  payload: any,
  deliveryId: string
): Promise<void> => {
  try {
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      logger.warn(
        "[github-webhook] Check run event missing repository.full_name"
      );
      return;
    }

    const repoId = await getRepoIdByGithubFullName(repoFullName);
    if (!repoId) {
      logger.warn(
        `[github-webhook] No linked repo found for ${repoFullName}, skipping check_run event`
      );
      return;
    }

    const checkRun = payload.check_run;
    const conclusion = checkRun.conclusion;
    const ciStatus = mapCheckConclusion(conclusion);
    const headBranch = checkRun.check_suite?.head_branch;

    if (headBranch) {
      await updatePullRequestCiStatus(repoId, headBranch, ciStatus);
    }

    // Propagate CI status to linked work items (fire-and-forget)
    if (headBranch) {
      propagateCiStatusToWorkItems(repoId, headBranch, {
        status: ciStatus,
        conclusion: conclusion,
        url: checkRun.html_url || null,
        workflowName: checkRun.name || null,
      }).catch((e) =>
        logger.error(
          `[github-webhook] CI status propagation failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
    }

    await createGithubEvent({
      repoId,
      eventType: "check_run",
      action: payload.action,
      actorLogin: payload.sender?.login || null,
      actorAvatarUrl: payload.sender?.avatar_url || null,
      summary: `Check '${checkRun.name}' ${ciStatus} on ${headBranch || "unknown branch"}`,
      payload: {
        checkRunName: checkRun.name,
        conclusion,
        ciStatus,
        headBranch,
      },
      githubDeliveryId: deliveryId,
    });

    logger.info(
      `[github-webhook] Processed check_run: '${checkRun.name}' ${ciStatus} on ${headBranch || "unknown"} in ${repoFullName}`
    );

    notifyCheckRunFailure({
      repoId,
      repoFullName,
      action: payload.action,
      checkRun,
    }).catch((e) =>
      logger.error(
        `[github-webhook] Check run notification failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  } catch (error) {
    logger.error(
      `[github-webhook] Error handling check_run event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const handleWorkflowRunEvent = async (
  payload: any,
  deliveryId: string
): Promise<void> => {
  try {
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      logger.warn(
        "[github-webhook] Workflow run event missing repository.full_name"
      );
      return;
    }

    const repoId = await getRepoIdByGithubFullName(repoFullName);
    if (!repoId) {
      logger.warn(
        `[github-webhook] No linked repo found for ${repoFullName}, skipping workflow_run event`
      );
      return;
    }

    const workflowRun = payload.workflow_run;

    await upsertWorkflowRun({
      repoId,
      runId: workflowRun.id,
      name: workflowRun.name || null,
      status: workflowRun.status || null,
      conclusion: workflowRun.conclusion || null,
      branch: workflowRun.head_branch || null,
      headSha: workflowRun.head_sha || null,
      htmlUrl: workflowRun.html_url || null,
      event: workflowRun.event || null,
      startedAt: workflowRun.run_started_at
        ? new Date(workflowRun.run_started_at)
        : null,
      completedAt: workflowRun.updated_at
        ? new Date(workflowRun.updated_at)
        : null,
    });

    const branch = workflowRun.head_branch || "unknown";
    const conclusion = workflowRun.conclusion || workflowRun.status || "unknown";

    // Propagate CI status to linked work items (fire-and-forget)
    if (workflowRun.head_branch) {
      const wfCiStatus = mapCheckConclusion(workflowRun.conclusion);
      propagateCiStatusToWorkItems(repoId, workflowRun.head_branch, {
        status: wfCiStatus,
        conclusion: workflowRun.conclusion || null,
        url: workflowRun.html_url || null,
        workflowName: workflowRun.name || null,
      }).catch((e) =>
        logger.error(
          `[github-webhook] Workflow CI status propagation failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
    }

    await createGithubEvent({
      repoId,
      eventType: "workflow_run",
      action: payload.action,
      actorLogin: payload.sender?.login || null,
      actorAvatarUrl: payload.sender?.avatar_url || null,
      summary: `Workflow '${workflowRun.name}' ${conclusion} on ${branch}`,
      payload: {
        runId: workflowRun.id,
        workflowName: workflowRun.name,
        status: workflowRun.status,
        conclusion: workflowRun.conclusion,
        branch,
      },
      githubDeliveryId: deliveryId,
    });

    logger.info(
      `[github-webhook] Processed workflow_run: '${workflowRun.name}' ${conclusion} on ${branch} in ${repoFullName}`
    );

    notifyWorkflowRunResult({
      repoId,
      repoFullName,
      workflowRun,
      action: payload.action,
    }).catch((e) =>
      logger.error(
        `[github-webhook] Workflow notification failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  } catch (error) {
    logger.error(
      `[github-webhook] Error handling workflow_run event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const handleInstallationEvent = async (
  payload: any,
  deliveryId: string
): Promise<void> => {
  try {
    const installation = payload.installation;
    const action = payload.action;

    if (action === "created") {
      const upserted = await upsertInstallation({
        installationId: installation.id,
        accountLogin: installation.account?.login,
        accountType: installation.account?.type === "User" ? "user" : "organization",
        accountAvatarUrl: installation.account?.avatar_url || null,
        permissions: installation.permissions || {},
        repositorySelection: installation.repository_selection || "all",
      });

      if (upserted?.scopeId && upserted.scopeId !== "pending") {
        wsConnectionManager.broadcastToWorkspace(upserted.scopeId, {
          type: "connection:updated",
          payload: {
            provider: "github",
            scope: "organization",
            scopeId: upserted.scopeId,
            connectionId: upserted.id,
            action: "updated",
          },
        });
      }

      logger.info(
        `[github-webhook] Installation created: ${installation.account?.login} (ID: ${installation.id})`
      );
    } else if (action === "deleted") {
      const existing = await getInstallationByGithubId(installation.id);
      await deleteInstallationByGithubId(installation.id);

      if (existing?.scopeId && existing.scopeId !== "pending") {
        wsConnectionManager.broadcastToWorkspace(existing.scopeId, {
          type: "connection:updated",
          payload: {
            provider: "github",
            scope: "organization",
            scopeId: existing.scopeId,
            connectionId: existing.id,
            action: "disconnected",
          },
        });
      }

      logger.info(
        `[github-webhook] Installation deleted: ${installation.account?.login} (ID: ${installation.id})`
      );
    } else if (action === "suspend") {
      const upserted = await upsertInstallation({
        installationId: installation.id,
        accountLogin: installation.account?.login,
        accountType: installation.account?.type === "User" ? "user" : "organization",
        accountAvatarUrl: installation.account?.avatar_url || null,
        permissions: installation.permissions || {},
        repositorySelection: installation.repository_selection || "all",
      });

      if (upserted?.scopeId && upserted.scopeId !== "pending") {
        wsConnectionManager.broadcastToWorkspace(upserted.scopeId, {
          type: "connection:updated",
          payload: {
            provider: "github",
            scope: "organization",
            scopeId: upserted.scopeId,
            connectionId: upserted.id,
            action: "updated",
          },
        });
      }

      logger.info(
        `[github-webhook] Installation suspended: ${installation.account?.login} (ID: ${installation.id})`
      );
    } else {
      logger.info(
        `[github-webhook] Installation action '${action}' for ${installation.account?.login} (ID: ${installation.id})`
      );
    }
  } catch (error) {
    logger.error(
      `[github-webhook] Error handling installation event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};
