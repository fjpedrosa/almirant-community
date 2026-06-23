CREATE TYPE "public"."notification_type" AS ENUM('assignment', 'comment');--> statement-breakpoint
CREATE TABLE "notification_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"debounce_key" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_queue" ADD CONSTRAINT "notification_queue_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_queue_sweeper_idx" ON "notification_queue" USING btree ("sent_at","scheduled_at");--> statement-breakpoint
CREATE INDEX "notification_queue_debounce_key_idx" ON "notification_queue" USING btree ("debounce_key");--> statement-breakpoint
CREATE INDEX "notification_queue_recipient_idx" ON "notification_queue" USING btree ("recipient_user_id");