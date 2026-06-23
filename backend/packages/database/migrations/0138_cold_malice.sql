-- Idempotent version: 0136 and 0138 overlap on several DDL statements.
-- Every statement is guarded so the migration can apply cleanly whether the
-- objects already exist (partial state from 0136) or not (fresh DB).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coding_agent') THEN
    CREATE TYPE "public"."coding_agent" AS ENUM('codex', 'claude-code', 'open-codec');
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'planning_session_status' AND e.enumlabel = 'interrupted'
  ) THEN
    ALTER TYPE "public"."planning_session_status" ADD VALUE 'interrupted' BEFORE 'completed';
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist_thank_you_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" "waitlist_tier" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "coding_agent" "coding_agent";--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "ai_model" varchar(100);--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "coding_agent" "coding_agent" DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "ai_provider" "ai_provider" DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "model" varchar(100) DEFAULT 'claude-opus-4-6' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "skill_name" varchar(100) DEFAULT 'implement' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_users" ADD COLUMN IF NOT EXISTS "locale" varchar(10) DEFAULT 'en' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "waitlist_thank_you_sends" ADD CONSTRAINT "waitlist_thank_you_sends_user_id_waitlist_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."waitlist_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "waitlist_thank_you_sends" ADD CONSTRAINT "waitlist_thank_you_sends_sent_by_user_id_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_thank_you_sends_user_tier_unique" ON "waitlist_thank_you_sends" USING btree ("user_id","tier");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "work_items" ADD CONSTRAINT "work_items_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
