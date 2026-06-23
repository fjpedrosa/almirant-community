-- A-1900: backfill project_id on feedback_items / feedback_clusters /
-- agent_jobs (feedback-related) / bug_fix_attempts, and remove the now-redundant
-- `metadata.projectId` key on feedback rows.
--
-- NOTE: the actual data migration is performed by the Bun script at
--   backend/packages/database/scripts/backfill-feedback-project.ts
-- (run via `bun run db:backfill:feedback-project`). The script reads the
-- target project UUID from the ALMIRANT_PROJECT_ID env var so we do not
-- hard-code it in this migration.
--
-- This file exists solely as a marker so Drizzle's migration journal moves
-- forward in lock-step with the script execution; it intentionally does not
-- perform any UPDATE, since running the updates here would require pulling
-- the project UUID at SQL-apply time (which we do not want).
DO $$ BEGIN
  RAISE NOTICE 'backfill is run via script backfill-feedback-project.ts';
END $$;
