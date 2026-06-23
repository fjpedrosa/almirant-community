/**
 * A-F-435 — Feedback cluster retry-budget drift normalizer (task A-1873).
 *
 * Companion / "apply" side of the read-only auditor
 * `audit-feedback-cluster-retry-drift.ts` (task A-1872). This script performs a
 * safe, idempotent backfill that re-points `bug_fix_attempts` rows to the
 * primary feedback item of their cluster so the canonical retry budget can be
 * enforced without miscounting.
 *
 * Canonical rule (A-1871 / A-F-435):
 *   Retry budget = 3 per cluster when a `bug_fix_attempts.cluster_id` is set.
 *   Fallback per-feedbackItem only applies when `cluster_id IS NULL`.
 *
 * What this script does
 * ---------------------
 * For each cluster with at least one bug-fix attempt (optionally narrowed by
 * `--cluster-id` and/or `--project-id`), it:
 *   1. Recomputes the audit classification inline (no dependency on the
 *      audit script at `audit-feedback-cluster-retry-drift.ts`).
 *   2. Picks the *primary* feedback item for the cluster (oldest feedback
 *      item linked to that cluster by `created_at`, with `id` as tie-breaker).
 *   3. Inside a per-cluster transaction, SELECTs all cluster-scoped attempts
 *      FOR UPDATE.
 *   4. For every attempt whose `feedback_item_id` differs from the primary
 *      (but whose `cluster_id` is non-null), merges the previous value into
 *      `metadata.legacyFeedbackItemId` and UPDATEs `feedback_item_id` to the
 *      primary, bumping `updated_at`.
 *   5. For clusters classified `OVER_CANONICAL_LIMIT` (more than 3 cluster
 *      attempts), the repair is skipped by default (honoring `--skip-overflow`)
 *      and only surfaced in the report, because capping requires product
 *      decisions beyond this drift repair.
 *   6. Emits a per-cluster result row describing what was repaired/skipped,
 *      including before/after counts.
 *
 * Safety properties
 * -----------------
 *   - **Dry-run by default.** Writes require both `--apply` and the
 *     `APPLY_I_UNDERSTAND_THIS_MUTATES=yes` environment variable.
 *   - **Per-cluster transactions.** If one cluster fails, the error is
 *     reported and the script keeps going with the next cluster.
 *   - **Idempotent.** Re-pointing to the same `feedback_item_id` is a no-op
 *     (compare-and-skip). Re-running the script against already-repaired
 *     clusters reports 0 repaired rows.
 *   - **No schema changes.** No migrations are created or applied.
 *   - **Respects uniqueness guards.** Repairs only touch `feedback_item_id`
 *     and `metadata`; `cluster_id` is preserved so the cluster-active and
 *     cluster-attempt-number unique indexes stay consistent.
 *   - **Exit 0 on clean run.** Even when drift is detected and reported,
 *     the script exits 0 as long as it ran without runtime errors.
 *
 * How to run
 * ----------
 *   # Dry-run (default, no writes):
 *   bun run backend/packages/database/src/scripts/normalize-feedback-cluster-retry-drift.ts
 *
 *   # JSON output (machine-readable, logs to stderr):
 *   bun run backend/packages/database/src/scripts/normalize-feedback-cluster-retry-drift.ts --json
 *
 *   # Narrow to specific clusters and/or a single project (dry-run):
 *   bun run backend/packages/database/src/scripts/normalize-feedback-cluster-retry-drift.ts \
 *     --cluster-id=<uuid> --cluster-id=<uuid> --project-id=<uuid>
 *
 *   # APPLY (writes) — requires environment acknowledgement:
 *   APPLY_I_UNDERSTAND_THIS_MUTATES=yes \
 *     bun run backend/packages/database/src/scripts/normalize-feedback-cluster-retry-drift.ts --apply
 *
 * CLI flags
 * ---------
 *   --dry-run                  Default. No writes. Mutually exclusive with --apply.
 *   --apply                    Perform mutations. Requires
 *                              `APPLY_I_UNDERSTAND_THIS_MUTATES=yes`.
 *   --cluster-id=<uuid>        Repeatable or comma-separated list of cluster UUIDs.
 *   --project-id=<uuid>        Narrow to a single project.
 *   --json                     Emit machine-readable JSON on stdout. Logs go to stderr.
 *   --skip-overflow            Default true. Skip `OVER_CANONICAL_LIMIT` clusters
 *                              (more than 3 attempts on the cluster).
 *   --no-skip-overflow         Also repair feedback_item_id pointers on overflow
 *                              clusters (still does NOT cap or fail attempts).
 *   --help, -h                 Print usage and exit 0.
 */

