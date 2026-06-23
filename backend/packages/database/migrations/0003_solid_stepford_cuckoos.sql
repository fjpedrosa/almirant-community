CREATE TYPE "public"."repository_provider" AS ENUM('github', 'gitlab', 'bitbucket', 'other');--> statement-breakpoint
CREATE TABLE "project_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"provider" "repository_provider" DEFAULT 'github' NOT NULL,
	"is_monorepo" boolean DEFAULT false,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_name" varchar(255);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "production_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "staging_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tech_stack" text[];--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "target_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;