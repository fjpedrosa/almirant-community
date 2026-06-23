-- Create new event_triggered_by enum (same values as old work_item_event_actor_type)
CREATE TYPE "public"."event_triggered_by" AS ENUM('user', 'system', 'claude-code');--> statement-breakpoint

-- Drop existing indexes that reference columns being renamed
DROP INDEX "work_item_events_type_idx";--> statement-breakpoint

-- Rename columns
ALTER TABLE "work_item_events" RENAME COLUMN "type" TO "event_type";--> statement-breakpoint
ALTER TABLE "work_item_events" RENAME COLUMN "field" TO "field_name";--> statement-breakpoint

-- Add new triggered_by column using the new enum
ALTER TABLE "work_item_events" ADD COLUMN "triggered_by" "event_triggered_by" DEFAULT 'system' NOT NULL;--> statement-breakpoint

-- Migrate data from actor_type to triggered_by
UPDATE "work_item_events" SET "triggered_by" = "actor_type"::text::"event_triggered_by";--> statement-breakpoint

-- Add triggered_by_user_id column
ALTER TABLE "work_item_events" ADD COLUMN "triggered_by_user_id" text;--> statement-breakpoint

-- Drop old columns
ALTER TABLE "work_item_events" DROP COLUMN "actor_type";--> statement-breakpoint
ALTER TABLE "work_item_events" DROP COLUMN "actor_name";--> statement-breakpoint

-- Update work_item_event_type enum: remove old values, add new values
-- PostgreSQL doesn't support removing enum values directly, so we need to recreate the type
-- First, update the column to use text temporarily
ALTER TABLE "work_item_events" ALTER COLUMN "event_type" TYPE text;--> statement-breakpoint

-- Drop old enum type
DROP TYPE "public"."work_item_event_type";--> statement-breakpoint

-- Create new enum type with updated values
CREATE TYPE "public"."work_item_event_type" AS ENUM('created', 'updated', 'moved', 'deleted', 'attachment_added', 'attachment_removed', 'ai_session', 'comment');--> statement-breakpoint

-- Migrate existing data: map old values to new where possible
UPDATE "work_item_events" SET "event_type" = 'deleted' WHERE "event_type" IN ('archived', 'unarchived');--> statement-breakpoint
UPDATE "work_item_events" SET "event_type" = 'updated' WHERE "event_type" IN ('parent_changed', 'tag_added', 'tag_removed');--> statement-breakpoint

-- Convert column back to enum type
ALTER TABLE "work_item_events" ALTER COLUMN "event_type" TYPE "work_item_event_type" USING "event_type"::"work_item_event_type";--> statement-breakpoint

-- Drop old actor type enum
DROP TYPE "public"."work_item_event_actor_type";--> statement-breakpoint

-- Add FK constraint for triggered_by_user_id
ALTER TABLE "work_item_events" ADD CONSTRAINT "work_item_events_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Create new indexes
CREATE INDEX "work_item_events_event_type_idx" ON "work_item_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "work_item_events_triggered_by_user_idx" ON "work_item_events" USING btree ("triggered_by_user_id");
