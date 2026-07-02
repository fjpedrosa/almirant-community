import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { DodHumanActionV2 } from "@almirant/shared";
import { db } from "../../client";
import {
  boardColumns,
  agentJobs,
  githubPullRequests,
  integrationBatches,
  integrationBatchItems,
  projectRepositories,
  projects,
  repoInstallationLinks,
  workItemDependencies,
  workItems,
} from "../../schema";
import type {
  IntegrationBatch,
  NewIntegrationBatch,
} from "../../schema/integration-batches";
import type {
  IntegrationBatchItem,
  NewIntegrationBatchItem,
} from "../../schema/integration-batch-items";
import { toPostgresTimestamptzParam } from "./postgres-timestamp";
import { moveWorkItem } from "./work-item-repository";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type IntegrationBatchStatus =
  | "queued"
  | "running"
  | "awaiting_release"
  | "merging"
  | "completed"
  | "failed"
  | "aborted";

export type IntegrationBatchItemStatus =
  | "pending"
  | "rebasing"
  | "migrating"
  | "type_checking"
  | "testing"
  | "merged"
  | "skipped"
  | "failed";

export type IntegrationBatchItemFailureCategory =
  | "merge_conflict"
  // Deprecated: prefer schema_obsolete_branch or schema_irreconcilable.
  | "schema_semantic"
  | "schema_obsolete_branch"
  | "schema_irreconcilable"
  | "migration_apply_failed"
  | "type_check_failed"
  | "tests_failed";

const ACTIVE_BATCH_STATUSES: IntegrationBatchStatus[] = [
  "queued",
  "running",
  "awaiting_release",
  "merging",
];

// Capacity limits only protect batches that need a runner right now.
// `awaiting_release` must still be discoverable as an open release batch, but
// it is an operator/release-PR waiting state; counting it here blocks new
// Validating items from being appended and re-processed into that release.
export const ACTIVE_BATCH_ITEM_LIMIT_STATUSES: IntegrationBatchStatus[] = [
  "queued",
  "running",
  "merging",
];

const ACTIVE_INTEGRATION_JOB_STATUSES = [
  "queued",
  "running",
  "finalizing",
  "waiting_for_input",
  "paused",
] as const;

export type IntegrationBatchWithItems = IntegrationBatch & {
  items: IntegrationBatchItem[];
};

export type ValidatingReleaseCandidate = {
  id: string;
  taskId: string | null;
  title: string;
  boardId: string;
  projectId: string;
  repositoryId: string;
  repositoryFullName: string;
  baseBranch: string;
  prNumber: number;
  prUrl: string;
  branchName: string;
  updatedAt: Date;
};

type ValidatingLeafCandidateRow = {
  id: string;
  taskId: string | null;
  title: string;
  boardId: string;
  projectId: string | null;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
  validatingColumnOrder: number;
};

type ReleaseCandidateOwnerRow = {
  id: string;
  taskId: string | null;
  title: string;
  boardId: string;
  projectId: string | null;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
};

export type DescendantLeafColumnRow = {
  originalParentId: string;
  id: string;
  boardColumnId: string | null;
  columnRole: string | null;
  columnOrder: number | null;
  updatedAt: Date;
};

type ReleaseColumnMoveItem = {
  id: string;
  taskId: string | null;
  boardId: string | null;
  boardColumnId: string | null;
  type: string | null;
};

export type ReleaseColumnMoveResult = {
  moved: number;
  alreadyInRelease: number;
  skippedMissingReleaseColumn: number;
  missingReleaseColumnBoardIds: string[];
  failed: Array<{ workItemId: string; reason: string }>;
};

const buildPullRequestOrderKey = (repositoryId: string, prNumber: number): string =>
  `${repositoryId}:${prNumber}`;

const compareByPullRequestCreationOrder = (
  a: {
    prNumber: number | null;
    prCreatedAt: Date | null;
    fallbackOrder: number;
    fallbackUpdatedAt?: Date | null;
    fallbackId: string;
  },
  b: {
    prNumber: number | null;
    prCreatedAt: Date | null;
    fallbackOrder: number;
    fallbackUpdatedAt?: Date | null;
    fallbackId: string;
  },
): number => {
  const aTime = a.prCreatedAt?.getTime() ?? null;
  const bTime = b.prCreatedAt?.getTime() ?? null;

  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }

  if (a.prNumber !== null && b.prNumber !== null && a.prNumber !== b.prNumber) {
    return a.prNumber - b.prNumber;
  }

  if (a.prNumber !== null && b.prNumber === null) return -1;
  if (a.prNumber === null && b.prNumber !== null) return 1;

  if (a.fallbackOrder !== b.fallbackOrder) {
    return a.fallbackOrder - b.fallbackOrder;
  }

  const updatedDiff =
    (a.fallbackUpdatedAt?.getTime() ?? 0) - (b.fallbackUpdatedAt?.getTime() ?? 0);
  if (updatedDiff !== 0) return updatedDiff;

  return a.fallbackId.localeCompare(b.fallbackId);
};

const loadPullRequestCreatedAtByKey = async (
  refs: Array<{ repositoryId: string; prNumber: number }>,
): Promise<Map<string, Date>> => {
  if (refs.length === 0) return new Map();

  const repositoryIds = [...new Set(refs.map((ref) => ref.repositoryId))];
  const prNumbers = [...new Set(refs.map((ref) => ref.prNumber))];

  const rows = await db
    .select({
      repositoryId: githubPullRequests.repoId,
      prNumber: githubPullRequests.number,
      prCreatedAt: githubPullRequests.createdAt,
    })
    .from(githubPullRequests)
    .where(
      and(
        inArray(githubPullRequests.repoId, repositoryIds),
        inArray(githubPullRequests.number, prNumbers),
      ),
    );

  return new Map(
    rows.map((row) => [
      buildPullRequestOrderKey(row.repositoryId, row.prNumber),
      row.prCreatedAt,
    ]),
  );
};

const isParentWorkItemType = (type: string | null | undefined): boolean =>
  type === "epic" || type === "feature" || type === "story";

