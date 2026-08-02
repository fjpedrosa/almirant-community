CREATE TABLE "agent_job_claim_sequence_receipts" (
	"job_id" uuid NOT NULL,
	"claim_attempt_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"state" varchar(24) DEFAULT 'active' NOT NULL,
	"job_log_sequence_start" integer NOT NULL,
	"job_log_sequence_end" integer NOT NULL,
	"job_log_emitted_through" integer,
	"job_log_inserted_count" integer DEFAULT 0 NOT NULL,
	"session_event_sequence_start" integer NOT NULL,
	"session_event_sequence_end" integer NOT NULL,
	"session_event_emitted_through" integer,
	"session_event_inserted_count" integer DEFAULT 0 NOT NULL,
	"native_event_sequence_start" integer NOT NULL,
	"native_event_sequence_end" integer NOT NULL,
	"native_event_emitted_through" integer,
	"native_event_inserted_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "agent_job_claim_sequence_receipts_pk" PRIMARY KEY("job_id","claim_attempt_id"),
	CONSTRAINT "agent_job_claim_sequence_receipts_state_check" CHECK ("agent_job_claim_sequence_receipts"."state" IN ('active', 'draining', 'ready', 'released', 'terminal', 'crashed')),
	CONSTRAINT "agent_job_claim_sequence_receipts_log_range_check" CHECK ("agent_job_claim_sequence_receipts"."job_log_sequence_start" >= 1 AND "agent_job_claim_sequence_receipts"."job_log_sequence_end" >= "agent_job_claim_sequence_receipts"."job_log_sequence_start"),
	CONSTRAINT "agent_job_claim_sequence_receipts_session_range_check" CHECK ("agent_job_claim_sequence_receipts"."session_event_sequence_start" >= 1 AND "agent_job_claim_sequence_receipts"."session_event_sequence_end" >= "agent_job_claim_sequence_receipts"."session_event_sequence_start"),
	CONSTRAINT "agent_job_claim_sequence_receipts_native_range_check" CHECK ("agent_job_claim_sequence_receipts"."native_event_sequence_start" >= 1 AND "agent_job_claim_sequence_receipts"."native_event_sequence_end" >= "agent_job_claim_sequence_receipts"."native_event_sequence_start"),
	CONSTRAINT "agent_job_claim_sequence_receipts_counts_check" CHECK ("agent_job_claim_sequence_receipts"."job_log_inserted_count" >= 0 AND "agent_job_claim_sequence_receipts"."session_event_inserted_count" >= 0 AND "agent_job_claim_sequence_receipts"."native_event_inserted_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_job_claim_sequence_receipts" ADD CONSTRAINT "agent_job_claim_sequence_receipts_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_job_claim_sequence_receipts_job_state_idx" ON "agent_job_claim_sequence_receipts" USING btree ("job_id","state");