ALTER TYPE "public"."schedule_type" ADD VALUE 'manual' BEFORE 'time_window';--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ALTER COLUMN "schedule_config" DROP NOT NULL;