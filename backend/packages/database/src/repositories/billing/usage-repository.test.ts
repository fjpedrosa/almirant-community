import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

type UsageRepository = typeof import("./usage-repository");
type CreateUsageRecordInput = Parameters<UsageRepository["createUsageRecord"]>[0];

const realClient = { ...(await import("../../client")) };

let client: PGlite;
let database: ReturnType<typeof drizzle>;
let createUsageRecord: UsageRepository["createUsageRecord"];
let UsageRecordIdempotencyConflictError: UsageRepository["UsageRecordIdempotencyConflictError"];

const workspaceId = "workspace-runtime-evidence";
const userId = "user-runtime-evidence";
const projectId = "00000000-0000-4000-8000-000000000010";
const jobId = "00000000-0000-4000-8000-000000000099";

beforeAll(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TABLE usage_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id text NOT NULL,
      user_id text,
      project_id uuid,
      job_id uuid,
      idempotency_key varchar(255),
      session_type varchar(32) NOT NULL,
      started_at timestamptz NOT NULL,
      ended_at timestamptz NOT NULL,
      duration_seconds integer NOT NULL,
      tokens_used bigint,
      runtime_evidence jsonb,
      provider_cost_usd numeric(20, 9),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX usage_records_idempotency_key_unique_idx
      ON usage_records (idempotency_key);
  `);
  database = drizzle(client);
  mock.module("../../client", () => ({ db: database }));
  ({
    createUsageRecord,
    UsageRecordIdempotencyConflictError,
  } = await import("./usage-repository"));
});

afterAll(async () => {
  mock.module("../../client", () => realClient);
  mock.restore();
  await client.close();
});

beforeEach(async () => {
  await client.exec("DELETE FROM usage_records");
});

const startedAt = new Date("2026-08-21T12:00:00.000Z");
const endedAt = new Date("2026-08-21T12:01:00.000Z");

const baseInput = (
  runtimeEvidence: CreateUsageRecordInput["runtimeEvidence"],
): CreateUsageRecordInput => ({
  workspaceId,
  userId,
  projectId,
  jobId,
  sessionType: "implement",
  startedAt,
  endedAt,
  durationSeconds: 60,
  tokensUsed: 20,
  runtimeEvidence,
});

describe("createUsageRecord", () => {
  it("keeps legacy keyless writes append-only and never fabricates unavailable cost", async () => {
    const unavailableEvidence = {
      schemaVersion: "runtime-evidence-v1",
      observed: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
      infrastructureProvider: "zipu",
      usage: {
        status: "unavailable",
        reason: "not_reported",
      },
    } as const;
    const input = baseInput(unavailableEvidence);

    const first = await createUsageRecord(input);
    const second = await createUsageRecord(input);

    expect(first.id).not.toBe(second.id);
    expect(first.runtimeEvidence).toEqual(unavailableEvidence);
    expect(first.providerCostUsd).toBeNull();
    expect(second.providerCostUsd).toBeNull();
    const count = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM usage_records",
    );
    expect(count.rows[0]?.count).toBe(2);
  });

  it("returns one durable row for identical keyed replay and rejects conflicting evidence", async () => {
    const reportedEvidence = {
      schemaVersion: "runtime-evidence-v1",
      observed: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
      infrastructureProvider: "zipu",
      usage: {
        status: "reported",
        source: "terminal_aggregate",
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        cost: { totalUsd: 0.0123 },
      },
    } as const;
    const input: CreateUsageRecordInput = {
      ...baseInput(reportedEvidence),
      idempotencyKey: `agent-job:${jobId}:terminal`,
    };

    const first = await createUsageRecord(input);
    const replay = await createUsageRecord(input);

    expect(replay.id).toBe(first.id);
    expect(replay.runtimeEvidence).toEqual(reportedEvidence);
    expect(Number(replay.providerCostUsd)).toBe(0.0123);
    const count = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM usage_records WHERE idempotency_key = $1",
      [input.idempotencyKey!],
    );
    expect(count.rows[0]?.count).toBe(1);

    const conflictingEvidence = {
      ...reportedEvidence,
      usage: {
        ...reportedEvidence.usage,
        outputTokens: 9,
        totalTokens: 21,
      },
    } as const;

    await expect(createUsageRecord({
      ...input,
      runtimeEvidence: conflictingEvidence,
    })).rejects.toBeInstanceOf(UsageRecordIdempotencyConflictError);
    await expect(createUsageRecord({
      ...input,
      runtimeEvidence: conflictingEvidence,
    })).rejects.toMatchObject({
      name: "UsageRecordIdempotencyConflictError",
      code: "USAGE_RECORD_IDEMPOTENCY_CONFLICT",
      message: "Usage record idempotency conflict",
    });

    const durable = await client.query<{
      runtime_evidence: unknown;
      provider_cost_usd: string | null;
    }>(
      "SELECT runtime_evidence, provider_cost_usd FROM usage_records WHERE idempotency_key = $1",
      [input.idempotencyKey!],
    );
    expect(durable.rows[0]?.runtime_evidence).toEqual(reportedEvidence);
    expect(Number(durable.rows[0]?.provider_cost_usd)).toBe(0.0123);
  });
});
