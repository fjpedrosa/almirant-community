import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "../../client";
import {
  agentOutputBindings,
  agentOutputDeliveries,
  agentOutputSinks,
  agentOutputSubmissions,
  scheduledAgentOutputSinks,
} from "../../schema/agent-output";
import { createAgentOutputRepository } from "./agent-output-repository";

const CONFIG_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000002";
const JOB_ID = "30000000-0000-4000-8000-000000000003";
const SINK_ID = "40000000-0000-4000-8000-000000000004";
const WORKSPACE_ID = "workspace-output";
const pinnedBinding = () => ({
  runId: RUN_ID,
  sinkId: SINK_ID,
  encryptedBinding: "ciphertext",
  bindingIv: "iv",
  bindingAuthTag: "tag",
  bindingHash: "b".repeat(64),
  keyVersion: 1,
});

describe("agent output repository", () => {
  let client: PGlite;
  let repository: ReturnType<typeof createAgentOutputRepository>;

  beforeAll(async () => {
    client = new PGlite();
    await client.exec(`
      CREATE TABLE "user" (id text PRIMARY KEY);
      CREATE TABLE workspace (id text PRIMARY KEY);
      CREATE TABLE scheduled_agent_configs (
        id uuid PRIMARY KEY,
        workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE
      );
      CREATE TABLE agent_jobs (
        id uuid PRIMARY KEY,
        workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'queued',
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        error_type varchar(255),
        error_message text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE scheduled_agent_runs (
        id uuid PRIMARY KEY,
        config_id uuid NOT NULL REFERENCES scheduled_agent_configs(id) ON DELETE CASCADE,
        workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        agent_job_id uuid REFERENCES agent_jobs(id) ON DELETE SET NULL
      );
    `);
    // The agent-output DDL below is hand-inlined rather than sourced from
    // migrations/0222_yielding_iron_lad.sql: 0222 merges cloud's 0233
    // (durable dispatch identity on scheduled_agent_runs) and 0234
    // (this domain) into one file per the R1 ledger policy, and this
    // fixture already declares scheduled_agent_runs/agent_jobs in their
    // POST-0233 shape (agent_job_id present, no due_key/trigger_type
    // needed by this suite) -- applying 0222 wholesale would re-add
    // agent_job_id and fail. This slice is exactly the agent_output_*
    // portion of 0222 (CREATE TABLEs, FKs, indexes, immutable-version
    // trigger); see scheduled-agent-authoritative-dispatch-migration-0222.test.ts
    // for the migration-file-driven verification of the full merged DDL.
    await client.exec(`
CREATE TABLE "agent_output_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sink_id" uuid NOT NULL,
	"encrypted_binding" text NOT NULL,
	"binding_iv" varchar(64) NOT NULL,
	"binding_auth_tag" varchar(64) NOT NULL,
	"binding_hash" varchar(64) NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_output_bindings_hash_check" CHECK ("agent_output_bindings"."binding_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_output_bindings_key_version_positive" CHECK ("agent_output_bindings"."key_version" > 0)
);

CREATE TABLE "agent_output_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"idempotency_key" varchar(255) NOT NULL,
	"response_status" integer,
	"last_error_code" varchar(100),
	"delivered_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_output_deliveries_status_check" CHECK ("agent_output_deliveries"."status" IN ('pending', 'delivering', 'retry_wait', 'delivered', 'dead_letter')),
	CONSTRAINT "agent_output_deliveries_attempts_nonnegative" CHECK ("agent_output_deliveries"."attempts" >= 0),
	CONSTRAINT "agent_output_deliveries_state_version_positive" CHECK ("agent_output_deliveries"."state_version" > 0)
);

CREATE TABLE "agent_output_sinks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_user_id" text,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"endpoint_origin" text NOT NULL,
	"path_template" text DEFAULT '/' NOT NULL,
	"header_templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_schema" jsonb NOT NULL,
	"schema_hash" varchar(64) NOT NULL,
	"max_payload_bytes" integer DEFAULT 262144 NOT NULL,
	"encrypted_headers" text,
	"headers_iv" varchar(64),
	"headers_auth_tag" varchar(64),
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_output_sinks_version_positive" CHECK ("agent_output_sinks"."version" > 0),
	CONSTRAINT "agent_output_sinks_max_payload_bytes_positive" CHECK ("agent_output_sinks"."max_payload_bytes" > 0),
	CONSTRAINT "agent_output_sinks_max_payload_bytes_limit" CHECK ("agent_output_sinks"."max_payload_bytes" <= 1048576),
	CONSTRAINT "agent_output_sinks_schema_hash_check" CHECK ("agent_output_sinks"."schema_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_output_sinks_headers_encryption_check" CHECK ((
        ("agent_output_sinks"."encrypted_headers" IS NULL AND "agent_output_sinks"."headers_iv" IS NULL AND "agent_output_sinks"."headers_auth_tag" IS NULL)
        OR
        ("agent_output_sinks"."encrypted_headers" IS NOT NULL AND "agent_output_sinks"."headers_iv" IS NOT NULL AND "agent_output_sinks"."headers_auth_tag" IS NOT NULL)
      ))
);

CREATE TABLE "agent_output_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"sink_id" uuid NOT NULL,
	"status" varchar(32) NOT NULL,
	"payload" jsonb,
	"payload_hash" varchar(64),
	"error_code" varchar(100),
	"error_message" varchar(255),
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_output_submissions_status_check" CHECK ("agent_output_submissions"."status" IN ('submitted', 'terminal_error')),
	CONSTRAINT "agent_output_submissions_hash_check" CHECK ("agent_output_submissions"."payload_hash" IS NULL OR "agent_output_submissions"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_output_submissions_shape_check" CHECK ((
        ("agent_output_submissions"."status" = 'submitted' AND "agent_output_submissions"."payload" IS NOT NULL AND "agent_output_submissions"."payload_hash" IS NOT NULL AND "agent_output_submissions"."error_code" IS NULL)
        OR
        ("agent_output_submissions"."status" = 'terminal_error' AND "agent_output_submissions"."payload" IS NULL AND "agent_output_submissions"."payload_hash" IS NULL AND "agent_output_submissions"."error_code" IS NOT NULL)
      ))
);

CREATE TABLE "scheduled_agent_output_sinks" (
	"config_id" uuid PRIMARY KEY NOT NULL,
	"sink_id" uuid NOT NULL,
	"sink_version" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_agent_output_sinks_version_positive" CHECK ("scheduled_agent_output_sinks"."sink_version" > 0)
);

ALTER TABLE "agent_output_bindings" ADD CONSTRAINT "agent_output_bindings_run_id_scheduled_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduled_agent_runs"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "agent_output_bindings" ADD CONSTRAINT "agent_output_bindings_sink_id_agent_output_sinks_id_fk" FOREIGN KEY ("sink_id") REFERENCES "public"."agent_output_sinks"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "agent_output_deliveries" ADD CONSTRAINT "agent_output_deliveries_submission_id_agent_output_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."agent_output_submissions"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "agent_output_sinks" ADD CONSTRAINT "agent_output_sinks_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "agent_output_sinks" ADD CONSTRAINT "agent_output_sinks_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "agent_output_submissions" ADD CONSTRAINT "agent_output_submissions_run_id_scheduled_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduled_agent_runs"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "agent_output_submissions" ADD CONSTRAINT "agent_output_submissions_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "agent_output_submissions" ADD CONSTRAINT "agent_output_submissions_sink_id_agent_output_sinks_id_fk" FOREIGN KEY ("sink_id") REFERENCES "public"."agent_output_sinks"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "scheduled_agent_output_sinks" ADD CONSTRAINT "scheduled_agent_output_sinks_config_id_scheduled_agent_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."scheduled_agent_configs"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "scheduled_agent_output_sinks" ADD CONSTRAINT "scheduled_agent_output_sinks_sink_id_agent_output_sinks_id_fk" FOREIGN KEY ("sink_id") REFERENCES "public"."agent_output_sinks"("id") ON DELETE restrict ON UPDATE no action;

CREATE UNIQUE INDEX "agent_output_bindings_run_uidx" ON "agent_output_bindings" USING btree ("run_id");

CREATE INDEX "agent_output_bindings_sink_idx" ON "agent_output_bindings" USING btree ("sink_id");

CREATE UNIQUE INDEX "agent_output_deliveries_submission_uidx" ON "agent_output_deliveries" USING btree ("submission_id");

CREATE UNIQUE INDEX "agent_output_deliveries_idempotency_uidx" ON "agent_output_deliveries" USING btree ("idempotency_key");

CREATE INDEX "agent_output_deliveries_claim_idx" ON "agent_output_deliveries" USING btree ("status","available_at","lease_expires_at");

CREATE INDEX "agent_output_sinks_workspace_idx" ON "agent_output_sinks" USING btree ("workspace_id");

CREATE UNIQUE INDEX "agent_output_submissions_run_uidx" ON "agent_output_submissions" USING btree ("run_id");

CREATE UNIQUE INDEX "agent_output_submissions_job_uidx" ON "agent_output_submissions" USING btree ("job_id");

CREATE INDEX "agent_output_submissions_sink_idx" ON "agent_output_submissions" USING btree ("sink_id");

CREATE UNIQUE INDEX "scheduled_agent_output_sinks_config_uidx" ON "scheduled_agent_output_sinks" USING btree ("config_id");

CREATE INDEX "scheduled_agent_output_sinks_sink_idx" ON "scheduled_agent_output_sinks" USING btree ("sink_id");

CREATE OR REPLACE FUNCTION prevent_agent_output_sink_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    ROW(
      NEW.workspace_id,
      NEW.version,
      NEW.endpoint_origin,
      NEW.path_template,
      NEW.header_templates,
      NEW.payload_schema,
      NEW.schema_hash,
      NEW.max_payload_bytes,
      NEW.encrypted_headers,
      NEW.headers_iv,
      NEW.headers_auth_tag,
      NEW.key_version
    ) IS DISTINCT FROM ROW(
      OLD.workspace_id,
      OLD.version,
      OLD.endpoint_origin,
      OLD.path_template,
      OLD.header_templates,
      OLD.payload_schema,
      OLD.schema_hash,
      OLD.max_payload_bytes,
      OLD.encrypted_headers,
      OLD.headers_iv,
      OLD.headers_auth_tag,
      OLD.key_version
    )
  ) THEN
    RAISE EXCEPTION 'Agent output sink versions are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_output_sinks_immutable_version_trigger
BEFORE UPDATE ON agent_output_sinks
FOR EACH ROW
EXECUTE FUNCTION prevent_agent_output_sink_version_mutation();
    `);
    const database = drizzle(client, {
      schema: {
        agentOutputBindings,
        agentOutputDeliveries,
        agentOutputSinks,
        agentOutputSubmissions,
        scheduledAgentOutputSinks,
      },
    });
    repository = createAgentOutputRepository(database as unknown as Database);
  });

  beforeEach(async () => {
    await client.exec(`
      TRUNCATE agent_output_deliveries,
        agent_output_submissions,
        agent_output_bindings,
        scheduled_agent_output_sinks,
        agent_output_sinks,
        scheduled_agent_runs,
        agent_jobs,
        scheduled_agent_configs,
        workspace CASCADE;
      INSERT INTO workspace (id) VALUES ('${WORKSPACE_ID}');
      INSERT INTO scheduled_agent_configs (id, workspace_id)
      VALUES ('${CONFIG_ID}', '${WORKSPACE_ID}');
      INSERT INTO agent_jobs (id, workspace_id, status, config)
      VALUES (
        '${JOB_ID}',
        '${WORKSPACE_ID}',
        'running',
        '{"scheduledConfigId":"${CONFIG_ID}","outputPolicy":{"sinkId":"${SINK_ID}","sinkVersion":2,"required":true,"schemaHash":"${"a".repeat(64)}","schema":{"type":"object"},"maxPayloadBytes":1024}}'
      );
      INSERT INTO scheduled_agent_runs (id, config_id, workspace_id, agent_job_id)
      VALUES ('${RUN_ID}', '${CONFIG_ID}', '${WORKSPACE_ID}', '${JOB_ID}');
      INSERT INTO agent_output_sinks (
        id, workspace_id, name, version, endpoint_origin, path_template,
        header_templates, payload_schema, schema_hash, max_payload_bytes,
        encrypted_headers, headers_iv, headers_auth_tag
      ) VALUES (
        '${SINK_ID}', '${WORKSPACE_ID}', 'Output', 2,
        'https://hooks.example.com', '/ingest/{{binding.token}}',
        '{"x-output-secret":"{{binding.secret}}"}',
        '{"type":"object"}', '${"a".repeat(64)}', 1024,
        'headers-ciphertext', 'headers-iv', 'headers-tag'
      );
      INSERT INTO scheduled_agent_output_sinks (config_id, sink_id, sink_version, required)
      VALUES ('${CONFIG_ID}', '${SINK_ID}', 2, true);
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  it("resolves only the exact enabled sink version pinned by a scheduled config", async () => {
    expect(await repository.findPolicyByConfigId(CONFIG_ID, WORKSPACE_ID)).toEqual(
      expect.objectContaining({
        required: true,
        sink: expect.objectContaining({ id: SINK_ID, version: 2 }),
      }),
    );

    await client.exec(
      `UPDATE scheduled_agent_output_sinks SET sink_version = 3 WHERE sink_id = '${SINK_ID}'`,
    );
    expect(await repository.findPolicyByConfigId(CONFIG_ID, WORKSPACE_ID)).toBeNull();
  });

  it("pins only an enabled sink from the same workspace and snapshots its version", async () => {
    await client.exec(
      `DELETE FROM scheduled_agent_output_sinks WHERE config_id = '${CONFIG_ID}'`,
    );
    expect(
      await repository.pinSink({
        configId: CONFIG_ID,
        workspaceId: WORKSPACE_ID,
        sinkId: SINK_ID,
        required: false,
      }),
    ).toMatchObject({
      configId: CONFIG_ID,
      sinkId: SINK_ID,
      sinkVersion: 2,
      required: false,
    });

    await client.exec(`
      INSERT INTO workspace (id) VALUES ('workspace-other');
      INSERT INTO agent_output_sinks (
        id, workspace_id, name, version, endpoint_origin, path_template,
        payload_schema, schema_hash, max_payload_bytes
      ) VALUES (
        '40000000-0000-4000-8000-000000000099', 'workspace-other',
        'Foreign', 1, 'https://hooks.example.net', '/',
        '{"type":"object"}', '${"a".repeat(64)}', 1024
      )
    `);
    await expect(
      repository.pinSink({
        configId: CONFIG_ID,
        workspaceId: WORKSPACE_ID,
        sinkId: "40000000-0000-4000-8000-000000000099",
        required: true,
      }),
    ).rejects.toThrow("not available");
  });

  it("persists one encrypted binding per run without accepting a different replay", async () => {
    const first = await repository.putBinding(pinnedBinding());
    const replay = await repository.putBinding({
      ...pinnedBinding(),
      encryptedBinding: "different-random-ciphertext",
      bindingIv: "different-iv",
      bindingAuthTag: "different-tag",
    });

    expect(first).toMatchObject({ created: true });
    expect(replay).toMatchObject({ created: false, replay: true });
    await expect(
      repository.putBinding({
        ...pinnedBinding(),
        encryptedBinding: "attacker-ciphertext",
        bindingIv: "attacker-iv",
        bindingAuthTag: "attacker-tag",
        bindingHash: "c".repeat(64),
      }),
    ).rejects.toThrow("binding conflict");
  });

  it("keeps a sink version immutable after config unpin and before run binding", async () => {
    await client.exec(`
      DELETE FROM scheduled_agent_output_sinks
      WHERE config_id = '${CONFIG_ID}'
    `);

    await expect(
      client.exec(`
        UPDATE agent_output_sinks
        SET version = 3,
            endpoint_origin = 'https://rerouted.example.net'
        WHERE id = '${SINK_ID}'
      `),
    ).rejects.toThrow("immutable");

    const sink = await client.query<{ version: number; endpoint_origin: string }>(
      `SELECT version, endpoint_origin
       FROM agent_output_sinks
       WHERE id = '${SINK_ID}'`,
    );
    expect(sink.rows[0]).toEqual({
      version: 2,
      endpoint_origin: "https://hooks.example.com",
    });

    expect(await repository.putBinding(pinnedBinding())).toMatchObject({
      created: true,
    });
  });

  it("authorizes from the immutable job snapshot even if the config association changes later", async () => {
    await repository.putBinding(pinnedBinding());
    await client.exec(
      `DELETE FROM scheduled_agent_output_sinks WHERE config_id = '${CONFIG_ID}'`,
    );
    expect(await repository.findCapabilityByJobId(JOB_ID)).toEqual(
      expect.objectContaining({
        job: expect.objectContaining({ id: JOB_ID }),
        run: expect.objectContaining({ id: RUN_ID }),
        sink: expect.objectContaining({ id: SINK_ID, version: 2 }),
        submission: null,
      }),
    );

    await client.exec(`
      UPDATE agent_jobs
      SET config = jsonb_set(config, '{outputPolicy,sinkVersion}', '99'::jsonb)
      WHERE id = '${JOB_ID}'
    `);
    expect(await repository.findCapabilityByJobId(JOB_ID)).toBeNull();
  });

  it("keeps a pinned sink version immutable so pending deliveries cannot be rerouted", async () => {
    await repository.putBinding(pinnedBinding());
    await expect(
      client.exec(`
        UPDATE agent_output_sinks
        SET version = 3,
            endpoint_origin = 'https://rerouted.example.net',
            path_template = '/changed',
            header_templates = '{}'::jsonb,
            encrypted_headers = NULL,
            headers_iv = NULL,
            headers_auth_tag = NULL
        WHERE id = '${SINK_ID}'
      `),
    ).rejects.toThrow("immutable");

    expect(await repository.findCapabilityByJobId(JOB_ID)).toEqual(
      expect.objectContaining({
        sink: expect.objectContaining({
          id: SINK_ID,
          version: 2,
        }),
      }),
    );

    await repository.submit({
      runId: RUN_ID,
      jobId: JOB_ID,
      sinkId: SINK_ID,
      payload: { answer: "ok" },
      payloadHash: "d".repeat(64),
      submittedAt: new Date("2026-07-24T10:00:00.000Z"),
    });
    const [claimed] = await repository.claimDeliveries({
      leaseOwner: "worker-immutable",
      now: new Date("2026-07-24T10:00:01.000Z"),
    });

    expect(claimed).toMatchObject({
      endpointOrigin: "https://hooks.example.com",
      pathTemplate: "/ingest/{{binding.token}}",
      headerTemplates: {
        "x-output-secret": "{{binding.secret}}",
      },
      encryptedHeaders: "headers-ciphertext",
      headersIv: "headers-iv",
      headersAuthTag: "headers-tag",
    });
  });

  it("atomically creates one submission and outbox delivery; identical hash replays, changed hash conflicts", async () => {
    const input = {
      runId: RUN_ID,
      jobId: JOB_ID,
      sinkId: SINK_ID,
      payload: { answer: "ok" },
      payloadHash: "d".repeat(64),
      submittedAt: new Date("2026-07-24T10:00:00.000Z"),
    };
    const first = await repository.submit(input);
    const replay = await repository.submit(input);

    expect(first).toMatchObject({ replay: false });
    expect(replay).toEqual({ ...first, replay: true });

    const deliveries = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM agent_output_deliveries`,
    );
    expect(deliveries.rows[0]?.count).toBe(1);
    await expect(
      repository.submit({ ...input, payload: { answer: "changed" }, payloadHash: "e".repeat(64) }),
    ).rejects.toThrow("submission conflict");
  });

  it("creates the missing-submission terminal envelope idempotently", async () => {
    const first = await repository.createTerminalFailure({
      runId: RUN_ID,
      jobId: JOB_ID,
      sinkId: SINK_ID,
      errorCode: "missing_structured_submission",
      errorMessage: "Required structured output was not submitted",
      submittedAt: new Date("2026-07-24T10:00:00.000Z"),
    });
    const replay = await repository.createTerminalFailure({
      runId: RUN_ID,
      jobId: JOB_ID,
      sinkId: SINK_ID,
      errorCode: "missing_structured_submission",
      errorMessage: "Required structured output was not submitted",
      submittedAt: new Date("2026-07-24T10:01:00.000Z"),
    });

    expect(first.created).toBe(true);
    expect(replay).toEqual({ created: false, submissionId: first.submissionId });
  });

  it("claims pending/retry and expired delivering rows, then fences completion and failure by lease plus state version", async () => {
    await repository.putBinding(pinnedBinding());
    const submitted = await repository.submit({
      runId: RUN_ID,
      jobId: JOB_ID,
      sinkId: SINK_ID,
      payload: { answer: "ok" },
      payloadHash: "d".repeat(64),
      submittedAt: new Date("2026-07-24T10:00:00.000Z"),
    });
    const now = new Date("2026-07-24T10:10:00.000Z");
    await client.exec(`
      UPDATE agent_output_deliveries
      SET status = 'delivering',
          attempts = 5,
          lease_owner = 'crashed-worker',
          lease_expires_at = '2026-07-24T10:09:00.000Z',
          available_at = '2026-07-24T10:00:00.000Z'
      WHERE submission_id = '${submitted.submissionId}'
    `);

    const [claimed] = await repository.claimDeliveries({
      leaseOwner: "worker-2",
      now,
      leaseMs: 60_000,
    });
    expect(claimed).toMatchObject({
      submissionId: submitted.submissionId,
      attempts: 6,
      leaseOwner: "worker-2",
    });

    expect(
      await repository.completeDelivery({
        deliveryId: claimed!.id,
        expectedStateVersion: claimed!.stateVersion - 1,
        leaseOwner: "worker-2",
        responseStatus: 204,
        now,
      }),
    ).toBe(false);
    expect(
      await repository.failDelivery({
        deliveryId: claimed!.id,
        expectedStateVersion: claimed!.stateVersion,
        leaseOwner: "worker-2",
        disposition: "dead_letter",
        errorCode: "delivery_attempts_exhausted",
        now,
      }),
    ).toBe(true);
  });
});
