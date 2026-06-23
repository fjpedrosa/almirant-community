CREATE TABLE "idea_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_item_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"field_name" varchar(100),
	"old_value" text,
	"new_value" text,
	"triggered_by" varchar(30) DEFAULT 'system' NOT NULL,
	"triggered_by_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idea_item_events" ADD CONSTRAINT "idea_item_events_idea_item_id_idea_items_id_fk" FOREIGN KEY ("idea_item_id") REFERENCES "public"."idea_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_item_events" ADD CONSTRAINT "idea_item_events_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_item_events_idea_item_idx" ON "idea_item_events" USING btree ("idea_item_id");--> statement-breakpoint
CREATE INDEX "idea_item_events_event_type_idx" ON "idea_item_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idea_item_events_triggered_by_user_idx" ON "idea_item_events" USING btree ("triggered_by_user_id");--> statement-breakpoint
CREATE INDEX "idea_item_events_created_at_idx" ON "idea_item_events" USING btree ("created_at");