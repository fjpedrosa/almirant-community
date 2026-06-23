ALTER TABLE "idea_items" DROP CONSTRAINT "idea_items_type_status_check";--> statement-breakpoint
ALTER TABLE "task_id_counters" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "idea_items" ADD CONSTRAINT "idea_items_type_status_check" CHECK ((
        ("idea_items"."type" = 'idea' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
        OR
        ("idea_items"."type" = 'seed' AND "idea_items"."status" IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
      ));