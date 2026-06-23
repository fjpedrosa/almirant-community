CREATE TABLE "todo_item_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"todo_item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todo_item_tags" ADD CONSTRAINT "todo_item_tags_todo_item_id_todo_items_id_fk" FOREIGN KEY ("todo_item_id") REFERENCES "public"."todo_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_item_tags" ADD CONSTRAINT "todo_item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "todo_item_tags_unique_idx" ON "todo_item_tags" USING btree ("todo_item_id","tag_id");