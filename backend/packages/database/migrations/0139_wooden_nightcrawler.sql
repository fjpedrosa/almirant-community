CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_job_id" uuid NOT NULL,
	"planning_session_id" uuid,
	"sequence_num" integer NOT NULL,
	"kind" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"provider" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_events_job_seq_idx" ON "session_events" USING btree ("agent_job_id","sequence_num");--> statement-breakpoint
CREATE INDEX "session_events_session_seq_idx" ON "session_events" USING btree ("planning_session_id","sequence_num");--> statement-breakpoint
CREATE INDEX "session_events_kind_idx" ON "session_events" USING btree ("kind");