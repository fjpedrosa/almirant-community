import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { SQL } from "drizzle-orm";
import {
  QUEUED_RECEIPT_RESIDUE_ERROR_MESSAGE,
  QUEUED_RECEIPT_RESIDUE_ERROR_TYPE,
  failQueuedReceiptResidueCandidate,
  findQueuedReceiptResidueCandidates,
  type QueuedReceiptResidueQueryExecutor,
} from "./queued-receipt-residue-repository";

const OLD = new Date("2026-07-24T10:00:00.000Z");
const CUTOFF = new Date("2026-07-24T11:00:00.000Z");
const FAILED_AT = new Date("2026-07-24T12:00:00.000Z");

describe("queued receipt-residue repository", () => {
  let client: PGlite;
  let execute: QueuedReceiptResidueQueryExecutor;

  beforeAll(async () => {
    client = new PGlite();
    const database = drizzle(client);
    execute = async <T>(
      query: SQL<T>,
    ): Promise<T[]> => {
      const result = await database.execute(query);
      return result.rows as T[];
    };

    await client.exec(`
      CREATE TABLE agent_jobs (
        id uuid PRIMARY KEY,
        status text NOT NULL,
        worker_id text,
        config jsonb NOT NULL,
        result jsonb,
        failed_at timestamptz,
        error_type text,
        error_message text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );

      CREATE TABLE agent_job_claim_sequence_receipts (
        job_id uuid NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
        claim_attempt_id text NOT NULL,
        worker_id text NOT NULL,
        state text NOT NULL DEFAULT 'active',
        job_log_sequence_start integer NOT NULL DEFAULT 1,
        job_log_sequence_end integer NOT NULL DEFAULT 4096,
        job_log_emitted_through integer,
        job_log_inserted_count integer NOT NULL DEFAULT 0,
        session_event_sequence_start integer NOT NULL DEFAULT 1,
        session_event_sequence_end integer NOT NULL DEFAULT 4096,
        session_event_emitted_through integer,
        session_event_inserted_count integer NOT NULL DEFAULT 0,
        native_event_sequence_start integer NOT NULL DEFAULT 1,
        native_event_sequence_end integer NOT NULL DEFAULT 4096,
        native_event_emitted_through integer,
        native_event_inserted_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        finalized_at timestamptz,
        PRIMARY KEY (job_id, claim_attempt_id)
      );
    `);
  });

  beforeEach(async () => {
    await client.exec(`
      DELETE FROM agent_job_claim_sequence_receipts;
      DELETE FROM agent_jobs;
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  const insertJob = async (input?: {
    id?: string;
    status?: string;
    workerId?: string | null;
    config?: Record<string, unknown>;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<string> => {
    const id = input?.id ?? crypto.randomUUID();
    await client.query(
      `INSERT INTO agent_jobs (
        id, status, worker_id, config, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        id,
        input?.status ?? "queued",
        input?.workerId ?? null,
        JSON.stringify(input?.config ?? {
          repoPath: ".",
          baseBranch: "main",
        }),
        input?.createdAt ?? OLD,
        input?.updatedAt ?? OLD,
      ],
    );
    return id;
  };

  const insertReceipt = async (
    jobId: string,
    claimAttemptId: string = crypto.randomUUID(),
    state = "active",
  ): Promise<void> => {
    await client.query(
      `INSERT INTO agent_job_claim_sequence_receipts (
        job_id, claim_attempt_id, worker_id, state, created_at, updated_at
      ) VALUES ($1, $2, 'historical-worker', $3, $4, $4)`,
      [jobId, claimAttemptId, state, OLD],
    );
  };

  const find = (limit = 25) =>
    findQueuedReceiptResidueCandidates(
      { updatedBefore: CUTOFF, limit },
      execute,
    );

  test("selects and terminalizes an old workerless queued job with only a receipt row", async () => {
    expect(QUEUED_RECEIPT_RESIDUE_ERROR_TYPE).toBe(
      "DURABLE_SEQUENCE_RECEIPT_RESIDUE_REQUIRES_FRESH_DISPATCH",
    );
    const jobId = await insertJob();
    await insertReceipt(jobId, "receipt-only", "released");

    const candidates = await find();
    expect(candidates.map((candidate) => candidate.jobId)).toEqual([jobId]);

    expect(
      await failQueuedReceiptResidueCandidate(
        candidates[0]!,
        { updatedBefore: CUTOFF, failedAt: FAILED_AT },
        execute,
      ),
    ).toBe(true);

    const rows = await client.query<{
      status: string;
      error_type: string;
      error_message: string;
      result: {
        summary: string;
        filesChanged: string[];
        linesAdded: number;
        linesRemoved: number;
      };
      receipt_count: number;
    }>(
      `SELECT
        job.status,
        job.error_type,
        job.error_message,
        job.result,
        (
          SELECT count(*)::integer
          FROM agent_job_claim_sequence_receipts receipt
          WHERE receipt.job_id = job.id
        ) AS receipt_count
      FROM agent_jobs job
      WHERE job.id = $1`,
      [jobId],
    );
    expect(rows.rows[0]).toMatchObject({
      status: "failed",
      error_type: QUEUED_RECEIPT_RESIDUE_ERROR_TYPE,
      error_message: QUEUED_RECEIPT_RESIDUE_ERROR_MESSAGE,
      result: {
        summary: QUEUED_RECEIPT_RESIDUE_ERROR_MESSAGE,
        filesChanged: [],
        linesAdded: 0,
        linesRemoved: 0,
      },
      receipt_count: 1,
    });
  });

  test("selects claimAttemptId-only, v2-high-water-only, and combined residue", async () => {
    const claimOnlyId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        claimAttemptId: "orphaned-claim",
      },
    });
    const highWaterOnlyId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 4096,
          sessionEvents: 4096,
          nativeEvents: 4096,
        },
      },
    });
    const combinedId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        claimAttemptId: "combined-claim",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 8192,
          sessionEvents: 8192,
          nativeEvents: 8192,
        },
      },
    });
    await insertReceipt(combinedId, "combined-receipt", "crashed");

    const candidates = await find();
    expect(new Set(candidates.map((candidate) => candidate.jobId))).toEqual(
      new Set([claimOnlyId, highWaterOnlyId, combinedId]),
    );

    const combined = candidates.find(
      (candidate) => candidate.jobId === combinedId,
    )!;
    const configBefore = await client.query<{ config: Record<string, unknown> }>(
      "SELECT config FROM agent_jobs WHERE id = $1",
      [combinedId],
    );
    const receiptBefore = await client.query<{ receipt: Record<string, unknown> }>(
      `SELECT to_jsonb(receipt) AS receipt
       FROM agent_job_claim_sequence_receipts receipt
       WHERE job_id = $1`,
      [combinedId],
    );

    expect(
      await failQueuedReceiptResidueCandidate(
        combined,
        { updatedBefore: CUTOFF, failedAt: FAILED_AT },
        execute,
      ),
    ).toBe(true);

    const configAfter = await client.query<{
      config: Record<string, unknown>;
      status: string;
    }>("SELECT config, status FROM agent_jobs WHERE id = $1", [combinedId]);
    const receiptAfter = await client.query<{ receipt: Record<string, unknown> }>(
      `SELECT to_jsonb(receipt) AS receipt
       FROM agent_job_claim_sequence_receipts receipt
       WHERE job_id = $1`,
      [combinedId],
    );
    expect(configAfter.rows[0]).toMatchObject({
      config: configBefore.rows[0]!.config,
      status: "failed",
    });
    expect(receiptAfter.rows).toEqual(receiptBefore.rows);
  });

  test("leaves fresh, legacy marker-free, and actively claimed jobs untouched", async () => {
    const freshId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        claimAttemptId: "fresh-residue",
      },
      createdAt: OLD,
      updatedAt: FAILED_AT,
    });
    const legacyId = await insertJob();
    const activeClaimId = await insertJob({
      status: "running",
      workerId: "active-worker",
      config: {
        repoPath: ".",
        baseBranch: "main",
        claimAttemptId: "active-claim",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 4096,
          sessionEvents: 4096,
          nativeEvents: 4096,
        },
      },
    });
    await insertReceipt(activeClaimId, "active-claim");

    expect(await find()).toEqual([]);

    const rows = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM agent_jobs ORDER BY id",
    );
    expect(new Map(rows.rows.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [freshId, "queued"],
        [legacyId, "queued"],
        [activeClaimId, "running"],
      ]),
    );
  });

  test("does not select an old job while one of its receipts is still fresh", async () => {
    const jobId = await insertJob();
    await insertReceipt(jobId, "recently-active-receipt", "released");
    await client.query(
      `UPDATE agent_job_claim_sequence_receipts
       SET updated_at = $2
       WHERE job_id = $1`,
      [jobId, FAILED_AT],
    );

    expect(await find()).toEqual([]);
    const rows = await client.query<{ status: string }>(
      "SELECT status FROM agent_jobs WHERE id = $1",
      [jobId],
    );
    expect(rows.rows[0]!.status).toBe("queued");
  });

  test("returns zero when a worker claims the job after selection", async () => {
    const jobId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        claimAttemptId: "selected-claim",
      },
    });
    const [candidate] = await find();
    expect(candidate?.jobId).toBe(jobId);

    await client.query(
      `UPDATE agent_jobs
       SET status = 'running', worker_id = 'racing-worker', updated_at = $2
       WHERE id = $1`,
      [jobId, FAILED_AT],
    );

    expect(
      await failQueuedReceiptResidueCandidate(
        candidate!,
        { updatedBefore: CUTOFF, failedAt: FAILED_AT },
        execute,
      ),
    ).toBe(false);
    const rows = await client.query<{ status: string; worker_id: string }>(
      "SELECT status, worker_id FROM agent_jobs WHERE id = $1",
      [jobId],
    );
    expect(rows.rows[0]).toEqual({
      status: "running",
      worker_id: "racing-worker",
    });
  });

  test("returns zero when the selected sequence high-water marker changes", async () => {
    const jobId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 4096,
          sessionEvents: 4096,
          nativeEvents: 4096,
        },
      },
    });
    const [candidate] = await find();
    expect(candidate?.jobId).toBe(jobId);

    await client.query(
      `UPDATE agent_jobs
       SET config = jsonb_set(config, '{sequenceHighWater,jobLogs}', '8192'::jsonb)
       WHERE id = $1`,
      [jobId],
    );

    expect(
      await failQueuedReceiptResidueCandidate(
        candidate!,
        { updatedBefore: CUTOFF, failedAt: FAILED_AT },
        execute,
      ),
    ).toBe(false);
    const rows = await client.query<{
      status: string;
      config: { sequenceHighWater: { jobLogs: number } };
    }>("SELECT status, config FROM agent_jobs WHERE id = $1", [jobId]);
    expect(rows.rows[0]).toMatchObject({
      status: "queued",
      config: { sequenceHighWater: { jobLogs: 8192 } },
    });
  });

  test("returns zero when receipt markers change without touching the job row", async () => {
    const jobId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        claimAttemptId: "stable-job-marker",
      },
    });
    const [candidate] = await find();
    await insertReceipt(jobId, "receipt-added-after-selection");

    expect(
      await failQueuedReceiptResidueCandidate(
        candidate!,
        { updatedBefore: CUTOFF, failedAt: FAILED_AT },
        execute,
      ),
    ).toBe(false);
    const rows = await client.query<{ status: string }>(
      "SELECT status FROM agent_jobs WHERE id = $1",
      [jobId],
    );
    expect(rows.rows[0]!.status).toBe("queued");
  });

  test("keeps the updatedAt fence stable across database session time zones", async () => {
    const jobId = await insertJob({
      config: {
        repoPath: ".",
        baseBranch: "main",
        claimAttemptId: "timezone-stable-marker",
      },
    });
    await insertReceipt(jobId, "timezone-stable-receipt", "ready");
    await client.exec("SET TIME ZONE 'UTC'");
    const [candidate] = await find();

    await client.exec("SET TIME ZONE 'America/New_York'");
    expect(
      await failQueuedReceiptResidueCandidate(
        candidate!,
        { updatedBefore: CUTOFF, failedAt: FAILED_AT },
        execute,
      ),
    ).toBe(true);
    await client.exec("SET TIME ZONE 'UTC'");

    const rows = await client.query<{ status: string }>(
      "SELECT status FROM agent_jobs WHERE id = $1",
      [jobId],
    );
    expect(rows.rows[0]!.status).toBe("failed");
  });

  test("bounds each selection batch", async () => {
    await Promise.all([
      insertJob({
        config: {
          repoPath: ".",
          baseBranch: "main",
          claimAttemptId: "batch-a",
        },
      }),
      insertJob({
        config: {
          repoPath: ".",
          baseBranch: "main",
          claimAttemptId: "batch-b",
        },
      }),
    ]);

    expect(await find(1)).toHaveLength(1);
  });
});
