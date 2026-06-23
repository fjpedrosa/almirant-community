-- Data migration: Move type='todo' rows from idea_items to todo_items
-- Reassign entity_comments and entity_events, clean up junction tables
-- This migration is idempotent (ON CONFLICT DO NOTHING / WHERE clauses)

DO $$ DECLARE
  has_created_by_user_id boolean;
  has_completed_at boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'idea_items'
      AND column_name = 'created_by_user_id'
  ) INTO has_created_by_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'idea_items'
      AND column_name = 'completed_at'
  ) INTO has_completed_at;

  IF has_created_by_user_id AND has_completed_at THEN
    INSERT INTO "todo_items" (
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      "status",
      "priority",
      "owner_user_id",
      "created_by_user_id",
      "due_date",
      "completed_at",
      "metadata",
      "created_at",
      "updated_at"
    )
    SELECT
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      CASE
        WHEN "status"::text = 'pending' THEN 'pending'::todo_item_status
        WHEN "status"::text = 'done' THEN 'done'::todo_item_status
        WHEN "status"::text = 'blocked' THEN 'blocked'::todo_item_status
        ELSE 'pending'::todo_item_status
      END,
      NULL,
      "owner_user_id",
      "created_by_user_id",
      "due_date",
      "completed_at",
      "metadata",
      "created_at",
      "updated_at"
    FROM "idea_items"
    WHERE "type" = 'todo'
    ON CONFLICT ("id") DO NOTHING;
  ELSIF has_created_by_user_id THEN
    INSERT INTO "todo_items" (
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      "status",
      "priority",
      "owner_user_id",
      "created_by_user_id",
      "due_date",
      "completed_at",
      "metadata",
      "created_at",
      "updated_at"
    )
    SELECT
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      CASE
        WHEN "status"::text = 'pending' THEN 'pending'::todo_item_status
        WHEN "status"::text = 'done' THEN 'done'::todo_item_status
        WHEN "status"::text = 'blocked' THEN 'blocked'::todo_item_status
        ELSE 'pending'::todo_item_status
      END,
      NULL,
      "owner_user_id",
      "created_by_user_id",
      "due_date",
      NULL,
      "metadata",
      "created_at",
      "updated_at"
    FROM "idea_items"
    WHERE "type" = 'todo'
    ON CONFLICT ("id") DO NOTHING;
  ELSIF has_completed_at THEN
    INSERT INTO "todo_items" (
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      "status",
      "priority",
      "owner_user_id",
      "created_by_user_id",
      "due_date",
      "completed_at",
      "metadata",
      "created_at",
      "updated_at"
    )
    SELECT
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      CASE
        WHEN "status"::text = 'pending' THEN 'pending'::todo_item_status
        WHEN "status"::text = 'done' THEN 'done'::todo_item_status
        WHEN "status"::text = 'blocked' THEN 'blocked'::todo_item_status
        ELSE 'pending'::todo_item_status
      END,
      NULL,
      "owner_user_id",
      NULL,
      "due_date",
      "completed_at",
      "metadata",
      "created_at",
      "updated_at"
    FROM "idea_items"
    WHERE "type" = 'todo'
    ON CONFLICT ("id") DO NOTHING;
  ELSE
    INSERT INTO "todo_items" (
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      "status",
      "priority",
      "owner_user_id",
      "created_by_user_id",
      "due_date",
      "completed_at",
      "metadata",
      "created_at",
      "updated_at"
    )
    SELECT
      "id",
      "organization_id",
      "project_id",
      "title",
      "description",
      CASE
        WHEN "status"::text = 'pending' THEN 'pending'::todo_item_status
        WHEN "status"::text = 'done' THEN 'done'::todo_item_status
        WHEN "status"::text = 'blocked' THEN 'blocked'::todo_item_status
        ELSE 'pending'::todo_item_status
      END,
      NULL,
      "owner_user_id",
      NULL,
      "due_date",
      NULL,
      "metadata",
      "created_at",
      "updated_at"
    FROM "idea_items"
    WHERE "type" = 'todo'
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;--> statement-breakpoint

-- Step 2: Update entity_comments that belong to todo items (change entity_type from 'idea' to 'todo')
UPDATE "entity_comments"
SET "entity_type" = 'todo'
WHERE "entity_type" = 'idea'
  AND "entity_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'todo');--> statement-breakpoint

-- Step 3: Update entity_events that belong to todo items (change entity_type from 'idea' to 'todo')
UPDATE "entity_events"
SET "entity_type" = 'todo'
WHERE "entity_type" = 'idea'
  AND "entity_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'todo');--> statement-breakpoint

-- Step 4: Delete idea_item_tags for todo items (todo_items has no tags junction table)
DELETE FROM "idea_item_tags"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'todo');--> statement-breakpoint

-- Step 5: Delete idea_item_feedback_links for todo items
DELETE FROM "idea_item_feedback_links"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'todo');--> statement-breakpoint

-- Step 6: Delete idea_item_work_item_links for todo items
DELETE FROM "idea_item_work_item_links"
WHERE "idea_item_id" IN (SELECT "id" FROM "idea_items" WHERE "type" = 'todo');--> statement-breakpoint

-- Step 7: Delete todo rows from idea_items (now fully migrated)
DELETE FROM "idea_items"
WHERE "type" = 'todo';
