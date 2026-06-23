ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "agent_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL;
