-- Rename bug job types: remove `nightly-fix` and `bug-triage`, introduce `bug-analysis`.
--
-- Postgres does not support DROP VALUE on an enum, so we must:
--   1. Migrate rows off the values we intend to drop
--   2. Add the new value (ADD VALUE IF NOT EXISTS works since PG 14)
--   3. Re-point legacy rows (`bug-triage` -> `bug-analysis`)
--   4. Recreate the enum without the retired values and swap both columns over

-- Step 1: migrate `nightly-fix` rows to `bug-fix` BEFORE touching the enum
UPDATE "agent_jobs" SET "job_type" = 'bug-fix' WHERE "job_type" = 'nightly-fix';
UPDATE "scheduled_agent_configs" SET "job_type" = 'bug-fix' WHERE "job_type" = 'nightly-fix';

-- Step 2: add `bug-analysis` as a new enum value so we can re-point `bug-triage` rows to it.
-- This MUST live in its own statement because PG forbids using a newly-added enum value
-- in the same transaction. Drizzle uses `--> statement-breakpoint` to split statements.
ALTER TYPE "public"."agent_job_type" ADD VALUE IF NOT EXISTS 'bug-analysis';--> statement-breakpoint

-- Step 3: migrate `bug-triage` rows to `bug-analysis`
UPDATE "agent_jobs" SET "job_type" = 'bug-analysis' WHERE "job_type" = 'bug-triage';
UPDATE "scheduled_agent_configs" SET "job_type" = 'bug-analysis' WHERE "job_type" = 'bug-triage';

-- Step 4: recreate the enum without `nightly-fix` and `bug-triage`
ALTER TYPE "public"."agent_job_type" RENAME TO "agent_job_type_old";

CREATE TYPE "public"."agent_job_type" AS ENUM (
  'implementation',
  'planning',
  'review',
  'validation',
  'recording',
  'prewarm',
  'bug-analysis',
  'bug-fix',
  'scheduled',
  'incident-analyze',
  'feedback-triage',
  'feedback-triage-batch'
);

ALTER TABLE "agent_jobs"
  ALTER COLUMN "job_type" DROP DEFAULT;

ALTER TABLE "agent_jobs"
  ALTER COLUMN "job_type" TYPE "public"."agent_job_type"
  USING "job_type"::text::"public"."agent_job_type";

ALTER TABLE "agent_jobs"
  ALTER COLUMN "job_type" SET DEFAULT 'implementation';

ALTER TABLE "scheduled_agent_configs"
  ALTER COLUMN "job_type" TYPE "public"."agent_job_type"
  USING "job_type"::text::"public"."agent_job_type";

DROP TYPE "public"."agent_job_type_old";
