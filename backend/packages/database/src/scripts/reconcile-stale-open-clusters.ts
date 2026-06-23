/**
 * A-1909 — Reconcile stale `open` feedback clusters whose items are all in
 * terminal state.
 *
 * SAFE TO RUN IN PRODUCTION (defaults to --dry-run). Mutates state only when
 * invoked with --apply.
 *
 * Why this exists
 * ---------------
 * In pre-A-F-440 flows, some feedback_clusters were left in `open` even after
 * every linked feedback_item had already reached a terminal status
 * (`deployed`, `verified`, `cancelled`). These stale clusters are legacy
 * artifacts: there is no outstanding work on them, yet they still appear in
 * "open" listings and can re-trigger investigations.
 *
 * This script finds every cluster still in `open` whose linked items are ALL
 * in a terminal state and transitions it to `dismissed` via the canonical
 * `transitionCluster()` helper (so `cluster_status_history` is populated
 * correctly with `reason = "auto-reconcile"`).
 *
 * Clusters with zero linked items are NOT touched — that is a separate
 * anomaly (empty cluster) and should be handled explicitly.
 *
 * How to run
 * ----------
 *   # Dry run (default, safe): list candidate clusters only, no writes.
 *   bun run backend/packages/database/src/scripts/reconcile-stale-open-clusters.ts
 *
 *   # Real run: dismiss each candidate via transitionCluster().
 *   bun run backend/packages/database/src/scripts/reconcile-stale-open-clusters.ts --apply
 *
 *   # Narrow to specific clusters (repeatable or comma-separated):
 *   bun run backend/packages/database/src/scripts/reconcile-stale-open-clusters.ts \
 *     --cluster-id=<uuid> --cluster-id=<uuid>
 *   bun run backend/packages/database/src/scripts/reconcile-stale-open-clusters.ts \
 *     --cluster-id=<uuid1>,<uuid2> --apply
 *
 *   # Machine-readable output:
 *   bun run backend/packages/database/src/scripts/reconcile-stale-open-clusters.ts --json
 *
 * CLI flags
 * ---------
 *   --dry-run               Default. Only print the list of candidates.
 *   --apply                 Actually perform the dismissal for each candidate.
 *                           Mutually exclusive with --dry-run; --apply wins if
 *                           both are provided.
 *   --cluster-id=<uuid>     Repeatable or comma-separated. Narrows the
 *                           candidate set to those clusters only.
 *   --json                  Emit a JSON payload on stdout (human logs → stderr).
 *   --help, -h              Print usage and exit 0.
 *
 * Exit codes
 * ----------
 *   0 — completed successfully (dry-run printed, or apply finished with no
 *       fatal errors; per-cluster failures are reported but do not fail the
 *       whole run).
 *   1 — unexpected runtime error (e.g. DB unreachable, invalid arguments).
 */

import { db, closeConnections } from "../client";
import { sql } from "drizzle-orm";
import { transitionCluster } from "../repositories/feedback/feedback-cluster-repository";

// Terminal feedback_item statuses for the "nothing left to do" check.
// Kept aligned with `feedbackStatusEnum` in schema/enums.ts.
const TERMINAL_ITEM_STATUSES = ["deployed", "verified", "cancelled"] as const;

const AUTO_RECONCILE_REASON = "auto-reconcile";

interface CandidateRow {
  clusterId: string;
  clusterTitle: string;
  clusterStatus: string;
  itemCount: number;
  terminalItemCount: number;
}

interface CliOptions {
  clusterIds: string[] | null;
  json: boolean;
  apply: boolean;
}

const USAGE = `Usage: bun run backend/packages/database/src/scripts/reconcile-stale-open-clusters.ts [options]

Options:
  --dry-run               Default. List candidate clusters without writing.
  --apply                 Actually dismiss each candidate via transitionCluster().
  --cluster-id=<uuid>     Repeatable or comma-separated list of cluster UUIDs.
  --json                  Emit a JSON payload on stdout (human logs → stderr).
  --help, -h              Print this message and exit.
`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    clusterIds: null,
    json: false,
    apply: false,
  };

  const clusterIdsAcc: string[] = [];

  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (raw === "--json") {
      options.json = true;
    } else if (raw === "--dry-run") {
      // Explicit dry-run keeps `apply` false unless --apply is also passed.
      if (!options.apply) {
        options.apply = false;
      }
    } else if (raw === "--apply") {
      options.apply = true;
    } else if (raw.startsWith("--cluster-id=")) {
      const value = raw.slice("--cluster-id=".length);
      for (const part of value.split(",")) {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          clusterIdsAcc.push(trimmed);
        }
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
  return String(value);
};

