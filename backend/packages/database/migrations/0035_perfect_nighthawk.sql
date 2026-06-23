ALTER TABLE "feedback_items" ADD COLUMN "ai_suggested_type" "work_item_type";--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "ai_suggested_title" varchar(500);--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "ai_suggested_summary" text;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "ai_category" "feedback_category";--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "ai_confidence" varchar(10);--> statement-breakpoint
ALTER TABLE "feedback_items" ADD COLUMN "ai_reasoning" text;