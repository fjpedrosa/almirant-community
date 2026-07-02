import { logger } from "@almirant/config";
import {
  and,
  bugFixAttempts,
  db,
  getInstallationByRepoId,
  getRepoIdByGithubFullName,
  inArray,
  isNotNull,
  sql,
} from "@almirant/database";
import {
  markFeedbackBugsAsFailedOnPrClosed,
  moveFeedbackBugsToPendingValidationOnPrMerge,
} from "./github-webhook-handlers";
import {
  fetchFromGithub,
  parseGithubPrUrl,
} from "./github-service";

// ---------------------------------------------------------------------------
// Why this sweeper exists
// ---------------------------------------------------------------------------
//
// The PR-merge webhook (`pull_request.closed + merged=true`) is the only
// production path that flips `bug_fix_attempts.status` from `implementing` to
// `merged` and cascades `feedback_clusters.status` to `resolved`. When that
// webhook is lost (bad signature, installation not mapped at delivery time,
// silent throw in the fire-and-forget `.then()`), the cluster stays `open` /
// `fix_ready` forever even though GitHub knows the PR was merged days ago.
//
// This reconciler is a backstop: periodically it finds attempts that claim
// a `fixPrUrl` but are still in `analyzing` / `proposed` / `implementing`
// after the webhook should have arrived, asks GitHub for the truth, and
// routes the outcome through the EXISTING webhook handlers — they are
// idempotent by design, so running them from here costs nothing when state
// is already consistent.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StuckAttempt = {
  id: string;
  clusterId: string | null;
  feedbackItemId: string | null;
  fixPrNumber: number;
  fixPrUrl: string;
  projectId: string;
  workspaceId: string;
  status: "analyzing" | "proposed" | "implementing";
  updatedAt: Date;
};

export type PrRemoteState =
  | { kind: "merged"; mergedAt: string; closedAt: string | null }
  | { kind: "closed_unmerged"; closedAt: string | null }
  | { kind: "open" }
  | { kind: "draft" }
  | { kind: "not_found" };

export type ReconcileAction =
  | { kind: "run_merge_path"; mergedAt: string; closedAt: string | null }
  | { kind: "run_closed_unmerged_path"; closedAt: string | null }
  | { kind: "skip_pr_open" }
  | { kind: "skip_pr_draft" }
  | { kind: "skip_pr_not_found" };

export interface BugFixAttemptReconcilerDeps {
  loadStuckAttempts: (cfg: {
    olderThanMinutes: number;
    batchSize: number;
  }) => Promise<StuckAttempt[]>;
  fetchPrState: (attempt: StuckAttempt) => Promise<PrRemoteState>;
  runMergePath: (pr: {
    html_url: string;
    number: number;
    merged_at: string;
    closed_at: string | null;
  }) => Promise<void>;
  runClosedUnmergedPath: (pr: {
    html_url: string;
    number: number;
    closed_at: string | null;
  }) => Promise<void>;
}

export type ReconcilerTickResult = {
  checked: number;
  merged: number;
  failedUnmerged: number;
  stillOpen: number;
  notFound: number;
  errored: number;
};

export type BugFixAttemptReconcilerConfig = {
  intervalMs: number;
  olderThanMinutes: number;
  batchSize: number;
};

// ---------------------------------------------------------------------------
// Pure decision
// ---------------------------------------------------------------------------

/**
 * Map a remote PR state into the action we need to take. Pure so it can be
 * unit-tested without stubbing IO.
 */
export const decideFromPrState = (state: PrRemoteState): ReconcileAction => {
  switch (state.kind) {
    case "merged":
      return {
        kind: "run_merge_path",
        mergedAt: state.mergedAt,
        closedAt: state.closedAt,
      };
    case "closed_unmerged":
      return {
        kind: "run_closed_unmerged_path",
        closedAt: state.closedAt,
      };
    case "open":
      return { kind: "skip_pr_open" };
    case "draft":
      return { kind: "skip_pr_draft" };
    case "not_found":
      return { kind: "skip_pr_not_found" };
  }
};

