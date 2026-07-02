import { logger } from "@almirant/config";
import {
  computeWorkItemContentHash,
  db,
  effortEstimationRequests,
  eq,
  projects,
  sql,
  workItems,
} from "@almirant/database";
import { isFeatureFlagEnabled } from "../../../shared/services/posthog-service";
import { getCachedActiveConfig, runEffortEstimation } from "./effort-estimator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEATURE_FLAG_KEY = "effort-estimation-v1";
const MAX_ATTEMPTS = 3;

type RequestRow = {
  id: string;
  workItemId: string;
  attemptCount: number;
};

export type EffortEstimationSweeperTickResult = {
  processed: number;
  failed: number;
};

export type EffortEstimationSweeperConfig = {
  intervalMs: number;
  batchSize: number;
};

// ---------------------------------------------------------------------------
// claimBatch — transactional SELECT … FOR UPDATE SKIP LOCKED + UPDATE to
// 'processing'. Returns the locked+transitioned rows so the rest of the tick
// can process them outside the transaction (LLM calls must not hold DB locks).
// ---------------------------------------------------------------------------

const claimBatch = async (batchSize: number): Promise<RequestRow[]> => {
  return db.transaction(async (tx) => {
    // FOR UPDATE SKIP LOCKED is not supported directly by Drizzle's fluent
    // builder, so we use a raw CTE that selects + locks + updates in one round
    // trip. Attempt count is incremented and last_attempt_at is touched here
    // so a crash between claim and processing still leaves the row visible to
    // a later sweep tick (no silent data loss).
    const rows = (await tx.execute(sql`
      WITH picked AS (
        SELECT id
        FROM effort_estimation_requests
        WHERE status = 'pending'
          AND attempt_count < ${MAX_ATTEMPTS}
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE effort_estimation_requests r
      SET status = 'processing',
          attempt_count = r.attempt_count + 1,
          last_attempt_at = NOW(),
          updated_at = NOW()
      FROM picked p
      WHERE r.id = p.id
      RETURNING
        r.id,
        r.work_item_id AS "workItemId",
        r.attempt_count AS "attemptCount"
    `)) as unknown as RequestRow[];

    return rows;
  });
};

// ---------------------------------------------------------------------------
// Per-row outcome writers
// ---------------------------------------------------------------------------

const markDone = async (requestId: string): Promise<void> => {
  await db
    .update(effortEstimationRequests)
    .set({
      status: "done",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(effortEstimationRequests.id, requestId));
};

const markFailed = async (
  requestId: string,
  errorMessage: string,
): Promise<void> => {
  await db
    .update(effortEstimationRequests)
    .set({
      status: "failed",
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(effortEstimationRequests.id, requestId));
};

const markBackToPending = async (
  requestId: string,
  errorMessage: string,
): Promise<void> => {
  await db
    .update(effortEstimationRequests)
    .set({
      status: "pending",
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(effortEstimationRequests.id, requestId));
};

// ---------------------------------------------------------------------------
// loadRunParams — resolves the inputs `runEffortEstimation` needs for a given
// work item. Returns null if the item has been deleted or is of type `idea`
// (ideas are never estimated) so the caller can mark the request failed.
// ---------------------------------------------------------------------------

type LoadedRunParams = {
  workspaceId: string | null;
  params: Parameters<typeof runEffortEstimation>[0];
};

const loadRunParams = async (
  workItemId: string,
): Promise<LoadedRunParams | null> => {
  const [row] = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      description: workItems.description,
      type: workItems.type,
      parentId: workItems.parentId,
      workspaceId: projects.workspaceId,
    })
    .from(workItems)
    .leftJoin(projects, eq(projects.id, workItems.projectId))
    .where(eq(workItems.id, workItemId))
    .limit(1);

  if (!row) return null;
  if (row.type === "idea") return null;

  const childRows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      type: workItems.type,
    })
    .from(workItems)
    .where(eq(workItems.parentId, workItemId));

  const config = await getCachedActiveConfig();

  return {
    workspaceId: row.workspaceId ?? null,
    params: {
      workItem: {
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        parentId: row.parentId,
        workspaceId: row.workspaceId ?? null,
      },
      children: childRows.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
      })),
      config: {
        provider: config.provider,
        model: config.model,
        temperature: Number(config.temperature),
        maxTokens: config.maxTokens,
        systemPrompt: config.systemPrompt,
      },
    },
  };
};