const parseGithubRepoFullNameFromPrUrl = (url: string): string | null => {
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+(?:[#?].*)?$/);
  return match?.[1] ?? null;
};

const readPullRequestRef = (
  metadata: Record<string, unknown> | null,
): { prNumber: number; prUrl: string; branchName: string; repoFullName: string } | null => {
  const pullRequest = metadata?.pullRequest;
  if (!pullRequest || typeof pullRequest !== "object") return null;

  const pr = pullRequest as Record<string, unknown>;
  const prUrl = typeof pr.url === "string" ? pr.url : null;
  const branchName = typeof pr.branch === "string" ? pr.branch : null;
  const prNumber = typeof pr.number === "number" ? pr.number : null;
  const state = typeof pr.state === "string" ? pr.state : "open";
  if (!prUrl || !branchName || !prNumber || state === "closed") return null;

  const repoFullName = parseGithubRepoFullNameFromPrUrl(prUrl);
  if (!repoFullName) return null;

  return { prNumber, prUrl, branchName, repoFullName };
};

const loadReleaseCandidateAncestors = async (
  leafRows: ValidatingLeafCandidateRow[],
): Promise<Map<string, ReleaseCandidateOwnerRow>> => {
  const ancestorMap = new Map<string, ReleaseCandidateOwnerRow>();
  let idsToFetch = new Set(
    leafRows
      .map((item) => item.parentId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  for (let level = 0; level < 4 && idsToFetch.size > 0; level++) {
    const missingIds = [...idsToFetch].filter((id) => !ancestorMap.has(id));
    if (missingIds.length === 0) break;

    const parents = await db
      .select({
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        boardId: workItems.boardId,
        projectId: workItems.projectId,
        parentId: workItems.parentId,
        metadata: workItems.metadata,
        updatedAt: workItems.updatedAt,
      })
      .from(workItems)
      .where(and(inArray(workItems.id, missingIds), isNull(workItems.archivedAt)));

    const nextIds = new Set<string>();
    for (const parent of parents) {
      ancestorMap.set(parent.id, parent);
      if (parent.parentId) nextIds.add(parent.parentId);
    }

    idsToFetch = nextIds;
  }

  return ancestorMap;
};

const findNearestPullRequestOwner = (
  leaf: ValidatingLeafCandidateRow,
  ancestorMap: Map<string, ReleaseCandidateOwnerRow>,
): {
  owner: ReleaseCandidateOwnerRow;
  pr: NonNullable<ReturnType<typeof readPullRequestRef>>;
  isParentOwner: boolean;
} | null => {
  const leafPr = readPullRequestRef(leaf.metadata);
  if (leafPr) {
    return {
      owner: leaf,
      pr: leafPr,
      isParentOwner: false,
    };
  }

  let currentParentId = leaf.parentId;
  let depth = 0;
  while (currentParentId && depth < 4) {
    const parent = ancestorMap.get(currentParentId);
    if (!parent) break;

    const parentPr = readPullRequestRef(parent.metadata);
    if (parentPr) {
      return {
        owner: parent,
        pr: parentPr,
        isParentOwner: true,
      };
    }

    currentParentId = parent.parentId;
    depth++;
  }

  return null;
};

export const loadDescendantLeafColumnsByParent = async (
  parentIds: string[],
): Promise<Map<string, DescendantLeafColumnRow[]>> => {
  const result = new Map<string, DescendantLeafColumnRow[]>(
    parentIds.map((parentId) => [parentId, []]),
  );

  let currentToOriginal = new Map<string, string>(
    parentIds.map((parentId) => [parentId, parentId]),
  );

  for (let level = 0; level < 4 && currentToOriginal.size > 0; level++) {
    const currentIds = [...currentToOriginal.keys()];
    const children = await db
      .select({
        originalParentId: workItems.parentId,
        id: workItems.id,
        boardColumnId: workItems.boardColumnId,
        columnRole: boardColumns.role,
        columnOrder: boardColumns.order,
        updatedAt: workItems.updatedAt,
      })
      .from(workItems)
      .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(and(inArray(workItems.parentId, currentIds), isNull(workItems.archivedAt)));

    const nextLevel = new Map<string, string>();

    for (const child of children) {
      if (!child.originalParentId) continue;
      const originalParentId = currentToOriginal.get(child.originalParentId);
      if (!originalParentId) continue;

      if (child.boardColumnId) {
        result.get(originalParentId)?.push({
          originalParentId,
          id: child.id,
          boardColumnId: child.boardColumnId,
          columnRole: child.columnRole,
          columnOrder: child.columnOrder,
          updatedAt: child.updatedAt,
        });
      } else {
        nextLevel.set(child.id, originalParentId);
      }
    }

    currentToOriginal = nextLevel;
  }

  return result;
};

const loadAlreadyBatchedReleaseWorkItemIds = async (
  workspaceId: string,
  projectId?: string,
): Promise<Set<string>> => {
  const conditions = [
    eq(integrationBatches.workspaceId, workspaceId),
    isNotNull(integrationBatches.releaseNumber),
    inArray(integrationBatches.status, ACTIVE_BATCH_STATUSES),
    ne(integrationBatchItems.status, "failed"),
    sql`(${githubPullRequests.state} IS NULL OR ${githubPullRequests.state} = 'open')`,
  ];

  if (projectId) {
    conditions.push(eq(integrationBatches.projectId, projectId));
  }

  const rows = await db
    .select({ alreadyBatchedWorkItemId: integrationBatchItems.workItemId })
    .from(integrationBatchItems)
    .innerJoin(integrationBatches, eq(integrationBatchItems.batchId, integrationBatches.id))
    .leftJoin(
      githubPullRequests,
      and(
        eq(githubPullRequests.repoId, integrationBatches.repositoryId),
        eq(githubPullRequests.number, integrationBatches.finalPrNumber),
      ),
    )
    .where(and(...conditions));

  return new Set(rows.map((row) => row.alreadyBatchedWorkItemId));
};

const parentBlockIsVirtuallyValidating = (
  descendantLeaves: DescendantLeafColumnRow[],
  validatingColumnOrder: number,
  stabilizationCutoff?: Date,
): boolean => {
  if (descendantLeaves.length === 0) return false;

  const hasValidatingLeaf = descendantLeaves.some(
    (leaf) => leaf.columnRole === "validating",
  );
  if (!hasValidatingLeaf) return false;

  const allLeavesReachedValidating = descendantLeaves.every(
    (leaf) =>
      typeof leaf.columnOrder === "number" &&
      leaf.columnOrder >= validatingColumnOrder,
  );
  if (!allLeavesReachedValidating) return false;

  if (!stabilizationCutoff) return true;

  return descendantLeaves.every(
    (leaf) =>
      leaf.columnRole !== "validating" ||
      leaf.updatedAt <= stabilizationCutoff,
  );
};

// ---------------------------------------------------------------------------
// Batch CRUD
// ---------------------------------------------------------------------------

export const createIntegrationBatch = async (
  input: Omit<NewIntegrationBatch, "id" | "createdAt" | "updatedAt">,
): Promise<IntegrationBatch> => {
  const [created] = await db.insert(integrationBatches).values(input).returning();
  if (!created) throw new Error("Failed to create integration batch");
  return created;
};

export const getBatchById = async (id: string): Promise<IntegrationBatch | null> => {
  const [row] = await db
    .select()
    .from(integrationBatches)
    .where(eq(integrationBatches.id, id))
    .limit(1);
  return row ?? null;
};

export const getBatchByIdWithItems = async (
  id: string,
): Promise<IntegrationBatchWithItems | null> => {
  const batch = await getBatchById(id);
  if (!batch) return null;
  const items = await listItemsByBatch(id);
  return { ...batch, items };
};

export const listActiveBatchesByProject = async (
  workspaceId: string,
  projectId: string,
): Promise<IntegrationBatch[]> => {
  return db
    .select()
    .from(integrationBatches)
    .where(
      and(
        eq(integrationBatches.workspaceId, workspaceId),
        eq(integrationBatches.projectId, projectId),
        inArray(integrationBatches.status, ACTIVE_BATCH_STATUSES),
      ),
    )
    .orderBy(desc(integrationBatches.createdAt));
};

export const countActiveBatchItemsByProject = async (
  workspaceId: string,
  projectId?: string | null,
): Promise<number> => {
  const conditions = [
    eq(integrationBatches.workspaceId, workspaceId),
    inArray(integrationBatches.status, ACTIVE_BATCH_ITEM_LIMIT_STATUSES),
  ];

  if (projectId) {
    conditions.push(eq(integrationBatches.projectId, projectId));
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(integrationBatchItems)
    .innerJoin(integrationBatches, eq(integrationBatchItems.batchId, integrationBatches.id))
    .where(and(...conditions));

  return Number(row?.count ?? 0);
};

export const getRecoverableReleaseBatchesWithoutActiveJob = async (
  workspaceId: string,
  projectId?: string | null,
  limit?: number | null,
): Promise<IntegrationBatchWithItems[]> => {
  const conditions = [
    eq(integrationBatches.workspaceId, workspaceId),
    inArray(integrationBatches.status, ["queued", "running", "merging"]),
    isNull(agentJobs.id),
  ];

  if (projectId) {
    conditions.push(eq(integrationBatches.projectId, projectId));
  }

  const query = db
    .select({ batch: integrationBatches })
    .from(integrationBatches)
    .leftJoin(
      agentJobs,
      and(
        eq(agentJobs.workspaceId, integrationBatches.workspaceId),
        eq(agentJobs.jobType, "integration"),
        inArray(agentJobs.status, ACTIVE_INTEGRATION_JOB_STATUSES),
        sql`${agentJobs.config} ->> 'batchId' = ${integrationBatches.id}::text`,
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(integrationBatches.createdAt));

  const boundedLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : null;
  const rows = boundedLimit !== null
    ? await query.limit(boundedLimit)
    : await query;

  const batches = await Promise.all(
    rows.map((row) => getBatchByIdWithItems(row.batch.id)),
  );

  return batches.filter((batch): batch is IntegrationBatchWithItems => batch !== null);
};

export const getActiveBatchForRepository = async (
  workspaceId: string,
  repositoryId: string,
): Promise<IntegrationBatch | null> => {
  const [row] = await db
    .select()
    .from(integrationBatches)
    .where(
      and(
        eq(integrationBatches.workspaceId, workspaceId),
        eq(integrationBatches.repositoryId, repositoryId),
        inArray(integrationBatches.status, ACTIVE_BATCH_STATUSES),
      ),
    )
    .limit(1);
  return row ?? null;
};

/**
 * Returns the open release batch for a repository — the one whose final release PR
 * is still open on GitHub. New tasks accumulate into this batch.
 *
 * Cross-checks the locally-synced `github_pull_requests` table to detect PRs
 * closed externally (e.g. someone closed the release PR manually on GitHub).
 * If the underlying PR is closed/merged, returns null even if the batch row
 * still has an active status.
 */
export const getOpenReleaseBatchForRepository = async (
  workspaceId: string,
  repositoryId: string,
): Promise<IntegrationBatch | null> => {
  const [row] = await db
    .select({ batch: integrationBatches })
    .from(integrationBatches)
    .leftJoin(
      githubPullRequests,
      and(
        eq(githubPullRequests.repoId, integrationBatches.repositoryId),
        eq(githubPullRequests.number, integrationBatches.finalPrNumber),
      ),
    )
    .where(
      and(
        eq(integrationBatches.workspaceId, workspaceId),
        eq(integrationBatches.repositoryId, repositoryId),
        isNotNull(integrationBatches.releaseNumber),
        inArray(integrationBatches.status, ACTIVE_BATCH_STATUSES),
        // Either no PR is created yet (still building) OR the PR is open.
        sql`(${githubPullRequests.state} IS NULL OR ${githubPullRequests.state} = 'open')`,
      ),
    )
    .orderBy(desc(integrationBatches.releaseNumber))
    .limit(1);
  return row?.batch ?? null;
};

/**
 * Returns the next release number for a repository: max(release_number) + 1.
 * Includes aborted/completed batches to keep the sequence monotonic (no gaps).
 */
export const getNextReleaseNumber = async (
  workspaceId: string,
  repositoryId: string,
): Promise<number> => {
  const [row] = await db
    .select({
      max: sql<number | null>`MAX(${integrationBatches.releaseNumber})`,
    })
    .from(integrationBatches)
    .where(
      and(
        eq(integrationBatches.workspaceId, workspaceId),
        eq(integrationBatches.repositoryId, repositoryId),
      ),
    );
  return (row?.max ?? 0) + 1;
};

/**
 * Look up an integration batch by its final release PR number. Used by the
 * GitHub webhook to detect when a release PR is merged/closed and propagate
 * the lifecycle to the work items in the batch.
 */
export const getBatchByFinalPrNumber = async (
  repositoryId: string,
  prNumber: number,
): Promise<IntegrationBatchWithItems | null> => {
  const [batch] = await db
    .select()
    .from(integrationBatches)
    .where(
      and(
        eq(integrationBatches.repositoryId, repositoryId),
        eq(integrationBatches.finalPrNumber, prNumber),
      ),
    )
    .limit(1);
  if (!batch) return null;
  const items = await listItemsByBatch(batch.id);
  return { ...batch, items };
};

/**
 * Clear the `releasePullRequest` metadata key from every work item in a batch.
 * Used when a release is rejected (`POST /:id/reject`) so the cards stop
 * pointing to a release that is no longer happening.
 */
export const clearReleasePullRequestForBatch = async (
  batchId: string,
): Promise<number> => {
  const items = await db
    .select({ workItemId: integrationBatchItems.workItemId })
    .from(integrationBatchItems)
    .where(eq(integrationBatchItems.batchId, batchId));
  if (items.length === 0) return 0;
  const ids = items.map((it) => it.workItemId);
  // jsonb path delete `metadata - 'releasePullRequest'` — preserves all other keys.
  const result = await db
    .update(workItems)
    .set({
      metadata: sql`${workItems.metadata} - 'releasePullRequest'`,
      updatedAt: new Date(),
    })
    .where(inArray(workItems.id, ids))
    .returning({ id: workItems.id });
  return result.length;
};

/**
 * Update the `releasePullRequest.state` field across every work item in a batch.
 * Used when the release PR transitions (e.g. merged → "merged", closed → "closed").
 */
export const updateReleasePullRequestStateForBatch = async (
  batchId: string,
  state: "open" | "merged" | "closed",
): Promise<number> => {
  const items = await db
    .select({ workItemId: integrationBatchItems.workItemId })
    .from(integrationBatchItems)
    .where(eq(integrationBatchItems.batchId, batchId));
  if (items.length === 0) return 0;
  const ids = items.map((it) => it.workItemId);
  const result = await db
    .update(workItems)
    .set({
      metadata: sql`jsonb_set(${workItems.metadata}, '{releasePullRequest,state}', to_jsonb(${state}::text), false)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(workItems.id, ids),
        sql`${workItems.metadata} ? 'releasePullRequest'`,
      ),
    )
    .returning({ id: workItems.id });
  return result.length;
};

/**
 * Set the `releasePullRequest` metadata only on successfully merged batch items.
 *
 * The Rocket icon means "this work is present in the release branch". Failed,
 * pending, or skipped items may belong to the same batch, but they must not get
 * release metadata because that makes unresolved `Validating` cards look shipped.
 * When this runs idempotently for an existing release PR, it also removes stale
 * `releasePullRequest` metadata from non-merged items in the batch.
 */
export const setReleasePullRequestForBatch = async (
  batchId: string,
  ref: {
    url: string;
    number: number;
    state: "open" | "merged" | "closed";
    branch: string;
    releaseNumber: number;
  },
): Promise<number> => {
  const items = await db
    .select({
      workItemId: integrationBatchItems.workItemId,
      status: integrationBatchItems.status,
    })
    .from(integrationBatchItems)
    .where(eq(integrationBatchItems.batchId, batchId));
  if (items.length === 0) return 0;

  const mergedIds = items
    .filter((item) => item.status === "merged")
    .map((item) => item.workItemId);
  const nonMergedIds = items
    .filter((item) => item.status !== "merged")
    .map((item) => item.workItemId);

  if (nonMergedIds.length > 0) {
    await db
      .update(workItems)
      .set({
        metadata: sql`${workItems.metadata} - 'releasePullRequest'`,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(workItems.id, nonMergedIds),
          sql`${workItems.metadata} ? 'releasePullRequest'`,
        ),
      );
  }

  if (mergedIds.length === 0) return 0;

  const refJson = JSON.stringify(ref);
  const result = await db
    .update(workItems)
    .set({
      metadata: sql`jsonb_set(COALESCE(${workItems.metadata}, '{}'::jsonb), '{releasePullRequest}', ${refJson}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(inArray(workItems.id, mergedIds))
    .returning({ id: workItems.id });
  return result.length;
};

const loadLeafDescendantsForReleaseColumnMove = async (
  parentIds: string[],
): Promise<ReleaseColumnMoveItem[]> => {
  const leaves: ReleaseColumnMoveItem[] = [];
  let currentToSource = new Map<string, string>(
    parentIds.map((parentId) => [parentId, parentId]),
  );

  for (let level = 0; level < 4 && currentToSource.size > 0; level++) {
    const currentIds = [...currentToSource.keys()];
    const children = await db
      .select({
        sourceWorkItemId: workItems.parentId,
        id: workItems.id,
        taskId: workItems.taskId,
        boardId: workItems.boardId,
        boardColumnId: workItems.boardColumnId,
        type: workItems.type,
      })
      .from(workItems)
      .where(
        and(
          inArray(workItems.parentId, currentIds),
          isNull(workItems.archivedAt),
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

/**
 * Move every successfully integrated batch item to its board's Release column.
 *
 * Release integration treats `Validating` as "ready to be integrated". Once the
 * item commits are present in the release branch and the release PR exists, the
 * card must advance to `To Release` (role `release`) so operators can see that
 * it is waiting for the release PR, not still being validated.
 *
 * Some existing boards have the visible `To Release` column but stale/missing
 * role metadata. Resolve release semantically by role first and then by column
 * name. Never fall back to review: that would make integrated work look as if
 * it still needs review and confuse operators.
 *
 * Parent batch items (epic/feature/story) are virtual cards; their leaf
 * descendants are moved because parent columns are derived from children.
 */
export const moveMergedIntegrationBatchItemsToReleaseColumn = async (
  batchId: string,
): Promise<ReleaseColumnMoveResult> => {
  const [batch] = await db
    .select({
      id: integrationBatches.id,
      workspaceId: integrationBatches.workspaceId,
    })
    .from(integrationBatches)
    .where(eq(integrationBatches.id, batchId))
    .limit(1);

  if (!batch) {
    return {
      moved: 0,
      alreadyInRelease: 0,
      skippedMissingReleaseColumn: 0,
      missingReleaseColumnBoardIds: [],
      failed: [{ workItemId: batchId, reason: "Integration batch not found" }],
    };
  }

  const mergedItems = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      boardId: workItems.boardId,
      boardColumnId: workItems.boardColumnId,
      type: workItems.type,
    })
    .from(integrationBatchItems)
    .innerJoin(workItems, eq(integrationBatchItems.workItemId, workItems.id))
    .where(
      and(
        eq(integrationBatchItems.batchId, batchId),
        eq(integrationBatchItems.status, "merged"),
        isNull(workItems.archivedAt),
      ),
    );

  if (mergedItems.length === 0) {
    return {
      moved: 0,
      alreadyInRelease: 0,
      skippedMissingReleaseColumn: 0,
      missingReleaseColumnBoardIds: [],
      failed: [],
    };
  }

  const parentItems = mergedItems.filter((item) =>
    isParentWorkItemType(item.type),
  );
  const descendantLeaves =
    parentItems.length > 0
      ? await loadLeafDescendantsForReleaseColumnMove(parentItems.map((item) => item.id))
      : [];

  const itemsToMoveById = new Map<string, ReleaseColumnMoveItem>();
  for (const item of mergedItems) {
    if (!isParentWorkItemType(item.type)) {
      itemsToMoveById.set(item.id, item);
    }
  }
  for (const leaf of descendantLeaves) {
    itemsToMoveById.set(leaf.id, leaf);
  }

  const itemsToMove = [...itemsToMoveById.values()].filter(
    (item) => typeof item.boardId === "string" && item.boardId.length > 0,
  );
  const boardIds = [...new Set(itemsToMove.map((item) => item.boardId!))];
  if (boardIds.length === 0) {
    return {
      moved: 0,
      alreadyInRelease: 0,
      skippedMissingReleaseColumn: 0,
      missingReleaseColumnBoardIds: [],
      failed: [],
    };
  }

  const releaseColumns = await db
    .select({
      id: boardColumns.id,
      boardId: boardColumns.boardId,
    })
    .from(boardColumns)
    .where(
      and(
        inArray(boardColumns.boardId, boardIds),
        sql`(${boardColumns.role} = 'release' OR lower(trim(${boardColumns.name})) IN ('to release', 'release'))`,
      ),
    )
    .orderBy(asc(boardColumns.order));

  const releaseColumnByBoardId = new Map<string, string>();
  for (const column of releaseColumns) {
    if (!releaseColumnByBoardId.has(column.boardId)) {
      releaseColumnByBoardId.set(column.boardId, column.id);
    }
  }

  let moved = 0;
  let alreadyInRelease = 0;
  let skippedMissingReleaseColumn = 0;
  const missingReleaseColumnBoardIds = new Set<string>();
  const failed: Array<{ workItemId: string; reason: string }> = [];

  for (const item of itemsToMove) {
    const boardId = item.boardId!;
    const releaseColumnId = releaseColumnByBoardId.get(boardId);
    if (!releaseColumnId) {
      skippedMissingReleaseColumn += 1;
      missingReleaseColumnBoardIds.add(boardId);
      continue;
    }

    if (item.boardColumnId === releaseColumnId) {
      alreadyInRelease += 1;
      continue;
    }

    try {
      const ok = await moveWorkItem(
        item.id,
        releaseColumnId,
        0,
        {
          triggeredBy: "worker",
          provenance: {
            source: "worker",
            skillName: "runner-release-integration",
          },
        },
        batch.workspaceId,
      );
      if (ok) moved += 1;
      else failed.push({ workItemId: item.id, reason: "moveWorkItem returned false" });
    } catch (error) {
      failed.push({
        workItemId: item.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    moved,
    alreadyInRelease,
    skippedMissingReleaseColumn,
    missingReleaseColumnBoardIds: [...missingReleaseColumnBoardIds],
    failed,
  };
};

export const setBatchFinalPullRequest = async (
  id: string,
  finalPr: { finalPrUrl: string | null; finalPrNumber: number | null },
): Promise<IntegrationBatch | null> => {
  const [row] = await db
    .update(integrationBatches)
    .set({
      finalPrUrl: finalPr.finalPrUrl,
      finalPrNumber: finalPr.finalPrNumber,
      updatedAt: new Date(),
    })
    .where(eq(integrationBatches.id, id))
    .returning();
  return row ?? null;
};

export const getValidatingReleaseCandidates = async (
  workspaceId: string,
  projectId?: string,
  limit?: number,
  options?: { minAgeMinutes?: number },
): Promise<{
  candidates: ValidatingReleaseCandidate[];
  skipped: {
    missingPullRequest: number;
    unresolvedRepository: number;
    alreadyBatched: number;
  };
}> => {
  const stabilizationCutoff =
    typeof options?.minAgeMinutes === "number" && options.minAgeMinutes > 0
      ? new Date(Date.now() - options.minAgeMinutes * 60_000)
      : undefined;
  const itemConditions = [
    isNotNull(workItems.boardColumnId),
    isNull(workItems.archivedAt),
    eq(boardColumns.role, "validating"),
    eq(projects.workspaceId, workspaceId),
  ];

  if (projectId) {
    itemConditions.push(eq(workItems.projectId, projectId));
  }

  if (stabilizationCutoff) {
    itemConditions.push(
      lte(
        workItems.updatedAt,
        sql`${toPostgresTimestamptzParam(stabilizationCutoff)}::timestamptz`,
      ),
    );
  }

  const rawItems = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      boardId: workItems.boardId,
      projectId: workItems.projectId,
      parentId: workItems.parentId,
      metadata: workItems.metadata,
      updatedAt: workItems.updatedAt,
      validatingColumnOrder: boardColumns.order,
    })
    .from(workItems)
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(...itemConditions))
    .orderBy(asc(workItems.updatedAt), asc(workItems.position), asc(workItems.createdAt));

  const repoLinkConditions = [eq(projects.workspaceId, workspaceId)];
  if (projectId) {
    repoLinkConditions.push(eq(projectRepositories.projectId, projectId));
  }

  const repoLinks = await db
    .select({
      repositoryId: repoInstallationLinks.repoId,
      githubRepoFullName: repoInstallationLinks.githubRepoFullName,
      defaultBranch: repoInstallationLinks.defaultBranch,
    })
    .from(repoInstallationLinks)
    .innerJoin(projectRepositories, eq(repoInstallationLinks.repoId, projectRepositories.id))
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .where(and(...repoLinkConditions));

  const reposByFullName = new Map(
    repoLinks.map((link) => [
      link.githubRepoFullName,
      {
        repositoryId: link.repositoryId,
        repositoryFullName: link.githubRepoFullName,
        baseBranch: link.defaultBranch ?? "main",
      },
    ]),
  );

  const candidates: ValidatingReleaseCandidate[] = [];
  let missingPullRequest = 0;
  let unresolvedRepository = 0;
  const effectiveLimit = typeof limit === "number" ? Math.max(0, limit) : undefined;
  if (effectiveLimit === 0) {
    return {
      candidates,
      skipped: {
        missingPullRequest,
        unresolvedRepository,
        alreadyBatched: 0,
      },
    };
  }

  const alreadyBatchedWorkItemIds = await loadAlreadyBatchedReleaseWorkItemIds(
    workspaceId,
    projectId,
  );
  const skippedAlreadyBatchedIds = new Set<string>();
  const ancestorMap = await loadReleaseCandidateAncestors(rawItems);
  const candidateMap = new Map<string, {
    owner: ReleaseCandidateOwnerRow & { projectId: string };
    repositoryId: string;
    repositoryFullName: string;
    baseBranch: string;
    prNumber: number;
    prUrl: string;
    branchName: string;
    updatedAt: Date;
    validatingColumnOrder: number;
    isParentOwner: boolean;
  }>();

  for (const item of rawItems) {
    if (!item.projectId) {
      unresolvedRepository++;
      continue;
    }

    const resolved = findNearestPullRequestOwner(item, ancestorMap);
    if (!resolved) {
      missingPullRequest++;
      continue;
    }

    const { owner, pr, isParentOwner } = resolved;
    if (alreadyBatchedWorkItemIds.has(owner.id)) {
      skippedAlreadyBatchedIds.add(owner.id);
      continue;
    }

    if (!owner.projectId) {
      unresolvedRepository++;
      continue;
    }
    const ownerWithProject = { ...owner, projectId: owner.projectId };

    const repo = reposByFullName.get(pr.repoFullName);
    if (!repo) {
      unresolvedRepository++;
      continue;
    }

    const key = `${repo.repositoryId}:${pr.prNumber}`;
    const existing = candidateMap.get(key);
    if (existing) {
      if (item.updatedAt > existing.updatedAt) {
        existing.updatedAt = item.updatedAt;
      }
      existing.isParentOwner = existing.isParentOwner || isParentOwner;
      existing.validatingColumnOrder = Math.min(
        existing.validatingColumnOrder,
        item.validatingColumnOrder,
      );
      continue;
    }

    candidateMap.set(key, {
      owner: ownerWithProject,
      repositoryId: repo.repositoryId,
      repositoryFullName: repo.repositoryFullName,
      baseBranch: repo.baseBranch,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      branchName: pr.branchName,
      updatedAt: item.updatedAt,
      validatingColumnOrder: item.validatingColumnOrder,
      isParentOwner,
    });
  }

  const parentOwnerIds = [...candidateMap.values()]
    .filter((candidate) => candidate.isParentOwner)
    .map((candidate) => candidate.owner.id);
  const descendantLeavesByParent =
    parentOwnerIds.length > 0
      ? await loadDescendantLeafColumnsByParent([...new Set(parentOwnerIds)])
      : new Map<string, DescendantLeafColumnRow[]>();

  const prCreatedAtByKey = await loadPullRequestCreatedAtByKey(
    [...candidateMap.values()].map((candidate) => ({
      repositoryId: candidate.repositoryId,
      prNumber: candidate.prNumber,
    })),
  );
  const orderedCandidates = [...candidateMap.values()]
    .map((candidate, fallbackOrder) => ({
      ...candidate,
      fallbackOrder,
      prCreatedAt:
        prCreatedAtByKey.get(
          buildPullRequestOrderKey(candidate.repositoryId, candidate.prNumber),
        ) ?? null,
    }))
    .sort((a, b) =>
      compareByPullRequestCreationOrder(
        {
          prNumber: a.prNumber,
          prCreatedAt: a.prCreatedAt,
          fallbackOrder: a.fallbackOrder,
          fallbackUpdatedAt: a.updatedAt,
          fallbackId: a.owner.id,
        },
        {
          prNumber: b.prNumber,
          prCreatedAt: b.prCreatedAt,
          fallbackOrder: b.fallbackOrder,
          fallbackUpdatedAt: b.updatedAt,
          fallbackId: b.owner.id,
        },
      ),
    );

  for (const candidate of orderedCandidates) {
    if (candidate.isParentOwner) {
      const descendantLeaves = descendantLeavesByParent.get(candidate.owner.id) ?? [];
      if (
        !parentBlockIsVirtuallyValidating(
          descendantLeaves,
          candidate.validatingColumnOrder,
          stabilizationCutoff,
        )
      ) {
        continue;
      }
    }

    candidates.push({
      id: candidate.owner.id,
      taskId: candidate.owner.taskId,
      title: candidate.owner.title,
      boardId: candidate.owner.boardId,
      projectId: candidate.owner.projectId,
      repositoryId: candidate.repositoryId,
      repositoryFullName: candidate.repositoryFullName,
      baseBranch: candidate.baseBranch,
      prNumber: candidate.prNumber,
      prUrl: candidate.prUrl,
      branchName: candidate.branchName,
      updatedAt: candidate.updatedAt,
    });

    if (effectiveLimit !== undefined && candidates.length >= effectiveLimit) break;
  }

  // Topological sort by explicit work_item_dependencies. Without this, the
  // PR-creation FIFO order can integrate a dependent feature before its
  // dependency, which guarantees a cascade conflict (the dependent's branch
  // contains a merge of the dependency's branch).
  const sortedCandidates = await topologicallySortCandidates(candidates);

  return {
    candidates: sortedCandidates,
    skipped: {
      missingPullRequest,
      unresolvedRepository,
      alreadyBatched: skippedAlreadyBatchedIds.size,
    },
  };
};

/**
 * Pure topological sort: reorder candidates so that work items declared as
 * `blocked_by` another candidate come AFTER their dependency. Edges to work
 * items NOT in the candidate set are ignored. Stable: preserves the input
 * order whenever no dependency forces a swap (Kahn's algorithm with
 * original-position tiebreaker).
 *
 * Cycle detection: returns the original input order on cycle (data bug).
 *
 * Exported for unit tests; the production caller is
 * `topologicallySortCandidates`, which loads deps from the database.
 */
export const topologicallySortCandidatesPure = <T extends { id: string }>(
  candidates: T[],
  deps: Array<{ workItemId: string; blockedByWorkItemId: string }>,
): T[] => {
  if (candidates.length < 2) return candidates;
  if (deps.length === 0) return candidates;

  const candidateIds = candidates.map((c) => c.id);
  const candidateSet = new Set(candidateIds);

  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of candidateIds) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const row of deps) {
    if (!candidateSet.has(row.workItemId) || !candidateSet.has(row.blockedByWorkItemId)) {
      continue;
    }
    if (row.workItemId === row.blockedByWorkItemId) continue;
    dependents.get(row.blockedByWorkItemId)!.push(row.workItemId);
    indegree.set(row.workItemId, (indegree.get(row.workItemId) ?? 0) + 1);
  }

  const positionById = new Map(candidates.map((c, i) => [c.id, i]));
  const ready: string[] = [];
  for (const id of candidateIds) {
    if ((indegree.get(id) ?? 0) === 0) ready.push(id);
  }
  ready.sort((a, b) => (positionById.get(a)! - positionById.get(b)!));

  const sortedIds: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    sortedIds.push(next);
    for (const dep of dependents.get(next) ?? []) {
      const newDeg = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, newDeg);
      if (newDeg === 0) {
        const insertIdx = ready.findIndex(
          (id) => positionById.get(id)! > positionById.get(dep)!,
        );
        if (insertIdx === -1) ready.push(dep);
        else ready.splice(insertIdx, 0, dep);
      }
    }
  }

  if (sortedIds.length !== candidates.length) {
    return candidates;
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  return sortedIds.map((id) => byId.get(id)!);
};

/**
 * DB-backed wrapper: loads `work_item_dependencies` rows for the candidate
 * set and delegates the actual ordering to the pure helper.
 */
const topologicallySortCandidates = async <T extends { id: string }>(
  candidates: T[],
): Promise<T[]> => {
  if (candidates.length < 2) return candidates;
  const candidateIds = candidates.map((c) => c.id);

  const depRows = await db
    .select({
      workItemId: workItemDependencies.workItemId,
      blockedByWorkItemId: workItemDependencies.blockedByWorkItemId,
    })
    .from(workItemDependencies)
    .where(
      and(
        inArray(workItemDependencies.workItemId, candidateIds),
        inArray(workItemDependencies.blockedByWorkItemId, candidateIds),
      ),
    );

  return topologicallySortCandidatesPure(candidates, depRows);
};

export const updateBatchStatus = async (
  id: string,
  status: IntegrationBatchStatus,
  extra?: { errorMessage?: string | null; completedAt?: Date | null },
): Promise<IntegrationBatch | null> => {
  const updates: Partial<IntegrationBatch> = {
    status,
    updatedAt: new Date(),
  };
  if (extra?.errorMessage !== undefined) updates.errorMessage = extra.errorMessage;
  if (extra?.completedAt !== undefined) updates.completedAt = extra.completedAt;
  if (status === "running" && !extra?.completedAt) updates.startedAt = new Date();
  const [row] = await db
    .update(integrationBatches)
    .set(updates)
    .where(eq(integrationBatches.id, id))
    .returning();
  return row ?? null;
};

export const setCurrentItemIndex = async (
  id: string,
  index: number,
): Promise<IntegrationBatch | null> => {
  const [row] = await db
    .update(integrationBatches)
    .set({ currentItemIndex: index, updatedAt: new Date() })
    .where(eq(integrationBatches.id, id))
    .returning();
  return row ?? null;
};

export const setSandboxContainerId = async (
  id: string,
  sandboxContainerId: string | null,
): Promise<IntegrationBatch | null> => {
  const [row] = await db
    .update(integrationBatches)
    .set({ sandboxContainerId, updatedAt: new Date() })
    .where(eq(integrationBatches.id, id))
    .returning();
  return row ?? null;
};

// ---------------------------------------------------------------------------
// Batch items CRUD
// ---------------------------------------------------------------------------

export type AddItemInput = Omit<
  NewIntegrationBatchItem,
  "id" | "createdAt" | "updatedAt" | "status" | "migrationRegenerated"
>;

export const addItemsToBatch = async (
  items: AddItemInput[],
): Promise<IntegrationBatchItem[]> => {
  if (items.length === 0) return [];
  return db.insert(integrationBatchItems).values(items).returning();
};

export const updateItemStatus = async (
  id: string,
  status: IntegrationBatchItemStatus,
  extra?: {
    commitShaBefore?: string;
    commitShaAfter?: string;
    migrationRegenerated?: boolean;
    completedAt?: Date | null;
  },
): Promise<IntegrationBatchItem | null> => {
  const updates: Partial<IntegrationBatchItem> = {
    status,
    updatedAt: new Date(),
  };
  if (status !== "failed") {
    updates.failureCategory = null;
    updates.failureReason = null;
  }
  if (
    status === "pending" ||
    status === "rebasing" ||
    status === "migrating" ||
    status === "type_checking" ||
    status === "testing"
  ) {
    updates.completedAt = null;
  }
  if (extra?.commitShaBefore) updates.commitShaBefore = extra.commitShaBefore;
  if (extra?.commitShaAfter) updates.commitShaAfter = extra.commitShaAfter;
  if (extra?.migrationRegenerated !== undefined)
    updates.migrationRegenerated = extra.migrationRegenerated;
  if (extra?.completedAt !== undefined) updates.completedAt = extra.completedAt;
  if (status === "rebasing" && !updates.completedAt) updates.startedAt = new Date();
  const [row] = await db
    .update(integrationBatchItems)
    .set(updates)
    .where(eq(integrationBatchItems.id, id))
    .returning();
  return row ?? null;
};

/**
 * Stamp the linked work item with the human-intervention metadata shape used
 * by DoD remediation, so the existing UI badges and the backlog-drain
 * `hasHumanInterventionMetadata` filter both surface and skip these tasks
 * consistently. Called automatically by `setItemFailure` on every failed
 * batch item — there is no automated retry loop, so a single agent escalation
 * is the signal to bring a human in.
 *
 * Idempotent: re-applies the same patch each time. Safe to call repeatedly
 * (e.g. on retroactive failures or status corrections).
 */
export const markIntegrationBatchItemForHumanAction = async (
  workItemId: string,
  args: { failureReason: string | null; failureCategory?: string | null },
): Promise<void> => {
  const reasonSuffix = args.failureReason ? ` Reason: ${args.failureReason}` : "";
  const categoryPrefix = args.failureCategory
    ? `Release integration could not auto-resolve this item (${args.failureCategory}).`
    : "Release integration could not auto-resolve this item.";
  const message = `${categoryPrefix} Human intervention required.${reasonSuffix}`;
  const patch = JSON.stringify({
    dod_human_action_required: true,
    dod_human_review_required: true,
    dod_auto_remediation_blocked: true,
    dod_human_action: message,
    dod_human_review_reason: message,
  });

  await db
    .update(workItems)
    .set({
      metadata: sql`coalesce(${workItems.metadata}, '{}') || ${patch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, workItemId));
};

/**
 * Pure: build the metadata JSONB patch that `writeDodHumanActionV2` writes.
 * Exposed for unit tests so the shape contract can be verified without a DB.
 */
export const buildDodHumanActionV2Patch = (
  payload: DodHumanActionV2,
  now: Date = new Date(),
): {
  enriched: DodHumanActionV2;
  patch: Record<string, unknown>;
} => {
  const enriched: DodHumanActionV2 = {
    ...payload,
    generatedAt: payload.generatedAt ?? now.toISOString(),
  };
  return {
    enriched,
    patch: {
      dod_human_action_required: true,
      dod_human_review_required: true,
      dod_auto_remediation_blocked: true,
      dod_human_action_v2: enriched,
      dod_human_action: enriched.diagnosis,
      dod_human_review_reason: enriched.diagnosis,
    },
  };
};

/**
 * Stamp a structured DodHumanActionV2 payload on a work item. Replaces the
 * legacy free-text `dod_human_action` with a card-per-option panel that the
 * frontend renders. Sets the legacy gate flags so the remediation cron skips
 * this item until the operator picks an option.
 *
 * Idempotent: re-applies the same patch each time. Safe to call multiple
 * times if the agent re-classifies the same conflict.
 */
export const writeDodHumanActionV2 = async (
  workItemId: string,
  payload: DodHumanActionV2,
): Promise<void> => {
  const { patch } = buildDodHumanActionV2Patch(payload);
  const patchJson = JSON.stringify(patch);
  await db
    .update(workItems)
    .set({
      metadata: sql`coalesce(${workItems.metadata}, '{}') || ${patchJson}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, workItemId));
};

/**
 * Auto-remediable failure path: instead of blocking on a human, mark every
 * leaf descendant of the failing parent as `dod_incompleted=true` with a
 * structured `dod_report` carrying the integration context. The next
 * runner-fix-dod tick picks them up via getDodRemediationExpectedLeafTaskIdsUnder
 * and re-implements them against the current main schema.
 *
 * Critically does NOT set `dod_human_action_required` or
 * `dod_auto_remediation_blocked` — those would gate the remediation pipeline
 * out of the leaves.
 *
 * The retry cap in markIntegrationBatchItemForHumanAction still applies as a
 * last-resort safety net if remediation keeps failing.
 */
export const enqueueDodRemediationFromIntegrationFailure = async (
  rootWorkItemId: string,
  args: {
    integrationContext: Record<string, unknown>;
    failureReason: string;
    triggeredBy: "release-integration";
  },
): Promise<{ leafCount: number }> => {
  const leafRows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT wi.id, wi.type, wi.archived_at, wi.parent_id, wi.board_column_id
      FROM work_items wi
      WHERE wi.id = ${rootWorkItemId}
      UNION ALL
      SELECT child.id, child.type, child.archived_at, child.parent_id, child.board_column_id
      FROM work_items child
      INNER JOIN descendants d ON child.parent_id = d.id
    )
    SELECT d.id
    FROM descendants d
    WHERE d.archived_at IS NULL
      AND d.type = 'task'
      AND NOT EXISTS (
        SELECT 1
        FROM work_items c
        WHERE c.parent_id = d.id
          AND c.archived_at IS NULL
      )
  `);

  const rawRows =
    (leafRows as { rows?: Array<{ id: string }> })?.rows ??
    (leafRows as Array<{ id: string }>);
  const leafIds = Array.isArray(rawRows)
    ? rawRows.map((row) => row.id)
    : [];

  if (leafIds.length === 0) {
    return { leafCount: 0 };
  }

  const { leafPatch: leafPatchObj, parentPatch: parentPatchObj } =
    buildIntegrationRemediationPatches({
      integrationContext: args.integrationContext,
      failureReason: args.failureReason,
      triggeredBy: args.triggeredBy,
      now: new Date(),
    });
  const leafPatch = JSON.stringify(leafPatchObj);

  await db
    .update(workItems)
    .set({
      metadata: sql`coalesce(${workItems.metadata}, '{}') || ${leafPatch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(inArray(workItems.id, leafIds));

  const parentPatch = JSON.stringify(parentPatchObj);
  await db
    .update(workItems)
    .set({
      metadata: sql`coalesce(${workItems.metadata}, '{}') || ${parentPatch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, rootWorkItemId));

  return { leafCount: leafIds.length };
};

/**
 * Pure: build the leaf and parent metadata patches that
 * `enqueueDodRemediationFromIntegrationFailure` writes. Exposed for unit
 * tests so the shape contract can be verified without a DB.
 *
 * Critically does NOT include `dod_human_action_required` or
 * `dod_auto_remediation_blocked` — that absence is what lets the remediation
 * pipeline pick the leaves up.
 */
export const buildIntegrationRemediationPatches = (args: {
  integrationContext: Record<string, unknown>;
  failureReason: string;
  triggeredBy: "release-integration";
  now: Date;
}): {
  leafPatch: Record<string, unknown>;
  parentPatch: Record<string, unknown>;
} => {
  const dodReportPayload = {
    source: args.triggeredBy,
    failureReason: args.failureReason,
    integrationContext: args.integrationContext,
    instructions:
      "Re-implement against the integrated schema currently on the release branch. " +
      "Read integrationContext.groundTruthSchema for the canonical column shape " +
      "and adapt repos/routes/types/migrations to match. Preserve any wiring already " +
      "present in main that the original branch tried to remove.",
  };
  return {
    leafPatch: {
      dod_incompleted: true,
      dod_approved: false,
      dod_report: JSON.stringify(dodReportPayload),
      integration_remediation_source: args.triggeredBy,
    },
    parentPatch: {
      integration_remediation_in_progress: true,
      integration_remediation_started_at: args.now.toISOString(),
      integration_remediation_failure_reason: args.failureReason,
    },
  };
};

/**
 * Clear the v2 panel state from a work item after the operator picks an
 * option. Removes the gate flags so the remediation/integration pipelines
 * can pick the item up again, and stamps an audit trail of which option
 * was chosen.
 *
 * Note: drizzle-orm currently lacks a first-class JSONB key delete operator,
 * so we rebuild the metadata via a SQL `-` (key-removal) chain instead of a
 * merge patch.
 */
export const clearDodHumanActionV2 = async (
  workItemId: string,
  args: {
    optionId: string;
    appliedByUserId: string | null;
    actionType: string;
  },
): Promise<void> => {
  const auditPatch = JSON.stringify({
    integration_human_action_applied_at: new Date().toISOString(),
    integration_human_action_chosen_option_id: args.optionId,
    integration_human_action_action_type: args.actionType,
    ...(args.appliedByUserId
      ? { integration_human_action_applied_by_user_id: args.appliedByUserId }
      : {}),
    dod_human_action_required: false,
    dod_human_review_required: false,
    dod_auto_remediation_blocked: false,
  });

  await db
    .update(workItems)
    .set({
      metadata: sql`
        (coalesce(${workItems.metadata}, '{}')
          - 'dod_human_action_v2'
          - 'dod_human_action'
          - 'dod_human_review_reason'
          - 'dod_human_action_reason'
        ) || ${auditPatch}::jsonb
      `,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, workItemId));
};

export const setItemFailure = async (
  id: string,
  category: IntegrationBatchItemFailureCategory,
  reason: string,
  options?: {
    /**
     * When category is `schema_obsolete_branch`, the agent supplies the
     * integration context (ground-truth schema, conflicting files, mapping
     * rules) so runner-fix-dod can re-implement against current main.
     */
    integrationContext?: Record<string, unknown>;
    /**
     * When category is `schema_irreconcilable`, the agent supplies the
     * structured DodHumanActionV2 payload that the UI panel will render.
     * If omitted, falls back to the legacy free-text human-action gate.
     */
    dodHumanActionV2?: DodHumanActionV2;
  },
): Promise<IntegrationBatchItem | null> => {
  const [row] = await db
    .update(integrationBatchItems)
    .set({
      status: "failed",
      failureCategory: category,
      failureReason: reason,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(integrationBatchItems.id, id))
    .returning();

  if (row?.workItemId) {
    if (category === "schema_obsolete_branch") {
      await enqueueDodRemediationFromIntegrationFailure(row.workItemId, {
        integrationContext: options?.integrationContext ?? {},
        failureReason: reason,
        triggeredBy: "release-integration",
      });
    } else if (
      category === "schema_irreconcilable" &&
      options?.dodHumanActionV2
    ) {
      await writeDodHumanActionV2(row.workItemId, options.dodHumanActionV2);
    } else {
      await markIntegrationBatchItemForHumanAction(row.workItemId, {
        failureReason: reason,
        failureCategory: category,
      });
    }
  }

  return row ?? null;
};

export const listItemsByBatch = async (
  batchId: string,
): Promise<IntegrationBatchItem[]> => {
  const [batch] = await db
    .select({
      repositoryId: integrationBatches.repositoryId,
    })
    .from(integrationBatches)
    .where(eq(integrationBatches.id, batchId))
    .limit(1);

  if (!batch) return [];

  const rows = await db
    .select({
      item: integrationBatchItems,
      prCreatedAt: githubPullRequests.createdAt,
    })
    .from(integrationBatchItems)
    .leftJoin(
      githubPullRequests,
      and(
        eq(githubPullRequests.repoId, batch.repositoryId),
        eq(githubPullRequests.number, integrationBatchItems.prNumber),
      ),
    )
    .where(eq(integrationBatchItems.batchId, batchId))
    .orderBy(integrationBatchItems.processingOrder);

  return rows
    .sort((a, b) =>
      compareByPullRequestCreationOrder(
        {
          prNumber: a.item.prNumber,
          prCreatedAt: a.prCreatedAt,
          fallbackOrder: a.item.processingOrder,
          fallbackUpdatedAt: a.item.updatedAt,
          fallbackId: a.item.id,
        },
        {
          prNumber: b.item.prNumber,
          prCreatedAt: b.prCreatedAt,
          fallbackOrder: b.item.processingOrder,
          fallbackUpdatedAt: b.item.updatedAt,
          fallbackId: b.item.id,
        },
      ),
    )
    .map((row) => row.item);
};
