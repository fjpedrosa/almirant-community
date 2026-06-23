CREATE TYPE "public"."bug_domain" AS ENUM('frontend', 'backend', 'coding-agent', 'infrastructure', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."bug_fix_attempt_status" AS ENUM('analyzing', 'proposed', 'implementing', 'merged', 'failed');--> statement-breakpoint
ALTER TYPE "public"."agent_job_type" ADD VALUE 'bug-triage';--> statement-breakpoint
ALTER TYPE "public"."agent_job_type" ADD VALUE 'bug-fix';--> statement-breakpoint
CREATE TABLE "bug_fix_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_item_id" uuid NOT NULL,
	"cluster_id" uuid,
	"project_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"agent_job_id" uuid,
	"domain" "bug_domain",
	"root_cause" text,
	"solution_proposed" text,
	"files_affected" jsonb,
	"fix_branch" varchar(255),
	"fix_pr_url" text,
	"fix_pr_number" integer,
	"status" "bug_fix_attempt_status" DEFAULT 'analyzing' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"failure_reason" text,
	"failure_detected_by" varchar(20),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "ai_domain" "bug_domain";--> statement-breakpoint
ALTER TABLE "bug_fix_attempts" ADD CONSTRAINT "bug_fix_attempts_feedback_item_id_feedback_items_id_fk" FOREIGN KEY ("feedback_item_id") REFERENCES "public"."feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_attempts" ADD CONSTRAINT "bug_fix_attempts_cluster_id_feedback_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."feedback_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_attempts" ADD CONSTRAINT "bug_fix_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_attempts" ADD CONSTRAINT "bug_fix_attempts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_attempts" ADD CONSTRAINT "bug_fix_attempts_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_fix_attempts_feedback_item_id_idx" ON "bug_fix_attempts" USING btree ("feedback_item_id");--> statement-breakpoint
CREATE INDEX "bug_fix_attempts_cluster_id_idx" ON "bug_fix_attempts" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "bug_fix_attempts_project_id_idx" ON "bug_fix_attempts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "bug_fix_attempts_status_idx" ON "bug_fix_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bug_fix_attempts_agent_job_id_idx" ON "bug_fix_attempts" USING btree ("agent_job_id");