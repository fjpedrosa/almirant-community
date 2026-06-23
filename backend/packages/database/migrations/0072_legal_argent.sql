ALTER TYPE "public"."connection_category" ADD VALUE IF NOT EXISTS 'monitoring';--> statement-breakpoint
ALTER TYPE "public"."provider_type" ADD VALUE IF NOT EXISTS 'sentry';--> statement-breakpoint
ALTER TYPE "public"."provider_type" ADD VALUE IF NOT EXISTS 'posthog';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_notification_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_work_item_moved" boolean DEFAULT true NOT NULL,
	"notify_work_item_assigned" boolean DEFAULT true NOT NULL,
	"notify_work_item_done" boolean DEFAULT true NOT NULL,
	"notify_review_completed" boolean DEFAULT true NOT NULL,
	"notify_sprint_closed" boolean DEFAULT true NOT NULL,
	"notify_user_actions" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"idea_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "email_notification_settings" ADD CONSTRAINT "email_notification_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_id_idea_item_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."idea_item_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_mentioned_user_id_user_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_idea_item_id_idea_items_id_fk" FOREIGN KEY ("idea_item_id") REFERENCES "public"."idea_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_notification_settings_user_id_unique" ON "email_notification_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_mentions_comment_id_idx" ON "comment_mentions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_mentions_mentioned_user_id_idx" ON "comment_mentions" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_mentions_idea_item_id_idx" ON "comment_mentions" USING btree ("idea_item_id");