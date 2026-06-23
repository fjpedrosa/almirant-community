CREATE TYPE "public"."coding_agent" AS ENUM('codex', 'claude-code', 'open-codec');--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "coding_agent" "coding_agent";--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "ai_model" varchar(100);--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