import { db, closeConnections } from "../client";
import { sql } from "drizzle-orm";
import {
  bugFixAttempts,
  feedbackClusters,
  feedbackItems,
} from "../schema";

// Keep in sync with A-1871 and the audit script (A-1872).
const CANONICAL_MAX_ATTEMPTS_PER_CLUSTER = 3;

// Env acknowledgement required to enable mutations.
const APPLY_ENV_VAR = "APPLY_I_UNDERSTAND_THIS_MUTATES";
const APPLY_ENV_EXPECTED = "yes";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DriftClassification =
  | "OVER_CANONICAL_LIMIT"
  | "PRIMARY_ITEM_INFLATED"
  | "PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT"
  | "CLEAN";

interface CliOptions {
  clusterIds: string[] | null;
  projectId: string | null;
  json: boolean;
  dryRun: boolean;
  apply: boolean;
  skipOverflow: boolean;
}

interface AuditRow {
  clusterId: string;
  clusterStatus: string;
  primaryFeedbackItemId: string | null;
  primaryFeedbackItemCreatedAt: string | null;
  attemptsByCluster: number;
  attemptsByPrimaryItem: number;
  distinctFeedbackItemIds: string[];
  classification: DriftClassification;
}

interface RepairResult {
  clusterId: string;
  classification: DriftClassification;
  action: "repaired" | "skipped" | "clean" | "error";
  reason: string | null;
  primaryFeedbackItemId: string | null;
  before: {
    attemptsByCluster: number;
    attemptsByPrimaryItem: number;
    distinctFeedbackItemIdsCount: number;
  };
  after: {
    attemptsByCluster: number;
    attemptsByPrimaryItem: number;
    distinctFeedbackItemIdsCount: number;
  };
  repaired: number;
  skipped: number;
  error: string | null;
}

const USAGE = `Usage: bun run backend/packages/database/src/scripts/normalize-feedback-cluster-retry-drift.ts [options]

Options:
  --dry-run               Default. No writes. Mutually exclusive with --apply.
  --apply                 Perform mutations. Requires env ${APPLY_ENV_VAR}=${APPLY_ENV_EXPECTED}.
  --cluster-id=<uuid>     Repeatable or comma-separated list of cluster UUIDs.
  --project-id=<uuid>     Narrow to a single project.
  --json                  Machine-readable JSON to stdout (logs on stderr).
  --skip-overflow         Default true. Skip OVER_CANONICAL_LIMIT clusters.
  --no-skip-overflow      Also repair feedback_item_id pointers on overflow clusters.
  --help, -h              Print this message and exit.
`;

const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    clusterIds: null,
    projectId: null,
    json: false,
    dryRun: true,
    apply: false,
    skipOverflow: true,
  };

  const clusterIdsAcc: string[] = [];

  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (raw === "--json") {
      options.json = true;
    } else if (raw === "--dry-run") {
      options.dryRun = true;
      options.apply = false;
    } else if (raw === "--apply") {
      options.apply = true;
      options.dryRun = false;
    } else if (raw === "--skip-overflow") {
      options.skipOverflow = true;
    } else if (raw === "--no-skip-overflow") {
      options.skipOverflow = false;
    } else if (raw.startsWith("--cluster-id=")) {
      const value = raw.slice("--cluster-id=".length);
      for (const part of value.split(",")) {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          clusterIdsAcc.push(trimmed);
        }
      }
    } else if (raw.startsWith("--project-id=")) {
      const value = raw.slice("--project-id=".length).trim();
      if (value.length > 0) {
        options.projectId = value;
      }
    } else if (raw.length > 0) {
      process.stderr.write(`Unknown argument: ${raw}\n${USAGE}`);
      process.exit(1);
    }
  }

  if (clusterIdsAcc.length > 0) {
    const invalid = clusterIdsAcc.filter((id) => !UUID_PATTERN.test(id));
    if (invalid.length > 0) {
      process.stderr.write(
        `Invalid --cluster-id values (expected UUID): ${invalid.join(", ")}\n`
      );
      process.exit(1);
    }
    options.clusterIds = clusterIdsAcc;
  }

  if (options.projectId && !UUID_PATTERN.test(options.projectId)) {
    process.stderr.write(
      `Invalid --project-id value (expected UUID): ${options.projectId}\n`
    );
    process.exit(1);
  }

  return options;
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

const toStringOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (item === null || item === undefined) continue;
    out.push(typeof item === "string" ? item : String(item));
  }
  return out;
};

const classify = (args: {
  attemptsByCluster: number;
  attemptsByPrimaryItem: number;
}): DriftClassification => {
  if (args.attemptsByCluster > CANONICAL_MAX_ATTEMPTS_PER_CLUSTER) {
    return "OVER_CANONICAL_LIMIT";
  }
  if (args.attemptsByPrimaryItem > args.attemptsByCluster) {
    return "PRIMARY_ITEM_INFLATED";
  }
  if (
    args.attemptsByPrimaryItem >= CANONICAL_MAX_ATTEMPTS_PER_CLUSTER &&
    args.attemptsByCluster < CANONICAL_MAX_ATTEMPTS_PER_CLUSTER
  ) {
    return "PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT";
  }
  return "CLEAN";
};

/**
 * Build the minimal candidate-cluster audit set. Inlined here — we do NOT
 * import the audit script, which is owned by A-1872. Any divergence between
 * this query and the audit query should be reconciled by matching the
 * canonical rule in A-1871, not by coupling the scripts.
 */
const loadAuditRows = async (options: CliOptions): Promise<AuditRow[]> => {
  const narrowByProjectId = options.projectId
    ? sql`AND bfa."project_id" = ${options.projectId}::uuid`
    : sql``;

  const candidateClusterFilter =
    options.clusterIds && options.clusterIds.length > 0
      ? sql`fc."id" IN (${sql.join(
          options.clusterIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})`
      : sql`EXISTS (
          SELECT 1 FROM "bug_fix_attempts" bfa2
          WHERE bfa2."cluster_id" = fc."id"
            ${options.projectId ? sql`AND bfa2."project_id" = ${options.projectId}::uuid` : sql``}
        )`;

  const result = await db.execute(sql`
    WITH candidate_clusters AS (
      SELECT
        fc."id"           AS cluster_id,
        fc."status"::text AS cluster_status
      FROM "feedback_clusters" fc
      WHERE ${candidateClusterFilter}
    ),
    per_cluster_attempts AS (
      SELECT
        bfa."cluster_id"                                         AS cluster_id,
        COUNT(*)::int                                            AS attempts_by_cluster,
        ARRAY_AGG(DISTINCT bfa."feedback_item_id"::text)
          FILTER (WHERE bfa."feedback_item_id" IS NOT NULL)      AS distinct_feedback_item_ids
      FROM "bug_fix_attempts" bfa
      WHERE bfa."cluster_id" IS NOT NULL
        ${narrowByProjectId}
      GROUP BY bfa."cluster_id"
    ),
    primary_item AS (
      SELECT DISTINCT ON (fi."cluster_id")
        fi."cluster_id" AS cluster_id,
        fi."id"         AS primary_feedback_item_id,
        fi."created_at" AS primary_feedback_item_created_at
      FROM "feedback_items" fi
      WHERE fi."cluster_id" IS NOT NULL
      ORDER BY fi."cluster_id", fi."created_at" ASC, fi."id" ASC
    ),
    per_primary_attempts AS (
      SELECT
        pi.cluster_id                  AS cluster_id,
        COUNT(bfa."id")::int           AS attempts_by_primary_item
      FROM primary_item pi
      LEFT JOIN "bug_fix_attempts" bfa
        ON bfa."feedback_item_id" = pi.primary_feedback_item_id
      GROUP BY pi.cluster_id
    )
    SELECT
      cc.cluster_id::text                                      AS "clusterId",
      cc.cluster_status                                        AS "clusterStatus",
      pi.primary_feedback_item_id::text                        AS "primaryFeedbackItemId",
      pi.primary_feedback_item_created_at                      AS "primaryFeedbackItemCreatedAt",
      COALESCE(pca.attempts_by_cluster, 0)                     AS "attemptsByCluster",
      COALESCE(ppa.attempts_by_primary_item, 0)                AS "attemptsByPrimaryItem",
      COALESCE(pca.distinct_feedback_item_ids, ARRAY[]::text[]) AS "distinctFeedbackItemIds"
    FROM candidate_clusters cc
    LEFT JOIN per_cluster_attempts pca ON pca.cluster_id = cc.cluster_id
    LEFT JOIN primary_item pi          ON pi.cluster_id = cc.cluster_id
    LEFT JOIN per_primary_attempts ppa ON ppa.cluster_id = cc.cluster_id
    ORDER BY
      COALESCE(pca.attempts_by_cluster, 0) DESC,
      cc.cluster_id ASC
  `);

  const rawRows: Array<Record<string, unknown>> = Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : Array.isArray((result as { rows?: unknown }).rows)
      ? ((result as { rows: Array<Record<string, unknown>> }).rows)
      : [];

  return rawRows.map((row): AuditRow => {
    const attemptsByCluster = toInt(row.attemptsByCluster);
    const attemptsByPrimaryItem = toInt(row.attemptsByPrimaryItem);
    return {
      clusterId: toStringOrNull(row.clusterId) ?? "",
      clusterStatus: toStringOrNull(row.clusterStatus) ?? "",
      primaryFeedbackItemId: toStringOrNull(row.primaryFeedbackItemId),
      primaryFeedbackItemCreatedAt: toStringOrNull(row.primaryFeedbackItemCreatedAt),
      attemptsByCluster,
      attemptsByPrimaryItem,
      distinctFeedbackItemIds: toStringArray(row.distinctFeedbackItemIds),
      classification: classify({ attemptsByCluster, attemptsByPrimaryItem }),
    };
  });
};

