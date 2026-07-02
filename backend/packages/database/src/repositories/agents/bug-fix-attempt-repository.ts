import { db } from "../../client";
import { randomUUID } from "node:crypto";
import {
  bugFixAttempts,
  feedbackClusters,
  feedbackItems,
  agentJobs,
  githubPullRequests,
  githubPrStateEnum,
  githubReviewStatusEnum,
  githubCiStatusEnum,
} from "../../schema";
import { eq, and, desc, sql, inArray, or, isNull } from "drizzle-orm";
import type { BugFixAttempt, NewBugFixAttempt } from "../../schema";
import type { PaginationParams } from "../../domain/types";
import {
  computeClusterRetryBudget,
  type RetryBudgetStatus,
} from "../feedback/feedback-cluster-repository";

// --- Types for traceability with PR enrichment ---

type GithubPrStateValue = (typeof githubPrStateEnum.enumValues)[number];
type GithubReviewStatusValue = (typeof githubReviewStatusEnum.enumValues)[number];
type GithubCiStatusValue = (typeof githubCiStatusEnum.enumValues)[number];

export interface BugFixAttemptPr {
  state: GithubPrStateValue;
  reviewStatus: GithubReviewStatusValue;
  ciStatus: GithubCiStatusValue;
  mergedAt: Date | null;
  closedAt: Date | null;
}

export interface BugFixAttemptWithPr extends BugFixAttempt {
  pr: BugFixAttemptPr | null;
}

export interface BugFixAttemptFingerprintData {
  runtime: string;
  boundary: string;
  canonicalKind: string;
  invariantKey: string;
  normalizedError: string;
  hash: string;
}

export interface BugFixAttemptWorkflowMetadata {
  workflowGuards?: {
    errorSearch?: {
      performedAt: string;
      query: string;
      area?: string;
      projectId?: string;
      resultCount: number;
    };
    errorSave?: {
      performedAt: string;
      observationId: string;
      topicKey: string;
      area: string;
      projectId?: string;
    };
  };
  fingerprint?: BugFixAttemptFingerprintData;
}

export interface BugFixAttemptFilters {
  projectId?: string;
  status?: string;
  clusterId?: string;
  feedbackItemId?: string;
}

export interface BugFixAttemptWithRelations extends BugFixAttempt {
  feedbackItem?: { id: string; title: string } | null;
  agentJob?: { id: string; status: string } | null;
}

export interface BugFeedbackItemSummary {
  id: string;
  title: string;
  content: string | null;
  authorName: string | null;
  authorEmail: string | null;
  sentiment: string | null;
  metadata: Record<string, unknown> | null;
  clusterId: string | null;
  createdAt: Date;
}

export interface ClaimedBugFeedback extends BugFeedbackItemSummary {
  claimToken: string;
  claimExpiresAt: string;
}

export type CreateClaimedBugFixAttemptResult =
  | {
      success: true;
      attempt: BugFixAttempt;
    }
  | {
      success: false;
      reason:
        | "feedback_not_found"
        | "feedback_not_new"
        | "claim_required"
        | "claim_expired"
        | "claim_mismatch"
        | "active_attempt_exists";
      activeAttemptId?: string;
    }
  | {
      success: false;
      reason: "max_attempts_reached";
      budget: RetryBudgetStatus;
      activeAttemptId?: string;
    };

const ACTIVE_STATUSES = ["analyzing", "proposed", "implementing"] as const;
const MAX_ATTEMPTS = 3;
const BUG_FIX_CLAIM_KEY = "bugFixClaim";
const BUG_FIX_CLAIM_TTL_MS = 10 * 60 * 1000;
const BUG_FIX_ATTEMPTS_FEEDBACK_ATTEMPT_NUMBER_UNIQUE =
  "bug_fix_attempts_feedback_attempt_number_unique_idx";
const BUG_FIX_ATTEMPTS_FEEDBACK_ACTIVE_UNIQUE =
  "bug_fix_attempts_feedback_active_unique_idx";
const BUG_FIX_ATTEMPTS_CLUSTER_ACTIVE_UNIQUE =
  "bug_fix_attempts_cluster_active_unique_idx";

type BugFixClaimMetadata = {
  token?: string;
  claimedBy?: string;
  claimedAt?: string;
  expiresAt?: string;
};

type PostgresUniqueViolationLike = {
  code?: string;
  constraint_name?: string;
};

const getBugFixClaim = (
  metadata: Record<string, unknown> | null | undefined
): BugFixClaimMetadata | null => {
  const claim = metadata?.[BUG_FIX_CLAIM_KEY];

  if (!claim || typeof claim !== "object") {
    return null;
  }

  return claim as BugFixClaimMetadata;
};

const getUniqueViolationConstraint = (error: unknown): string | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const pgError = error as PostgresUniqueViolationLike;
  if (pgError.code !== "23505") {
    return null;
  }

  return typeof pgError.constraint_name === "string"
    ? pgError.constraint_name
    : null;
};

