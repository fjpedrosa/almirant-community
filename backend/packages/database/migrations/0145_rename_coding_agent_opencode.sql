-- Rename coding_agent enum value: open-codec → opencode
-- Step 1: Convert columns to text temporarily
ALTER TABLE "work_items" ALTER COLUMN "coding_agent" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "agent_jobs" ALTER COLUMN "coding_agent" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "agent_jobs" ALTER COLUMN "coding_agent" SET DEFAULT 'claude-code'::text;--> statement-breakpoint

-- Step 2: Update existing rows with old value
UPDATE "work_items" SET "coding_agent" = 'opencode' WHERE "coding_agent" = 'open-codec';--> statement-breakpoint
UPDATE "agent_jobs" SET "coding_agent" = 'opencode' WHERE "coding_agent" = 'open-codec';--> statement-breakpoint

-- Step 3: Drop old enum, create new one
DROP TYPE "public"."coding_agent";--> statement-breakpoint
CREATE TYPE "public"."coding_agent" AS ENUM('codex', 'claude-code', 'opencode');--> statement-breakpoint

-- Step 4: Cast columns back to enum
ALTER TABLE "work_items" ALTER COLUMN "coding_agent" SET DATA TYPE "public"."coding_agent" USING "coding_agent"::"public"."coding_agent";--> statement-breakpoint
ALTER TABLE "agent_jobs" ALTER COLUMN "coding_agent" SET DEFAULT 'claude-code'::"public"."coding_agent";--> statement-breakpoint
ALTER TABLE "agent_jobs" ALTER COLUMN "coding_agent" SET DATA TYPE "public"."coding_agent" USING "coding_agent"::"public"."coding_agent";
