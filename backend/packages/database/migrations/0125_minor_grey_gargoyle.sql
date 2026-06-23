CREATE TYPE "public"."schedule_type" AS ENUM('time_window', 'cron');--> statement-breakpoint
CREATE TABLE "scheduled_agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"name" varchar(255) NOT NULL,
	"skill_name" varchar(100) NOT NULL,
	"job_type" "agent_job_type" NOT NULL,
	"provider" "agent_provider" NOT NULL,
	"schedule_type" "schedule_type" NOT NULL,
	"schedule_config" jsonb NOT NULL,
	"timezone" varchar(100) DEFAULT 'Europe/Madrid' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"target_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_jobs_per_run" integer DEFAULT 10 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "max_concurrent_jobs" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD CONSTRAINT "scheduled_agent_configs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD CONSTRAINT "scheduled_agent_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_agent_configs_organization_id_idx" ON "scheduled_agent_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduled_agent_configs_enabled_idx" ON "scheduled_agent_configs" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "scheduled_agent_configs_project_id_idx" ON "scheduled_agent_configs" USING btree ("project_id");