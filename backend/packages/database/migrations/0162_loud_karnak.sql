CREATE TYPE "public"."trigger_type" AS ENUM('event', 'scheduled', 'recovery');--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "prompt_template" varchar(100);--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "trigger_type" "trigger_type" DEFAULT 'event';--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "interactive" boolean DEFAULT false;