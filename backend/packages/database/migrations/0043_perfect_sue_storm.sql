CREATE TYPE "public"."assignee_role" AS ENUM('responsible', 'collaborator', 'reviewer');--> statement-breakpoint
CREATE TABLE "work_item_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "assignee_role" DEFAULT 'responsible' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "work_item_assignees" ADD CONSTRAINT "work_item_assignees_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignees" ADD CONSTRAINT "work_item_assignees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_assignees_unique_idx" ON "work_item_assignees" USING btree ("work_item_id","user_id");--> statement-breakpoint
CREATE INDEX "work_item_assignees_work_item_id_idx" ON "work_item_assignees" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_assignees_user_id_idx" ON "work_item_assignees" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_items_created_by_user_idx" ON "work_items" USING btree ("created_by_user_id");