const isBugFixAttemptClaimConflictConstraint = (
  constraintName: string | null
): boolean =>
  constraintName === BUG_FIX_ATTEMPTS_FEEDBACK_ATTEMPT_NUMBER_UNIQUE ||
  constraintName === BUG_FIX_ATTEMPTS_FEEDBACK_ACTIVE_UNIQUE ||
  constraintName === BUG_FIX_ATTEMPTS_CLUSTER_ACTIVE_UNIQUE;

export const buildBugFixClaimMetadataSql = (args: {
  claimToken: string;
  claimedBy: string;
  claimedAt: string;
  expiresAt: string;
}) => sql`jsonb_build_object(
  'token', ${args.claimToken}::text,
  'claimedBy', ${args.claimedBy}::text,
  'claimedAt', ${args.claimedAt}::text,
  'expiresAt', ${args.expiresAt}::text
)`;

const isBugFixClaimAvailableSql = sql`(
  ${feedbackItems.metadata}->'bugFixClaim' IS NULL
  OR COALESCE((${feedbackItems.metadata}->'bugFixClaim'->>'expiresAt')::timestamptz, '-infinity'::timestamptz) <= now()
)`;

const hasNoActiveAttemptForFeedbackSql = sql`NOT EXISTS (
  SELECT 1
  FROM bug_fix_attempts bfa_feedback
  WHERE bfa_feedback.feedback_item_id = ${feedbackItems.id}
    AND bfa_feedback.status IN ('analyzing', 'proposed', 'implementing')
)`;

const hasNoActiveAttemptForClusterSql = sql`(
  ${feedbackItems.clusterId} IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM bug_fix_attempts bfa_cluster
    WHERE bfa_cluster.cluster_id = ${feedbackItems.clusterId}
      AND bfa_cluster.status IN ('analyzing', 'proposed', 'implementing')
  )
)`;

