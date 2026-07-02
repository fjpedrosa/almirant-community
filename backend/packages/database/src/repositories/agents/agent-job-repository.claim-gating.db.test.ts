import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Real-DB regression tests for the effort-estimate gating in `claimJobs`.
//
// These exercise the gating predicate against real Postgres — the only place
// the two CRITICAL bugs actually manifest:
//   * CRITICAL 1 — `NULL NOT IN (...)` evaluates to NULL (not TRUE) in SQL, so
//     an un-guarded gate would EXCLUDE prompt-only jobs (skill_name &
//     prompt_template both NULL) until the 10-minute escape.
//   * CRITICAL 2 — with the estimator disabled (no active config) no estimate
//     rows are ever written, so the gate must be skipped entirely instead of
//     making every gated job wait out the 10-minute escape.
//
// The predicate below is a faithful copy of the gate in `claimJobs`; the
// companion mock-based `agent-job-repository.claim-sql.test.ts` asserts that the
// real query string contains exactly these clauses, so the two together are
// equivalent to an end-to-end assertion while staying immune to Bun's global
// module-mock pollution (this file uses its OWN `postgres` connection and never
// imports the shared, mockable `db` singleton).
//
// Gated behind DATABASE_URL like the other DB-adjacent suites.
// ---------------------------------------------------------------------------

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB_URL)("claimJobs effort-estimate gating (real DB)", () => {
  let sql: ReturnType<typeof postgres>;

  let createdJobIds: string[] = [];
  let createdConfigIds: string[] = [];
  let deactivatedConfigIds: string[] = [];

  const insertJob = async (opts: {
    skillName: string | null;
    promptTemplate: string | null;
    createdAt?: string;
  }): Promise<string> => {
    const createdAt = opts.createdAt ?? new Date().toISOString();
    const rows = await sql`
      INSERT INTO agent_jobs (provider, config, status, skill_name, prompt_template, created_at)
      VALUES (
        'claude-code',
        ${sql.json({ repoPath: "/tmp/repo", baseBranch: "main" })},
        'queued',
        ${opts.skillName},
        ${opts.promptTemplate},
        ${createdAt}
      )
      RETURNING id
    `;
    const id = rows[0].id as string;
    createdJobIds.push(id);
    return id;
  };

  // Evaluate the EXACT gate predicate from claimJobs against real Postgres for
  // the given job id and return whether the row would be claimable.
  const passesGate = async (jobId: string): Promise<boolean> => {
    const rows = await sql`
      SELECT aj.id
      FROM agent_jobs aj
      LEFT JOIN work_item_effort_estimates e ON e.work_item_id = aj.work_item_id
      WHERE aj.id = ${jobId}
        AND aj.status = 'queued'
        AND (
          NOT EXISTS (
            SELECT 1 FROM effort_estimator_configs ec WHERE ec.is_active = true
          )
          OR (
            (aj.skill_name IS NULL OR aj.skill_name NOT IN ('runner-implement', 'runner-document'))
            AND (aj.prompt_template IS NULL OR aj.prompt_template NOT IN ('runner-implement', 'runner-document'))
          )
          OR e.id IS NOT NULL
          OR aj.created_at < NOW() - INTERVAL '10 minutes'
        )
    `;
    return rows.length === 1;
  };

  // Ensure at least one active effort_estimator_config exists so the gate is
  // ACTIVE. The partial unique index on (singleton) WHERE is_active = true means
  // we must never insert a second active row while one already exists.
  const ensureEstimatorEnabled = async (): Promise<void> => {
    const active = await sql`
      SELECT id FROM effort_estimator_configs WHERE is_active = true LIMIT 1
    `;
    if (active.length > 0) return;
    const rows = await sql`
      INSERT INTO effort_estimator_configs (provider, model, system_prompt, is_active)
      VALUES ('openai', 'gpt-4o-mini', 'estimate effort', true)
      RETURNING id
    `;
    createdConfigIds.push(rows[0].id as string);
  };

  // Turn the estimator OFF by deactivating every currently-active config,
  // remembering which ones so afterEach can restore them.
  const disableEstimator = async (): Promise<void> => {
    const active = await sql`
      SELECT id FROM effort_estimator_configs WHERE is_active = true
    `;
    for (const row of active) {
      await sql`
        UPDATE effort_estimator_configs SET is_active = false WHERE id = ${row.id}
      `;
      deactivatedConfigIds.push(row.id as string);
    }
  };

  beforeAll(() => {
    sql = postgres(process.env.DATABASE_URL!, { max: 3 });
  });

  afterEach(async () => {
    if (createdJobIds.length > 0) {
      await sql`DELETE FROM agent_jobs WHERE id = ANY(${createdJobIds})`;
      createdJobIds = [];
    }
    for (const id of deactivatedConfigIds) {
      await sql`UPDATE effort_estimator_configs SET is_active = true WHERE id = ${id}`;
    }
    deactivatedConfigIds = [];
    if (createdConfigIds.length > 0) {
      await sql`DELETE FROM effort_estimator_configs WHERE id = ANY(${createdConfigIds})`;
      createdConfigIds = [];
    }
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  test("CRITICAL 1: prompt-only job (skill_name & prompt_template NULL) is claimable even with the estimator active", async () => {
    await ensureEstimatorEnabled();
    const jobId = await insertJob({ skillName: null, promptTemplate: null });

    expect(await passesGate(jobId)).toBe(true);
  });

  test("gated runner-implement job with no estimate is NOT claimable while fresh (estimator active)", async () => {
    await ensureEstimatorEnabled();
    const jobId = await insertJob({
      skillName: "runner-implement",
      promptTemplate: "runner-implement",
    });

    expect(await passesGate(jobId)).toBe(false);
  });

  test("gated runner-implement job IS claimable via the 10-minute escape (estimator active, no estimate)", async () => {
    await ensureEstimatorEnabled();
    // A job with NULL work_item_id can never carry an estimate row, so this
    // exercises the 10-minute escape branch of the OR-chain instead.
    const jobId = await insertJob({
      skillName: "runner-implement",
      promptTemplate: "runner-implement",
      createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    });

    expect(await passesGate(jobId)).toBe(true);
  });

  test("CRITICAL 2: gated runner-implement job is claimable immediately when the estimator is disabled", async () => {
    await disableEstimator();
    const jobId = await insertJob({
      skillName: "runner-implement",
      promptTemplate: "runner-implement",
    });

    expect(await passesGate(jobId)).toBe(true);
  });
});
