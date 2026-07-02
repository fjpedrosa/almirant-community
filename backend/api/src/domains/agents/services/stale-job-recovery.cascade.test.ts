/**
 * CRÍTICO 1(a) — the stale-job-recovery sweeps fail agent_jobs via DIRECT
 * `db.update(agentJobs)` calls that bypass `updateJobStatus`, so the
 * bug_fix_attempt cascade wired into `updateJobStatus` does not cover them.
 * This integration test drives the 4-hour timeout sweep end-to-end and asserts
 * the linked active attempt is cascaded to `failed` (before the wiring it stays
 * "implementing" forever).
 *
 * DB-gated: auto-skips when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("stale-job-recovery → bug_fix_attempt cascade (direct-update paths)", () => {
  let db: typeof import("@almirant/database").db;
  let sql: typeof import("drizzle-orm").sql;
  let runStaleJobRecoveryOnce: typeof import("./stale-job-recovery").runStaleJobRecoveryOnce;

  const workspaceId = `srcascade-ws-${randomUUID().slice(0, 8)}`;
  const projectId = randomUUID();
  const createdIds: { attempts: string[]; jobs: string[]; feedbackItems: string[] } = {
    attempts: [],
    jobs: [],
    feedbackItems: [],
  };

  beforeAll(async () => {
    if (!hasDb) return;
    ({ db } = await import("@almirant/database"));
    ({ sql } = await import("drizzle-orm"));
    ({ runStaleJobRecoveryOnce } = await import("./stale-job-recovery"));

    await db.execute(sql`
      INSERT INTO workspace (id, name, slug, created_at)
      VALUES (${workspaceId}, 'srcascade-test', ${`srcascade-${randomUUID().slice(0, 8)}`}, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO projects (id, workspace_id, name, status)
      VALUES (${projectId}, ${workspaceId}, 'srcascade-test', 'active')
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

  const createTimedOutJob = async (): Promise<string> => {
    const id = randomUUID();
    // Running job whose startedAt is > 4h ago, no worker, no session, no logs —
    // this matches ONLY the 4h timeout sweep, not the worker/finalizing sweeps.
    await db.execute(sql`
      INSERT INTO agent_jobs (
        id, workspace_id, project_id, job_type, provider, priority,
        status, config, coding_agent, ai_provider, model, started_at
      )
      VALUES (
        ${id}, ${workspaceId}, ${projectId}, 'bug-analysis', 'claude-code',
        'medium', 'running', '{}'::jsonb, 'claude-code', 'anthropic',
        'claude-opus-4-7', NOW() - INTERVAL '5 hours'
      )
    `);
    createdIds.jobs.push(id);
    return id;
  };

  const createAttempt = async (jobId: string): Promise<string> => {
    const attemptId = randomUUID();
    const feedbackItemId = randomUUID();
    await db.execute(sql`
      INSERT INTO feedback_items (id, title, status, category)
      VALUES (${feedbackItemId}, 'srcascade-test', 'triaged', 'bug')
    `);
    createdIds.feedbackItems.push(feedbackItemId);
    await db.execute(sql`
      INSERT INTO bug_fix_attempts (
        id, feedback_item_id, project_id, workspace_id, agent_job_id,
        status, attempt_number
      )
      VALUES (
        ${attemptId}, ${feedbackItemId}, ${projectId}, ${workspaceId}, ${jobId},
        'implementing', 1
      )
    `);
    createdIds.attempts.push(attemptId);
    return attemptId;
  };

  const getStatus = async (
    table: "agent_jobs" | "bug_fix_attempts",
    id: string
  ): Promise<string | undefined> => {
    const rows = (await db.execute(
      table === "agent_jobs"
        ? sql`SELECT status FROM agent_jobs WHERE id = ${id}`
        : sql`SELECT status FROM bug_fix_attempts WHERE id = ${id}`
    )) as unknown as Array<{ status: string }>;
    return rows[0]?.status;
  };

  test("4h timeout sweep fails the job AND cascades the linked attempt to failed", async () => {
    const jobId = await createTimedOutJob();
    const attemptId = await createAttempt(jobId);

    await runStaleJobRecoveryOnce();

    expect(await getStatus("agent_jobs", jobId)).toBe("failed");
    expect(await getStatus("bug_fix_attempts", attemptId)).toBe("failed");
  });
});
