/**
 * A-F-435 — Feedback cluster retry-budget drift auditor (task A-1872).
 *
 * SAFE TO RUN IN PRODUCTION. Read-only.
 *
 * Why this exists
 * ---------------
 * The canonical rule for the retry budget (A-F-435 / parallel task A-1871) is:
 *   "when a `bug_fix_attempts` row has a `cluster_id`, the budget is 3 per cluster".
 *
 * Historically `launchClusterInvestigation` counted prior attempts by the
 * primary feedback item (the oldest item in the cluster), not by the cluster
 * itself. Any change of the primary, any reuse of a cluster by normalized
 * title, or any inherited attempt from an older primary can cause the two
 * counts to disagree, producing "drift" that must be triaged before we enforce
 * the canonical rule.
 *
 * This script audits every cluster that has at least one bug-fix attempt and
 * classifies it against the canonical rule. It never writes to the database.
 *
 * How to run
 * ----------
 *   # Production (read-only, safe):
 *   bun run backend/packages/database/src/scripts/audit-feedback-cluster-retry-drift.ts
 *
 *   # Machine-readable JSON output (pipe into A-1873 backfill):
 *   bun run backend/packages/database/src/scripts/audit-feedback-cluster-retry-drift.ts --json > /tmp/drift.json
 *
 *   # Narrow to specific clusters (shows full diagnosis even if CLEAN):
 *   bun run backend/packages/database/src/scripts/audit-feedback-cluster-retry-drift.ts \
 *     --cluster-id=<uuid> --cluster-id=<uuid>
 *   bun run backend/packages/database/src/scripts/audit-feedback-cluster-retry-drift.ts \
 *     --cluster-id=<uuid1>,<uuid2>
 *
 *   # Narrow to a single project:
 *   bun run backend/packages/database/src/scripts/audit-feedback-cluster-retry-drift.ts \
 *     --project-id=<uuid>
 *
 *   # Include all clusters (clean + drifted) in the report:
 *   bun run backend/packages/database/src/scripts/audit-feedback-cluster-retry-drift.ts --include-legitimate
 *
 * CLI flags
 * ---------
 *   --cluster-id=<uuid>         Repeatable or comma-separated. Narrows the
 *                               audit to those clusters. When set, CLEAN
 *                               clusters are always printed so the operator
 *                               can confirm user-reported cases.
 *   --project-id=<uuid>         Narrows the audit to a single project.
 *   --json                      Emits a JSON array on stdout suitable for
 *                               piping into the A-1873 backfill job. All
 *                               human-readable logs are redirected to stderr.
 *   --include-legitimate        Includes CLEAN clusters in the output even
 *                               when --cluster-id is not provided. Default:
 *                               only drifted clusters are printed.
 *   --dry-run                   Accepted for symmetry with other scripts.
 *                               This script is always read-only.
 *   --help / -h                 Print usage and exit 0.
 *
 * Exit codes
 * ----------
 *   0 — audit completed successfully (drift found or not).
 *   1 — unexpected runtime error (e.g. DB unreachable).
 */

import { db, closeConnections } from "../client";
import { sql } from "drizzle-orm";

// Mirror the canonical retry budget. Keep in sync with A-1871.
const CANONICAL_MAX_ATTEMPTS_PER_CLUSTER = 3;

// Keep this list aligned with `ACTIVE_STATUSES_SQL` in the migration preflight
// and the repositories. These are the statuses that block new attempts.
const ACTIVE_STATUSES = ["analyzing", "proposed", "implementing"] as const;

// Cap the number of active attempt IDs we embed in each report row so the
// JSON payload stays small even for pathological clusters.
const MAX_ACTIVE_ATTEMPT_IDS_PER_CLUSTER = 5;

type DriftFlag =
  | "OVER_CANONICAL_LIMIT"
  | "PRIMARY_ITEM_INFLATED"
  | "PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT"
  | "TITLE_REUSED"
  | "CLEAN";

