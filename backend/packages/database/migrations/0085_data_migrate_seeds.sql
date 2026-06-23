-- Data migration: Move type='seed' rows from idea_items to seeds
-- Reassign junction tables, clean up old data
-- This migration is idempotent (ON CONFLICT DO NOTHING / WHERE clauses)
--
-- NOTE: entity_comments and entity_events entity_type updates are handled
-- by a post-migration script (migrate-seed-entity-types.ts) because
-- Drizzle ORM wraps all pending migrations in a single transaction,
-- and PostgreSQL forbids using new enum values (added via ALTER TYPE ADD VALUE)
-- in DML within the same transaction.

DO $$ DECLARE
  has_created_by_user_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'idea_items'
      AND column_name = 'created_by_user_id'
  ) INTO has_created_by_user_id;

  IF has_created_by_user_id THEN
    INSERT INTO "seeds" (
      "id",
      "organization_id",
      "project_id",
      "status",
      "title",
      "description",
      "source",
      "selected_for_ideation",
      "owner_user_id",
      "created_by_user_id",
      "metadata",
      "created_at",
      "updated_at"
    )
    SELECT
      "id",
      "organization_id",
      "project_id",
      CASE
        WHEN "status"::text IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected') THEN "status"::text::seed_status
        ELSE 'active'::seed_status
      END,
      "title",
      "description",
      'manual'::seed_source,
      COALESCE(("metadata"->>'selectedForIdeation')::boolean, false),
      "owner_user_id",
      "created_by_user_id",
      "metadata",
      "created_at",
      "updated_at"
    FROM "idea_items"
    WHERE "type" = 'seed'
    ON CONFLICT ("id") DO NOTHING;
  ELSE
    INSERT INTO "seeds" (
      "id",
      "organization_id",
      "project_id",
      "status",
      "title",
      "description",
      "source",
      "selected_for_ideation",
      "owner_user_id",
      "created_by_user_id",
      "metadata",
      "created_at",
      "updated_at"
    )
    SELECT
      "id",
      "organization_id",
      "project_id",
      CASE
        WHEN "status"::text IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected') THEN "status"::text::seed_status
        ELSE 'active'::seed_status
      END,
      "title",
      "description",
      'manual'::seed_source,
      COALESCE(("metadata"->>'selectedForIdeation')::boolean, false),
      "owner_user_id",
      NULL,
      "metadata",
      "created_at",
      "updated_at"
    FROM "idea_items"
    WHERE "type" = 'seed'
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;--> statement-breakpoint

-- Step 2: Migrate idea_item_tags to seed_tags
INSERT INTO "seed_tags" ("id", "seed_id", "tag_id", "created_at")
SELECT gen_random_uuid(), "idea_item_id", "tag_id", "created_at"
FROM "idea_item_tags"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'seed')
ON CONFLICT ("seed_id", "tag_id") DO NOTHING;--> statement-breakpoint

-- Step 3: Migrate idea_item_feedback_links to seed_feedback_links
INSERT INTO "seed_feedback_links" ("id", "seed_id", "feedback_item_id", "metadata", "created_at", "updated_at")
SELECT gen_random_uuid(), "idea_item_id", "feedback_item_id", "metadata", "created_at", "updated_at"
FROM "idea_item_feedback_links"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'seed')
ON CONFLICT ("seed_id", "feedback_item_id") DO NOTHING;--> statement-breakpoint

-- Step 4: Migrate idea_item_work_item_links to seed_work_item_links
INSERT INTO "seed_work_item_links" ("id", "seed_id", "work_item_id", "link_type", "created_by", "metadata", "created_at", "updated_at")
SELECT gen_random_uuid(), "idea_item_id", "work_item_id", "link_type", "created_by", "metadata", "created_at", "updated_at"
FROM "idea_item_work_item_links"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'seed')
ON CONFLICT ("seed_id", "work_item_id") DO NOTHING;--> statement-breakpoint

-- Step 5 & 6: MOVED to post-migration script (migrate-seed-entity-types.ts)
-- entity_comments and entity_events entity_type updates require the 'seed'
-- enum value to be committed first (PostgreSQL restriction)

-- Step 7: Clean up junction tables for seeds in idea_items
DELETE FROM "idea_item_tags"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'seed');--> statement-breakpoint

DELETE FROM "idea_item_feedback_links"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'seed');--> statement-breakpoint

DELETE FROM "idea_item_work_item_links"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'seed');--> statement-breakpoint

-- Step 8: Delete seed rows from idea_items (now fully migrated)
DELETE FROM "idea_items"
WHERE "type" = 'seed';
