CREATE TABLE "telegram_notification_settings" (
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
ALTER TABLE "telegram_notification_settings" ADD CONSTRAINT "telegram_notification_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_notification_settings_user_id_unique" ON "telegram_notification_settings" USING btree ("user_id");