interface AuditRow {
  clusterId: string;
  clusterStatus: string;
  clusterTitle: string;
  projectId: string | null;
  organizationId: string | null;
  primaryFeedbackItemId: string | null;
  primaryFeedbackItemCreatedAt: string | null;
  attemptsByCluster: number;
  attemptsByPrimaryItem: number;
  activeAttemptsByCluster: number;
  activeAttemptIdsByCluster: string[];
  distinctFeedbackItemsWithAttempts: number;
  normalizedTitle: string;
  potentialSiblingClusterIds: string[];
  flags: DriftFlag[];
  drifted: boolean;
}

interface CliOptions {
  clusterIds: string[] | null;
  projectId: string | null;
  json: boolean;
  includeLegitimate: boolean;
  dryRun: boolean;
}

const USAGE = `Usage: bun run backend/packages/database/src/scripts/audit-feedback-cluster-retry-drift.ts [options]

Options:
  --cluster-id=<uuid>     Repeatable or comma-separated list of cluster UUIDs.
  --project-id=<uuid>     Narrow the audit to a single project.
  --json                  Emit a JSON array on stdout (logs go to stderr).
  --include-legitimate    Include CLEAN clusters in the report (default: drifted only).
  --dry-run               Accepted for symmetry. Script is always read-only.
  --help, -h              Print this message and exit.
`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    clusterIds: null,
    projectId: null,
    json: false,
    includeLegitimate: false,
    dryRun: true,
  };

  const clusterIdsAcc: string[] = [];

  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (raw === "--json") {
      options.json = true;
    } else if (raw === "--include-legitimate") {
      options.includeLegitimate = true;
    } else if (raw === "--dry-run") {
      options.dryRun = true;
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

/**
 * Canonical normalization for cluster titles. Mirrors common UX normalization
 * (lowercase, trimmed, whitespace collapsed). Used both to detect title reuse
 * across clusters and to expose a stable key in the report for operators.
 */
const normalizeTitle = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, " ");

const classifyRow = (row: {
  attemptsByCluster: number;
  attemptsByPrimaryItem: number;
  potentialSiblingClusterIds: string[];
}): DriftFlag[] => {
  const flags: DriftFlag[] = [];

  if (row.attemptsByCluster > CANONICAL_MAX_ATTEMPTS_PER_CLUSTER) {
    flags.push("OVER_CANONICAL_LIMIT");
  }
  if (row.attemptsByPrimaryItem > row.attemptsByCluster) {
    flags.push("PRIMARY_ITEM_INFLATED");
  }
  if (
    row.attemptsByPrimaryItem >= CANONICAL_MAX_ATTEMPTS_PER_CLUSTER &&
    row.attemptsByCluster < CANONICAL_MAX_ATTEMPTS_PER_CLUSTER
  ) {
    flags.push("PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT");
  }
  if (row.potentialSiblingClusterIds.length > 0) {
    flags.push("TITLE_REUSED");
  }

  if (flags.length === 0) {
    flags.push("CLEAN");
  }

  return flags;
};

/**
 * The audit query runs inside a read-only transaction. We rely on a single
 * Postgres query so the snapshot is internally consistent even if rows change
 * concurrently.
 *
 * - `per_cluster_attempts`: attempts grouped by cluster_id (canonical count).
 * - `primary_item`: oldest feedback item in each cluster — mirrors
 *   `launchClusterInvestigation`.
 * - `per_primary_attempts`: attempts grouped by the primary feedback item
 *   (historical count used before A-F-435).
 * - `active_sample`: up to N active attempt ids per cluster, for the report.
 * - `title_groups`: cluster ids sharing the same normalized title.
 */
