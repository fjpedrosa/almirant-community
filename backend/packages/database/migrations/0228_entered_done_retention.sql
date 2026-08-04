ALTER TABLE "work_items" ADD COLUMN "entered_done_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "work_items_entered_done_at_active_idx" ON "work_items" USING btree ("entered_done_at", "id") WHERE "archived_at" IS NULL;
--> statement-breakpoint
-- Existing active Done items receive the last persisted row update as their
-- conservative entry point. Historical sprint metadata is intentionally not
-- consulted: it is mutable and was refreshed by Done reorders.
UPDATE "work_items" wi
SET "entered_done_at" = wi."updated_at"
WHERE wi."archived_at" IS NULL
  AND wi."entered_done_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "board_columns" bc
    WHERE bc."id" = wi."board_column_id"
      AND bc."is_done" = true
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_work_item_entered_done_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_is_done boolean := false;
  previous_is_done boolean := false;
BEGIN
  IF NEW."board_column_id" IS NULL THEN
    NEW."entered_done_at" := NULL;
    RETURN NEW;
  END IF;

  SELECT COALESCE(bc."is_done", false)
    INTO target_is_done
  FROM "board_columns" bc
  WHERE bc."id" = NEW."board_column_id";

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(bc."is_done", false)
      INTO previous_is_done
    FROM "board_columns" bc
    WHERE bc."id" = OLD."board_column_id";
  END IF;

  IF NEW."archived_at" IS NOT NULL OR NOT target_is_done THEN
    NEW."entered_done_at" := NULL;
  ELSIF TG_OP = 'UPDATE' AND previous_is_done THEN
    NEW."entered_done_at" := COALESCE(OLD."entered_done_at", now());
  ELSE
    NEW."entered_done_at" := now();
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_work_item_done_clock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."is_done" IS DISTINCT FROM OLD."is_done" THEN
    UPDATE "work_items"
    SET "entered_done_at" = CASE
      WHEN NEW."is_done" AND "archived_at" IS NULL
        THEN COALESCE("entered_done_at", now())
      ELSE NULL
    END
    WHERE "board_column_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_work_item_parent_archival()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_is_archived boolean;
BEGIN
  -- An active child must never be attached to an archived parent. The share
  -- lock serializes this check with a concurrent parent archival UPDATE.
  IF NEW."parent_id" IS NOT NULL AND NEW."archived_at" IS NULL THEN
    SELECT parent."archived_at" IS NOT NULL
      INTO parent_is_archived
    FROM "work_items" parent
    WHERE parent."id" = NEW."parent_id"
    FOR SHARE;

    IF COALESCE(parent_is_archived, false) THEN
      RAISE EXCEPTION 'cannot attach active child to archived work item %', NEW."parent_id";
    END IF;
  END IF;

  -- The parent UPDATE already holds its row lock. Reject archival while any
  -- direct child remains active; concurrent child inserts wait on the same
  -- parent share lock and re-check after the archival attempt completes.
  IF NEW."archived_at" IS NOT NULL
    AND (TG_OP = 'INSERT' OR OLD."archived_at" IS NULL)
    AND EXISTS (
      SELECT 1
      FROM "work_items" child
      WHERE child."parent_id" = NEW."id"
        AND child."archived_at" IS NULL
    )
  THEN
    RAISE EXCEPTION 'cannot archive work item % while it has active children', NEW."id";
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS work_items_entered_done_at_trigger ON "work_items";
--> statement-breakpoint
CREATE TRIGGER work_items_entered_done_at_trigger
BEFORE INSERT OR UPDATE ON "work_items"
FOR EACH ROW
EXECUTE FUNCTION set_work_item_entered_done_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS work_items_parent_archive_guard ON "work_items";
--> statement-breakpoint
CREATE TRIGGER work_items_parent_archive_guard
BEFORE INSERT OR UPDATE ON "work_items"
FOR EACH ROW
EXECUTE FUNCTION guard_work_item_parent_archival();
--> statement-breakpoint
DROP TRIGGER IF EXISTS board_columns_done_clock_trigger ON "board_columns";
--> statement-breakpoint
CREATE TRIGGER board_columns_done_clock_trigger
AFTER UPDATE OF "is_done" ON "board_columns"
FOR EACH ROW
EXECUTE FUNCTION sync_work_item_done_clock();
