CREATE TYPE "public"."feedback_category" AS ENUM('bug', 'feature_request', 'improvement', 'question', 'praise', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_cluster_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."feedback_source_type" AS ENUM('widget', 'api', 'telegram', 'email', 'manual');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'triaged', 'promoted', 'dismissed', 'archived');--> statement-breakpoint
CREATE TABLE "feedback_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "feedback_source_type" DEFAULT 'widget' NOT NULL,
	"public_key" varchar(64) NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_sources_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "feedback_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_id" uuid,
	"cluster_id" uuid,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"category" "feedback_category" DEFAULT 'other' NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text,
	"author_name" varchar(255),
	"author_email" varchar(255),
	"author_meta" jsonb DEFAULT '{}'::jsonb,
	"sentiment" varchar(20),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"promoted_work_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"summary" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"status" "feedback_cluster_status" DEFAULT 'open' NOT NULL,
	"suggested_type" "work_item_type",
	"suggested_priority" "priority",
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_item_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"promoted_by" varchar(255),
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_sources" ADD CONSTRAINT "feedback_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_source_id_feedback_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."feedback_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_cluster_id_feedback_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."feedback_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_promoted_work_item_id_work_items_id_fk" FOREIGN KEY ("promoted_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD CONSTRAINT "feedback_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_promotions" ADD CONSTRAINT "feedback_promotions_feedback_item_id_feedback_items_id_fk" FOREIGN KEY ("feedback_item_id") REFERENCES "public"."feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_promotions" ADD CONSTRAINT "feedback_promotions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_sources_project_id_idx" ON "feedback_sources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "feedback_items_project_status_created_idx" ON "feedback_items" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_items_source_id_idx" ON "feedback_items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "feedback_items_cluster_id_idx" ON "feedback_items" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "feedback_items_promoted_work_item_id_idx" ON "feedback_items" USING btree ("promoted_work_item_id");--> statement-breakpoint
CREATE INDEX "feedback_clusters_project_id_status_idx" ON "feedback_clusters" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "feedback_promotions_feedback_item_id_idx" ON "feedback_promotions" USING btree ("feedback_item_id");--> statement-breakpoint
CREATE INDEX "feedback_promotions_work_item_id_idx" ON "feedback_promotions" USING btree ("work_item_id");