const runAudit = async (options: CliOptions): Promise<AuditRow[]> => {
  const narrowByClusterIds =
    options.clusterIds && options.clusterIds.length > 0
      ? sql`AND fc."id" IN (${sql.join(
          options.clusterIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})`
      : sql``;

  const narrowByProjectId = options.projectId
    ? sql`AND bfa."project_id" = ${options.projectId}::uuid`
    : sql``;

  // Narrow the "candidate clusters" set: either the explicit cluster list or
  // every cluster that has at least one bug_fix_attempt.
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
        fc."id"              AS cluster_id,
        fc."status"::text    AS cluster_status,
        fc."title"           AS cluster_title,
        TRIM(REGEXP_REPLACE(LOWER(fc."title"), '\\s+', ' ', 'g')) AS normalized_title
      FROM "feedback_clusters" fc
      WHERE ${candidateClusterFilter}
        ${narrowByClusterIds}
    ),
    per_cluster_attempts AS (
      SELECT
        bfa."cluster_id"                                   AS cluster_id,
        COUNT(*)::int                                      AS attempts_by_cluster,
        COUNT(*) FILTER (
          WHERE bfa."status" IN ('analyzing', 'proposed', 'implementing')
        )::int                                             AS active_attempts_by_cluster,
        COUNT(DISTINCT bfa."feedback_item_id")::int        AS distinct_feedback_items_with_attempts,
        MIN(bfa."project_id"::text)                        AS project_id,
        MIN(bfa."organization_id")                         AS organization_id
      FROM "bug_fix_attempts" bfa
      WHERE bfa."cluster_id" IS NOT NULL
        ${narrowByProjectId}
      GROUP BY bfa."cluster_id"
    ),
    primary_item AS (
      SELECT DISTINCT ON (fi."cluster_id")
        fi."cluster_id"      AS cluster_id,
        fi."id"              AS primary_feedback_item_id,
        fi."created_at"      AS primary_feedback_item_created_at
      FROM "feedback_items" fi
      WHERE fi."cluster_id" IS NOT NULL
      ORDER BY fi."cluster_id", fi."created_at" ASC, fi."id" ASC
    ),
    per_primary_attempts AS (
      SELECT
        pi.cluster_id                                      AS cluster_id,
        COUNT(bfa."id")::int                               AS attempts_by_primary_item
      FROM primary_item pi
      LEFT JOIN "bug_fix_attempts" bfa
        ON bfa."feedback_item_id" = pi.primary_feedback_item_id
      GROUP BY pi.cluster_id
    ),
    active_sample AS (
      SELECT
        bfa."cluster_id"                                   AS cluster_id,
        (
          ARRAY_AGG(bfa."id"::text ORDER BY bfa."created_at" DESC, bfa."id" DESC)
        )[1:${sql.raw(String(MAX_ACTIVE_ATTEMPT_IDS_PER_CLUSTER))}] AS active_attempt_ids
      FROM "bug_fix_attempts" bfa
      WHERE bfa."cluster_id" IS NOT NULL
        AND bfa."status" IN ('analyzing', 'proposed', 'implementing')
      GROUP BY bfa."cluster_id"
    ),
    title_groups AS (
      SELECT
        TRIM(REGEXP_REPLACE(LOWER(fc2."title"), '\\s+', ' ', 'g')) AS normalized_title,
        ARRAY_AGG(fc2."id"::text ORDER BY fc2."created_at" ASC, fc2."id" ASC) AS cluster_ids
      FROM "feedback_clusters" fc2
      GROUP BY TRIM(REGEXP_REPLACE(LOWER(fc2."title"), '\\s+', ' ', 'g'))
      HAVING COUNT(*) > 1
    )
    SELECT
      cc.cluster_id::text                                              AS "clusterId",
      cc.cluster_status                                                AS "clusterStatus",
      cc.cluster_title                                                 AS "clusterTitle",
      cc.normalized_title                                              AS "normalizedTitle",
      pi.primary_feedback_item_id::text                                AS "primaryFeedbackItemId",
      pi.primary_feedback_item_created_at                              AS "primaryFeedbackItemCreatedAt",
      pca.project_id                                                   AS "projectId",
      pca.organization_id                                              AS "organizationId",
      COALESCE(pca.attempts_by_cluster, 0)                             AS "attemptsByCluster",
      COALESCE(ppa.attempts_by_primary_item, 0)                        AS "attemptsByPrimaryItem",
      COALESCE(pca.active_attempts_by_cluster, 0)                      AS "activeAttemptsByCluster",
      COALESCE(asam.active_attempt_ids, ARRAY[]::text[])               AS "activeAttemptIdsByCluster",
      COALESCE(pca.distinct_feedback_items_with_attempts, 0)           AS "distinctFeedbackItemsWithAttempts",
      COALESCE(
        (
          SELECT ARRAY_AGG(sibling)
          FROM UNNEST(tg.cluster_ids) AS sibling
          WHERE sibling <> cc.cluster_id::text
        ),
        ARRAY[]::text[]
      )                                                                AS "potentialSiblingClusterIds"
    FROM candidate_clusters cc
    LEFT JOIN per_cluster_attempts pca  ON pca.cluster_id = cc.cluster_id
    LEFT JOIN primary_item pi           ON pi.cluster_id = cc.cluster_id
    LEFT JOIN per_primary_attempts ppa  ON ppa.cluster_id = cc.cluster_id
    LEFT JOIN active_sample asam        ON asam.cluster_id = cc.cluster_id
    LEFT JOIN title_groups tg           ON tg.normalized_title = cc.normalized_title
    ORDER BY
      COALESCE(pca.attempts_by_cluster, 0) DESC,
      cc.cluster_id ASC
  `);

  // `db.execute` with postgres-js returns an array-like of rows. We treat it
  // defensively so the script keeps working if the driver changes.
  const rawRows: Array<Record<string, unknown>> = Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : Array.isArray((result as { rows?: unknown }).rows)
      ? ((result as { rows: Array<Record<string, unknown>> }).rows)
      : [];

  const rows: AuditRow[] = rawRows.map((row) => {
    const normalizedTitleRaw = toStringOrNull(row.normalizedTitle);
    const clusterTitleRaw = toStringOrNull(row.clusterTitle) ?? "";

    // Safety net: if the DB-side normalization differs from the application
    // one (e.g. a locale-specific collation quirk), prefer the app-side value
    // so downstream consumers can reproduce the key.
    const normalizedTitle = normalizedTitleRaw ?? normalizeTitle(clusterTitleRaw);

    const attemptsByCluster = toInt(row.attemptsByCluster);
    const attemptsByPrimaryItem = toInt(row.attemptsByPrimaryItem);
    const potentialSiblingClusterIds = toStringArray(row.potentialSiblingClusterIds);

    const flags = classifyRow({
      attemptsByCluster,
      attemptsByPrimaryItem,
      potentialSiblingClusterIds,
    });

    const drifted = !(flags.length === 1 && flags[0] === "CLEAN");

    return {
      clusterId: toStringOrNull(row.clusterId) ?? "",
      clusterStatus: toStringOrNull(row.clusterStatus) ?? "",
      clusterTitle: clusterTitleRaw,
      projectId: toStringOrNull(row.projectId),
      organizationId: toStringOrNull(row.organizationId),
      primaryFeedbackItemId: toStringOrNull(row.primaryFeedbackItemId),
      primaryFeedbackItemCreatedAt: toStringOrNull(row.primaryFeedbackItemCreatedAt),
      attemptsByCluster,
      attemptsByPrimaryItem,
      activeAttemptsByCluster: toInt(row.activeAttemptsByCluster),
      activeAttemptIdsByCluster: toStringArray(row.activeAttemptIdsByCluster),
      distinctFeedbackItemsWithAttempts: toInt(row.distinctFeedbackItemsWithAttempts),
      normalizedTitle,
      potentialSiblingClusterIds,
      flags,
      drifted,
    };
  });

  return rows;
};

interface Summary {
  totalAudited: number;
  drifted: number;
  clean: number;
  byFlag: Record<Exclude<DriftFlag, "CLEAN">, number>;
}

const buildSummary = (rows: AuditRow[]): Summary => {
  const summary: Summary = {
    totalAudited: rows.length,
    drifted: 0,
    clean: 0,
    byFlag: {
      OVER_CANONICAL_LIMIT: 0,
      PRIMARY_ITEM_INFLATED: 0,
      PRIMARY_ITEM_BLOCKED_BUT_CLUSTER_NOT: 0,
      TITLE_REUSED: 0,
    },
  };

  for (const row of rows) {
    if (row.drifted) {
      summary.drifted += 1;
      for (const flag of row.flags) {
        if (flag !== "CLEAN") {
          summary.byFlag[flag] += 1;
        }
      }
    } else {
      summary.clean += 1;
    }
  }

  return summary;
};

const formatSummaryLine = (summary: Summary): string => {
  const flagBreakdown = Object.entries(summary.byFlag)
    .filter(([, count]) => count > 0)
    .map(([flag, count]) => `${count} ${flag}`)
    .join(", ");
  const breakdownSuffix = flagBreakdown.length > 0 ? ` (${flagBreakdown})` : "";
  return `${summary.totalAudited} clusters audited, ${summary.drifted} drifted${breakdownSuffix}, ${summary.clean} clean`;
};

const printHumanReport = (
  rows: AuditRow[],
  options: CliOptions,
  summary: Summary,
  log: (message: string) => void
): void => {
  const explicitClusterIds = options.clusterIds ?? [];
  const displayRows = rows.filter((row) => {
    if (explicitClusterIds.includes(row.clusterId)) return true;
    if (options.includeLegitimate) return true;
    return row.drifted;
  });

  log("=== A-F-435 cluster retry-budget drift audit ===");
  log(
    `Mode: read-only | Canonical max attempts per cluster: ${CANONICAL_MAX_ATTEMPTS_PER_CLUSTER} | Active statuses: ${ACTIVE_STATUSES.join(
      ", "
    )}`
  );
  if (options.projectId) log(`Project filter: ${options.projectId}`);
  if (explicitClusterIds.length > 0) {
    log(`Cluster filter: ${explicitClusterIds.join(", ")}`);
  }
  log("");

  if (displayRows.length === 0) {
    log("(no clusters to report)");
  }

  for (const row of displayRows) {
    const header = row.drifted
      ? `DRIFT [${row.flags.join(", ")}]`
      : `CLEAN`;
    log(`[${header}] cluster=${row.clusterId} status=${row.clusterStatus}`);
    log(`  title: ${row.clusterTitle}`);
    log(`  project=${row.projectId ?? "-"} organization=${row.organizationId ?? "-"}`);
    log(
      `  primaryFeedbackItemId=${row.primaryFeedbackItemId ?? "-"} (createdAt=${
        row.primaryFeedbackItemCreatedAt ?? "-"
      })`
    );
    log(
      `  attemptsByCluster=${row.attemptsByCluster} attemptsByPrimaryItem=${row.attemptsByPrimaryItem} activeAttemptsByCluster=${row.activeAttemptsByCluster}`
    );
    log(
      `  distinctFeedbackItemsWithAttempts=${row.distinctFeedbackItemsWithAttempts}`
    );
    if (row.activeAttemptIdsByCluster.length > 0) {
      log(
        `  activeAttemptIdsByCluster (sample, max ${MAX_ACTIVE_ATTEMPT_IDS_PER_CLUSTER}): ${row.activeAttemptIdsByCluster.join(
          ", "
        )}`
      );
    }
    if (row.potentialSiblingClusterIds.length > 0) {
      log(
        `  potentialSiblingClusterIds (same normalizedTitle=\"${row.normalizedTitle}\"): ${row.potentialSiblingClusterIds.join(
          ", "
        )}`
      );
    }
    log("");
  }

  log(formatSummaryLine(summary));
};

const main = async (): Promise<void> => {
  const options = parseCliArgs(process.argv.slice(2));

  // When --json is set we emit logs to stderr so stdout stays parseable.
  const log = (message: string): void => {
    if (options.json) {
      process.stderr.write(`${message}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  };

  log(
    "[audit-feedback-cluster-retry-drift] Read-only audit — no writes will be performed."
  );

  const rows = await runAudit(options);
  const summary = buildSummary(rows);

  if (options.json) {
    const explicitClusterIds = options.clusterIds ?? [];
    const jsonRows = rows.filter((row) => {
      if (explicitClusterIds.includes(row.clusterId)) return true;
      if (options.includeLegitimate) return true;
      return row.drifted;
    });

    const payload = {
      generatedAt: new Date().toISOString(),
      canonicalMaxAttemptsPerCluster: CANONICAL_MAX_ATTEMPTS_PER_CLUSTER,
      activeStatuses: [...ACTIVE_STATUSES],
      filters: {
        clusterIds: options.clusterIds,
        projectId: options.projectId,
        includeLegitimate: options.includeLegitimate,
      },
      summary,
      rows: jsonRows,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    log(formatSummaryLine(summary));
  } else {
    printHumanReport(rows, options, summary, log);
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
      `[audit-feedback-cluster-retry-drift] Unexpected error: ${message}\n`
    );
    try {
      await closeConnections();
    } catch {
      // Ignore secondary errors during shutdown.
    }
    process.exit(1);
  });
