CREATE TYPE "public"."integration_batch_item_failure_category" AS ENUM('merge_conflict', 'schema_semantic', 'migration_apply_failed', 'type_check_failed', 'tests_failed');--> statement-breakpoint
CREATE TYPE "public"."integration_batch_item_status" AS ENUM('pending', 'rebasing', 'migrating', 'type_checking', 'testing', 'merged', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."integration_batch_status" AS ENUM('queued', 'running', 'awaiting_release', 'merging', 'completed', 'failed', 'aborted');--> statement-breakpoint
ALTER TYPE "public"."agent_job_type" ADD VALUE 'integration';--> statement-breakpoint
ALTER TYPE "public"."column_role" ADD VALUE 'release' BEFORE 'to_document';--> statement-breakpoint
CREATE TABLE "integration_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"board_id" uuid,
	"integration_branch" varchar(255) NOT NULL,
	"base_branch" varchar(255) DEFAULT 'main' NOT NULL,
	"status" "integration_batch_status" DEFAULT 'queued' NOT NULL,
	"triggered_by_user_id" text,
	"current_item_index" integer DEFAULT 0 NOT NULL,
	"sandbox_container_id" varchar(128),
	"final_pr_url" text,
	"final_pr_number" integer,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"pr_number" integer,
	"pr_url" text,
	"branch_name" varchar(255),
	"processing_order" integer NOT NULL,
	"status" "integration_batch_item_status" DEFAULT 'pending' NOT NULL,
	"failure_category" "integration_batch_item_failure_category",
	"failure_reason" text,
	"commit_sha_before" varchar(64),
	"commit_sha_after" varchar(64),
	"migration_regenerated" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_batches" ADD CONSTRAINT "integration_batches_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_batches" ADD CONSTRAINT "integration_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_batches" ADD CONSTRAINT "integration_batches_repository_id_project_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_batches" ADD CONSTRAINT "integration_batches_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_batches" ADD CONSTRAINT "integration_batches_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_batch_items" ADD CONSTRAINT "integration_batch_items_batch_id_integration_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."integration_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_batch_items" ADD CONSTRAINT "integration_batch_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_batches_organization_idx" ON "integration_batches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_batches_project_idx" ON "integration_batches" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "integration_batches_repository_idx" ON "integration_batches" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "integration_batches_board_idx" ON "integration_batches" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "integration_batches_status_idx" ON "integration_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_batches_repository_status_idx" ON "integration_batches" USING btree ("repository_id","status");--> statement-breakpoint
CREATE INDEX "integration_batch_items_batch_idx" ON "integration_batch_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "integration_batch_items_work_item_idx" ON "integration_batch_items" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "integration_batch_items_status_idx" ON "integration_batch_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_batch_items_batch_order_idx" ON "integration_batch_items" USING btree ("batch_id","processing_order");