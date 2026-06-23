CREATE TYPE "public"."worker_interaction_status" AS ENUM('pending', 'answered', 'timed_out', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."worker_question_type" AS ENUM('clarification', 'approval', 'choice', 'free_text');--> statement-breakpoint
ALTER TYPE "public"."agent_job_status" ADD VALUE 'waiting_for_input';--> statement-breakpoint
CREATE TABLE "worker_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_job_id" uuid NOT NULL,
	"work_item_id" uuid,
	"question_type" "worker_question_type" NOT NULL,
	"question_text" text NOT NULL,
	"question_context" jsonb,
	"options" jsonb,
	"answer_text" text,
	"answer_metadata" jsonb,
	"answered_by" text,
	"status" "worker_interaction_status" DEFAULT 'pending' NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"timeout_action" text DEFAULT 'fail' NOT NULL,
	"default_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worker_interactions" ADD CONSTRAINT "worker_interactions_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_interactions" ADD CONSTRAINT "worker_interactions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_interactions" ADD CONSTRAINT "worker_interactions_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worker_interactions_job_status_idx" ON "worker_interactions" USING btree ("agent_job_id","status");--> statement-breakpoint
CREATE INDEX "worker_interactions_work_item_idx" ON "worker_interactions" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "worker_interactions_expires_pending_idx" ON "worker_interactions" USING btree ("expires_at") WHERE status = 'pending';