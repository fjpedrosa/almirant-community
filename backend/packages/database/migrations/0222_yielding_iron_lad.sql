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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "scheduled_agent_output_sinks" (
	"config_id" uuid PRIMARY KEY NOT NULL,
	"sink_id" uuid NOT NULL,
	"sink_version" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_agent_output_sinks_version_positive" CHECK ("scheduled_agent_output_sinks"."sink_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD COLUMN "agent_job_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD COLUMN "due_key" varchar(255);--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD COLUMN "trigger_type" varchar(20);--> statement-breakpoint
-- Backfill due_key/trigger_type for rows that predate the authoritative-dispatch
-- durable occurrence-identity model (parity with cloud migration 0233). Every
-- pre-existing row gets a synthetic legacy key so the NOT NULL constraints and
-- the unique(config_id, due_key) index below can be applied safely.
UPDATE "scheduled_agent_runs"
SET
  "due_key" = 'legacy:' || "id"::text,
  "trigger_type" = 'legacy'
WHERE "due_key" IS NULL OR "trigger_type" IS NULL;--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ALTER COLUMN "due_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ALTER COLUMN "trigger_type" SET NOT NULL;--> statement-breakpoint
-- Backfill scheduled_agent_mcp_servers from the legacy inline
-- target_config.customFilters.__agent.selectedMcpServerIds array so
-- dispatch-time tooling resolution (agent-tooling-resolution.ts) has a
-- normalized association to read instead of reaching back into the legacy
-- jsonb blob (parity with cloud migration 0233).
INSERT INTO "scheduled_agent_mcp_servers" (
  "agent_id",
  "mcp_server_id",
  "enabled"
)
SELECT DISTINCT
  config."id",
  server."id",
  true
FROM "scheduled_agent_configs" AS config
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(
      config."target_config" #> '{customFilters,__agent,selectedMcpServerIds}'
    ) = 'array'
    THEN config."target_config" #> '{customFilters,__agent,selectedMcpServerIds}'
    ELSE '[]'::jsonb
  END
) AS selected("mcp_server_id")
INNER JOIN "mcp_servers" AS server
  ON server."id"::text = selected."mcp_server_id"
  AND server."workspace_id" = config."workspace_id"
