ALTER TYPE "public"."coding_agent" ADD VALUE 'pi';--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "resolved_runtime_selection" jsonb;