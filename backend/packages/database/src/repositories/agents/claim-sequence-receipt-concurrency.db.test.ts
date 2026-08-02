/**
 * Ports the receipt-ledger slice of cloud's
 * claim-sequence-receipt-concurrency.db.test.ts (issue #64 / community#16),
 * now extended (community#16c) with the two additional cases that exercise
 * `claimJobs`'s durable options and `agent-job-repository.ts`'s
 * `requestJobTerminalIntent`/`updateClaimedJobStatus` claim/terminal-intent
 * lifecycle without a Shoutrz dependency.
 *
 * Still excluded from this file (see PR body for the full accounting):
 *  - "holds the exact live claim lock until resolved-media bytes finish
 *    reading" — exercises `withLiveAgentJobClaim`, whose only real consumer
 *    is the Shoutrz-only `GET /jobs/:jobId/resolved-media/:assetId` route.
 *    Community never ports `withLiveAgentJobClaim`/`withLiveAgentJobClaimWith`
 *    at all (dead code without that consumer) — see agent-job-repository.ts.
 *  - "fails a successor release that waits on the job lock across the
 *    canonical cutoff" and "does not create an interaction after waiting on
 *    the job lock across the canonical cutoff" — both seed
 *    `site_targets`/`site_build_runs` rows and assert on the Shoutrz
 *    execution-deadline fence, which community's adapted
 *    `updateClaimedJobStatus`/`createFencedJobInteraction` deliberately do
 *    not implement (no `site_build_runs` table in community).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  ClaimSequenceReceiptConflictError,
  persistFencedSessionEvents,
  persistReceiptFreeLegacyAgentJobLogs,
  persistReceiptFreeLegacyNativeEvents,
  persistReceiptFreeLegacySessionEvents,
} from "./claim-sequence-receipt-repository";
import { claimJobs, requestJobTerminalIntent, updateClaimedJobStatus } from "./agent-job-repository";

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB_URL)("claim sequence receipts (real PostgreSQL)", () => {
  let sql: ReturnType<typeof postgres>;
  const createdJobIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdWorkerIds: string[] = [];

  beforeAll(() => {
    sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  });

  afterEach(async () => {
    if (createdJobIds.length > 0) {
      await sql`DELETE FROM agent_jobs WHERE id = ANY(${createdJobIds.splice(0)})`;
    }
    if (createdWorkspaceIds.length > 0) {
      await sql`DELETE FROM workspace WHERE id = ANY(${createdWorkspaceIds.splice(0)})`;
    }
    if (createdWorkerIds.length > 0) {
      await sql`DELETE FROM worker_registrations WHERE worker_id = ANY(${createdWorkerIds.splice(0)})`;
    }
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const createClaim = async (claimAttemptId: string) => {
    const jobs = await sql`
      INSERT INTO agent_jobs (provider, config, status, worker_id)
      VALUES (
        'claude-code',
        ${sql.json({ repoPath: ".", baseBranch: "main", claimAttemptId })},
        'running',
        'worker-receipt-test'
      )
      RETURNING id
    `;
    const jobId = jobs[0]!.id as string;
    createdJobIds.push(jobId);
    await sql`
      INSERT INTO agent_job_claim_sequence_receipts (
        job_id, claim_attempt_id, worker_id,
        job_log_sequence_start, job_log_sequence_end,
        session_event_sequence_start, session_event_sequence_end,
        native_event_sequence_start, native_event_sequence_end
      ) VALUES (
        ${jobId}, ${claimAttemptId}, 'worker-receipt-test',
        1, 4096, 1, 4096, 1, 4096
      )
    `;
    return jobId;
  };

  it("serializes duplicate bridge inserts and increments receipt coverage once", async () => {
    const claimAttemptId = crypto.randomUUID();
    const jobId = await createClaim(claimAttemptId);
    const value = [{
      claimAttemptId,
      event: {
        agentJobId: jobId,
        sequenceNum: 1,
        sequenceProtocolVersion: "durable.v2" as const,
        kind: "system.info",
        payload: { marker: "receipt-concurrency" },
      },
    }];

    const results = await Promise.all([
      persistFencedSessionEvents(value),
      persistFencedSessionEvents(value),
    ]);

    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    const [receipt] = await sql`
      SELECT session_event_inserted_count AS count
      FROM agent_job_claim_sequence_receipts
      WHERE job_id = ${jobId} AND claim_attempt_id = ${claimAttemptId}
    `;
    expect(Number(receipt!.count)).toBe(1);
  });

  it("serializes a claim-first race and fences every legacy channel from the reserved ranges", async () => {
    const claimAttemptId = crypto.randomUUID();
    const workspaceId = `workspace-claim-first-${crypto.randomUUID()}`;
    createdWorkspaceIds.push(workspaceId);
    await sql`
      INSERT INTO workspace (id, name, slug)
      VALUES (${workspaceId}, 'Claim First Test', ${workspaceId})
    `;
    const jobs = await sql`
      INSERT INTO agent_jobs (provider, config, status, workspace_id)
      VALUES (
        'claude-code',
        ${sql.json({ repoPath: ".", baseBranch: "main" })},
        'queued',
        ${workspaceId}
      )
      RETURNING id
    `;
    const jobId = jobs[0]!.id as string;
    createdJobIds.push(jobId);

    let markClaimLocked!: () => void;
    let releaseClaim!: () => void;
    const claimLocked = new Promise<void>((resolve) => {
      markClaimLocked = resolve;
    });
    const claimRelease = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const claimTransaction = sql.begin(async (tx) => {
      // postgres.js 3.4.8 exposes TransactionSql as callable at runtime, but
      // its bundled type in this workspace omits the tagged-template signature.
      const txSql = tx as unknown as typeof sql;
      await txSql`SELECT id FROM agent_jobs WHERE id = ${jobId} FOR UPDATE`;
      markClaimLocked();
      await claimRelease;
      await txSql`
        UPDATE agent_jobs
        SET status = 'running',
            worker_id = 'worker-claim-first',
            config = jsonb_set(config, '{claimAttemptId}', ${JSON.stringify(claimAttemptId)}::jsonb, true)
        WHERE id = ${jobId}
      `;
      await txSql`
        INSERT INTO agent_job_claim_sequence_receipts (
          job_id, claim_attempt_id, worker_id,
          job_log_sequence_start, job_log_sequence_end,
          session_event_sequence_start, session_event_sequence_end,
          native_event_sequence_start, native_event_sequence_end
        ) VALUES (
          ${jobId}, ${claimAttemptId}, 'worker-claim-first',
          1, 4096, 1, 4096, 1, 4096
        )
      `;
    });

    await claimLocked;
    const legacyWrites = [
      persistReceiptFreeLegacyAgentJobLogs([{
        jobId,
        orgId: workspaceId,
        seq: 1,
        level: "info",
        phase: "legacy",
        eventType: "legacy.log.race",
        message: "must not enter the reserved log range",
        payload: {},
        contentType: "text",
        timestamp: new Date(),
      }]),
      persistReceiptFreeLegacySessionEvents([{
        agentJobId: jobId,
        sequenceNum: 1,
        kind: "legacy.session.race",
        payload: { marker: "must-not-enter-session-reservation" },
      }]),
      persistReceiptFreeLegacyNativeEvents([{
        agentJobId: jobId,
        sequenceNum: 1,
        nativeEventType: "legacy.native.race",
        sourceFormat: "legacy-test",
        payload: { marker: "must-not-enter-native-reservation" },
      }]),
    ];

    // Wait until the repository transaction is actually blocked behind the
    // claim's row lock, then release the deterministic barrier.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [waiting] = await sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%agent_jobs%FOR UPDATE%'
        ) AS blocked
      `;
      if (waiting?.blocked === true) break;
      if (attempt === 99) throw new Error("legacy writer did not reach the job-row barrier");
      await Bun.sleep(10);
    }

    releaseClaim();
    await claimTransaction;
    const legacyResults = await Promise.allSettled(legacyWrites);
    expect(legacyResults).toHaveLength(3);
    for (const result of legacyResults) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ClaimSequenceReceiptConflictError);
      }
    }

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM agent_job_logs WHERE job_id = ${jobId}) AS logs,
        (SELECT COUNT(*)::int FROM session_events WHERE agent_job_id = ${jobId}) AS sessions,
        (SELECT COUNT(*)::int FROM agent_native_events WHERE agent_job_id = ${jobId}) AS natives
    `;
    const [receipt] = await sql`
      SELECT
        job_log_inserted_count AS "jobLogInsertedCount",
        session_event_inserted_count AS "sessionEventInsertedCount",
        native_event_inserted_count AS "nativeEventInsertedCount",
        job_log_sequence_start AS "jobLogSequenceStart",
        session_event_sequence_start AS "sessionEventSequenceStart",
        native_event_sequence_start AS "nativeEventSequenceStart"
      FROM agent_job_claim_sequence_receipts
      WHERE job_id = ${jobId} AND claim_attempt_id = ${claimAttemptId}
    `;
    expect(counts).toMatchObject({ logs: 0, sessions: 0, natives: 0 });
    expect(receipt).toMatchObject({
      jobLogInsertedCount: 0,
      sessionEventInsertedCount: 0,
      nativeEventInsertedCount: 0,
      jobLogSequenceStart: 1,
      sessionEventSequenceStart: 1,
      nativeEventSequenceStart: 1,
    });
  });

  it("fences all legacy channels once any durable receipt exists", async () => {
    const workspaceId = `workspace-receipt-fence-${crypto.randomUUID()}`;
    createdWorkspaceIds.push(workspaceId);
    await sql`
      INSERT INTO workspace (id, name, slug)
      VALUES (${workspaceId}, 'Receipt Fence Test', ${workspaceId})
    `;
    const jobs = await sql`
      INSERT INTO agent_jobs (provider, config, status, workspace_id)
      VALUES (
        'claude-code',
        ${sql.json({ repoPath: ".", baseBranch: "main" })},
        'queued',
        ${workspaceId}
      )
      RETURNING id
    `;
    const jobId = jobs[0]!.id as string;
    createdJobIds.push(jobId);

    expect(await persistReceiptFreeLegacyAgentJobLogs([{
      jobId,
      orgId: workspaceId,
      seq: 1,
      level: "info",
      phase: "legacy",
      eventType: "legacy.log",
      message: "before receipt",
      payload: {},
      contentType: "text",
      timestamp: new Date(),
    }])).toHaveLength(1);
    expect(await persistReceiptFreeLegacySessionEvents([{
      agentJobId: jobId,
      sequenceNum: 1,
      kind: "legacy.session",
      payload: {},
    }])).toBe(1);
    expect(await persistReceiptFreeLegacyNativeEvents([{
      agentJobId: jobId,
      sequenceNum: 1,
      nativeEventType: "legacy.native",
      sourceFormat: "legacy-test",
      payload: {},
    }])).toBe(1);

    const claimAttemptId = crypto.randomUUID();
    await sql`
      INSERT INTO agent_job_claim_sequence_receipts (
        job_id, claim_attempt_id, worker_id,
        job_log_sequence_start, job_log_sequence_end,
        session_event_sequence_start, session_event_sequence_end,
        native_event_sequence_start, native_event_sequence_end
      ) VALUES (
        ${jobId}, ${claimAttemptId}, 'worker-receipt-fence',
        2, 4097, 2, 4097, 2, 4097
      )
    `;

    await expect(persistReceiptFreeLegacyAgentJobLogs([{
      jobId,
      orgId: workspaceId,
      seq: 2,
      level: "info",
      phase: "legacy",
      eventType: "legacy.log",
      message: "after receipt",
      timestamp: new Date(),
    }])).rejects.toBeInstanceOf(ClaimSequenceReceiptConflictError);
    await expect(persistReceiptFreeLegacySessionEvents([{
      agentJobId: jobId,
      sequenceNum: 2,
      kind: "legacy.session",
      payload: {},
    }])).rejects.toBeInstanceOf(ClaimSequenceReceiptConflictError);
    await expect(persistReceiptFreeLegacyNativeEvents([{
      agentJobId: jobId,
      sequenceNum: 2,
      nativeEventType: "legacy.native",
      sourceFormat: "legacy-test",
      payload: {},
    }])).rejects.toBeInstanceOf(ClaimSequenceReceiptConflictError);

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM agent_job_logs WHERE job_id = ${jobId}) AS logs,
        (SELECT COUNT(*)::int FROM session_events WHERE agent_job_id = ${jobId}) AS sessions,
        (SELECT COUNT(*)::int FROM agent_native_events WHERE agent_job_id = ${jobId}) AS natives
    `;
    expect(counts).toMatchObject({ logs: 1, sessions: 1, natives: 1 });
  });

  it("rejects a forged historical nonce even when its sequence is below another receipt", async () => {
    const claimAttemptId = crypto.randomUUID();
    const jobId = await createClaim(claimAttemptId);

    await expect(
      persistFencedSessionEvents([{
        claimAttemptId: crypto.randomUUID(),
        event: {
          agentJobId: jobId,
          sequenceNum: 1,
          sequenceProtocolVersion: "durable.v2",
          kind: "system.info",
          payload: { marker: "forged-receipt" },
        },
      }]),
    ).rejects.toBeInstanceOf(ClaimSequenceReceiptConflictError);

    const [row] = await sql`
      SELECT COUNT(*)::int AS count FROM session_events
      WHERE agent_job_id = ${jobId}
    `;
    expect(row!.count).toBe(0);
  });

  it("makes a transactionally blocked legacy-first write visible to every durable claim base", async () => {
    const workerId = `worker-legacy-first-${crypto.randomUUID()}`;
    createdWorkerIds.push(workerId);
    await sql`
      INSERT INTO worker_registrations (
        worker_id, hostname, status, max_concurrent_agents, available_slots
      ) VALUES (${workerId}, ${`${workerId}.test`}, 'online', 1, 1)
    `;
    const workspaceId = `workspace-legacy-first-${crypto.randomUUID()}`;
    createdWorkspaceIds.push(workspaceId);
    await sql`
      INSERT INTO workspace (id, name, slug)
      VALUES (${workspaceId}, 'Legacy First Test', ${workspaceId})
    `;
    const jobs = await sql`
      INSERT INTO agent_jobs (provider, config, status, workspace_id)
      VALUES (
        'claude-code',
        ${sql.json({ repoPath: ".", baseBranch: "main" })},
        'queued',
        ${workspaceId}
      )
      RETURNING id
    `;
    const jobId = jobs[0]!.id as string;
    createdJobIds.push(jobId);

    let markLegacyReady!: () => void;
    let releaseLegacy!: () => void;
    const legacyReady = new Promise<void>((resolve) => {
      markLegacyReady = resolve;
    });
    const legacyRelease = new Promise<void>((resolve) => {
      releaseLegacy = resolve;
    });
    const legacyTransaction = sql.begin(async (tx) => {
      const txSql = tx as unknown as typeof sql;
      await txSql`SELECT id FROM agent_jobs WHERE id = ${jobId} FOR UPDATE`;
      await txSql`
        INSERT INTO agent_job_logs (
          job_id, org_id, seq, level, phase, event_type, message,
          payload, content_type, timestamp
        ) VALUES (
          ${jobId}, ${workspaceId}, 7, 'info', 'legacy',
          'legacy.log.before-claim', 'claim must start after seven',
          '{}'::jsonb, 'text', NOW()
        )
      `;
      await txSql`
        INSERT INTO session_events (
          agent_job_id, sequence_num, kind, payload
        ) VALUES (
          ${jobId}, 7, 'legacy.session.before-claim', '{}'::jsonb
        )
      `;
      await txSql`
        INSERT INTO agent_native_events (
          agent_job_id, sequence_num, native_event_type, source_format, payload
        ) VALUES (
          ${jobId}, 7, 'legacy.native.before-claim', 'legacy-test', '{}'::jsonb
        )
      `;
      markLegacyReady();
      await legacyRelease;
    });

    await legacyReady;

    // SKIP LOCKED must not snapshot a base while the legacy transaction still
    // owns the job row. The next claim after commit observes all three writes.
    const claimWhileLegacyLocked = await claimJobs(workerId, 1, undefined, {
      durableSequenceReceipts: true,
    });
    expect(claimWhileLegacyLocked).toEqual([]);

    releaseLegacy();
    await legacyTransaction;

    const claimed = await claimJobs(workerId, 1, undefined, {
      durableSequenceReceipts: true,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: jobId,
      jobLogSequenceBase: 7,
      sessionEventSequenceBase: 7,
      nativeEventSequenceBase: 7,
    });
    const [receipt] = await sql`
      SELECT
        job_log_sequence_start AS "jobLogSequenceStart",
        session_event_sequence_start AS "sessionEventSequenceStart",
        native_event_sequence_start AS "nativeEventSequenceStart"
      FROM agent_job_claim_sequence_receipts
      WHERE job_id = ${jobId}
    `;
    expect(receipt).toMatchObject({
      jobLogSequenceStart: 8,
      sessionEventSequenceStart: 8,
      nativeEventSequenceStart: 8,
    });
  });

  it("keeps an external failure pending until the exact receipt is ready", async () => {
    const claimAttemptId = crypto.randomUUID();
    const jobId = await createClaim(claimAttemptId);

    const pending = await requestJobTerminalIntent(jobId, "failed", {
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out",
    });

    expect(pending).toMatchObject({
      id: jobId,
      status: "finalizing",
      workerId: "worker-receipt-test",
      config: {
        claimAttemptId,
        pendingTerminalIntent: {
          status: "failed",
          errorType: "interaction-timeout",
        },
      },
    });
    const [held] = await sql`
      SELECT status, worker_id AS "workerId", config
      FROM agent_jobs
      WHERE id = ${jobId}
    `;
    const [activeReceipt] = await sql`
      SELECT state
      FROM agent_job_claim_sequence_receipts
      WHERE job_id = ${jobId} AND claim_attempt_id = ${claimAttemptId}
    `;
    expect(held).toMatchObject({
      status: "finalizing",
      workerId: "worker-receipt-test",
    });
    expect(activeReceipt!.state).toBe("active");

    await sql`
      UPDATE agent_job_claim_sequence_receipts
      SET state = 'ready'
      WHERE job_id = ${jobId} AND claim_attempt_id = ${claimAttemptId}
    `;
    const finalized = await updateClaimedJobStatus(
      jobId,
      "cancelled",
      { workerId: "worker-receipt-test", claimAttemptId },
      { result: { runnerObservedCancellation: true } },
    );

    expect(finalized).toMatchObject({
      id: jobId,
      status: "failed",
      workerId: null,
      errorType: "interaction-timeout",
      result: { runnerObservedCancellation: true },
    });
    const [terminalReceipt] = await sql`
      SELECT state
      FROM agent_job_claim_sequence_receipts
      WHERE job_id = ${jobId} AND claim_attempt_id = ${claimAttemptId}
    `;
    expect(terminalReceipt!.state).toBe("terminal");
    expect(finalized!.config.claimAttemptId).toBeUndefined();
    expect(finalized!.config.pendingTerminalIntent).toBeUndefined();
  });
});
