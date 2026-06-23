CREATE TYPE "public"."agent_job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_provider" AS ENUM('claude-code', 'codex');--> statement-breakpoint
CREATE TYPE "public"."worker_status" AS ENUM('online', 'offline');--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"work_item_id" uuid,
	"board_id" uuid,
	"status" "agent_job_status" DEFAULT 'queued' NOT NULL,
	"provider" "agent_provider" NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"config" jsonb NOT NULL,
	"result" jsonb,
	"worker_id" text,
	"branch_name" varchar(255),
	"worktree_path" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_message" text,
	"error_type" varchar(255),
	"pr_url" text,
	"pr_number" integer,
	"commit_sha" varchar(64),
	"cost" numeric,
	"tokens_used" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" text NOT NULL,
	"hostname" text NOT NULL,
	"status" "worker_status" DEFAULT 'offline' NOT NULL,
	"config" jsonb DEFAULT '{"providers":[],"maxConcurrentAgents":2,"projects":[]}'::jsonb NOT NULL,
	"active_jobs" integer DEFAULT 0 NOT NULL,
	"max_concurrent_agents" integer DEFAULT 2 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "allowed_types" jsonb;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD COLUMN "agent_job_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_jobs_status_idx" ON "agent_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_jobs_work_item_idx" ON "agent_jobs" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_project_idx" ON "agent_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_worker_idx" ON "agent_jobs" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_created_at_idx" ON "agent_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_registrations_worker_id_unique_idx" ON "worker_registrations" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_registrations_worker_id_idx" ON "worker_registrations" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_registrations_status_idx" ON "worker_registrations" USING btree ("status");--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_sessions_agent_job_idx" ON "ai_sessions" USING btree ("agent_job_id");