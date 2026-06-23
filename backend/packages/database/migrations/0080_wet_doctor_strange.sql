ALTER TABLE "idea_items" DROP CONSTRAINT IF EXISTS "idea_items_type_status_check";--> statement-breakpoint
ALTER TABLE "idea_items" ALTER COLUMN "type" SET DATA TYPE text USING "type"::text;--> statement-breakpoint
ALTER TABLE "idea_items" ALTER COLUMN "type" SET DEFAULT 'idea'::text;--> statement-breakpoint
-- Migrate any existing 'todo' rows to 'idea' before dropping the old enum
UPDATE "idea_items" SET "type" = 'idea' WHERE "type" = 'todo';--> statement-breakpoint
DROP TYPE "public"."idea_item_type";--> statement-breakpoint
CREATE TYPE "public"."idea_item_type" AS ENUM('idea', 'seed');--> statement-breakpoint
ALTER TABLE "idea_items" ALTER COLUMN "type" SET DEFAULT 'idea'::"public"."idea_item_type";--> statement-breakpoint
ALTER TABLE "idea_items" ALTER COLUMN "type" SET DATA TYPE "public"."idea_item_type" USING "type"::"public"."idea_item_type";--> statement-breakpoint
ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_type_status_check" CHECK ((
        ("idea_items"."type" = 'idea' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
        OR
        ("idea_items"."type" = 'seed' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
      ));
