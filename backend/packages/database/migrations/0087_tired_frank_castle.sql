CREATE TYPE "public"."agent_job_type" AS ENUM('implementation', 'planning', 'review');--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "planning_session_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "job_type" "agent_job_type" DEFAULT 'implementation' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_jobs_planning_session_idx" ON "agent_jobs" USING btree ("planning_session_id");