export const getBugFixAttempts = async (
  filters: BugFixAttemptFilters,
  pagination: PaginationParams
): Promise<{ items: BugFixAttemptWithRelations[]; total: number }> => {
  const conditions = [];
  if (filters.projectId) {
    conditions.push(eq(bugFixAttempts.projectId, filters.projectId));
  }

  const validStatuses = bugFixAttempts.status.enumValues as readonly string[];
  if (filters.status && validStatuses.includes(filters.status)) {
    conditions.push(
      eq(
        bugFixAttempts.status,
        filters.status as (typeof bugFixAttempts.status.enumValues)[number]
      )
    );
  }
  if (filters.clusterId) {
    conditions.push(eq(bugFixAttempts.clusterId, filters.clusterId));
  }
  if (filters.feedbackItemId) {
    conditions.push(eq(bugFixAttempts.feedbackItemId, filters.feedbackItemId));
  }

  const whereClause = and(...conditions);

  const [itemsResult, countResult] = await Promise.all([
    db
      .select({
        attempt: bugFixAttempts,
        feedbackItemTitle: feedbackItems.title,
        agentJobStatus: agentJobs.status,
      })
      .from(bugFixAttempts)
      .leftJoin(
        feedbackItems,
        eq(bugFixAttempts.feedbackItemId, feedbackItems.id)
      )
      .leftJoin(agentJobs, eq(bugFixAttempts.agentJobId, agentJobs.id))
      .where(whereClause)
      .orderBy(desc(bugFixAttempts.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bugFixAttempts)
      .where(whereClause),
  ]);

  const items: BugFixAttemptWithRelations[] = itemsResult.map((row) => ({
    ...row.attempt,
    feedbackItem: row.attempt.feedbackItemId
      ? { id: row.attempt.feedbackItemId, title: row.feedbackItemTitle ?? "" }
      : null,
    agentJob: row.attempt.agentJobId
      ? {
          id: row.attempt.agentJobId,
          status: row.agentJobStatus ?? "",
        }
      : null,
  }));

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};

export const getBugFixAttemptById = async (
  id: string
): Promise<BugFixAttemptWithRelations | null> => {
  const [result] = await db
    .select({
      attempt: bugFixAttempts,
      feedbackItemTitle: feedbackItems.title,
      agentJobStatus: agentJobs.status,
    })
    .from(bugFixAttempts)
    .leftJoin(feedbackItems, eq(bugFixAttempts.feedbackItemId, feedbackItems.id))
    .leftJoin(agentJobs, eq(bugFixAttempts.agentJobId, agentJobs.id))
    .where(eq(bugFixAttempts.id, id))
    .limit(1);

  if (!result) return null;

  return {
    ...result.attempt,
    feedbackItem: result.attempt.feedbackItemId
      ? {
          id: result.attempt.feedbackItemId,
          title: result.feedbackItemTitle ?? "",
        }
      : null,
    agentJob: result.attempt.agentJobId
      ? {
          id: result.attempt.agentJobId,
          status: result.agentJobStatus ?? "",
        }
      : null,
  };
};

export const createBugFixAttempt = async (
  data: Omit<NewBugFixAttempt, "id" | "createdAt" | "updatedAt">
): Promise<BugFixAttempt> => {
  const [newAttempt] = await db
    .insert(bugFixAttempts)
    .values(data)
    .returning();

  if (!newAttempt) throw new Error("Failed to create bug fix attempt");
  return newAttempt;
};

export const getClaimableBugFeedbackItems = async (
  limit: number
): Promise<{ items: BugFeedbackItemSummary[]; total: number }> => {
  const safeLimit = Math.max(1, Math.min(limit, 20));

  const [itemsResult, totalResult] = await Promise.all([
    db
      .select({
        id: feedbackItems.id,
        title: feedbackItems.title,
        content: feedbackItems.content,
        authorName: feedbackItems.authorName,
        authorEmail: feedbackItems.authorEmail,
        sentiment: feedbackItems.sentiment,
        metadata: feedbackItems.metadata,
        clusterId: feedbackItems.clusterId,
        createdAt: feedbackItems.createdAt,
      })
      .from(feedbackItems)
      .where(
        and(
          eq(feedbackItems.status, "new"),
          eq(feedbackItems.category, "bug"),
          isBugFixClaimAvailableSql,
          hasNoActiveAttemptForFeedbackSql,
          hasNoActiveAttemptForClusterSql
        )
      )
      .orderBy(feedbackItems.createdAt)
      .limit(safeLimit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackItems)
      .where(
        and(
          eq(feedbackItems.status, "new"),
          eq(feedbackItems.category, "bug"),
          isBugFixClaimAvailableSql,
          hasNoActiveAttemptForFeedbackSql,
          hasNoActiveAttemptForClusterSql
        )
      ),
  ]);

  return {
    items: itemsResult.map((item) => ({
      ...item,
      metadata: (item.metadata as Record<string, unknown> | null) ?? null,
    })),
    total: totalResult[0]?.count ?? 0,
  };
};

export const claimNextBugFeedbackItem = async (args: {
  claimedBy: string;
  ttlMs?: number;
}): Promise<ClaimedBugFeedback | null> => {
  const ttlMs = Math.max(1_000, args.ttlMs ?? BUG_FIX_CLAIM_TTL_MS);
  const now = new Date();
  const claimedAtIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const expiresAtIso = expiresAt.toISOString();
  const claimToken = randomUUID();

  return db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      WITH picked AS (
        SELECT ${feedbackItems.id} AS id
        FROM ${feedbackItems}
        WHERE ${feedbackItems.status} = 'new'
          AND ${feedbackItems.category} = 'bug'
          AND ${isBugFixClaimAvailableSql}
          AND ${hasNoActiveAttemptForFeedbackSql}
          AND ${hasNoActiveAttemptForClusterSql}
        ORDER BY ${feedbackItems.createdAt} ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${feedbackItems}
      SET metadata = jsonb_set(
            coalesce(${feedbackItems.metadata}, '{}'::jsonb),
            '{bugFixClaim}',
            ${buildBugFixClaimMetadataSql({
              claimToken,
              claimedBy: args.claimedBy,
              claimedAt: claimedAtIso,
              expiresAt: expiresAtIso,
            })}
          ),
          updated_at = ${claimedAtIso}::timestamptz
      WHERE ${feedbackItems.id} IN (SELECT id FROM picked)
      RETURNING
        ${feedbackItems.id} AS "id",
        ${feedbackItems.title} AS "title",
        ${feedbackItems.content} AS "content",
        ${feedbackItems.authorName} AS "authorName",
        ${feedbackItems.authorEmail} AS "authorEmail",
        ${feedbackItems.sentiment} AS "sentiment",
        ${feedbackItems.metadata} AS "metadata",
        ${feedbackItems.clusterId} AS "clusterId",
        ${feedbackItems.createdAt} AS "createdAt"
    `)) as unknown as BugFeedbackItemSummary[];

    const claimed = rows[0];

    if (!claimed) {
      return null;
    }

    return {
      ...claimed,
      metadata: (claimed.metadata as Record<string, unknown> | null) ?? null,
      claimToken,
      claimExpiresAt: expiresAtIso,
    };
  });
};

export const createBugFixAttemptFromClaim = async (args: {
  feedbackItemId: string;
  clusterId?: string | null;
  projectId: string;
  workspaceId: string;
  domain: NonNullable<NewBugFixAttempt["domain"]>;
  claimToken: string;
}): Promise<CreateClaimedBugFixAttemptResult> => {
  return db.transaction(async (tx) => {
    const feedbackRows = (await tx.execute(sql`
      SELECT
        ${feedbackItems.id} AS "id",
        ${feedbackItems.status} AS "status",
        ${feedbackItems.clusterId} AS "clusterId",
        ${feedbackItems.metadata} AS "metadata"
      FROM ${feedbackItems}
      WHERE ${feedbackItems.id} = ${args.feedbackItemId}
      FOR UPDATE
    `)) as unknown as Array<{
      id: string;
      status: string;
      clusterId: string | null;
      metadata: Record<string, unknown> | null;
    }>;

    const feedback = feedbackRows[0];

    if (!feedback) {
      return { success: false, reason: "feedback_not_found" };
    }

    if (feedback.status !== "new") {
      return { success: false, reason: "feedback_not_new" };
    }

    const claim = getBugFixClaim(feedback.metadata);
    if (!claim?.token) {
      return { success: false, reason: "claim_required" };
    }
    if (claim.token !== args.claimToken) {
      return { success: false, reason: "claim_mismatch" };
    }
    if (!claim.expiresAt || new Date(claim.expiresAt).getTime() <= Date.now()) {
      return { success: false, reason: "claim_expired" };
    }

    const activeFeedbackAttemptRows = (await tx.execute(sql`
      SELECT id
      FROM ${bugFixAttempts}
      WHERE ${bugFixAttempts.feedbackItemId} = ${args.feedbackItemId}
        AND ${bugFixAttempts.status} IN ('analyzing', 'proposed', 'implementing')
      LIMIT 1
    `)) as unknown as Array<{ id: string }>;

    const activeFeedbackAttempt = activeFeedbackAttemptRows[0];
    if (activeFeedbackAttempt) {
      return {
        success: false,
        reason: "active_attempt_exists",
        activeAttemptId: activeFeedbackAttempt.id,
      };
    }

    const clusterId = args.clusterId ?? feedback.clusterId ?? null;
    if (clusterId) {
      const activeClusterAttemptRows = (await tx.execute(sql`
        SELECT id
        FROM ${bugFixAttempts}
        WHERE ${bugFixAttempts.clusterId} = ${clusterId}
          AND ${bugFixAttempts.status} IN ('analyzing', 'proposed', 'implementing')
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;

      const activeClusterAttempt = activeClusterAttemptRows[0];
      if (activeClusterAttempt) {
        return {
          success: false,
          reason: "active_attempt_exists",
          activeAttemptId: activeClusterAttempt.id,
        };
      }
    }

    // Canonical retry budget (A-F-435 / A-F-389): count attempts PER CLUSTER
    // when a cluster is linked to this feedback item; fall back to
    // per-feedback-item counting only when the feedback lives outside any
    // cluster. Both anchors share the same cap so the "3 strikes" UX contract
    // is uniform.
    const budget = await computeClusterRetryBudget(tx, {
      clusterId,
      feedbackItemId: clusterId ? null : args.feedbackItemId,
    });
    if (budget.isExhausted) {
      return { success: false, reason: "max_attempts_reached", budget };
    }

    let attempt: BugFixAttempt | undefined;

    try {
      [attempt] = await tx
        .insert(bugFixAttempts)
        .values({
          feedbackItemId: args.feedbackItemId,
          clusterId,
          projectId: args.projectId,
          workspaceId: args.workspaceId,
          domain: args.domain,
          status: "analyzing",
          attemptNumber: budget.currentCount + 1,
        })
        .returning();
    } catch (error) {
      const violatedConstraint = getUniqueViolationConstraint(error);

      if (!isBugFixAttemptClaimConflictConstraint(violatedConstraint)) {
        throw error;
      }

      const conflictingAttemptRows = (await tx.execute(sql`
        SELECT id
        FROM ${bugFixAttempts}
        WHERE (
          ${bugFixAttempts.feedbackItemId} = ${args.feedbackItemId}
          OR (${clusterId} IS NOT NULL AND ${bugFixAttempts.clusterId} = ${clusterId})
        )
          AND ${bugFixAttempts.status} IN ('analyzing', 'proposed', 'implementing')
        ORDER BY ${bugFixAttempts.createdAt} DESC
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;

      const conflictingAttempt = conflictingAttemptRows[0];
      if (conflictingAttempt) {
        return {
          success: false,
          reason: "active_attempt_exists",
          activeAttemptId: conflictingAttempt.id,
        };
      }

      // Re-check the canonical retry budget after the race — another tx may
      // have inserted a fourth attempt between our pre-INSERT check and the
      // unique-violation landing here. Re-using the shared helper keeps the
      // "per cluster if set, else per feedback item" rule in one place.
      const refreshedBudget = await computeClusterRetryBudget(tx, {
        clusterId,
        feedbackItemId: clusterId ? null : args.feedbackItemId,
      });
      if (refreshedBudget.isExhausted) {
        return {
          success: false,
          reason: "max_attempts_reached",
          budget: refreshedBudget,
        };
      }

      return { success: false, reason: "active_attempt_exists" };
    }

    if (!attempt) {
      throw new Error("Failed to create bug fix attempt");
    }

    return { success: true, attempt };
  });
};

export const updateBugFixAttempt = async (
  id: string,
  data: Partial<
    Omit<NewBugFixAttempt, "id" | "createdAt" | "updatedAt" | "projectId" | "workspaceId" | "feedbackItemId">
  >
): Promise<BugFixAttempt | null> => {
  const [updated] = await db
    .update(bugFixAttempts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(bugFixAttempts.id, id))
    .returning();

  return updated ?? null;
};

const mergeWorkflowMetadata = (
  attempt: Pick<BugFixAttempt, "metadata">,
  next: BugFixAttemptWorkflowMetadata
): Record<string, unknown> => {
  const current =
    ((attempt.metadata ?? {}) as Record<string, unknown> &
      BugFixAttemptWorkflowMetadata) ?? {};

  const merged: Record<string, unknown> = {
    ...current,
    workflowGuards: {
      ...(current.workflowGuards ?? {}),
      ...(next.workflowGuards ?? {}),
    },
  };

  // Merge fingerprint if provided in next; existing fingerprint is overwritten
  if (next.fingerprint) {
    merged.fingerprint = next.fingerprint;
  }

  return merged;
};

export const recordBugFixAttemptErrorSearch = async (
  id: string,
  data: {
    query: string;
    area?: string;
    projectId?: string;
    resultCount: number;
    performedAt?: string;
  }
): Promise<BugFixAttempt | null> => {
  const attempt = await getBugFixAttemptById(id);
  if (!attempt) return null;

  return updateBugFixAttempt(id, {
    metadata: mergeWorkflowMetadata(attempt, {
      workflowGuards: {
        errorSearch: {
          performedAt: data.performedAt ?? new Date().toISOString(),
          query: data.query,
          area: data.area,
          projectId: data.projectId,
          resultCount: data.resultCount,
        },
      },
    }),
  });
};

export const recordBugFixAttemptErrorSave = async (
  id: string,
  data: {
    observationId: string;
    topicKey: string;
    area: string;
    projectId?: string;
    performedAt?: string;
  }
): Promise<BugFixAttempt | null> => {
  const attempt = await getBugFixAttemptById(id);
  if (!attempt) return null;

  return updateBugFixAttempt(id, {
    metadata: mergeWorkflowMetadata(attempt, {
      workflowGuards: {
        errorSave: {
          performedAt: data.performedAt ?? new Date().toISOString(),
          observationId: data.observationId,
          topicKey: data.topicKey,
          area: data.area,
          projectId: data.projectId,
        },
      },
    }),
  });
};

export const recordBugFixAttemptFingerprint = async (
  id: string,
  fingerprint: BugFixAttemptFingerprintData
): Promise<BugFixAttempt | null> => {
  const attempt = await getBugFixAttemptById(id);
  if (!attempt) return null;

  return updateBugFixAttempt(id, {
    metadata: mergeWorkflowMetadata(attempt, { fingerprint }),
  });
};

export const getLatestBugFixAttemptByFeedbackItemId = async (
  feedbackItemId: string
): Promise<BugFixAttempt | null> => {
  const [result] = await db
    .select()
    .from(bugFixAttempts)
    .where(eq(bugFixAttempts.feedbackItemId, feedbackItemId))
    .orderBy(desc(bugFixAttempts.attemptNumber), desc(bugFixAttempts.createdAt))
    .limit(1);

  return result ?? null;
};

export const getBugFixAttemptsByFixPrUrl = async (
  fixPrUrl: string
): Promise<BugFixAttempt[]> => {
  return db
    .select()
    .from(bugFixAttempts)
    .where(eq(bugFixAttempts.fixPrUrl, fixPrUrl))
    .orderBy(desc(bugFixAttempts.attemptNumber), desc(bugFixAttempts.createdAt));
};

export const getBugFixAttemptsByCluster = async (
  clusterId: string
): Promise<BugFixAttempt[]> => {
  return db
    .select()
    .from(bugFixAttempts)
    .where(eq(bugFixAttempts.clusterId, clusterId))
    .orderBy(bugFixAttempts.attemptNumber);
};

export const getFailedAttemptsByCluster = async (
  clusterId: string
): Promise<{ solutionProposed: string | null; failureReason: string | null }[]> => {
  return db
    .select({
      solutionProposed: bugFixAttempts.solutionProposed,
      failureReason: bugFixAttempts.failureReason,
    })
    .from(bugFixAttempts)
    .where(
      and(
        eq(bugFixAttempts.clusterId, clusterId),
        eq(bugFixAttempts.status, "failed")
      )
    )
    .orderBy(bugFixAttempts.attemptNumber);
};

export const getNextAttemptNumber = async (
  feedbackItemId: string
): Promise<number | null> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bugFixAttempts)
    .where(eq(bugFixAttempts.feedbackItemId, feedbackItemId));

  const currentCount = result?.count ?? 0;

  if (currentCount >= MAX_ATTEMPTS) {
    return null;
  }

  return currentCount + 1;
};

export const markAttemptAsFailed = async (
  id: string,
  reason: string,
  detectedBy: string
): Promise<BugFixAttempt | null> => {
  // Compare-and-swap: only transition attempts that are still active. A
  // separate reader (failActiveAttemptForCancelledJob, the timeout sweeper, or
  // an abort service) may have observed the attempt as active moments before,
  // but a concurrent PR-merge webhook / reconciler could flip it to `merged`
  // in between. Guarding the UPDATE on the active statuses makes this a no-op
  // when the row already reached a terminal state (`merged` / `failed`), so a
  // just-merged attempt is never clobbered back to `failed`. 0 rows updated ⇒
  // already terminal ⇒ return null.
  const [updated] = await db
    .update(bugFixAttempts)
    .set({
      status: "failed",
      failureReason: reason,
      failureDetectedBy: detectedBy,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bugFixAttempts.id, id),
        inArray(bugFixAttempts.status, [...ACTIVE_STATUSES])
      )
    )
    .returning();

  if (!updated) return null;

  // Hook 4: if the agent aborted before opening a PR (fixPrUrl is null) and
  // the cluster is still investigating, move the cluster back to `open` so
  // triage can retry or escalate. We import lazily to break the circular
  // dependency between the feedback-cluster-repository and this file (the
  // feedback-cluster-repository already depends on this module for the
  // BugFixAttemptWithPr type).
  if (updated.clusterId && !updated.fixPrUrl) {
    try {
      const { getFeedbackClusterById, transitionCluster } = await import(
        "../feedback/feedback-cluster-repository"
      );
      const cluster = await getFeedbackClusterById(updated.clusterId);
      if (cluster && cluster.status === "investigating") {
        await transitionCluster(updated.clusterId, "open", {
          triggeredByKind: detectedBy === "webhook" ? "webhook" : "agent",
          reason: "attempt_failed",
          triggeredByAttemptId: updated.id,
          metadata: {
            failureReason: reason,
            detectedBy,
          },
        });
      }
    } catch (clusterError) {
      // Best-effort: the attempt is already marked failed. Surface the error
      // via the lightweight console warning so we don't require a logger
      // dependency inside the database package.
      // eslint-disable-next-line no-console
      console.warn(
        `[markAttemptAsFailed] cluster auto-transition failed for attempt ${updated.id}: ${clusterError instanceof Error ? clusterError.message : String(clusterError)}`
      );
    }
  }

  return updated;
};

/**
 * Compare-and-swap merge write for the PR-merge path. Only flips an attempt to
 * `merged` when it is still active (`analyzing` / `proposed` / `implementing`).
 *
 * This is the symmetric guard to `markAttemptAsFailed`: the PR-merge webhook /
 * reconciler both SELECT the attempt (via `getBugFixAttemptsByFixPrUrl`) and
 * then write `merged` in a separate statement. Between the two, a competing
 * fail write (timeout sweeper, job-cancel cascade) may have moved the attempt
 * to a terminal `failed` state — e.g. a stale PR from an already-failed attempt
 * merging late. Guarding the UPDATE on the active statuses prevents that late
 * merge from resurrecting a dead attempt and re-triggering cluster resolution.
 *
 * Returns null when the attempt is no longer active (already `merged` — the
 * caller short-circuits that case separately — or already `failed`).
 */
export const markAttemptAsMergedIfActive = async (
  id: string
): Promise<BugFixAttempt | null> => {
  const [updated] = await db
    .update(bugFixAttempts)
    .set({
      status: "merged",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bugFixAttempts.id, id),
        inArray(bugFixAttempts.status, [...ACTIVE_STATUSES])
      )
    )
    .returning();

  return updated ?? null;
};

/**
 * Cascade helper for the job-cancel path: when an agent_jobs row transitions
 * to `cancelled` (via `cancelJob` or a runner-driven `updateJobStatus`), the
 * linked bug_fix_attempts row should transition to `failed` immediately so
 * downstream pipelines (feedback-bug-triage cron, cluster auto-transitions)
 * can react within minutes instead of waiting ~30 min for the zombie
 * sweeper to notice a stalled attempt.
 *
 * Behaviour:
 *   - Finds the attempt referenced by `agent_job_id = jobId` whose status is
 *     still active (`analyzing` / `proposed` / `implementing`).
 *   - Delegates to `markAttemptAsFailed` so the existing cluster-transition
 *     hook (open-on-abort) fires consistently with other failure paths.
 *   - Idempotent: returns `null` when the attempt is already terminal
 *     (`merged` / `failed`) or when the job is not linked to any attempt.
 */
export const failActiveAttemptForCancelledJob = async (
  jobId: string
): Promise<BugFixAttempt | null> => {
  const [candidate] = await db
    .select({ id: bugFixAttempts.id })
    .from(bugFixAttempts)
    .where(
      and(
        eq(bugFixAttempts.agentJobId, jobId),
        inArray(bugFixAttempts.status, [...ACTIVE_STATUSES])
      )
    )
    .limit(1);

  if (!candidate) return null;

  return markAttemptAsFailed(candidate.id, "job_cancelled", "job_cancel");
};

export const getActiveAttemptForCluster = async (
  clusterId: string
): Promise<BugFixAttempt | null> => {
  const [result] = await db
    .select()
    .from(bugFixAttempts)
    .where(
      and(
        eq(bugFixAttempts.clusterId, clusterId),
        inArray(bugFixAttempts.status, [...ACTIVE_STATUSES])
      )
    )
    .limit(1);

  return result ?? null;
};

/**
 * A-1931: find zombie bug-fix attempts — active (analyzing/proposed/implementing),
 * older than `timeoutMinutes`, and without a live agent_job. Used by the
 * investigation-timeout sweeper.
 *
 * Uses the partial index `bug_fix_attempts_active_created_at_idx` (A-1929).
 */
export const findZombieAttempts = async (
  timeoutMinutes: number,
  limit = 100
): Promise<BugFixAttempt[]> => {
  const rows = await db
    .select({ attempt: bugFixAttempts })
    .from(bugFixAttempts)
    .leftJoin(agentJobs, eq(bugFixAttempts.agentJobId, agentJobs.id))
    .where(
      and(
        inArray(bugFixAttempts.status, [...ACTIVE_STATUSES]),
        sql`${bugFixAttempts.createdAt} < NOW() - (${timeoutMinutes} || ' minutes')::interval`,
        or(
          isNull(agentJobs.id),
          sql`${agentJobs.status} NOT IN ('queued','running','finalizing','waiting_for_input','paused')`
        )
      )
    )
    .limit(limit);

  return rows.map((r) => r.attempt);
};

/**
 * Counts agent jobs related to bug analysis/fix that are currently active
 * (queued, running, finalizing, waiting_for_input, or paused).
 * Used by the orchestrator to enforce the MAX_CONCURRENT_BUG_JOBS limit.
 */
export const getActiveBugJobCount = async (): Promise<number> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentJobs)
    .where(
      and(
        or(
          eq(agentJobs.jobType, "bug-analysis" as typeof agentJobs.jobType.enumValues[number]),
          eq(agentJobs.jobType, "bug-fix" as typeof agentJobs.jobType.enumValues[number]),
        ),
        inArray(agentJobs.status, ["queued", "running", "finalizing", "waiting_for_input", "paused"]),
      )
    );

  return result?.count ?? 0;
};

/**
 * Returns all bug fix attempts for a feedback item, enriched with the
 * real-time PR state from the locally-synced github_pull_requests table.
 *
 * Join strategy: LEFT JOIN on html_url = fix_pr_url.
 * Using the full URL (not PR number) avoids ambiguity across repositories.
 *
 * pr is null when:
 *   - the attempt has no fixPrUrl yet, OR
 *   - the PR hasn't been synced from GitHub yet
 */
export const listBugFixAttemptsWithPrByFeedbackItem = async (
  feedbackItemId: string
): Promise<BugFixAttemptWithPr[]> => {
  const rows = await db
    .select({
      attempt: bugFixAttempts,
      prState: githubPullRequests.state,
      prReviewStatus: githubPullRequests.reviewStatus,
      prCiStatus: githubPullRequests.ciStatus,
      prMergedAt: githubPullRequests.mergedAt,
      prClosedAt: githubPullRequests.closedAt,
    })
    .from(bugFixAttempts)
    .leftJoin(
      githubPullRequests,
      eq(githubPullRequests.htmlUrl, bugFixAttempts.fixPrUrl)
    )
    .where(eq(bugFixAttempts.feedbackItemId, feedbackItemId))
    .orderBy(desc(bugFixAttempts.attemptNumber), desc(bugFixAttempts.createdAt));

  return rows.map((row) => ({
    ...row.attempt,
    pr:
      row.prState != null
        ? {
            state: row.prState,
            reviewStatus: row.prReviewStatus!,
            ciStatus: row.prCiStatus!,
            mergedAt: row.prMergedAt ?? null,
            closedAt: row.prClosedAt ?? null,
          }
        : null,
  }));
};

/**
 * Returns all bug fix attempts for a feedback cluster, enriched with the
 * real-time PR state from the locally-synced github_pull_requests table.
 *
 * Mirrors `listBugFixAttemptsWithPrByFeedbackItem` but filters by `clusterId`
 * instead of `feedbackItemId`. A bug_fix_attempt can target either a single
 * feedback item or an entire cluster (schema CHECK enforces at least one);
 * cluster-scoped attempts are what the cluster-detail modal needs.
 *
 * Join strategy: LEFT JOIN on html_url = fix_pr_url.
 * Using the full URL (not PR number) avoids ambiguity across repositories.
 *
 * pr is null when:
 *   - the attempt has no fixPrUrl yet, OR
 *   - the PR hasn't been synced from GitHub yet
 */
/**
 * Returns the feedback cluster associated with the most recent bug_fix_attempt
 * linked to the given agent job, or null if no attempt / cluster exists.
 *
 * Used by `GET /api/agent-jobs/:id` to hydrate the `cluster` relation so the
 * agent-job detail panel can show cluster context. A single JOIN + LIMIT 1
 * avoids N+1 and returns at most one row.
 */
export const findClusterByAgentJobId = async (
  jobId: string
): Promise<{ id: string; title: string } | null> => {
  const [row] = await db
    .select({
      id: feedbackClusters.id,
      title: feedbackClusters.title,
    })
    .from(bugFixAttempts)
    .innerJoin(
      feedbackClusters,
      eq(bugFixAttempts.clusterId, feedbackClusters.id)
    )
    .where(eq(bugFixAttempts.agentJobId, jobId))
    .orderBy(desc(bugFixAttempts.createdAt))
    .limit(1);

  return row ?? null;
};

export const listBugFixAttemptsWithPrByCluster = async (
  clusterId: string
): Promise<BugFixAttemptWithPr[]> => {
  const rows = await db
    .select({
      attempt: bugFixAttempts,
      prState: githubPullRequests.state,
      prReviewStatus: githubPullRequests.reviewStatus,
      prCiStatus: githubPullRequests.ciStatus,
      prMergedAt: githubPullRequests.mergedAt,
      prClosedAt: githubPullRequests.closedAt,
    })
    .from(bugFixAttempts)
    .leftJoin(
      githubPullRequests,
      eq(githubPullRequests.htmlUrl, bugFixAttempts.fixPrUrl)
    )
    .where(eq(bugFixAttempts.clusterId, clusterId))
    .orderBy(desc(bugFixAttempts.attemptNumber), desc(bugFixAttempts.createdAt));

  return rows.map((row) => ({
    ...row.attempt,
    pr:
      row.prState != null
        ? {
            state: row.prState,
            reviewStatus: row.prReviewStatus!,
            ciStatus: row.prCiStatus!,
            mergedAt: row.prMergedAt ?? null,
            closedAt: row.prClosedAt ?? null,
          }
        : null,
  }));
};

/**
 * Returns all bug fix attempts reachable from a feedback cluster via either:
 *   - the direct `bug_fix_attempts.cluster_id` link (modern path), OR
 *   - the legacy `bug_fix_attempts.feedback_item_id` link for attempts that
 *     pre-date cluster adoption (their cluster_id is NULL but the item now
 *     belongs to a cluster).
 *
 * Enriched with the real-time PR state from `github_pull_requests` via a
 * LEFT JOIN on `html_url = fix_pr_url` (same strategy as the by-cluster and
 * by-feedback-item variants — see A-F-389 / A-1910 context).
 *
 * A single `bug_fix_attempts` row can have both `cluster_id` and
 * `feedback_item_id` populated (current schema allows it); the OR filter
 * matches the row exactly once, so there is no duplication at the SQL layer.
 * The in-memory `byId` dedupe below is a belt-and-suspenders guard that also
 * preserves the DB `ORDER BY attemptNumber DESC, createdAt DESC` ordering.
 *
 * pr is null when:
 *   - the attempt has no fixPrUrl yet, OR
 *   - the PR hasn't been synced from GitHub yet.
 */
export const listBugFixAttemptsWithPrByClusterOrItems = async (
  clusterId: string,
  feedbackItemIds: string[]
): Promise<BugFixAttemptWithPr[]> => {
  const conditions = [eq(bugFixAttempts.clusterId, clusterId)];
  if (feedbackItemIds.length > 0) {
    conditions.push(inArray(bugFixAttempts.feedbackItemId, feedbackItemIds));
  }

  const rows = await db
    .select({
      attempt: bugFixAttempts,
      prState: githubPullRequests.state,
      prReviewStatus: githubPullRequests.reviewStatus,
      prCiStatus: githubPullRequests.ciStatus,
      prMergedAt: githubPullRequests.mergedAt,
      prClosedAt: githubPullRequests.closedAt,
    })
    .from(bugFixAttempts)
    .leftJoin(
      githubPullRequests,
      eq(githubPullRequests.htmlUrl, bugFixAttempts.fixPrUrl)
    )
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .orderBy(desc(bugFixAttempts.attemptNumber), desc(bugFixAttempts.createdAt));

  const byId = new Map<string, BugFixAttemptWithPr>();
  for (const row of rows) {
    if (byId.has(row.attempt.id)) continue;
    byId.set(row.attempt.id, {
      ...row.attempt,
      pr:
        row.prState != null
          ? {
              state: row.prState,
              reviewStatus: row.prReviewStatus!,
              ciStatus: row.prCiStatus!,
              mergedAt: row.prMergedAt ?? null,
              closedAt: row.prClosedAt ?? null,
            }
          : null,
    });
  }

  return Array.from(byId.values());
};
