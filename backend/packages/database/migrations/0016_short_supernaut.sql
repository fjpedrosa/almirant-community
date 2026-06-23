CREATE TABLE "work_item_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"blocked_by_work_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_blocked_by_work_item_id_work_items_id_fk" FOREIGN KEY ("blocked_by_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_dependencies_unique_idx" ON "work_item_dependencies" USING btree ("work_item_id","blocked_by_work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_dependencies_work_item_idx" ON "work_item_dependencies" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_dependencies_blocked_by_idx" ON "work_item_dependencies" USING btree ("blocked_by_work_item_id");