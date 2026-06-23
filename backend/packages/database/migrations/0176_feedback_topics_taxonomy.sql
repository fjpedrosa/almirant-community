CREATE TYPE "public"."feedback_topic_proposal_status" AS ENUM('pending', 'accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."feedback_topic_proposal_type" AS ENUM('merge', 'split', 'rename');--> statement-breakpoint
CREATE TYPE "public"."feedback_topic_status" AS ENUM('active', 'archived', 'merged');--> statement-breakpoint
CREATE TABLE "feedback_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_topic_id" uuid,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" varchar(1000) NOT NULL,
	"description" text,
	"embedding" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"cluster_count" integer DEFAULT 0 NOT NULL,
	"status" "feedback_topic_status" DEFAULT 'active' NOT NULL,
	"merged_into_topic_id" uuid,
	"created_by" varchar(50) DEFAULT 'ai' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_topic_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "feedback_topic_proposal_type" NOT NULL,
	"status" "feedback_topic_proposal_status" DEFAULT 'pending' NOT NULL,
	"topic_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text,
	"confidence" real,
	"created_by" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "topic_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD COLUMN "topic_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_topics" ADD CONSTRAINT "feedback_topics_parent_topic_id_feedback_topics_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "public"."feedback_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_topics" ADD CONSTRAINT "feedback_topics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_topics" ADD CONSTRAINT "feedback_topics_merged_into_topic_id_feedback_topics_id_fk" FOREIGN KEY ("merged_into_topic_id") REFERENCES "public"."feedback_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_topic_proposals" ADD CONSTRAINT "feedback_topic_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_topic_proposals" ADD CONSTRAINT "feedback_topic_proposals_topic_id_feedback_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."feedback_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_topics_parent_status_idx" ON "feedback_topics" USING btree ("parent_topic_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_topics_slug_project_idx" ON "feedback_topics" USING btree ("slug","project_id");--> statement-breakpoint
CREATE INDEX "feedback_topics_project_status_idx" ON "feedback_topics" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "ftp_project_status_idx" ON "feedback_topic_proposals" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "ftp_topic_id_idx" ON "feedback_topic_proposals" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "ftp_type_status_idx" ON "feedback_topic_proposals" USING btree ("type","status");--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_topic_id_feedback_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."feedback_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_clusters" ADD CONSTRAINT "feedback_clusters_topic_id_feedback_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."feedback_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_items_topic_id_idx" ON "feedback_items" USING btree ("topic_id");