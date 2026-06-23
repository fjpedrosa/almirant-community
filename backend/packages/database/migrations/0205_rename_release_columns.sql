-- Idempotent rename of board columns:
--   * "Reviewing" (role=review)  -> "To Review"
--   * "Release"   (role=release) -> "To Release"
-- Existing UUIDs are preserved; only the display name changes.
UPDATE "board_columns"
SET "name" = 'To Review', "updated_at" = NOW()
WHERE "role" = 'review' AND "name" = 'Reviewing';
--> statement-breakpoint
UPDATE "board_columns"
SET "name" = 'To Release', "updated_at" = NOW()
WHERE "role" = 'release' AND "name" = 'Release';