// ---------------------------------------------------------------------------
// processRow — single-item pipeline. Side-effects:
//   * flips the request to done / failed / pending-retry
//   * calls runEffortEstimation on the feature-flag-on path
// Throws are converted to a failure transition by the caller.
// ---------------------------------------------------------------------------

const processRow = async (row: RequestRow): Promise<"done" | "failed"> => {
  const loaded = await loadRunParams(row.workItemId);

  if (!loaded) {
    // Work item disappeared or is an idea — no point in retrying, terminal.
    await markFailed(row.id, "work item not estimable (missing or idea)");
    return "failed";
  }

  const orgKey = loaded.workspaceId ?? "unknown-org";
  const enabled = await isFeatureFlagEnabled(FEATURE_FLAG_KEY, orgKey);

  if (!enabled) {
    await markFailed(row.id, "feature flag disabled");
    return "failed";
  }

  try {
    await runEffortEstimation(loaded.params);
    await markDone(row.id);
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (row.attemptCount >= MAX_ATTEMPTS) {
      await markFailed(row.id, message);
    } else {
      // Requeue for the next sweep tick. attempt_count was already bumped
      // during the claim, so the next retry sees a strictly higher counter
      // and eventually terminates at MAX_ATTEMPTS.
      await markBackToPending(row.id, message);
    }
    return "failed";
  }
};

// ---------------------------------------------------------------------------
// runEffortEstimationSweeperOnce — single tick, usable from tests and a
// future admin "run now" endpoint.
// ---------------------------------------------------------------------------

export const runEffortEstimationSweeperOnce = async (cfg: {
  batchSize: number;
}): Promise<EffortEstimationSweeperTickResult> => {
  const started = Date.now();
  const batchSize = Math.max(1, cfg.batchSize);

  const claimed = await claimBatch(batchSize);

  let processed = 0;
  let failed = 0;

  // Sequential on purpose: respects LLM rate limits and keeps a predictable
  // concurrency of 1 per replica. Multi-replica parallelism is achieved by
  // running multiple sweeper processes — SKIP LOCKED keeps them from
  // stepping on each other.
  for (const row of claimed) {
    try {
      const outcome = await processRow(row);
      if (outcome === "done") processed += 1;
      else failed += 1;
    } catch (err) {
      // Defensive: processRow is supposed to handle its own errors, but if
      // something slips through we must not abort the whole batch.
      failed += 1;
      logger.error(
        {
          err,
          requestId: row.id,
          workItemId: row.workItemId,
        },
        "[effort-estimation-sweeper] Unhandled processRow error",
      );
      try {
        await markFailed(
          row.id,
          err instanceof Error ? err.message : String(err),
        );
      } catch (markErr) {
        logger.error(
          { err: markErr, requestId: row.id },
          "[effort-estimation-sweeper] Failed to mark row as failed after unhandled error",
        );
      }
    }
  }

  const durationMs = Date.now() - started;
  logger.info(
    {
      claimed: claimed.length,
      processed,
      failed,
      durationMs,
      batchSize,
    },
    "[effort-estimation-sweeper] Tick completed",
  );

  return { processed, failed };
};

// ---------------------------------------------------------------------------
// startEffortEstimationSweeper — setInterval + re-entrancy guard + warm-up.
// ---------------------------------------------------------------------------

export const startEffortEstimationSweeper = (
  cfg: EffortEstimationSweeperConfig,
): (() => void) => {
  const intervalMs = cfg.intervalMs;
  const batchSize = cfg.batchSize;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let warmup: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runEffortEstimationSweeperOnce({ batchSize });
    } catch (err) {
      // Swallow at tick level — setInterval must never die.
      logger.error(
        { err },
        "[effort-estimation-sweeper] Tick failed (transient, will retry next interval)",
      );
    } finally {
      running = false;
    }
  };

  warmup = setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info(
    { intervalMs, batchSize },
    "[effort-estimation-sweeper] Background sweeper started",
  );

  return () => {
    stopped = true;
    if (warmup) clearTimeout(warmup);
    warmup = null;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[effort-estimation-sweeper] Background sweeper stopped");
  };
};

// ---------------------------------------------------------------------------
// Internals exposed for tests only — not part of the public module contract.
// `computeWorkItemContentHash` is re-exported so this module has a
// side-effect-free way to surface the hashing helper to tests without them
// having to import from `@almirant/database` directly.
// ---------------------------------------------------------------------------

export const __internals = {
  computeWorkItemContentHash,
  MAX_ATTEMPTS,
  FEATURE_FLAG_KEY,
};
