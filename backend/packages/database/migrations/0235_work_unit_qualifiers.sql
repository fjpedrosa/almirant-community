ALTER TABLE "work_items" ADD COLUMN "work_unit_size" varchar(16);--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "work_unit_size_origin" varchar(32);--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "backlog_intent" varchar(16);--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_work_unit_size_check" CHECK ("work_items"."work_unit_size" IS NULL OR "work_items"."work_unit_size" IN ('XS', 'S', 'M', 'L', 'XL'));--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_work_unit_size_origin_check" CHECK ("work_items"."work_unit_size_origin" IS NULL OR "work_items"."work_unit_size_origin" IN ('plan', 'legacy_points'));--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_backlog_intent_check" CHECK ("work_items"."backlog_intent" IS NULL OR "work_items"."backlog_intent" IN ('new', 'fix'));--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_work_unit_size_pair_check" CHECK (("work_items"."work_unit_size" IS NULL AND "work_items"."work_unit_size_origin" IS NULL) OR ("work_items"."work_unit_size" IS NOT NULL AND "work_items"."work_unit_size_origin" IS NOT NULL));