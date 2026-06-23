-- Fix: seeds.status column DEFAULT was 'active' in migration 0084, but the
-- Drizzle schema defines default("draft"). When the repository's createSeed()
-- omits status from the INSERT, PostgreSQL's column default ('active') takes
-- precedence over the ORM-level default, causing new seeds to appear as
-- "active" instead of "draft".
--
-- This migration corrects the column default to match the intended behavior.
-- See: A-775

ALTER TABLE "seeds" ALTER COLUMN "status" SET DEFAULT 'draft';
