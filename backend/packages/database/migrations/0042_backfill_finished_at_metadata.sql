-- Backfill metadata.finishedAt for work items currently in "done" columns
-- that don't have finishedAt set in their metadata.
-- Uses updated_at as the best approximation of when the item was completed.
UPDATE work_items
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{finishedAt}',
  to_jsonb(to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
),
updated_at = updated_at  -- preserve original updated_at
WHERE board_column_id IN (
  SELECT id FROM board_columns WHERE is_done = true
)
AND archived_at IS NULL
AND (
  metadata IS NULL
  OR metadata->>'finishedAt' IS NULL
);