/**
 * Recompute the attempts-by-cluster / attempts-by-primary-item counters for a
 * single cluster after the repair. Used to populate `after.*` in the result.
 */
const recomputeClusterCounters = async (
  clusterId: string,
  primaryFeedbackItemId: string | null
): Promise<{
  attemptsByCluster: number;
  attemptsByPrimaryItem: number;
  distinctFeedbackItemIdsCount: number;
}> => {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "attemptsByCluster",
      COUNT(*) FILTER (
        WHERE "feedback_item_id" = ${primaryFeedbackItemId}::uuid
      )::int AS "attemptsByPrimaryItem",
      COUNT(DISTINCT "feedback_item_id")::int AS "distinctFeedbackItemIdsCount"
    FROM "bug_fix_attempts"
    WHERE "cluster_id" = ${clusterId}::uuid
  `);

  const rows: Array<Record<string, unknown>> = Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : Array.isArray((result as { rows?: unknown }).rows)
      ? ((result as { rows: Array<Record<string, unknown>> }).rows)
      : [];

  const row = rows[0] ?? {};
  return {
    attemptsByCluster: toInt(row.attemptsByCluster),
    attemptsByPrimaryItem: toInt(row.attemptsByPrimaryItem),
    distinctFeedbackItemIdsCount: toInt(row.distinctFeedbackItemIdsCount),
  };
};

/**
 * Repair algorithm for a single cluster, executed inside its own transaction.
 *
 * Steps:
 *   1. SELECT current primary feedback item (oldest in cluster).
 *   2. SELECT FOR UPDATE all bug_fix_attempts WHERE cluster_id = C.
 *   3. For each attempt with feedback_item_id != primary (and cluster_id NOT NULL):
 *      - merge metadata.legacyFeedbackItemId = oldFeedbackItemId (JSON merge)
 *      - UPDATE feedback_item_id = primaryId, updated_at = NOW()
 *   4. No-op when feedback_item_id already matches primary.
 */
const repairClusterInTransaction = async (args: {
  clusterId: string;
  dryRun: boolean;
}): Promise<{
  primaryFeedbackItemId: string | null;
  repaired: number;
  noopMatches: number;
}> => {
  return db.transaction(async (tx) => {
    // Step 1: look up the primary feedback item.
    const primaryResult = await tx.execute(sql`
      SELECT fi."id"::text AS "primaryId"
      FROM "feedback_items" fi
      WHERE fi."cluster_id" = ${args.clusterId}::uuid
      ORDER BY fi."created_at" ASC, fi."id" ASC
      LIMIT 1
    `);

    const primaryRows: Array<Record<string, unknown>> = Array.isArray(primaryResult)
      ? (primaryResult as Array<Record<string, unknown>>)
      : Array.isArray((primaryResult as { rows?: unknown }).rows)
        ? ((primaryResult as { rows: Array<Record<string, unknown>> }).rows)
        : [];

    const primaryId = toStringOrNull(primaryRows[0]?.primaryId);

    if (!primaryId) {
      // No feedback item linked to this cluster — cannot repair.
      return { primaryFeedbackItemId: null, repaired: 0, noopMatches: 0 };
    }

    // Step 2: lock cluster-scoped attempts.
    const attemptsResult = await tx.execute(sql`
      SELECT
        bfa."id"::text AS "attemptId",
        bfa."feedback_item_id"::text AS "feedbackItemId"
      FROM "bug_fix_attempts" bfa
      WHERE bfa."cluster_id" = ${args.clusterId}::uuid
      ORDER BY bfa."created_at" ASC, bfa."id" ASC
      FOR UPDATE
    `);

    const attemptRows: Array<Record<string, unknown>> = Array.isArray(attemptsResult)
      ? (attemptsResult as Array<Record<string, unknown>>)
      : Array.isArray((attemptsResult as { rows?: unknown }).rows)
        ? ((attemptsResult as { rows: Array<Record<string, unknown>> }).rows)
        : [];

    let repaired = 0;
    let noopMatches = 0;

    for (const attempt of attemptRows) {
      const attemptId = toStringOrNull(attempt.attemptId);
      const currentFeedbackItemId = toStringOrNull(attempt.feedbackItemId);

      if (!attemptId) {
        continue;
      }

      // Step 4 (idempotency): skip attempts already pointing at the primary.
      if (currentFeedbackItemId === primaryId) {
        noopMatches += 1;
        continue;
      }

      if (args.dryRun) {
        // Count what *would* be repaired without mutating.
        repaired += 1;
        continue;
      }

      // Step 3: JSON-merge metadata.legacyFeedbackItemId and re-point.
      await tx.execute(sql`
        UPDATE "bug_fix_attempts"
        SET
          "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
            'legacyFeedbackItemId', ${currentFeedbackItemId}::text
          ),
          "feedback_item_id" = ${primaryId}::uuid,
          "updated_at" = NOW()
        WHERE "id" = ${attemptId}::uuid
      `);

      repaired += 1;
    }

    return { primaryFeedbackItemId: primaryId, repaired, noopMatches };
  });
};

/**
 * For OVER_CANONICAL_LIMIT clusters, emit a diagnostic-only repair that
 * re-points feedback_item_id (when --no-skip-overflow is set) but never caps
 * or fails attempts. Defaults to --skip-overflow=true, which surfaces these
 * clusters in the report with action="skipped".
 */
const processCluster = async (args: {
  row: AuditRow;
  options: CliOptions;
}): Promise<RepairResult> => {
  const { row, options } = args;

  const baseBefore = {
    attemptsByCluster: row.attemptsByCluster,
    attemptsByPrimaryItem: row.attemptsByPrimaryItem,
    distinctFeedbackItemIdsCount: row.distinctFeedbackItemIds.length,
  };

  if (row.classification === "CLEAN") {
    return {
      clusterId: row.clusterId,
      classification: row.classification,
      action: "clean",
      reason: "no drift detected",
      primaryFeedbackItemId: row.primaryFeedbackItemId,
      before: baseBefore,
      after: baseBefore,
      repaired: 0,
      skipped: 0,
      error: null,
    };
  }

  if (row.classification === "OVER_CANONICAL_LIMIT" && options.skipOverflow) {
    return {
      clusterId: row.clusterId,
      classification: row.classification,
      action: "skipped",
      reason:
        "cluster exceeds canonical retry budget; requires product decision before repair",
      primaryFeedbackItemId: row.primaryFeedbackItemId,
      before: baseBefore,
      after: baseBefore,
      repaired: 0,
      skipped: row.attemptsByCluster,
      error: null,
    };
  }

  try {
    const repairSummary = await repairClusterInTransaction({
      clusterId: row.clusterId,
      dryRun: options.dryRun,
    });

    const after = options.dryRun
      ? baseBefore
      : await recomputeClusterCounters(
          row.clusterId,
          repairSummary.primaryFeedbackItemId
        );

    return {
      clusterId: row.clusterId,
      classification: row.classification,
      action: repairSummary.repaired > 0 ? "repaired" : "clean",
      reason:
        repairSummary.primaryFeedbackItemId === null
          ? "no primary feedback item linked to cluster"
          : repairSummary.repaired === 0
            ? "all attempts already point at the primary feedback item"
            : options.dryRun
              ? "dry-run: attempts would be re-pointed to the primary feedback item"
              : "attempts re-pointed to the primary feedback item",
      primaryFeedbackItemId: repairSummary.primaryFeedbackItemId,
      before: baseBefore,
      after,
      repaired: repairSummary.repaired,
      skipped: 0,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return {
      clusterId: row.clusterId,
      classification: row.classification,
      action: "error",
      reason: "transaction failed; see error",
      primaryFeedbackItemId: row.primaryFeedbackItemId,
      before: baseBefore,
      after: baseBefore,
      repaired: 0,
      skipped: 0,
      error: message,
    };
  }
};

interface Summary {
  totalAudited: number;
  byClassification: Record<DriftClassification, number>;
  repairedClusters: number;
  repairedAttempts: number;
  skippedClusters: number;
  errorClusters: number;
  mode: "dry-run" | "apply";
}

const buildSummary = (
  results: RepairResult[],
  rows: AuditRow[],
  options: CliOptions
): Summary => {
  const summary: Summary = {
    totalAudited: rows.length,
    byClassification: {
      OVER_CANONICAL_LIMIT: 0,
      PRIMARY_ITEM_INFLATED: 0,
      PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT: 0,
      CLEAN: 0,
    },
    repairedClusters: 0,
    repairedAttempts: 0,
    skippedClusters: 0,
    errorClusters: 0,
    mode: options.apply ? "apply" : "dry-run",
  };

  for (const row of rows) {
    summary.byClassification[row.classification] += 1;
  }

  for (const result of results) {
    if (result.action === "repaired") {
      summary.repairedClusters += 1;
      summary.repairedAttempts += result.repaired;
    } else if (result.action === "skipped") {
      summary.skippedClusters += 1;
    } else if (result.action === "error") {
      summary.errorClusters += 1;
    }
  }

  return summary;
};

const printHumanReport = (args: {
  results: RepairResult[];
  rows: AuditRow[];
  options: CliOptions;
  summary: Summary;
  log: (message: string) => void;
}): void => {
  const { results, options, summary, log } = args;

  log("=== A-F-435 cluster retry-budget drift normalizer ===");
  log(
    `Mode: ${summary.mode} | canonical max attempts per cluster: ${CANONICAL_MAX_ATTEMPTS_PER_CLUSTER} | skipOverflow: ${options.skipOverflow}`
  );
  if (options.projectId) log(`Project filter: ${options.projectId}`);
  if (options.clusterIds && options.clusterIds.length > 0) {
    log(`Cluster filter: ${options.clusterIds.join(", ")}`);
  }
  log("");

  if (results.length === 0) {
    log("(no candidate clusters to process)");
  }

  log(
    `cluster                                 classification                          action    repaired  skipped   before(c/p/d)   after(c/p/d)`
  );
  log(
    `--------------------------------------  --------------------------------------  --------  --------  --------  --------------  --------------`
  );
  for (const result of results) {
    const before = `${result.before.attemptsByCluster}/${result.before.attemptsByPrimaryItem}/${result.before.distinctFeedbackItemIdsCount}`;
    const after = `${result.after.attemptsByCluster}/${result.after.attemptsByPrimaryItem}/${result.after.distinctFeedbackItemIdsCount}`;
    log(
      [
        result.clusterId.padEnd(38),
        result.classification.padEnd(38),
        result.action.padEnd(8),
        String(result.repaired).padEnd(8),
        String(result.skipped).padEnd(8),
        before.padEnd(14),
        after.padEnd(14),
      ].join("  ")
    );
    if (result.error) {
      log(`    error: ${result.error}`);
    } else if (result.reason) {
      log(`    reason: ${result.reason}`);
    }
  }
  log("");

  const clazz = summary.byClassification;
  log(
    `${summary.totalAudited} clusters audited | ${clazz.CLEAN} clean, ${clazz.PRIMARY_ITEM_INFLATED} PRIMARY_ITEM_INFLATED, ${clazz.PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT} PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT, ${clazz.OVER_CANONICAL_LIMIT} OVER_CANONICAL_LIMIT`
  );
  log(
    `repaired clusters: ${summary.repairedClusters} (attempts re-pointed: ${summary.repairedAttempts}), skipped: ${summary.skippedClusters}, errors: ${summary.errorClusters}`
  );
  if (summary.mode === "dry-run") {
    log(
      `[DRY-RUN] No changes were applied. Re-run with --apply and ${APPLY_ENV_VAR}=${APPLY_ENV_EXPECTED} to mutate.`
    );
  }
};

const main = async (): Promise<void> => {
  const options = parseCliArgs(process.argv.slice(2));

  // When --json is set, logs go to stderr so stdout stays parseable.
  const log = (message: string): void => {
    if (options.json) {
      process.stderr.write(`${message}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  };

  // Safety gate: --apply requires explicit env acknowledgement.
  if (options.apply) {
    const ack = process.env[APPLY_ENV_VAR];
    if (ack !== APPLY_ENV_EXPECTED) {
      process.stderr.write(
        [
          `[normalize-feedback-cluster-retry-drift] Refusing to apply mutations.`,
          ``,
          `--apply was passed but the environment variable`,
          `  ${APPLY_ENV_VAR}=${APPLY_ENV_EXPECTED}`,
          `is not set. This is a guardrail to prevent accidental writes to production.`,
          ``,
          `To run for real:`,
          `  ${APPLY_ENV_VAR}=${APPLY_ENV_EXPECTED} bun run backend/packages/database/src/scripts/normalize-feedback-cluster-retry-drift.ts --apply`,
          ``,
          `To preview without writes, omit --apply (dry-run is the default).`,
          ``,
        ].join("\n")
      );
      process.exit(2);
    }
  }

  log(
    options.apply
      ? "[normalize-feedback-cluster-retry-drift] APPLY mode — mutations enabled."
      : "[normalize-feedback-cluster-retry-drift] Dry-run — no writes will be performed."
  );

  // Touch the imported schema references so tree-shaking / lint keeps them as
  // part of the public contract. These tables are the ones the SQL below
  // operates on.
  void bugFixAttempts;
  void feedbackClusters;
  void feedbackItems;

  const rows = await loadAuditRows(options);
  const results: RepairResult[] = [];

  for (const row of rows) {
    const result = await processCluster({ row, options });
    results.push(result);
  }

  const summary = buildSummary(results, rows, options);

  if (options.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      canonicalMaxAttemptsPerCluster: CANONICAL_MAX_ATTEMPTS_PER_CLUSTER,
      mode: summary.mode,
      filters: {
        clusterIds: options.clusterIds,
        projectId: options.projectId,
        skipOverflow: options.skipOverflow,
      },
      summary,
      results,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHumanReport({ results, rows, options, summary, log });
  }
};

main()
  .then(async () => {
    await closeConnections();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    const message =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    process.stderr.write(
      `[normalize-feedback-cluster-retry-drift] Unexpected error: ${message}\n`
    );
    try {
      await closeConnections();
    } catch {
      // Ignore secondary errors during shutdown.
    }
    process.exit(1);
  });
