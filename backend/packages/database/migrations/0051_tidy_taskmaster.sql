CREATE TYPE "public"."idea_item_status" AS ENUM('active', 'archived', 'pending', 'done', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."idea_item_type" AS ENUM('idea', 'todo');--> statement-breakpoint
CREATE TYPE "public"."idea_item_work_link_type" AS ENUM('promoted_to', 'related_to');--> statement-breakpoint
CREATE TABLE "idea_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"type" "idea_item_type" DEFAULT 'idea' NOT NULL,
	"status" "idea_item_status" DEFAULT 'active' NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"owner_user_id" text,
	"due_date" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_items_type_status_check" CHECK ((
        ("idea_items"."type" = 'idea' AND "idea_items"."status" IN ('active', 'archived'))
        OR
        ("idea_items"."type" = 'todo' AND "idea_items"."status" IN ('pending', 'done', 'blocked'))
      ))
);
--> statement-breakpoint
CREATE TABLE "idea_item_feedback_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_item_id" uuid NOT NULL,
	"feedback_item_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_item_work_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_item_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"link_type" "idea_item_work_link_type" DEFAULT 'related_to' NOT NULL,
	"created_by" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_item_feedback_links" ADD CONSTRAINT "idea_item_feedback_links_idea_item_id_idea_items_id_fk" FOREIGN KEY ("idea_item_id") REFERENCES "public"."idea_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_item_feedback_links" ADD CONSTRAINT "idea_item_feedback_links_feedback_item_id_feedback_items_id_fk" FOREIGN KEY ("feedback_item_id") REFERENCES "public"."feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_item_work_item_links" ADD CONSTRAINT "idea_item_work_item_links_idea_item_id_idea_items_id_fk" FOREIGN KEY ("idea_item_id") REFERENCES "public"."idea_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_item_work_item_links" ADD CONSTRAINT "idea_item_work_item_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_item_work_item_links" ADD CONSTRAINT "idea_item_work_item_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_items_organization_idx" ON "idea_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idea_items_project_idx" ON "idea_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idea_items_owner_user_idx" ON "idea_items" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idea_items_type_status_idx" ON "idea_items" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "idea_items_due_date_idx" ON "idea_items" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_item_feedback_links_unique_idx" ON "idea_item_feedback_links" USING btree ("idea_item_id","feedback_item_id");--> statement-breakpoint
CREATE INDEX "idea_item_feedback_links_idea_item_idx" ON "idea_item_feedback_links" USING btree ("idea_item_id");--> statement-breakpoint
CREATE INDEX "idea_item_feedback_links_feedback_item_idx" ON "idea_item_feedback_links" USING btree ("feedback_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_item_work_item_links_unique_idx" ON "idea_item_work_item_links" USING btree ("idea_item_id","work_item_id");--> statement-breakpoint
CREATE INDEX "idea_item_work_item_links_idea_item_idx" ON "idea_item_work_item_links" USING btree ("idea_item_id");--> statement-breakpoint
CREATE INDEX "idea_item_work_item_links_work_item_idx" ON "idea_item_work_item_links" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "idea_item_work_item_links_type_idx" ON "idea_item_work_item_links" USING btree ("link_type");