CREATE TYPE "public"."sprint_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "sprint_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "sprint_status" DEFAULT 'open' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sprint_work_items" ADD CONSTRAINT "sprint_work_items_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_work_items" ADD CONSTRAINT "sprint_work_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_work_items_unique_idx" ON "sprint_work_items" USING btree ("sprint_id","work_item_id");--> statement-breakpoint
CREATE INDEX "sprints_board_id_idx" ON "sprints" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "sprints_status_idx" ON "sprints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_items_archived_at_idx" ON "work_items" USING btree ("archived_at");