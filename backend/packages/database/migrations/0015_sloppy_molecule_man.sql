CREATE TYPE "public"."work_item_event_actor_type" AS ENUM('user', 'system', 'claude-code');--> statement-breakpoint
CREATE TYPE "public"."work_item_event_type" AS ENUM('created', 'updated', 'moved', 'archived', 'unarchived', 'parent_changed', 'tag_added', 'tag_removed', 'comment');--> statement-breakpoint
CREATE TABLE "work_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"type" "work_item_event_type" NOT NULL,
	"field" varchar(100),
	"old_value" text,
	"new_value" text,
	"actor_type" "work_item_event_actor_type" DEFAULT 'system' NOT NULL,
	"actor_name" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_events" ADD CONSTRAINT "work_item_events_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_events_work_item_idx" ON "work_item_events" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_events_type_idx" ON "work_item_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "work_item_events_created_at_idx" ON "work_item_events" USING btree ("created_at");