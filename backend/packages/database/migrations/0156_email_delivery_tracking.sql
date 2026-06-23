DO $$ BEGIN CREATE TYPE "public"."email_delivery_status" AS ENUM('sent', 'delivered', 'bounced', 'complained'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD COLUMN IF NOT EXISTS "resend_email_id" text;--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD COLUMN IF NOT EXISTS "delivery_status" "email_delivery_status" DEFAULT 'sent';--> statement-breakpoint
ALTER TABLE "waitlist_thank_you_sends" ADD COLUMN IF NOT EXISTS "delivery_status_updated_at" timestamp with time zone;