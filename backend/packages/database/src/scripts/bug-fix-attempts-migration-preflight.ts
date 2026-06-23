export const BUG_FIX_ATTEMPTS_UNIQUENESS_MIGRATION_TAG =
  "0168_gray_lucky_pierre";

export const BUG_FIX_ATTEMPTS_FEEDBACK_DUPLICATE_REASON =
  "Auto-failed by migration preflight 0168: duplicate active attempt for the same feedback item.";

export const BUG_FIX_ATTEMPTS_CLUSTER_DUPLICATE_REASON =
  "Auto-failed by migration preflight 0168: duplicate active attempt for the same cluster.";

interface RowLike {
  [key: string]: unknown;
}

interface QueryResultLike<T extends RowLike> {
  rows?: T[];
}

export type QueryExecutor = (statement: string) => Promise<unknown>;

export type ExecuteInTransaction = <T>(
  callback: (execute: QueryExecutor) => Promise<T>
) => Promise<T>;

export interface BugFixAttemptPreflightSummary {
  targetMigrationTag: string;
  attemptNumberIssueGroups: number;
  feedbackActiveDuplicateGroups: number;
  clusterActiveDuplicateGroups: number;
  attemptNumbersRepaired: number;
  feedbackActiveAttemptsFailed: number;
  clusterActiveAttemptsFailed: number;
  hadRelevantIssues: boolean;
}

const ACTIVE_STATUSES_SQL = "('analyzing', 'proposed', 'implementing')";

const BUG_FIX_ATTEMPTS_TABLE_EXISTS_SQL = `
SELECT to_regclass('public.bug_fix_attempts') IS NOT NULL AS "exists";
`;

const PRECHECK_SQL = `
SELECT
  COALESCE((
    SELECT count(*)::int
    FROM (
      SELECT "feedback_item_id"
      FROM "bug_fix_attempts"
      GROUP BY "feedback_item_id"
      HAVING COUNT(*) <> COUNT(DISTINCT "attempt_number")
         OR COALESCE(MIN("attempt_number"), 0) <> 1
         OR COALESCE(MAX("attempt_number"), 0) <> COUNT(*)
    ) AS affected_feedback
  ), 0) AS "attemptNumberIssueGroups",
  COALESCE((
    SELECT count(*)::int
    FROM (
      SELECT "feedback_item_id"
      FROM "bug_fix_attempts"
      WHERE "status" IN ${ACTIVE_STATUSES_SQL}
      GROUP BY "feedback_item_id"
      HAVING COUNT(*) > 1
    ) AS duplicate_feedback
  ), 0) AS "feedbackActiveDuplicateGroups",
  COALESCE((
    SELECT count(*)::int
    FROM (
      SELECT "cluster_id"
      FROM "bug_fix_attempts"
      WHERE "cluster_id" IS NOT NULL
        AND "status" IN ${ACTIVE_STATUSES_SQL}
      GROUP BY "cluster_id"
      HAVING COUNT(*) > 1
    ) AS duplicate_cluster
  ), 0) AS "clusterActiveDuplicateGroups";
`;

const RESEQUENCE_ATTEMPT_NUMBERS_SQL = `
WITH affected_feedback AS (
  SELECT "feedback_item_id"
  FROM "bug_fix_attempts"
  GROUP BY "feedback_item_id"
  HAVING COUNT(*) <> COUNT(DISTINCT "attempt_number")
     OR COALESCE(MIN("attempt_number"), 0) <> 1
     OR COALESCE(MAX("attempt_number"), 0) <> COUNT(*)
),
ranked_attempts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "feedback_item_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS "new_attempt_number"
  FROM "bug_fix_attempts"
  WHERE "feedback_item_id" IN (SELECT "feedback_item_id" FROM affected_feedback)
),
updated_attempts AS (
  UPDATE "bug_fix_attempts" AS "attempts"
  SET "attempt_number" = "ranked_attempts"."new_attempt_number"
  FROM ranked_attempts
  WHERE "attempts"."id" = "ranked_attempts"."id"
    AND "attempts"."attempt_number" IS DISTINCT FROM "ranked_attempts"."new_attempt_number"
  RETURNING 1
)
SELECT COUNT(*)::int AS "repaired" FROM updated_attempts;
`;

const FAIL_DUPLICATE_ACTIVE_BY_FEEDBACK_SQL = `
WITH ranked_active_attempts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "feedback_item_id"
      ORDER BY
        CASE "status"
          WHEN 'implementing' THEN 3
          WHEN 'proposed' THEN 2
          WHEN 'analyzing' THEN 1
          ELSE 0
        END DESC,
        "updated_at" DESC,
        "created_at" DESC,
        "attempt_number" DESC,
        "id" DESC
    ) AS "active_rank"
  FROM "bug_fix_attempts"
  WHERE "status" IN ${ACTIVE_STATUSES_SQL}
),
failed_duplicates AS (
  UPDATE "bug_fix_attempts" AS "attempts"
  SET
    "status" = 'failed',
    "failure_reason" = COALESCE(
      "attempts"."failure_reason",
      '${BUG_FIX_ATTEMPTS_FEEDBACK_DUPLICATE_REASON}'
    ),
    "failure_detected_by" = COALESCE("attempts"."failure_detected_by", 'system'),
    "updated_at" = NOW()
  FROM ranked_active_attempts
  WHERE "attempts"."id" = ranked_active_attempts."id"
    AND ranked_active_attempts."active_rank" > 1
  RETURNING 1
)
SELECT COUNT(*)::int AS "failedCount" FROM failed_duplicates;
`;

