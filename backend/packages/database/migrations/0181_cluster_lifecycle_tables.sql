CREATE TABLE "cluster_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"from_status" "feedback_cluster_status",
	"to_status" "feedback_cluster_status" NOT NULL,
	"triggered_by_kind" varchar(20) NOT NULL,
	"triggered_by_user_id" text,
	"triggered_by_attempt_id" uuid,
	"triggered_by_agent_job_id" uuid,
	"reason" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bug_fix_attempts" ALTER COLUMN "feedback_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD COLUMN "resolved_by_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD COLUMN "last_regression_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD COLUMN "regression_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cluster_status_history" ADD CONSTRAINT "cluster_status_history_cluster_id_feedback_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."feedback_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_status_history" ADD CONSTRAINT "cluster_status_history_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_status_history" ADD CONSTRAINT "cluster_status_history_triggered_by_attempt_id_bug_fix_attempts_id_fk" FOREIGN KEY ("triggered_by_attempt_id") REFERENCES "public"."bug_fix_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_status_history" ADD CONSTRAINT "cluster_status_history_triggered_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("triggered_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cluster_status_history_cluster_id_idx" ON "cluster_status_history" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "cluster_status_history_cluster_changed_at_idx" ON "cluster_status_history" USING btree ("cluster_id","changed_at");--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD CONSTRAINT "feedback_clusters_resolved_by_attempt_id_bug_fix_attempts_id_fk" FOREIGN KEY ("resolved_by_attempt_id") REFERENCES "public"."bug_fix_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bug_fix_attempts_cluster_attempt_number_unique_idx" ON "bug_fix_attempts" USING btree ("cluster_id","attempt_number") WHERE "bug_fix_attempts"."cluster_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bug_fix_attempts" ADD CONSTRAINT "bug_fix_attempts_target_required" CHECK ("bug_fix_attempts"."feedback_item_id" IS NOT NULL OR "bug_fix_attempts"."cluster_id" IS NOT NULL);
