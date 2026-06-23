CREATE TABLE "session_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planning_session_id" uuid NOT NULL,
	"projector_version" integer NOT NULL,
	"last_canonical_seq" integer DEFAULT 0 NOT NULL,
	"timeline" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_checkpoints" ADD CONSTRAINT "session_checkpoints_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "session_checkpoints_session_unique_idx" ON "session_checkpoints" USING btree ("planning_session_id");
--> statement-breakpoint
CREATE INDEX "session_checkpoints_updated_at_idx" ON "session_checkpoints" USING btree ("updated_at");
--> statement-breakpoint

CREATE TABLE "session_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planning_session_id" uuid NOT NULL,
	"projector_version" integer NOT NULL,
	"last_canonical_seq" integer DEFAULT 0 NOT NULL,
	"timeline" jsonb NOT NULL,
	"summary" jsonb,
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_snapshots" ADD CONSTRAINT "session_snapshots_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "session_snapshots_session_unique_idx" ON "session_snapshots" USING btree ("planning_session_id");
--> statement-breakpoint
CREATE INDEX "session_snapshots_updated_at_idx" ON "session_snapshots" USING btree ("updated_at");
--> statement-breakpoint

CREATE TABLE "agent_native_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_job_id" uuid NOT NULL,
	"planning_session_id" uuid,
	"sequence_num" integer NOT NULL,
	"native_event_type" varchar(120) NOT NULL,
	"source_format" varchar(50) DEFAULT 'sse' NOT NULL,
	"provider" "agent_provider",
	"coding_agent" "coding_agent",
	"runtime_session_id" varchar(255),
	"payload" jsonb NOT NULL,
	"emitted_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_native_events" ADD CONSTRAINT "agent_native_events_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_native_events" ADD CONSTRAINT "agent_native_events_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_native_events_job_seq_unique_idx" ON "agent_native_events" USING btree ("agent_job_id","sequence_num");
--> statement-breakpoint
CREATE INDEX "agent_native_events_session_seq_idx" ON "agent_native_events" USING btree ("planning_session_id","sequence_num");
--> statement-breakpoint
CREATE INDEX "agent_native_events_type_idx" ON "agent_native_events" USING btree ("native_event_type");
--> statement-breakpoint
CREATE INDEX "agent_native_events_received_at_idx" ON "agent_native_events" USING btree ("received_at");
