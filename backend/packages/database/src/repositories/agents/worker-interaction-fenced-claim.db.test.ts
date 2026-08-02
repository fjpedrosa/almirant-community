/**
 * Covers `createFencedJobInteraction` (community#16c / cloud#64) against real
 * PostgreSQL. Cloud has no equivalent "clean" test for this function — its
 * only coverage lives in `claim-sequence-receipt-concurrency.db.test.ts`'s
 * "does not create an interaction after waiting on the job lock across the
 * canonical cutoff" case, which is 100% about the Shoutrz execution-deadline
 * fence that community's adapted implementation does not have. This file
 * exercises the fence community DOES implement: claim ownership + job status
 * + pendingTerminalIntent, atomically re-checked in the UPDATE.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { createFencedJobInteraction } from "./worker-interaction-repository";

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB_URL)("createFencedJobInteraction (real PostgreSQL)", () => {
  let sql: ReturnType<typeof postgres>;
  const createdJobIds: string[] = [];

  beforeAll(() => {
    sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  });

  afterEach(async () => {
    if (createdJobIds.length > 0) {
      await sql`DELETE FROM agent_jobs WHERE id = ANY(${createdJobIds.splice(0)})`;
    }
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const baseInput = {
    questionType: "clarification" as const,
    questionText: "Should I proceed?",
    expiresAt: new Date(Date.now() + 60_000),
  };

  const createJob = async (
    config: Record<string, unknown>,
    status: string,
    workerId: string | null,
  ): Promise<string> => {
    const jobs = await sql`
      INSERT INTO agent_jobs (provider, config, status, worker_id)
      VALUES ('claude-code', ${sql.json(config as never)}, ${status}, ${workerId})
      RETURNING id
    `;
    const jobId = jobs[0]!.id as string;
    createdJobIds.push(jobId);
    return jobId;
  };

  it("transitions a durably claimed job to waiting_for_input and creates the interaction", async () => {
    const claimAttemptId = crypto.randomUUID();
    const jobId = await createJob({ claimAttemptId }, "running", "worker-1");

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
      workerId: "worker-1",
      claimAttemptId,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("expected created");
    expect(result.job.status).toBe("waiting_for_input");
    expect(result.interaction.agentJobId).toBe(jobId);
    expect(result.interaction.status).toBe("pending");

    const [row] = await sql`SELECT status FROM agent_jobs WHERE id = ${jobId}`;
    expect(row!.status).toBe("waiting_for_input");
  });

  it("transitions a receipt-free (no claim) job when the request also carries no claim", async () => {
    const jobId = await createJob({}, "running", "worker-1");

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("expected created");
    expect(result.job.status).toBe("waiting_for_input");
  });

  it("rejects a workerId that does not match the active claim", async () => {
    const claimAttemptId = crypto.randomUUID();
    const jobId = await createJob({ claimAttemptId }, "running", "worker-1");

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
      workerId: "worker-2",
      claimAttemptId,
    });

    expect(result.outcome).toBe("claim_conflict");
    const [row] = await sql`SELECT status FROM agent_jobs WHERE id = ${jobId}`;
    expect(row!.status).toBe("running");
  });

  it("rejects a claimAttemptId that does not match the active claim", async () => {
    const claimAttemptId = crypto.randomUUID();
    const jobId = await createJob({ claimAttemptId }, "running", "worker-1");

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
      workerId: "worker-1",
      claimAttemptId: crypto.randomUUID(),
    });

    expect(result.outcome).toBe("claim_conflict");
  });

  it("rejects a request that omits claim ownership when a durable claim is active", async () => {
    const claimAttemptId = crypto.randomUUID();
    const jobId = await createJob({ claimAttemptId }, "running", "worker-1");

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
    });

    expect(result.outcome).toBe("claim_conflict");
  });

  it("rejects a request carrying claim ownership when the job has no active claim", async () => {
    const jobId = await createJob({}, "running", "worker-1");

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
      workerId: "worker-1",
      claimAttemptId: crypto.randomUUID(),
    });

    expect(result.outcome).toBe("claim_conflict");
  });

  it("rejects a job outside the current-claim statuses (e.g. completed)", async () => {
    const jobId = await createJob({}, "completed", "worker-1");

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
    });

    expect(result.outcome).toBe("claim_conflict");
  });

  it("rejects a job with a pending terminal intent", async () => {
    const jobId = await createJob(
      {
        pendingTerminalIntent: {
          status: "cancelled",
          requestedAt: new Date().toISOString(),
        },
      },
      "running",
      "worker-1",
    );

    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: jobId,
    });

    expect(result.outcome).toBe("claim_conflict");
  });

  it("returns not_found for a nonexistent job", async () => {
    const result = await createFencedJobInteraction({
      ...baseInput,
      agentJobId: crypto.randomUUID(),
    });

    expect(result.outcome).toBe("not_found");
  });
});
