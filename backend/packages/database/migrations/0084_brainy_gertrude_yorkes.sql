CREATE TYPE "public"."seed_source" AS ENUM('manual', 'feedback', 'ai_generated', 'import');--> statement-breakpoint
CREATE TYPE "public"."seed_status" AS ENUM('draft', 'active', 'to_review', 'approved', 'archived', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'seed';--> statement-breakpoint
CREATE TABLE "seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"status" "seed_status" DEFAULT 'active' NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"source" "seed_source" DEFAULT 'manual' NOT NULL,
	"priority" "priority",
	"selected_for_ideation" boolean DEFAULT false NOT NULL,
	"owner_user_id" text,
	"created_by_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_feedback_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_id" uuid NOT NULL,
	"feedback_item_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_work_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"link_type" "idea_item_work_link_type" DEFAULT 'related_to' NOT NULL,
	"created_by" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seeds" ADD CONSTRAINT "seeds_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeds" ADD CONSTRAINT "seeds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeds" ADD CONSTRAINT "seeds_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeds" ADD CONSTRAINT "seeds_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_tags" ADD CONSTRAINT "seed_tags_seed_id_seeds_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."seeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_tags" ADD CONSTRAINT "seed_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_feedback_links" ADD CONSTRAINT "seed_feedback_links_seed_id_seeds_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."seeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_feedback_links" ADD CONSTRAINT "seed_feedback_links_feedback_item_id_feedback_items_id_fk" FOREIGN KEY ("feedback_item_id") REFERENCES "public"."feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_work_item_links" ADD CONSTRAINT "seed_work_item_links_seed_id_seeds_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."seeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_work_item_links" ADD CONSTRAINT "seed_work_item_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_work_item_links" ADD CONSTRAINT "seed_work_item_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seeds_organization_idx" ON "seeds" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "seeds_project_idx" ON "seeds" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "seeds_status_idx" ON "seeds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seeds_owner_user_idx" ON "seeds" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "seeds_selected_for_ideation_idx" ON "seeds" USING btree ("selected_for_ideation");--> statement-breakpoint
CREATE INDEX "seeds_project_selected_status_idx" ON "seeds" USING btree ("project_id","selected_for_ideation","status");--> statement-breakpoint
CREATE UNIQUE INDEX "seed_tags_unique_idx" ON "seed_tags" USING btree ("seed_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seed_feedback_links_unique_idx" ON "seed_feedback_links" USING btree ("seed_id","feedback_item_id");--> statement-breakpoint
CREATE INDEX "seed_feedback_links_seed_idx" ON "seed_feedback_links" USING btree ("seed_id");--> statement-breakpoint
CREATE INDEX "seed_feedback_links_feedback_idx" ON "seed_feedback_links" USING btree ("feedback_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seed_work_item_links_unique_idx" ON "seed_work_item_links" USING btree ("seed_id","work_item_id");--> statement-breakpoint
CREATE INDEX "seed_work_item_links_seed_idx" ON "seed_work_item_links" USING btree ("seed_id");--> statement-breakpoint
CREATE INDEX "seed_work_item_links_work_item_idx" ON "seed_work_item_links" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "seed_work_item_links_type_idx" ON "seed_work_item_links" USING btree ("link_type");