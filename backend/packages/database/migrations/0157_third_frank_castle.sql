DO $$ BEGIN CREATE TYPE "public"."email_delivery_status" AS ENUM('sent', 'delivered', 'bounced', 'complained'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "feedback_items" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "feedback_items" ALTER COLUMN "status" SET DEFAULT 'new'::text;--> statement-breakpoint
-- Migrate existing feedback statuses to new lifecycle values
UPDATE "feedback_items" SET "status" = 'cancelled' WHERE "status" = 'dismissed';--> statement-breakpoint
UPDATE "feedback_items" SET "status" = 'verified' WHERE "status" = 'archived';--> statement-breakpoint
UPDATE "feedback_items" SET "status" = 'verified' WHERE "status" = 'promoted';--> statement-breakpoint
DROP TYPE IF EXISTS "public"."feedback_status";--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'triaged', 'in_progress', 'pending_validation', 'implementing', 'deployed', 'verified', 'cancelled');--> statement-breakpoint
ALTER TABLE "feedback_items" ALTER COLUMN "status" SET DEFAULT 'new'::"public"."feedback_status";--> statement-breakpoint
ALTER TABLE "feedback_items" ALTER COLUMN "status" SET DATA TYPE "public"."feedback_status" USING "status"::"public"."feedback_status";--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD COLUMN IF NOT EXISTS "resend_email_id" text;--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD COLUMN IF NOT EXISTS "delivery_status" "email_delivery_status" DEFAULT 'sent';--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD COLUMN IF NOT EXISTS "delivery_status_updated_at" timestamp with time zone;