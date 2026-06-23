ALTER TYPE "public"."waitlist_action_type" ADD VALUE 'features_selected';--> statement-breakpoint
ALTER TABLE "waitlist_users" ADD COLUMN "profile_features" jsonb;