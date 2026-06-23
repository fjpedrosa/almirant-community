CREATE TYPE "public"."handbook_capture_proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."handbook_entry_source_type" AS ENUM('import', 'agent_capture', 'manual');--> statement-breakpoint
CREATE TYPE "public"."handbook_entry_status" AS ENUM('draft', 'verified', 'deprecated');--> statement-breakpoint
CREATE TABLE "handbook_capture_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" varchar(500) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"summary" text,
	"proposed_content" text NOT NULL,
	"category" varchar(120) DEFAULT 'general' NOT NULL,
	"rationale" text,
	"status" "handbook_capture_proposal_status" DEFAULT 'pending' NOT NULL,
	"source_project_id" uuid,
	"source_files" jsonb DEFAULT '[]'::jsonb,
	"target_entry_id" uuid,
	"reviewed_by_user_id" text,
	"created_by_user_id" text,
	"created_by_agent_job_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handbook_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text,
	"content" text NOT NULL,
	"token_count" integer,
	"embedding" vector(1536),
	"search_vector" "tsvector",
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handbook_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" varchar(500) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"category" varchar(120) DEFAULT 'general' NOT NULL,
	"status" "handbook_entry_status" DEFAULT 'draft' NOT NULL,
	"source_type" "handbook_entry_source_type" DEFAULT 'manual' NOT NULL,
	"source_path" text,
	"source_project_id" uuid,
	"content_hash" varchar(64) NOT NULL,
	"search_vector" "tsvector",
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by_user_id" text,
	"created_by_agent_job_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handbook_entry_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"change_summary" text,
	"created_by_user_id" text,
	"created_by_agent_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handbook_capture_proposals" ADD CONSTRAINT "handbook_capture_proposals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_capture_proposals" ADD CONSTRAINT "handbook_capture_proposals_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_capture_proposals" ADD CONSTRAINT "handbook_capture_proposals_target_entry_id_handbook_entries_id_fk" FOREIGN KEY ("target_entry_id") REFERENCES "public"."handbook_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_capture_proposals" ADD CONSTRAINT "handbook_capture_proposals_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_capture_proposals" ADD CONSTRAINT "handbook_capture_proposals_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_capture_proposals" ADD CONSTRAINT "handbook_capture_proposals_created_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("created_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_chunks" ADD CONSTRAINT "handbook_chunks_entry_id_handbook_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."handbook_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_entries" ADD CONSTRAINT "handbook_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_entries" ADD CONSTRAINT "handbook_entries_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_entries" ADD CONSTRAINT "handbook_entries_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_entries" ADD CONSTRAINT "handbook_entries_created_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("created_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_entry_versions" ADD CONSTRAINT "handbook_entry_versions_entry_id_handbook_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."handbook_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_entry_versions" ADD CONSTRAINT "handbook_entry_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handbook_entry_versions" ADD CONSTRAINT "handbook_entry_versions_created_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("created_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handbook_capture_proposals_org_status_idx" ON "handbook_capture_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "handbook_capture_proposals_source_project_idx" ON "handbook_capture_proposals" USING btree ("source_project_id");--> statement-breakpoint
CREATE INDEX "handbook_capture_proposals_target_entry_idx" ON "handbook_capture_proposals" USING btree ("target_entry_id");--> statement-breakpoint
CREATE INDEX "handbook_capture_proposals_slug_idx" ON "handbook_capture_proposals" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "handbook_chunks_entry_chunk_unique_idx" ON "handbook_chunks" USING btree ("entry_id","chunk_index");--> statement-breakpoint
CREATE INDEX "handbook_chunks_entry_idx" ON "handbook_chunks" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "handbook_chunks_search_vector_idx" ON "handbook_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "handbook_entries_org_slug_unique_idx" ON "handbook_entries" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "handbook_entries_org_status_idx" ON "handbook_entries" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "handbook_entries_org_category_idx" ON "handbook_entries" USING btree ("organization_id","category");--> statement-breakpoint
CREATE INDEX "handbook_entries_source_project_idx" ON "handbook_entries" USING btree ("source_project_id");--> statement-breakpoint
CREATE INDEX "handbook_entries_archived_at_idx" ON "handbook_entries" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "handbook_entries_search_vector_idx" ON "handbook_entries" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "handbook_entry_versions_entry_version_unique_idx" ON "handbook_entry_versions" USING btree ("entry_id","version");--> statement-breakpoint
CREATE INDEX "handbook_entry_versions_entry_idx" ON "handbook_entry_versions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "handbook_entry_versions_content_hash_idx" ON "handbook_entry_versions" USING btree ("content_hash");