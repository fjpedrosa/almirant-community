import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "../../client";
import {
  agentJobs,
  agentOutputSubmissions,
  scheduledAgentRuns,
} from "../../schema";
import { createScheduledAgentRunRepository } from "./scheduled-agent-run-repository";

const CONFIG_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000002";
const JOB_ID = "30000000-0000-4000-8000-000000000003";
const SINK_ID = "40000000-0000-4000-8000-000000000004";
const WORKSPACE_ID = "workspace-scheduled-run";
const TERMINAL_AT = "2026-07-24T17:18:07.000Z";

describe("scheduled agent terminal run reconciliation", () => {
  let client: PGlite;
  let repository: ReturnType<typeof createScheduledAgentRunRepository>;

  beforeAll(async () => {
    client = new PGlite();
    await client.exec(`
      CREATE TABLE workspace (id text PRIMARY KEY);
      CREATE TABLE scheduled_agent_configs (
        id uuid PRIMARY KEY,
        workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE
      );
      CREATE TABLE agent_jobs (
        id uuid PRIMARY KEY,
        workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
        status text NOT NULL,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        completed_at timestamptz,
        failed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE scheduled_agent_runs (
        id uuid PRIMARY KEY,
        config_id uuid NOT NULL REFERENCES scheduled_agent_configs(id) ON DELETE CASCADE,
        workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        agent_job_id uuid REFERENCES agent_jobs(id) ON DELETE SET NULL,
        due_key varchar(255) NOT NULL,
        trigger_type varchar(20) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        items_processed integer NOT NULL DEFAULT 0,
        items_succeeded integer NOT NULL DEFAULT 0,
        items_failed integer NOT NULL DEFAULT 0,
        error_message text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE agent_output_submissions (
        id uuid PRIMARY KEY,
        run_id uuid NOT NULL REFERENCES scheduled_agent_runs(id) ON DELETE CASCADE,
        job_id uuid NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
        sink_id uuid NOT NULL,
        status varchar(32) NOT NULL,
        payload jsonb,
        payload_hash char(64),
        error_code varchar(128),
        error_message text,
        submitted_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (job_id),
        UNIQUE (run_id)
      );
    `);
    const database = drizzle(client, {
      schema: {
        agentJobs,
        agentOutputSubmissions,
        scheduledAgentRuns,
      },
    });
    repository = createScheduledAgentRunRepository(
      database as unknown as Database,
    );
  });

  beforeEach(async () => {
    await client.exec(`
      TRUNCATE agent_output_submissions,
        scheduled_agent_runs,
        agent_jobs,
        scheduled_agent_configs,
        workspace CASCADE;
      INSERT INTO workspace (id) VALUES ('${WORKSPACE_ID}');
      INSERT INTO scheduled_agent_configs (id, workspace_id)
      VALUES ('${CONFIG_ID}', '${WORKSPACE_ID}');
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  const seedRun = async (input: {
    jobStatus: "running" | "completed" | "incomplete" | "failed" | "cancelled";
    requiredOutput?: boolean;
    submission?: "submitted" | "terminal_error";
    errorCode?: string;
  }) => {
    const terminalTimestamp =
      input.jobStatus === "running" ? "NULL" : `'${TERMINAL_AT}'`;
    const completedAt =
      input.jobStatus === "failed" ? "NULL" : terminalTimestamp;
    const failedAt =
      input.jobStatus === "failed" ? terminalTimestamp : "NULL";
    const outputPolicy =
      input.requiredOutput === undefined
        ? "{}"
        : JSON.stringify({
            outputPolicy: {
              sinkId: SINK_ID,
              sinkVersion: 1,
              required: input.requiredOutput,
              schemaHash: "a".repeat(64),
              schema: { type: "object" },
              maxPayloadBytes: 1024,
            },
          });

    await client.exec(`
      INSERT INTO agent_jobs (
        id, workspace_id, status, config, completed_at, failed_at
      ) VALUES (
        '${JOB_ID}',
        '${WORKSPACE_ID}',
        '${input.jobStatus}',
        '${outputPolicy}'::jsonb,
        ${completedAt},
        ${failedAt}
      );
      INSERT INTO scheduled_agent_runs (
        id, config_id, workspace_id, agent_job_id, due_key, trigger_type
      ) VALUES (
        '${RUN_ID}',
        '${CONFIG_ID}',
        '${WORKSPACE_ID}',
        '${JOB_ID}',
        'webhook:run-1',
        'webhook'
      );
    `);

    if (input.submission) {
      const isSubmitted = input.submission === "submitted";
      await client.exec(`
        INSERT INTO agent_output_submissions (
          id, run_id, job_id, sink_id, status, payload, payload_hash,
          error_code, error_message, submitted_at
        ) VALUES (
          '50000000-0000-4000-8000-000000000005',
          '${RUN_ID}',
          '${JOB_ID}',
          '${SINK_ID}',
          '${input.submission}',
          ${isSubmitted ? `'{"answer":"ok"}'::jsonb` : "NULL"},
          ${isSubmitted ? `'${"b".repeat(64)}'` : "NULL"},
          ${input.errorCode ? `'${input.errorCode}'` : "NULL"},
          ${input.errorCode ? "'Safe terminal output failure'" : "NULL"},
          '${TERMINAL_AT}'
        );
      `);
    }
  };

  const readRun = async () => {
    const result = await client.query<{
      status: string;
      completed_at: string | null;
      items_processed: number;
      items_succeeded: number;
      items_failed: number;
      error_message: string | null;
      agent_job_id: string | null;
      updated_at: string;
    }>(`
      SELECT
        status,
        completed_at::text,
        items_processed,
        items_succeeded,
        items_failed,
        error_message,
        agent_job_id::text,
        updated_at::text
      FROM scheduled_agent_runs
      WHERE id = '${RUN_ID}'
    `);
    return result.rows[0]!;
  };

  it("completes a terminal job only when its required structured output was submitted", async () => {
    await seedRun({
      jobStatus: "completed",
      requiredOutput: true,
      submission: "submitted",
    });

    expect(
      await repository.reconcileTerminalRunForJob(JOB_ID, {
        now: new Date("2026-07-24T17:19:00.000Z"),
      }),
    ).toEqual({
      reconciled: true,
      runId: RUN_ID,
      status: "completed",
    });
    expect(await readRun()).toMatchObject({
      status: "completed",
      completed_at: "2026-07-24 17:18:07+00",
      items_processed: 1,
      items_succeeded: 1,
      items_failed: 0,
      error_message: null,
    });
  });

  it("marks completed-with-terminal_error as failed using the safe stable error code", async () => {
    await seedRun({
      jobStatus: "completed",
      requiredOutput: true,
      submission: "terminal_error",
      errorCode: "missing_structured_submission",
    });

    expect(
      await repository.reconcileTerminalRunForJob(JOB_ID, {
        now: new Date("2026-07-24T17:19:00.000Z"),
      }),
    ).toEqual({
      reconciled: true,
      runId: RUN_ID,
      status: "failed",
    });
    expect(await readRun()).toMatchObject({
      status: "failed",
      items_processed: 1,
      items_succeeded: 0,
      items_failed: 1,
      error_message: "missing_structured_submission",
    });
  });

  it("waits for required output finalization instead of claiming process completion as success", async () => {
    await seedRun({
      jobStatus: "completed",
      requiredOutput: true,
    });

    expect(
      await repository.reconcileTerminalRunForJob(JOB_ID, {
        now: new Date("2026-07-24T17:19:00.000Z"),
      }),
    ).toEqual({
      reconciled: false,
      reason: "awaiting_required_output",
    });
    expect(await readRun()).toMatchObject({
      status: "pending",
      completed_at: null,
      items_processed: 0,
      items_succeeded: 0,
      items_failed: 0,
      error_message: null,
    });
  });

  it.each([
    ["failed", "failed", "agent_job_failed"],
    ["incomplete", "failed", "agent_job_incomplete"],
    ["cancelled", "cancelled", "agent_job_cancelled"],
  ] as const)(
    "maps terminal agent job %s to scheduled run %s even if output was submitted first",
    async (jobStatus, runStatus, errorCode) => {
      await seedRun({
        jobStatus,
        requiredOutput: true,
        submission: "submitted",
      });

      expect(
        await repository.reconcileTerminalRunForJob(JOB_ID, {
          now: new Date("2026-07-24T17:19:00.000Z"),
        }),
      ).toMatchObject({
        reconciled: true,
        status: runStatus,
      });
      expect(await readRun()).toMatchObject({
        status: runStatus,
        items_processed: 1,
        items_succeeded: 0,
        items_failed: 1,
        error_message: errorCode,
      });
    },
  );

  it("is idempotent and conditionally fences concurrent retries", async () => {
    await seedRun({
      jobStatus: "completed",
      requiredOutput: true,
      submission: "submitted",
    });
    const now = new Date("2026-07-24T17:19:00.000Z");

    const outcomes = await Promise.all([
      repository.reconcileTerminalRunForJob(JOB_ID, { now }),
      repository.reconcileTerminalRunForJob(JOB_ID, { now }),
    ]);
    expect(outcomes.filter((outcome) => outcome.reconciled)).toHaveLength(1);
    expect(outcomes).toContainEqual({
      reconciled: false,
      reason: "already_terminal",
    });

    const once = await readRun();
    expect(
      await repository.reconcileTerminalRunForJob(JOB_ID, {
        now: new Date("2026-07-24T18:00:00.000Z"),
      }),
    ).toEqual({
      reconciled: false,
      reason: "already_terminal",
    });
    expect(await readRun()).toEqual(once);
  });

  it("discovers terminal linked jobs left pending after callback crashes", async () => {
    await seedRun({
      jobStatus: "completed",
      requiredOutput: true,
      submission: "terminal_error",
      errorCode: "missing_structured_submission",
    });

    expect(
      await repository.findUnreconciledTerminalJobIds({ limit: 25 }),
    ).toEqual([JOB_ID]);

    await repository.reconcileTerminalRunForJob(JOB_ID);
    expect(
      await repository.findUnreconciledTerminalJobIds({ limit: 25 }),
    ).toEqual([]);
  });

  it("repairs the deterministic run/job link when dispatch crashed before linking", async () => {
    await seedRun({ jobStatus: "completed" });
    await client.exec(`
      UPDATE scheduled_agent_runs
      SET agent_job_id = NULL
      WHERE id = '${RUN_ID}';
      DELETE FROM agent_jobs
      WHERE id = '${JOB_ID}';
      INSERT INTO agent_jobs (
        id, workspace_id, status, config, completed_at
      ) VALUES (
        '${RUN_ID}',
        '${WORKSPACE_ID}',
        'completed',
        jsonb_build_object(
          'scheduledConfigId', '${CONFIG_ID}',
          'scheduledDispatchDueKey', 'webhook:run-1'
        ),
        '${TERMINAL_AT}'
      );
    `);

    expect(
      await repository.findUnreconciledTerminalJobIds({ limit: 25 }),
    ).toEqual([RUN_ID]);
    expect(
      await repository.reconcileTerminalRunForJob(RUN_ID, {
        now: new Date("2026-07-24T17:19:00.000Z"),
      }),
    ).toMatchObject({
      reconciled: true,
      runId: RUN_ID,
      status: "completed",
    });
    expect(await readRun()).toMatchObject({
      status: "completed",
      agent_job_id: RUN_ID,
    });
  });

  it("repairs an unlinked required-output run before waiting for its terminal envelope", async () => {
    await seedRun({ jobStatus: "completed", requiredOutput: true });
    await client.exec(`
      UPDATE scheduled_agent_runs
      SET agent_job_id = NULL
      WHERE id = '${RUN_ID}';
      DELETE FROM agent_jobs
      WHERE id = '${JOB_ID}';
      INSERT INTO agent_jobs (
        id, workspace_id, status, config, completed_at
      ) VALUES (
        '${RUN_ID}',
        '${WORKSPACE_ID}',
        'completed',
        jsonb_build_object(
          'scheduledConfigId', '${CONFIG_ID}',
          'scheduledDispatchDueKey', 'webhook:run-1',
          'outputPolicy', jsonb_build_object(
            'sinkId', '${SINK_ID}',
            'sinkVersion', 1,
            'required', true,
            'schemaHash', '${"a".repeat(64)}',
            'schema', '{"type":"object"}'::jsonb,
            'maxPayloadBytes', 1024
          )
        ),
        '${TERMINAL_AT}'
      );
    `);

    expect(
      await repository.reconcileTerminalRunForJob(RUN_ID, {
        now: new Date("2026-07-24T17:19:00.000Z"),
      }),
    ).toEqual({
      reconciled: false,
      reason: "awaiting_required_output",
    });
    expect(await readRun()).toMatchObject({
      status: "pending",
      agent_job_id: RUN_ID,
    });
  });

  it("fails closed when a corrupted job link crosses the workspace boundary", async () => {
    await seedRun({ jobStatus: "completed" });
    await client.exec(`
      INSERT INTO workspace (id) VALUES ('workspace-foreign');
      UPDATE agent_jobs
      SET workspace_id = 'workspace-foreign'
      WHERE id = '${JOB_ID}';
    `);

    expect(
      await repository.findUnreconciledTerminalJobIds({ limit: 25 }),
    ).toEqual([]);
    expect(
      await repository.reconcileTerminalRunForJob(JOB_ID),
    ).toEqual({
      reconciled: false,
      reason: "not_found",
    });
    expect(await readRun()).toMatchObject({
      status: "pending",
      items_processed: 0,
    });
  });
});
