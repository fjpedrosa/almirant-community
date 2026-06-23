DO $$ BEGIN
 CREATE TYPE "public"."project_member_role" AS ENUM('owner', 'admin', 'member', 'viewer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_daily_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"total_duration_seconds" integer DEFAULT 0 NOT NULL,
	"total_tokens" bigint,
	"total_cost" numeric(12, 6),
	"active_users" integer DEFAULT 0 NOT NULL,
	"by_model" jsonb,
	"by_coding_agent" jsonb,
	"by_ai_provider" jsonb,
	"by_job_type" jsonb,
	"by_project" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_daily_user_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"total_duration_seconds" integer DEFAULT 0 NOT NULL,
	"total_tokens" bigint,
	"total_cost" numeric(12, 6),
	"active_users" integer DEFAULT 0 NOT NULL,
	"by_model" jsonb,
	"by_coding_agent" jsonb,
	"by_ai_provider" jsonb,
	"by_job_type" jsonb,
	"by_project" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "cumulative_duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_daily_aggregates" ADD CONSTRAINT "analytics_daily_aggregates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_daily_user_aggregates" ADD CONSTRAINT "analytics_daily_user_aggregates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_daily_user_aggregates" ADD CONSTRAINT "analytics_daily_user_aggregates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_aggregates_org_date_idx" ON "analytics_daily_aggregates" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_daily_aggregates_org_idx" ON "analytics_daily_aggregates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_daily_aggregates_date_idx" ON "analytics_daily_aggregates" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_user_aggregates_org_user_date_idx" ON "analytics_daily_user_aggregates" USING btree ("organization_id","user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_daily_user_aggregates_org_idx" ON "analytics_daily_user_aggregates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_daily_user_aggregates_user_idx" ON "analytics_daily_user_aggregates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_daily_user_aggregates_date_idx" ON "analytics_daily_user_aggregates" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_members_project_user_idx" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_members_project_id_idx" ON "project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_members_user_id_idx" ON "project_members" USING btree ("user_id");