const FAIL_DUPLICATE_ACTIVE_BY_CLUSTER_SQL = `
WITH ranked_cluster_attempts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "cluster_id"
      ORDER BY
        CASE "status"
          WHEN 'implementing' THEN 3
          WHEN 'proposed' THEN 2
          WHEN 'analyzing' THEN 1
          ELSE 0
        END DESC,
        "updated_at" DESC,
        "created_at" DESC,
        "attempt_number" DESC,
        "id" DESC
    ) AS "cluster_rank"
  FROM "bug_fix_attempts"
  WHERE "cluster_id" IS NOT NULL
    AND "status" IN ${ACTIVE_STATUSES_SQL}
),
failed_duplicates AS (
  UPDATE "bug_fix_attempts" AS "attempts"
  SET
    "status" = 'failed',
    "failure_reason" = COALESCE(
      "attempts"."failure_reason",
      '${BUG_FIX_ATTEMPTS_CLUSTER_DUPLICATE_REASON}'
    ),
    "failure_detected_by" = COALESCE("attempts"."failure_detected_by", 'system'),
    "updated_at" = NOW()
  FROM ranked_cluster_attempts
  WHERE "attempts"."id" = ranked_cluster_attempts."id"
    AND ranked_cluster_attempts."cluster_rank" > 1
  RETURNING 1
)
SELECT COUNT(*)::int AS "failedCount" FROM failed_duplicates;
`;

const getRows = <T extends RowLike>(result: unknown): T[] => {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as QueryResultLike<T>).rows)
  ) {
    return (result as QueryResultLike<T>).rows ?? [];
  }

  return [];
};

const toInt = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

export const shouldRunBugFixAttemptPreflight = (
  pendingMigrationTags: string[]
): boolean => pendingMigrationTags.includes(BUG_FIX_ATTEMPTS_UNIQUENESS_MIGRATION_TAG);

export const runBugFixAttemptUniquenessPreflight = async (
  execute: QueryExecutor
): Promise<BugFixAttemptPreflightSummary> => {
  const [before] = getRows<{
    attemptNumberIssueGroups: unknown;
    feedbackActiveDuplicateGroups: unknown;
    clusterActiveDuplicateGroups: unknown;
  }>(await execute(PRECHECK_SQL));

  const attemptNumberIssueGroups = toInt(before?.attemptNumberIssueGroups);
  const feedbackActiveDuplicateGroups = toInt(before?.feedbackActiveDuplicateGroups);
  const clusterActiveDuplicateGroups = toInt(before?.clusterActiveDuplicateGroups);

  const [attemptRepair] = getRows<{ repaired: unknown }>(
    await execute(RESEQUENCE_ATTEMPT_NUMBERS_SQL)
  );
  const [feedbackRepair] = getRows<{ failedCount: unknown }>(
    await execute(FAIL_DUPLICATE_ACTIVE_BY_FEEDBACK_SQL)
  );
  const [clusterRepair] = getRows<{ failedCount: unknown }>(
    await execute(FAIL_DUPLICATE_ACTIVE_BY_CLUSTER_SQL)
  );

  return {
    targetMigrationTag: BUG_FIX_ATTEMPTS_UNIQUENESS_MIGRATION_TAG,
    attemptNumberIssueGroups,
    feedbackActiveDuplicateGroups,
    clusterActiveDuplicateGroups,
    attemptNumbersRepaired: toInt(attemptRepair?.repaired),
    feedbackActiveAttemptsFailed: toInt(feedbackRepair?.failedCount),
    clusterActiveAttemptsFailed: toInt(clusterRepair?.failedCount),
    hadRelevantIssues:
      attemptNumberIssueGroups > 0 ||
      feedbackActiveDuplicateGroups > 0 ||
      clusterActiveDuplicateGroups > 0,
  };
};

export const maybeRunBugFixAttemptPreflight = async (args: {
  pendingMigrationTags: string[];
  executeInTransaction: ExecuteInTransaction;
  log?: (message: string) => void;
}): Promise<BugFixAttemptPreflightSummary | null> => {
  if (!shouldRunBugFixAttemptPreflight(args.pendingMigrationTags)) {
    return null;
  }

  const log = args.log ?? (() => undefined);

  return args.executeInTransaction(async (execute) => {
    const [tableRow] = getRows<{ exists: unknown }>(
      await execute(BUG_FIX_ATTEMPTS_TABLE_EXISTS_SQL)
    );

    if (!tableRow?.exists) {
      log(
        "↪️  Skipping bug_fix_attempts preflight for 0168 because the table does not exist yet."
      );
      return null;
    }

    log("🧹 Running bug_fix_attempts preflight for migration 0168...");

    const summary = await runBugFixAttemptUniquenessPreflight(execute);

    if (!summary.hadRelevantIssues) {
      log("   ↪️ No bug_fix_attempts duplicates detected.");
      return summary;
    }

    log(
      `   ↪️ Attempt-number issue groups: ${summary.attemptNumberIssueGroups} (rows repaired: ${summary.attemptNumbersRepaired})`
    );
    log(
      `   ↪️ Duplicate active feedback groups: ${summary.feedbackActiveDuplicateGroups} (rows failed: ${summary.feedbackActiveAttemptsFailed})`
    );
    log(
      `   ↪️ Duplicate active cluster groups: ${summary.clusterActiveDuplicateGroups} (rows failed: ${summary.clusterActiveAttemptsFailed})`
    );

    return summary;
  });
};