ON CONFLICT ("agent_id", "mcp_server_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "agent_output_bindings" ADD CONSTRAINT "agent_output_bindings_run_id_scheduled_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduled_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_output_bindings" ADD CONSTRAINT "agent_output_bindings_sink_id_agent_output_sinks_id_fk" FOREIGN KEY ("sink_id") REFERENCES "public"."agent_output_sinks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_output_deliveries" ADD CONSTRAINT "agent_output_deliveries_submission_id_agent_output_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."agent_output_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_output_sinks" ADD CONSTRAINT "agent_output_sinks_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_output_sinks" ADD CONSTRAINT "agent_output_sinks_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_output_submissions" ADD CONSTRAINT "agent_output_submissions_run_id_scheduled_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduled_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_output_submissions" ADD CONSTRAINT "agent_output_submissions_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_output_submissions" ADD CONSTRAINT "agent_output_submissions_sink_id_agent_output_sinks_id_fk" FOREIGN KEY ("sink_id") REFERENCES "public"."agent_output_sinks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_output_sinks" ADD CONSTRAINT "scheduled_agent_output_sinks_config_id_scheduled_agent_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."scheduled_agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_output_sinks" ADD CONSTRAINT "scheduled_agent_output_sinks_sink_id_agent_output_sinks_id_fk" FOREIGN KEY ("sink_id") REFERENCES "public"."agent_output_sinks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_output_bindings_run_uidx" ON "agent_output_bindings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_output_bindings_sink_idx" ON "agent_output_bindings" USING btree ("sink_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_output_deliveries_submission_uidx" ON "agent_output_deliveries" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_output_deliveries_idempotency_uidx" ON "agent_output_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_output_deliveries_claim_idx" ON "agent_output_deliveries" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "agent_output_sinks_workspace_idx" ON "agent_output_sinks" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_output_submissions_run_uidx" ON "agent_output_submissions" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_output_submissions_job_uidx" ON "agent_output_submissions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_output_submissions_sink_idx" ON "agent_output_submissions" USING btree ("sink_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_agent_output_sinks_config_uidx" ON "scheduled_agent_output_sinks" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "scheduled_agent_output_sinks_sink_idx" ON "scheduled_agent_output_sinks" USING btree ("sink_id");--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD CONSTRAINT "scheduled_agent_runs_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Duplicate-guard sanitization for agent_jobs BEFORE the new partial unique
-- index below (parity with cloud migration 0236). Two dispatch authorities
-- (backend scheduled-agent-dispatcher tick + runner scheduler over
-- /workers/*) could previously race and create more than one active job for
-- the same (work_item_id, job_type) pair. For every such pre-existing group,
-- keep the most-advanced job (running/finalizing beats queued; ties broken
-- by the oldest created_at) and terminalize the rest as failed so the new
-- index can be created cleanly.
WITH ranked_duplicate_jobs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "work_item_id", "job_type"
      ORDER BY
        CASE "status"
          WHEN 'finalizing' THEN 1
          WHEN 'running' THEN 2
          WHEN 'waiting_for_input' THEN 3
          WHEN 'paused' THEN 4
          WHEN 'queued' THEN 5
          ELSE 6
        END ASC,
        "created_at" ASC
    ) AS "rn"
  FROM "agent_jobs"
  WHERE "work_item_id" IS NOT NULL
    AND "status" IN ('queued', 'running', 'finalizing', 'waiting_for_input', 'paused')
)
UPDATE "agent_jobs"
SET
  "status" = 'failed',
  "failed_at" = COALESCE("agent_jobs"."failed_at", now()),
  "error_type" = 'duplicate_active_job_superseded',
  "error_message" = 'superseded by duplicate-guard migration',
  "updated_at" = now()
FROM ranked_duplicate_jobs
WHERE "agent_jobs"."id" = ranked_duplicate_jobs."id"
  AND ranked_duplicate_jobs."rn" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_jobs_work_item_job_type_active_uidx" ON "agent_jobs" USING btree ("work_item_id","job_type") WHERE "agent_jobs"."work_item_id" IS NOT NULL AND "agent_jobs"."status" IN ('queued', 'running', 'finalizing', 'waiting_for_input', 'paused');--> statement-breakpoint
-- Duplicate-guard sanitization for integration_batches BEFORE the new
-- partial unique index below (parity with cloud migration 0236). Two
-- concurrent `queueReleaseIntegration` runs could both observe "no active
-- batch" for a repository and each create one. For every pre-existing group
-- of open batches sharing (workspace_id, repository_id), keep the
-- most-advanced batch (merging beats awaiting_release beats running beats
-- queued; ties broken by the oldest created_at) and abort the rest so the
-- new index can be created cleanly.
WITH ranked_duplicate_batches AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspace_id", "repository_id"
      ORDER BY
        CASE "status"
          WHEN 'merging' THEN 1
          WHEN 'awaiting_release' THEN 2
          WHEN 'running' THEN 3
          WHEN 'queued' THEN 4
          ELSE 5
        END ASC,
        "created_at" ASC
    ) AS "rn"
  FROM "integration_batches"
  WHERE "status" IN ('queued', 'running', 'awaiting_release', 'merging')
)
UPDATE "integration_batches"
SET
  "status" = 'aborted',
  "error_message" = 'superseded by duplicate-guard migration',
  "completed_at" = COALESCE("integration_batches"."completed_at", now()),
  "updated_at" = now()
FROM ranked_duplicate_batches
WHERE "integration_batches"."id" = ranked_duplicate_batches."id"
  AND ranked_duplicate_batches."rn" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_batches_repository_open_uidx" ON "integration_batches" USING btree ("workspace_id","repository_id") WHERE "integration_batches"."status" IN ('queued', 'running', 'awaiting_release', 'merging');--> statement-breakpoint
CREATE INDEX "scheduled_agent_runs_agent_job_id_idx" ON "scheduled_agent_runs" USING btree ("agent_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_agent_runs_config_due_key_idx" ON "scheduled_agent_runs" USING btree ("config_id","due_key");
-- Hand-added (Drizzle cannot express triggers/functions — same discovery as
-- PR #72's queue_user_storage_object_deletion trigger). Parity with cloud
-- migration 0234: agent_output_sinks rows are version-pinned; scheduled
-- agents bind to a specific (sink_id, sink_version) pair via
-- scheduled_agent_output_sinks, and running occurrences replay against the
-- exact policy snapshot captured at dispatch time. Mutating an existing
-- version in place would silently change the contract underneath in-flight
-- runs and already-issued encrypted bindings; a new version must be created
-- instead.
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
$$;--> statement-breakpoint
CREATE TRIGGER agent_output_sinks_immutable_version_trigger
BEFORE UPDATE ON agent_output_sinks
FOR EACH ROW
EXECUTE FUNCTION prevent_agent_output_sink_version_mutation();