// ---------------------------------------------------------------------------
// Single tick — orchestrates deps
// ---------------------------------------------------------------------------

export const runBugFixAttemptPrReconciliationOnce = async (
  deps: BugFixAttemptReconcilerDeps,
  cfg: { olderThanMinutes: number; batchSize: number }
): Promise<ReconcilerTickResult> => {
  const attempts = await deps.loadStuckAttempts({
    olderThanMinutes: cfg.olderThanMinutes,
    batchSize: cfg.batchSize,
  });

  const result: ReconcilerTickResult = {
    checked: 0,
    merged: 0,
    failedUnmerged: 0,
    stillOpen: 0,
    notFound: 0,
    errored: 0,
  };

  for (const attempt of attempts) {
    result.checked += 1;
    try {
      const state = await deps.fetchPrState(attempt);
      const action = decideFromPrState(state);

      if (action.kind === "run_merge_path") {
        await deps.runMergePath({
          html_url: attempt.fixPrUrl,
          number: attempt.fixPrNumber,
          merged_at: action.mergedAt,
          closed_at: action.closedAt,
        });
        result.merged += 1;
      } else if (action.kind === "run_closed_unmerged_path") {
        await deps.runClosedUnmergedPath({
          html_url: attempt.fixPrUrl,
          number: attempt.fixPrNumber,
          closed_at: action.closedAt,
        });
        result.failedUnmerged += 1;
      } else if (action.kind === "skip_pr_open" || action.kind === "skip_pr_draft") {
        result.stillOpen += 1;
      } else {
        // not_found: the PR URL does not resolve on GitHub (deleted repo,
        // dropped installation, URL typo). We do NOT mark the attempt failed
        // from here — that's a manual review decision.
        result.notFound += 1;
      }
    } catch (err) {
      result.errored += 1;
      logger.error(
        {
          attemptId: attempt.id,
          prUrl: attempt.fixPrUrl,
          err: err instanceof Error ? err.message : String(err),
        },
        "[bug-fix-attempt-pr-reconciler] processing attempt failed (continuing)"
      );
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Production dependencies — DB + GitHub
// ---------------------------------------------------------------------------

const defaultLoadStuckAttempts = async (cfg: {
  olderThanMinutes: number;
  batchSize: number;
}): Promise<StuckAttempt[]> => {
  // Filter criteria: attempts in a pre-terminal status that claim a
  // `fix_pr_number` / `fix_pr_url` but whose `updated_at` is old enough that
  // the webhook should have arrived by now.
  const olderThan = new Date(Date.now() - cfg.olderThanMinutes * 60_000);

  const rows = await db
    .select({
      id: bugFixAttempts.id,
      clusterId: bugFixAttempts.clusterId,
      feedbackItemId: bugFixAttempts.feedbackItemId,
      fixPrNumber: bugFixAttempts.fixPrNumber,
      fixPrUrl: bugFixAttempts.fixPrUrl,
      projectId: bugFixAttempts.projectId,
      workspaceId: bugFixAttempts.workspaceId,
      status: bugFixAttempts.status,
      updatedAt: bugFixAttempts.updatedAt,
    })
    .from(bugFixAttempts)
    .where(
      and(
        inArray(bugFixAttempts.status, [
          "analyzing",
          "proposed",
          "implementing",
        ]),
        isNotNull(bugFixAttempts.fixPrNumber),
        isNotNull(bugFixAttempts.fixPrUrl),
        sql`${bugFixAttempts.updatedAt} < ${olderThan}`
      )
    )
    .limit(cfg.batchSize);

  return rows
    .filter(
      (r): r is typeof r & { fixPrNumber: number; fixPrUrl: string } =>
        r.fixPrNumber != null && r.fixPrUrl != null
    )
    .map((r) => ({
      id: r.id,
      clusterId: r.clusterId,
      feedbackItemId: r.feedbackItemId,
      fixPrNumber: r.fixPrNumber,
      fixPrUrl: r.fixPrUrl,
      projectId: r.projectId,
      workspaceId: r.workspaceId,
      status: r.status as StuckAttempt["status"],
      updatedAt: r.updatedAt,
    }));
};

type GithubPullRequestSummary = {
  number: number;
  state: "open" | "closed";
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
};

const defaultFetchPrState = async (
  attempt: StuckAttempt
): Promise<PrRemoteState> => {
  const parsed = parseGithubPrUrl(attempt.fixPrUrl);
  if (!parsed) {
    return { kind: "not_found" };
  }

  // Look up which installation owns this repo so we can authenticate the
  // `GET /repos/{owner}/{repo}/pulls/{n}` call. Without an installation the
  // PR is effectively unreachable for us; flag as not_found and leave the
  // attempt for manual review rather than mark it failed.
  const [owner, repoName] = parsed.repoFullName.split("/");
  if (!owner || !repoName) {
    return { kind: "not_found" };
  }

  const repoId = await getRepoIdByGithubFullName(parsed.repoFullName);
  if (!repoId) {
    return { kind: "not_found" };
  }

  const installation = await getInstallationByRepoId(repoId);
  if (!installation || !installation.installationId) {
    return { kind: "not_found" };
  }

  try {
    const pr = await fetchFromGithub<GithubPullRequestSummary>(
      installation.installationId,
      `/repos/${owner}/${repoName}/pulls/${attempt.fixPrNumber}`
    );

    if (pr.state === "closed") {
      if (pr.merged) {
        return {
          kind: "merged",
          mergedAt: pr.merged_at ?? new Date().toISOString(),
          closedAt: pr.closed_at ?? null,
        };
      }
      return {
        kind: "closed_unmerged",
        closedAt: pr.closed_at ?? null,
      };
    }

    // state === "open"
    if (pr.draft === true) {
      return { kind: "draft" };
    }
    return { kind: "open" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 404: PR or repo was deleted. Swallow to `not_found` so a run-of-the-
    // mill missing PR does not keep erroring forever.
    if (message.includes("GitHub API 404")) {
      return { kind: "not_found" };
    }
    throw err;
  }
};

const productionDeps: BugFixAttemptReconcilerDeps = {
  loadStuckAttempts: defaultLoadStuckAttempts,
  fetchPrState: defaultFetchPrState,
  runMergePath: async (pr) =>
    moveFeedbackBugsToPendingValidationOnPrMerge({
      html_url: pr.html_url,
      number: pr.number,
    }),
  runClosedUnmergedPath: async (pr) =>
    markFeedbackBugsAsFailedOnPrClosed({
      html_url: pr.html_url,
      number: pr.number,
    }),
};

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------

export const startBugFixAttemptPrReconciler = (
  cfg: BugFixAttemptReconcilerConfig,
  deps: BugFixAttemptReconcilerDeps = productionDeps
): (() => void) => {
  const intervalMs = cfg.intervalMs;
  const olderThanMinutes = cfg.olderThanMinutes;
  const batchSize = cfg.batchSize;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let warmup: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await runBugFixAttemptPrReconciliationOnce(deps, {
        olderThanMinutes,
        batchSize,
      });
      if (result.checked > 0) {
        logger.info(
          {
            ...result,
            olderThanMinutes,
            batchSize,
          },
          "[bug-fix-attempt-pr-reconciler] Tick completed"
        );
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[bug-fix-attempt-pr-reconciler] Tick failed (transient, will retry next interval)"
      );
    } finally {
      running = false;
    }
  };

  // Warm-up after 30s so we do not race startup migrations / webhook replays.
  warmup = setTimeout(() => void tick(), 30_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info(
    { intervalMs, olderThanMinutes, batchSize },
    "[bug-fix-attempt-pr-reconciler] Background sweeper started"
  );

  return () => {
    stopped = true;
    if (warmup) clearTimeout(warmup);
    warmup = null;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[bug-fix-attempt-pr-reconciler] Background sweeper stopped");
  };
};