/**
 * Find clusters in `open` status whose linked feedback_items are ALL in
 * terminal state.
 *
 * Uses INNER JOIN so clusters without any linked items are ignored (they are
 * a separate anomaly class — see module docstring).
 */
const findCandidates = async (
  options: CliOptions
): Promise<CandidateRow[]> => {
  const narrowByClusterIds =
    options.clusterIds && options.clusterIds.length > 0
      ? sql`AND fc."id" IN (${sql.join(
          options.clusterIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})`
      : sql``;

  const result = await db.execute(sql`
    SELECT
      fc."id"::text                                         AS "clusterId",
      fc."title"                                            AS "clusterTitle",
      fc."status"::text                                     AS "clusterStatus",
      COUNT(fi."id")::int                                   AS "itemCount",
      COUNT(*) FILTER (
        WHERE fi."status" IN ('deployed','verified','cancelled')
      )::int                                                AS "terminalItemCount"
    FROM "feedback_clusters" fc
    INNER JOIN "feedback_items" fi
      ON fi."cluster_id" = fc."id"
    WHERE fc."status" = 'open'
      ${narrowByClusterIds}
    GROUP BY fc."id", fc."title", fc."status"
    HAVING COUNT(*) FILTER (
      WHERE fi."status" NOT IN ('deployed','verified','cancelled')
    ) = 0
    ORDER BY fc."id" ASC
  `);

  const rawRows: Array<Record<string, unknown>> = Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : Array.isArray((result as { rows?: unknown }).rows)
      ? ((result as { rows: Array<Record<string, unknown>> }).rows)
      : [];

  return rawRows.map((row) => ({
    clusterId: toStringOrNull(row.clusterId) ?? "",
    clusterTitle: toStringOrNull(row.clusterTitle) ?? "",
    clusterStatus: toStringOrNull(row.clusterStatus) ?? "",
    itemCount: toInt(row.itemCount),
    terminalItemCount: toInt(row.terminalItemCount),
  }));
};

type ApplyOutcome =
  | { clusterId: string; status: "dismissed" }
  | { clusterId: string; status: "skipped_not_found" }
  | { clusterId: string; status: "skipped_invalid_transition"; from: string; to: string; allowed: string[] }
  | { clusterId: string; status: "error"; message: string };

