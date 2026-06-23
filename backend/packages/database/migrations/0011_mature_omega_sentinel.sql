CREATE TABLE "task_id_counters" (
	"prefix" varchar(10) PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "task_id" varchar(20);--> statement-breakpoint
CREATE INDEX "work_items_task_id_idx" ON "work_items" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_task_id_unique" UNIQUE("task_id");