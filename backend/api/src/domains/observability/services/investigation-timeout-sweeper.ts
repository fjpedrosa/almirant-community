import { logger } from "@almirant/config";
import { findZombieAttempts, markAttemptAsFailed } from "@almirant/database";

// ---------------------------------------------------------------------------
// Why this sweeper exists (CRÍTICO 1b)
// ---------------------------------------------------------------------------
//
// `findZombieAttempts` was ported to community but had NO caller: its whole
// purpose (the safety net its docstring promises) went unwired. A bug_fix_attempt
// can be left active (analyzing/proposed/implementing) after its agent_job has
// already died — e.g. the job row was deleted, the failure cascade threw, or the
// attempt was created without ever getting a live job. Without this backstop the
// attempt (and its cluster) stays stuck indefinitely.
//
// This sweeper periodically fails those zombies. It routes each one through
// `markAttemptAsFailed`, whose internal hook reopens an `investigating` cluster
// with no PR back to `open` so triage can retry — the same reopen path every
// other failure uses. `markAttemptAsFailed` is compare-and-swap guarded, so an
// attempt that raced to a terminal state between the scan and the write is a
// no-op (counted as `alreadyTerminal`, not a failure).
//
// Adapted from the enterprise `domains/admin` sweeper: community has no
// domains/admin and no `abortClusterInvestigation` service, so instead of
// aborting the cluster investigation with a bespoke actor we reuse the existing
// attempt-failure reopen path. This also unsticks feedback-item-scoped zombies
// (clusterId === null), which the enterprise version skipped.

export type ZombieAttempt = {
  id: string;
  clusterId: string | null;
};

type SweeperLogger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export interface InvestigationTimeoutSweeperDeps {
  /** Find attempts still active past `timeoutMinutes` with no live agent_job. */
  findZombies: (timeoutMinutes: number) => Promise<ZombieAttempt[]>;
  /** Fail one zombie; returns true if it transitioned (was still active). */
  failZombie: (attempt: ZombieAttempt) => Promise<boolean>;
  logger?: SweeperLogger;
}

export type InvestigationTimeoutTickResult = {
  attemptsScanned: number;
  /** Attempts transitioned active -> failed by this tick. */
  failed: number;
  /** Attempts that had already reached a terminal state (CAS no-op). */
  alreadyTerminal: number;
  /** Attempts whose fail write threw (logged, processing continues). */
  errored: number;
};

export type InvestigationTimeoutSweeperConfig = {
  intervalMs: number;
  timeoutMinutes: number;
};

export const runInvestigationTimeoutOnce = async (
  deps: InvestigationTimeoutSweeperDeps,
  args: { timeoutMinutes: number }
): Promise<InvestigationTimeoutTickResult> => {
  const log = deps.logger ?? logger;
  const started = Date.now();

  const zombies = await deps.findZombies(args.timeoutMinutes);

  const result: InvestigationTimeoutTickResult = {
    attemptsScanned: zombies.length,
    failed: 0,
    alreadyTerminal: 0,
    errored: 0,
  };

  for (const zombie of zombies) {
    try {
      const didFail = await deps.failZombie(zombie);
      if (didFail) result.failed += 1;
      else result.alreadyTerminal += 1;
    } catch (err) {
      result.errored += 1;
      log.error(
        { attemptId: zombie.id, clusterId: zombie.clusterId, err },
        "investigation-timeout-sweeper: failing zombie attempt threw (continuing)"
      );
    }
  }

  if (result.attemptsScanned > 0) {
    log.info(
      { ...result, timeoutMinutes: args.timeoutMinutes, durationMs: Date.now() - started },
      "investigation-timeout-sweep-completed"
    );
  }

  return result;
};

const productionDeps: InvestigationTimeoutSweeperDeps = {
  findZombies: async (timeoutMinutes) => {
    const rows = await findZombieAttempts(timeoutMinutes);
    return rows.map((r) => ({ id: r.id, clusterId: r.clusterId }));
  },
  failZombie: async (zombie) => {
    const updated = await markAttemptAsFailed(
      zombie.id,
      "aborted_by_timeout",
      "timeout_sweeper"
    );
    return updated !== null;
  },
};

export const startInvestigationTimeoutSweeper = (
  cfg: InvestigationTimeoutSweeperConfig,
  deps: InvestigationTimeoutSweeperDeps = productionDeps
): (() => void) => {
  const { intervalMs, timeoutMinutes } = cfg;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let warmup: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runInvestigationTimeoutOnce(deps, { timeoutMinutes });
    } catch (err) {
      logger.error(
        { err },
        "investigation-timeout-sweeper: tick failed (transient, will retry)"
      );
    } finally {
      running = false;
    }
  };

  // Warm-up after 10s so we do not race startup migrations.
  warmup = setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info(
    { intervalMs, timeoutMinutes },
    "investigation-timeout-sweeper: background sweeper started"
  );

  return () => {
    stopped = true;
    if (warmup) clearTimeout(warmup);
    warmup = null;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("investigation-timeout-sweeper: background sweeper stopped");
  };
};
