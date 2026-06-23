CREATE TYPE "public"."skill_source" AS ENUM('official', 'custom', 'repo');--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"project_id" uuid,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"source" "skill_source" DEFAULT 'custom' NOT NULL,
	"source_path" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_slug_org_project_idx" ON "skills" USING btree ("slug","organization_id","project_id");--> statement-breakpoint
CREATE INDEX "skills_organization_id_idx" ON "skills" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "skills_project_id_idx" ON "skills" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "skills_source_idx" ON "skills" USING btree ("source");--> statement-breakpoint
CREATE INDEX "skills_content_hash_idx" ON "skills" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "skills_archived_at_idx" ON "skills" USING btree ("archived_at");