const applyReconciliation = async (
  candidates: CandidateRow[],
  log: (message: string) => void
): Promise<ApplyOutcome[]> => {
  const outcomes: ApplyOutcome[] = [];

  for (const candidate of candidates) {
    try {
      const result = await transitionCluster(candidate.clusterId, "dismissed", {
        triggeredByKind: "system",
        reason: AUTO_RECONCILE_REASON,
        metadata: {},
      });

      if (result.success) {
        outcomes.push({ clusterId: candidate.clusterId, status: "dismissed" });
        log(
          `  [OK] cluster=${candidate.clusterId} transitioned ${result.from} → ${result.to}`
        );
      } else if (result.reason === "cluster_not_found") {
        outcomes.push({
          clusterId: candidate.clusterId,
          status: "skipped_not_found",
        });
        log(`  [SKIP] cluster=${candidate.clusterId} not found (deleted between scan and apply?)`);
      } else {
        // invalid_transition
        outcomes.push({
          clusterId: candidate.clusterId,
          status: "skipped_invalid_transition",
          from: result.from,
          to: result.to,
          allowed: result.allowed,
        });
        log(
          `  [SKIP] cluster=${candidate.clusterId} invalid transition ${result.from} → ${result.to} (allowed: ${result.allowed.join(", ") || "(none)"})`
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      outcomes.push({
        clusterId: candidate.clusterId,
        status: "error",
        message,
      });
      log(`  [ERROR] cluster=${candidate.clusterId} ${message}`);
    }
  }

  return outcomes;
};

interface Summary {
  totalCandidates: number;
  applied: boolean;
  dismissed: number;
  skippedNotFound: number;
  skippedInvalidTransition: number;
  errors: number;
}

const buildSummary = (
  candidates: CandidateRow[],
  outcomes: ApplyOutcome[] | null
): Summary => {
  const summary: Summary = {
    totalCandidates: candidates.length,
    applied: outcomes !== null,
    dismissed: 0,
    skippedNotFound: 0,
    skippedInvalidTransition: 0,
    errors: 0,
  };

  if (outcomes) {
    for (const outcome of outcomes) {
      switch (outcome.status) {
        case "dismissed":
          summary.dismissed += 1;
          break;
        case "skipped_not_found":
          summary.skippedNotFound += 1;
          break;
        case "skipped_invalid_transition":
          summary.skippedInvalidTransition += 1;
          break;
        case "error":
          summary.errors += 1;
          break;
      }
    }
  }

  return summary;
};

const formatSummaryLine = (summary: Summary): string => {
  if (!summary.applied) {
    return `DRY-RUN: ${summary.totalCandidates} stale open cluster(s) would be dismissed with reason="${AUTO_RECONCILE_REASON}".`;
  }
  return `APPLY: ${summary.totalCandidates} candidate(s) — ${summary.dismissed} dismissed, ${summary.skippedNotFound} not-found, ${summary.skippedInvalidTransition} invalid-transition, ${summary.errors} error(s).`;
};

const printHumanReport = (
  candidates: CandidateRow[],
  options: CliOptions,
  summary: Summary,
  log: (message: string) => void
): void => {
  log("=== A-1909 reconcile stale open clusters ===");
  log(
    `Mode: ${options.apply ? "APPLY (will write)" : "dry-run (read-only)"} | Terminal item statuses: ${TERMINAL_ITEM_STATUSES.join(
      ", "
    )} | Reason: "${AUTO_RECONCILE_REASON}"`
  );
  if (options.clusterIds && options.clusterIds.length > 0) {
    log(`Cluster filter: ${options.clusterIds.join(", ")}`);
  }
  log("");

  if (candidates.length === 0) {
    log("(no stale open clusters found — nothing to do)");
    log("");
    log(formatSummaryLine(summary));
    return;
  }

  log(`Candidates (${candidates.length}):`);
  for (const candidate of candidates) {
    log(
      `  - cluster=${candidate.clusterId} status=${candidate.clusterStatus} items=${candidate.itemCount} (terminal=${candidate.terminalItemCount})`
    );
    log(`      title: ${candidate.clusterTitle}`);
  }
  log("");
  log(formatSummaryLine(summary));
};

const main = async (): Promise<void> => {
  const options = parseCliArgs(process.argv.slice(2));

  const log = (message: string): void => {
    if (options.json) {
      process.stderr.write(`${message}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  };

  log(
    `[reconcile-stale-open-clusters] ${options.apply ? "APPLY mode — writes will occur." : "Dry-run mode — no writes will be performed."}`
  );

  const candidates = await findCandidates(options);

  let outcomes: ApplyOutcome[] | null = null;
  if (options.apply && candidates.length > 0) {
    log("");
    log(`Applying dismissals for ${candidates.length} cluster(s)...`);
    outcomes = await applyReconciliation(candidates, log);
  }

  const summary = buildSummary(candidates, outcomes);

  if (options.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      mode: options.apply ? "apply" : "dry-run",
      terminalItemStatuses: [...TERMINAL_ITEM_STATUSES],
      reason: AUTO_RECONCILE_REASON,
      filters: {
        clusterIds: options.clusterIds,
      },
      summary,
      candidates,
      outcomes,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    log(formatSummaryLine(summary));
  } else {
    if (outcomes === null) {
      printHumanReport(candidates, options, summary, log);
    } else {
      // In apply mode, per-cluster outcomes were already logged inline by
      // applyReconciliation(). Print the candidate list header + summary for
      // context.
      printHumanReport(candidates, options, summary, log);
    }
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
      `[reconcile-stale-open-clusters] Unexpected error: ${message}\n`
    );
    try {
      await closeConnections();
    } catch {
      // Ignore secondary errors during shutdown.
    }
    process.exit(1);
  });
