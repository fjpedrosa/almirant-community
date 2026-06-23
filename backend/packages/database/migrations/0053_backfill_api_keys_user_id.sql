-- Backfill userId for existing API keys where userId IS NULL
-- Strategy: assign the owner of the organization, or the first member by createdAt if no owner exists.
-- Keys belonging to organizations with no members at all are left as NULL (orphaned).
-- This UPDATE is idempotent: it only affects rows where user_id IS NULL.
UPDATE "api_keys"
SET "user_id" = (
  SELECT m."user_id"
  FROM "member" m
  WHERE m."organization_id" = "api_keys"."organization_id"
  ORDER BY
    CASE WHEN m."role" = 'owner' THEN 0 ELSE 1 END,
    m."created_at" ASC
  LIMIT 1
)
WHERE "user_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "member" m WHERE m."organization_id" = "api_keys"."organization_id"
  );
