/**
 * Integration tests for the job-cancel → bug_fix_attempt cascade — the bridge
 * between an agent_jobs row transitioning to `cancelled` and its linked
 * bug_fix_attempts row. Ported from enterprise (commit d06fe720d).
 *
 * Before this cascade existed, a cancelled job left its attempt in an
 * active status (`analyzing` / `proposed` / `implementing`) until the
 * zombie sweeper picked it up ~30 min later and flagged it
 * `aborted_by_timeout` (~19% of cluster-scoped attempt failures in the
 * four days sampled in prod). With the cascade, the attempt is failed
 * immediately and the feedback item can be re-triaged within the next
 * triage cron tick (~10 min) instead.
 *
 * These tests require a live Postgres instance via DATABASE_URL. They
 * auto-skip when DATABASE_URL is unset, mirroring the pattern of the
 * enterprise DB-gated suites.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("job-cancel → bug_fix_attempt cascade", () => {
  let db: typeof import("../../client").db;
  let failActiveAttemptForCancelledJob: typeof import("./bug-fix-attempt-repository").failActiveAttemptForCancelledJob;
  let failActiveAttemptForFailedJob: typeof import("./bug-fix-attempt-repository").failActiveAttemptForFailedJob;
  let markAttemptAsFailed: typeof import("./bug-fix-attempt-repository").markAttemptAsFailed;
  let markAttemptAsMergedIfActive: typeof import("./bug-fix-attempt-repository").markAttemptAsMergedIfActive;
  let cancelJob: typeof import("./agent-job-repository").cancelJob;
  let updateJobStatus: typeof import("./agent-job-repository").updateJobStatus;
  let sql: typeof import("drizzle-orm").sql;

  const workspaceId = `cascade-ws-${randomUUID().slice(0, 8)}`;
  const projectId = randomUUID();
  const createdIds: {
    attempts: string[];
    jobs: string[];
    feedbackItems: string[];
  } = {
    attempts: [],
    jobs: [],
    feedbackItems: [],
  };

  beforeAll(async () => {
    if (!hasDb) return;
    ({ db } = await import("../../client"));
    ({
      failActiveAttemptForCancelledJob,
      failActiveAttemptForFailedJob,
      markAttemptAsFailed,
      markAttemptAsMergedIfActive,
    } = await import("./bug-fix-attempt-repository"));
    // Cache-busted import: `agent-job-repository.claim-sql.test.ts` runs
    // earlier in the suite and leaves a mock-bound instance of this module
    // in bun's module cache (its afterAll restores the dependency mocks,
    // but not modules already evaluated against them). The query string
    // forces a fresh evaluation that resolves the restored real deps.
    const freshAgentJobRepository = "./agent-job-repository?cancel-cascade-real";
    ({ cancelJob, updateJobStatus } = (await import(
      freshAgentJobRepository
    )) as typeof import("./agent-job-repository"));
    ({ sql } = await import("drizzle-orm"));

    await db.execute(sql`
      INSERT INTO workspace (id, name, slug, created_at)
      VALUES (
        ${workspaceId},
        'cascade-test-workspace',
        ${`cascade-test-${randomUUID().slice(0, 8)}`},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `);

    await db.execute(sql`
      INSERT INTO projects (id, workspace_id, name, status)
      VALUES (
        ${projectId},
        ${workspaceId},
        'cascade-test',
        'active'
      )
      ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    if (!hasDb) return;
    for (const id of createdIds.attempts) {
      await db.execute(sql`DELETE FROM bug_fix_attempts WHERE id = ${id}`);
    }
    for (const id of createdIds.jobs) {
      await db.execute(sql`DELETE FROM agent_jobs WHERE id = ${id}`);
    }
    for (const id of createdIds.feedbackItems) {
      await db.execute(sql`DELETE FROM feedback_items WHERE id = ${id}`);
    }
    await db.execute(sql`DELETE FROM projects WHERE id = ${projectId}`);
    await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  });

  const createJob = async (
    status: "cancelled" | "running" | "queued" = "cancelled"
  ): Promise<string> => {
    const id = randomUUID();
    await db.execute(sql`
      INSERT INTO agent_jobs (
        id, workspace_id, project_id, job_type, provider, priority,
        status, config, coding_agent, ai_provider, model
      )
      VALUES (
        ${id}, ${workspaceId}, ${projectId}, 'bug-analysis', 'claude-code',
        'medium', ${status}, '{}'::jsonb, 'claude-code', 'anthropic',
        'claude-opus-4-7'
      )
    `);
    createdIds.jobs.push(id);
    return id;
  };

  const createFeedbackItem = async (): Promise<string> => {
    const id = randomUUID();
    await db.execute(sql`
      INSERT INTO feedback_items (id, title, status, category)
      VALUES (${id}, 'cascade-test', 'triaged', 'bug')
    `);
    createdIds.feedbackItems.push(id);
    return id;
  };

  const createAttempt = async (params: {
    agentJobId: string | null;
    status: "analyzing" | "proposed" | "implementing" | "merged" | "failed";
  }): Promise<string> => {
    const id = randomUUID();
    const feedbackItemId = await createFeedbackItem();
    await db.execute(sql`
      INSERT INTO bug_fix_attempts (
        id, feedback_item_id, project_id, workspace_id, agent_job_id,
        status, attempt_number
      )
      VALUES (
        ${id}, ${feedbackItemId}, ${projectId}, ${workspaceId}, ${params.agentJobId},
        ${params.status}, 1
      )
    `);
    createdIds.attempts.push(id);
    return id;
  };

  const getAttemptStatus = async (attemptId: string): Promise<string | undefined> => {
    const rows = (await db.execute(
      sql`SELECT status FROM bug_fix_attempts WHERE id = ${attemptId}`
    )) as unknown as Array<{ status: string }>;
    return rows[0]?.status;
  };

  describe("failActiveAttemptForCancelledJob", () => {
    test("marks an active attempt as failed with job_cancelled reason", async () => {
      const jobId = await createJob();
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "implementing",
      });

      const updated = await failActiveAttemptForCancelledJob(jobId);

      expect(updated).not.toBeNull();
      expect(updated!.id).toBe(attemptId);
      expect(updated!.status).toBe("failed");
      expect(updated!.failureReason).toBe("job_cancelled");
      expect(updated!.failureDetectedBy).toBe("job_cancel");
    });

    test("fails an attempt in the `analyzing` state too (not just implementing)", async () => {
      const jobId = await createJob();
      await createAttempt({ agentJobId: jobId, status: "analyzing" });

      const updated = await failActiveAttemptForCancelledJob(jobId);

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("failed");
    });

    test("does not touch an attempt that is already `merged` (terminal)", async () => {
      const jobId = await createJob();
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "merged",
      });

      const result = await failActiveAttemptForCancelledJob(jobId);

      expect(result).toBeNull();
      expect(await getAttemptStatus(attemptId)).toBe("merged");
    });

    test("does not touch an attempt that is already `failed` (idempotent)", async () => {
      const jobId = await createJob();
      await createAttempt({ agentJobId: jobId, status: "failed" });

      const result = await failActiveAttemptForCancelledJob(jobId);

      expect(result).toBeNull();
    });

    test("returns null when no attempt is linked to the job", async () => {
      const result = await failActiveAttemptForCancelledJob(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe("cascade wiring from agent-job-repository", () => {
    test("cancelJob cascades: the linked active attempt does not stay orphaned", async () => {
      const jobId = await createJob("running");
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "implementing",
      });

      const cancelled = await cancelJob(jobId);

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe("cancelled");
      expect(await getAttemptStatus(attemptId)).toBe("failed");
    });

    test("updateJobStatus(status: 'cancelled') cascades to the linked attempt", async () => {
      const jobId = await createJob("running");
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "analyzing",
      });

      const updated = await updateJobStatus(jobId, "cancelled");

      expect(updated).not.toBeNull();
      expect(await getAttemptStatus(attemptId)).toBe("failed");
    });

    test("updateJobStatus with a non-cancel status leaves the attempt untouched", async () => {
      const jobId = await createJob("running");
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "implementing",
      });

      await updateJobStatus(jobId, "completed");

      expect(await getAttemptStatus(attemptId)).toBe("implementing");
    });
  });

  // ---------------------------------------------------------------------------
  // CRÍTICO 1(a) — the cascade must also fire when a job terminates in `failed`,
  // not only `cancelled`. Most real terminations are `failed` (stale-job
  // recovery, 4h timeout, orchestrator quota/retry-window, worker POST status).
  // Without this, a bug_fix_attempt whose job dies `failed` stays active
  // ("implementing") forever and the cluster never reopens.
  // ---------------------------------------------------------------------------
  describe("cascade on job failure", () => {
    test("failActiveAttemptForFailedJob marks an active attempt failed with a failure reason", async () => {
      const jobId = await createJob();
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "implementing",
      });

      const updated = await failActiveAttemptForFailedJob(jobId);

      expect(updated).not.toBeNull();
      expect(updated!.id).toBe(attemptId);
      expect(updated!.status).toBe("failed");
      expect(updated!.failureReason).toBe("job_failed");
      expect(updated!.failureDetectedBy).toBe("job_failure");
    });

    test("failActiveAttemptForFailedJob is idempotent against already-terminal attempts", async () => {
      const jobId = await createJob();
      await createAttempt({ agentJobId: jobId, status: "merged" });

      const result = await failActiveAttemptForFailedJob(jobId);

      expect(result).toBeNull();
    });

    test("updateJobStatus(status: 'failed') cascades to the linked active attempt", async () => {
      const jobId = await createJob("running");
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "analyzing",
      });

      const updated = await updateJobStatus(jobId, "failed", {
        errorType: "worker-crash",
        errorMessage: "boom",
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("failed");
      expect(await getAttemptStatus(attemptId)).toBe("failed");
    });

    test("updateJobStatus(status: 'failed') does NOT clobber an already-merged attempt", async () => {
      // A PR merged the attempt just before the job was marked failed; the
      // cascade goes through the compare-and-swap and must leave `merged`.
      const jobId = await createJob("running");
      const attemptId = await createAttempt({
        agentJobId: jobId,
        status: "merged",
      });

      await updateJobStatus(jobId, "failed", { errorType: "timeout" });

      expect(await getAttemptStatus(attemptId)).toBe("merged");
    });
  });

  // ---------------------------------------------------------------------------
  // CRÍTICO 2 — compare-and-swap on the terminal writes. markAttemptAsFailed
  // must NOT clobber an attempt that has already reached a terminal state
  // (merged / failed), and the merge write must NOT resurrect a terminal
  // `failed` attempt. These reproduce the TOCTOU interleaving where a
  // just-merged PR (webhook or reconciler) races a fail write over the same row.
  // ---------------------------------------------------------------------------
  describe("markAttemptAsFailed compare-and-swap", () => {
    test("fails an active (implementing) attempt and returns the row", async () => {
      const attemptId = await createAttempt({
        agentJobId: null,
        status: "implementing",
      });

      const updated = await markAttemptAsFailed(attemptId, "boom", "test");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("failed");
      expect(updated!.failureReason).toBe("boom");
    });

    test("does NOT clobber an already-merged attempt (returns null, stays merged)", async () => {
      const attemptId = await createAttempt({
        agentJobId: null,
        status: "merged",
      });

      const result = await markAttemptAsFailed(attemptId, "boom", "test");

      expect(result).toBeNull();
      expect(await getAttemptStatus(attemptId)).toBe("merged");
    });

    test("is a no-op on an already-failed attempt (idempotent, returns null)", async () => {
      const attemptId = await createAttempt({
        agentJobId: null,
        status: "failed",
      });

      const result = await markAttemptAsFailed(attemptId, "boom", "test");

      expect(result).toBeNull();
      expect(await getAttemptStatus(attemptId)).toBe("failed");
    });

    test("TOCTOU interleaving: a merge that lands first wins over a later fail", async () => {
      // Simulate: SELECT saw the attempt active, but a merge webhook committed
      // `merged` before our fail UPDATE runs. The fail must lose (no-op).
      const attemptId = await createAttempt({
        agentJobId: null,
        status: "implementing",
      });

      // Merge lands first (the winning write).
      const merged = await markAttemptAsMergedIfActive(attemptId);
      expect(merged).not.toBeNull();
      expect(merged!.status).toBe("merged");

      // Fail arrives second — must not overwrite the merged terminal state.
      const failed = await markAttemptAsFailed(attemptId, "job_failed", "system");
      expect(failed).toBeNull();
      expect(await getAttemptStatus(attemptId)).toBe("merged");
    });
  });

  describe("markAttemptAsMergedIfActive compare-and-swap (merge path)", () => {
    test("merges an active (implementing) attempt", async () => {
      const attemptId = await createAttempt({
        agentJobId: null,
        status: "implementing",
      });

      const merged = await markAttemptAsMergedIfActive(attemptId);

      expect(merged).not.toBeNull();
      expect(merged!.status).toBe("merged");
    });

    test("does NOT resurrect a terminal `failed` attempt (returns null, stays failed)", async () => {
      // A stale PR from an already-failed attempt merges late: the failed
      // attempt must not flip back to merged and re-trigger resolution.
      const attemptId = await createAttempt({
        agentJobId: null,
        status: "failed",
      });

      const result = await markAttemptAsMergedIfActive(attemptId);

      expect(result).toBeNull();
      expect(await getAttemptStatus(attemptId)).toBe("failed");
    });
  });
});
