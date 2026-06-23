-- Migration: Rename openai-compatible/openai_compatible to zai in enums
-- Task: A-1397

-- Step 1: For aiProviderEnum ('ai_provider'):
-- 'zai' already exists in the enum, so we just need to update rows using the old value
-- and leave the old value unused (PostgreSQL cannot DROP enum values).
UPDATE "ai_sessions" SET "provider" = 'zai' WHERE "provider" = 'openai-compatible';
UPDATE "provider_quotas" SET "provider" = 'zai' WHERE "provider" = 'openai-compatible';
UPDATE "quota_usage_periods" SET "provider" = 'zai' WHERE "provider" = 'openai-compatible';
-- quota_alerts has no provider column (uses FK to provider_quotas)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oauth_states') THEN
    UPDATE "oauth_states" SET "provider" = 'zai' WHERE "provider" = 'openai-compatible';
  END IF;
END $$;

-- Step 2: For providerTypeEnum ('provider_type'):
-- 'zai' does NOT exist yet, so we need to add it first.
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'zai';

-- Step 3: Update all rows in provider_connections that use 'openai_compatible'
UPDATE "provider_connections" SET "provider" = 'zai' WHERE "provider" = 'openai_compatible';
