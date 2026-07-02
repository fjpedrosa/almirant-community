-- Rename the tenant-scoping concept "organization" -> "workspace".
--
-- Tables `organization` and `organization_settings` are renamed to `workspace`
-- and `workspace_settings`; every tenant-scoped `organization_id` column becomes
-- `workspace_id` (including `session.active_organization_id` ->
-- `session.active_workspace_id`), and foreign keys, indexes, unique constraints
-- and the composite primary key on `task_id_counters` are renamed to the
-- canonical Drizzle names so `db:generate` detects no drift afterwards.
--
-- Every rename is wrapped in an idempotent guard (IF EXISTS on the old name)
-- so the migration is safe to run against databases in any intermediate state
-- (fresh installs, already-renamed databases, or drifted self-hosted setups).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF to_regclass('public.organization') IS NOT NULL AND to_regclass('public.workspace') IS NULL THEN
    ALTER TABLE "organization" RENAME TO "workspace";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('public.organization_settings') IS NOT NULL AND to_regclass('public.workspace_settings') IS NULL THEN
    ALTER TABLE "organization_settings" RENAME TO "workspace_settings";
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'session' AND column_name = 'active_organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'session' AND column_name = 'active_workspace_id') THEN
    ALTER TABLE "session" RENAME COLUMN "active_organization_id" TO "active_workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tags' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tags' AND column_name = 'workspace_id') THEN
    ALTER TABLE "tags" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'workspace_id') THEN
    ALTER TABLE "webhooks" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'workspace_id') THEN
    ALTER TABLE "import_jobs" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'workspace_id') THEN
    ALTER TABLE "projects" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'boards' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'boards' AND column_name = 'workspace_id') THEN
    ALTER TABLE "boards" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_jobs' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_jobs' AND column_name = 'workspace_id') THEN
    ALTER TABLE "agent_jobs" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_id_counters' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_id_counters' AND column_name = 'workspace_id') THEN
    ALTER TABLE "task_id_counters" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'milestones' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'milestones' AND column_name = 'workspace_id') THEN
    ALTER TABLE "milestones" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_categories' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_categories' AND column_name = 'workspace_id') THEN
    ALTER TABLE "document_categories" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'workspace_id') THEN
    ALTER TABLE "api_keys" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_accounts' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'service_accounts' AND column_name = 'workspace_id') THEN
    ALTER TABLE "service_accounts" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_quotas' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_quotas' AND column_name = 'workspace_id') THEN
    ALTER TABLE "provider_quotas" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'discord_connections' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'discord_connections' AND column_name = 'workspace_id') THEN
    ALTER TABLE "discord_connections" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bug_fix_attempts' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bug_fix_attempts' AND column_name = 'workspace_id') THEN
    ALTER TABLE "bug_fix_attempts" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'idea_items' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'idea_items' AND column_name = 'workspace_id') THEN
    ALTER TABLE "idea_items" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seeds' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seeds' AND column_name = 'workspace_id') THEN
    ALTER TABLE "seeds" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'planning_sessions' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'planning_sessions' AND column_name = 'workspace_id') THEN
    ALTER TABLE "planning_sessions" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'integration_batches' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'integration_batches' AND column_name = 'workspace_id') THEN
    ALTER TABLE "integration_batches" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todo_items' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todo_items' AND column_name = 'workspace_id') THEN
    ALTER TABLE "todo_items" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invitation' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invitation' AND column_name = 'workspace_id') THEN
    ALTER TABLE "invitation" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member' AND column_name = 'workspace_id') THEN
    ALTER TABLE "member" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workspace_settings' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workspace_settings' AND column_name = 'workspace_id') THEN
    ALTER TABLE "workspace_settings" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_queue' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_queue' AND column_name = 'workspace_id') THEN
    ALTER TABLE "notification_queue" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'workspace_id') THEN
    ALTER TABLE "notification_preferences" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'workspace_id') THEN
    ALTER TABLE "notifications" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expense_categories' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expense_categories' AND column_name = 'workspace_id') THEN
    ALTER TABLE "expense_categories" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'workspace_id') THEN
    ALTER TABLE "expenses" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_expenses' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_expenses' AND column_name = 'workspace_id') THEN
    ALTER TABLE "recurring_expenses" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_records' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_records' AND column_name = 'workspace_id') THEN
    ALTER TABLE "usage_records" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_summaries' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_summaries' AND column_name = 'workspace_id') THEN
    ALTER TABLE "usage_summaries" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_usage_summaries' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_usage_summaries' AND column_name = 'workspace_id') THEN
    ALTER TABLE "user_usage_summaries" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'workspace_id') THEN
    ALTER TABLE "skills" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scheduled_agent_configs' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scheduled_agent_configs' AND column_name = 'workspace_id') THEN
    ALTER TABLE "scheduled_agent_configs" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scheduled_agent_runs' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scheduled_agent_runs' AND column_name = 'workspace_id') THEN
    ALTER TABLE "scheduled_agent_runs" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ask_documents' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ask_documents' AND column_name = 'workspace_id') THEN
    ALTER TABLE "ask_documents" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ask_ingestion_state' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ask_ingestion_state' AND column_name = 'workspace_id') THEN
    ALTER TABLE "ask_ingestion_state" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'handbook_capture_proposals' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'handbook_capture_proposals' AND column_name = 'workspace_id') THEN
    ALTER TABLE "handbook_capture_proposals" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'handbook_entries' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'handbook_entries' AND column_name = 'workspace_id') THEN
    ALTER TABLE "handbook_entries" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analytics_daily_aggregates' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analytics_daily_aggregates' AND column_name = 'workspace_id') THEN
    ALTER TABLE "analytics_daily_aggregates" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analytics_daily_user_aggregates' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analytics_daily_user_aggregates' AND column_name = 'workspace_id') THEN
    ALTER TABLE "analytics_daily_user_aggregates" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_observations' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_observations' AND column_name = 'workspace_id') THEN
    ALTER TABLE "agent_observations" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_memory_telemetry' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_memory_telemetry' AND column_name = 'workspace_id') THEN
    ALTER TABLE "agent_memory_telemetry" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incident_bundles' AND column_name = 'organization_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incident_bundles' AND column_name = 'workspace_id') THEN
    ALTER TABLE "incident_bundles" RENAME COLUMN "organization_id" TO "workspace_id";
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Foreign-key constraints
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_organization_id_organization_id_fk') THEN
    ALTER TABLE "tags" RENAME CONSTRAINT "tags_organization_id_organization_id_fk" TO "tags_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_organization_id_organization_id_fk') THEN
    ALTER TABLE "webhooks" RENAME CONSTRAINT "webhooks_organization_id_organization_id_fk" TO "webhooks_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_jobs_organization_id_organization_id_fk') THEN
    ALTER TABLE "import_jobs" RENAME CONSTRAINT "import_jobs_organization_id_organization_id_fk" TO "import_jobs_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_organization_id_organization_id_fk') THEN
    ALTER TABLE "projects" RENAME CONSTRAINT "projects_organization_id_organization_id_fk" TO "projects_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boards_organization_id_organization_id_fk') THEN
    ALTER TABLE "boards" RENAME CONSTRAINT "boards_organization_id_organization_id_fk" TO "boards_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_jobs_organization_id_organization_id_fk') THEN
    ALTER TABLE "agent_jobs" RENAME CONSTRAINT "agent_jobs_organization_id_organization_id_fk" TO "agent_jobs_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_job_logs_org_id_organization_id_fk') THEN
    ALTER TABLE "agent_job_logs" RENAME CONSTRAINT "agent_job_logs_org_id_organization_id_fk" TO "agent_job_logs_org_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_id_counters_organization_id_organization_id_fk') THEN
    ALTER TABLE "task_id_counters" RENAME CONSTRAINT "task_id_counters_organization_id_organization_id_fk" TO "task_id_counters_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestones_organization_id_organization_id_fk') THEN
    ALTER TABLE "milestones" RENAME CONSTRAINT "milestones_organization_id_organization_id_fk" TO "milestones_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_categories_organization_id_organization_id_fk') THEN
    ALTER TABLE "document_categories" RENAME CONSTRAINT "document_categories_organization_id_organization_id_fk" TO "document_categories_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_organization_id_organization_id_fk') THEN
    ALTER TABLE "api_keys" RENAME CONSTRAINT "api_keys_organization_id_organization_id_fk" TO "api_keys_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_accounts_organization_id_organization_id_fk') THEN
    ALTER TABLE "service_accounts" RENAME CONSTRAINT "service_accounts_organization_id_organization_id_fk" TO "service_accounts_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_quotas_organization_id_organization_id_fk') THEN
    ALTER TABLE "provider_quotas" RENAME CONSTRAINT "provider_quotas_organization_id_organization_id_fk" TO "provider_quotas_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discord_connections_organization_id_organization_id_fk') THEN
    ALTER TABLE "discord_connections" RENAME CONSTRAINT "discord_connections_organization_id_organization_id_fk" TO "discord_connections_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bug_fix_attempts_organization_id_organization_id_fk') THEN
    ALTER TABLE "bug_fix_attempts" RENAME CONSTRAINT "bug_fix_attempts_organization_id_organization_id_fk" TO "bug_fix_attempts_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idea_items_organization_id_organization_id_fk') THEN
    ALTER TABLE "idea_items" RENAME CONSTRAINT "idea_items_organization_id_organization_id_fk" TO "idea_items_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seeds_organization_id_organization_id_fk') THEN
    ALTER TABLE "seeds" RENAME CONSTRAINT "seeds_organization_id_organization_id_fk" TO "seeds_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planning_sessions_organization_id_organization_id_fk') THEN
    ALTER TABLE "planning_sessions" RENAME CONSTRAINT "planning_sessions_organization_id_organization_id_fk" TO "planning_sessions_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_batches_organization_id_organization_id_fk') THEN
    ALTER TABLE "integration_batches" RENAME CONSTRAINT "integration_batches_organization_id_organization_id_fk" TO "integration_batches_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_items_organization_id_organization_id_fk') THEN
    ALTER TABLE "todo_items" RENAME CONSTRAINT "todo_items_organization_id_organization_id_fk" TO "todo_items_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_organization_id_organization_id_fk') THEN
    ALTER TABLE "invitation" RENAME CONSTRAINT "invitation_organization_id_organization_id_fk" TO "invitation_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_organization_id_organization_id_fk') THEN
    ALTER TABLE "member" RENAME CONSTRAINT "member_organization_id_organization_id_fk" TO "member_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_settings_organization_id_organization_id_fk') THEN
    ALTER TABLE "workspace_settings" RENAME CONSTRAINT "organization_settings_organization_id_organization_id_fk" TO "workspace_settings_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_categories_organization_id_organization_id_fk') THEN
    ALTER TABLE "expense_categories" RENAME CONSTRAINT "expense_categories_organization_id_organization_id_fk" TO "expense_categories_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_organization_id_organization_id_fk') THEN
    ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_organization_id_organization_id_fk" TO "expenses_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_expenses_organization_id_organization_id_fk') THEN
    ALTER TABLE "recurring_expenses" RENAME CONSTRAINT "recurring_expenses_organization_id_organization_id_fk" TO "recurring_expenses_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usage_records_organization_id_organization_id_fk') THEN
    ALTER TABLE "usage_records" RENAME CONSTRAINT "usage_records_organization_id_organization_id_fk" TO "usage_records_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usage_summaries_organization_id_organization_id_fk') THEN
    ALTER TABLE "usage_summaries" RENAME CONSTRAINT "usage_summaries_organization_id_organization_id_fk" TO "usage_summaries_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_usage_summaries_organization_id_organization_id_fk') THEN
    ALTER TABLE "user_usage_summaries" RENAME CONSTRAINT "user_usage_summaries_organization_id_organization_id_fk" TO "user_usage_summaries_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skills_organization_id_organization_id_fk') THEN
    ALTER TABLE "skills" RENAME CONSTRAINT "skills_organization_id_organization_id_fk" TO "skills_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_agent_configs_organization_id_organization_id_fk') THEN
    ALTER TABLE "scheduled_agent_configs" RENAME CONSTRAINT "scheduled_agent_configs_organization_id_organization_id_fk" TO "scheduled_agent_configs_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_agent_runs_organization_id_organization_id_fk') THEN
    ALTER TABLE "scheduled_agent_runs" RENAME CONSTRAINT "scheduled_agent_runs_organization_id_organization_id_fk" TO "scheduled_agent_runs_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ask_documents_organization_id_organization_id_fk') THEN
    ALTER TABLE "ask_documents" RENAME CONSTRAINT "ask_documents_organization_id_organization_id_fk" TO "ask_documents_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ask_ingestion_state_organization_id_organization_id_fk') THEN
    ALTER TABLE "ask_ingestion_state" RENAME CONSTRAINT "ask_ingestion_state_organization_id_organization_id_fk" TO "ask_ingestion_state_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handbook_capture_proposals_organization_id_organization_id_fk') THEN
    ALTER TABLE "handbook_capture_proposals" RENAME CONSTRAINT "handbook_capture_proposals_organization_id_organization_id_fk" TO "handbook_capture_proposals_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handbook_entries_organization_id_organization_id_fk') THEN
    ALTER TABLE "handbook_entries" RENAME CONSTRAINT "handbook_entries_organization_id_organization_id_fk" TO "handbook_entries_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_daily_aggregates_organization_id_organization_id_fk') THEN
    ALTER TABLE "analytics_daily_aggregates" RENAME CONSTRAINT "analytics_daily_aggregates_organization_id_organization_id_fk" TO "analytics_daily_aggregates_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_daily_user_aggregates_organization_id_organization_id_fk') THEN
    ALTER TABLE "analytics_daily_user_aggregates" RENAME CONSTRAINT "analytics_daily_user_aggregates_organization_id_organization_id_fk" TO "analytics_daily_user_aggregates_workspace_id_workspace_id_fk";
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_daily_user_aggregates_organization_id_organization_id') THEN
    -- Name was truncated by Postgres at 63 chars; rename to the full canonical Drizzle name.
    ALTER TABLE "analytics_daily_user_aggregates" RENAME CONSTRAINT "analytics_daily_user_aggregates_organization_id_organization_id" TO "analytics_daily_user_aggregates_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_observations_organization_id_organization_id_fk') THEN
    ALTER TABLE "agent_observations" RENAME CONSTRAINT "agent_observations_organization_id_organization_id_fk" TO "agent_observations_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_telemetry_organization_id_organization_id_fk') THEN
    ALTER TABLE "agent_memory_telemetry" RENAME CONSTRAINT "agent_memory_telemetry_organization_id_organization_id_fk" TO "agent_memory_telemetry_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_bundles_organization_id_organization_id_fk') THEN
    ALTER TABLE "incident_bundles" RENAME CONSTRAINT "incident_bundles_organization_id_organization_id_fk" TO "incident_bundles_workspace_id_workspace_id_fk";
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'tags_name_organization_id_idx') THEN
    ALTER INDEX "tags_name_organization_id_idx" RENAME TO "tags_name_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'tags_organization_id_idx') THEN
    ALTER INDEX "tags_organization_id_idx" RENAME TO "tags_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'webhooks_organization_id_idx') THEN
    ALTER INDEX "webhooks_organization_id_idx" RENAME TO "webhooks_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'import_jobs_organization_id_idx') THEN
    ALTER INDEX "import_jobs_organization_id_idx" RENAME TO "import_jobs_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'projects_organization_id_idx') THEN
    ALTER INDEX "projects_organization_id_idx" RENAME TO "projects_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'agent_jobs_organization_idx') THEN
    ALTER INDEX "agent_jobs_organization_idx" RENAME TO "agent_jobs_workspace_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'milestones_organization_id_idx') THEN
    ALTER INDEX "milestones_organization_id_idx" RENAME TO "milestones_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'document_categories_organization_id_idx') THEN
    ALTER INDEX "document_categories_organization_id_idx" RENAME TO "document_categories_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'api_keys_organization_id_idx') THEN
    ALTER INDEX "api_keys_organization_id_idx" RENAME TO "api_keys_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'service_accounts_organization_id_idx') THEN
    ALTER INDEX "service_accounts_organization_id_idx" RENAME TO "service_accounts_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'provider_quotas_organization_id_idx') THEN
    ALTER INDEX "provider_quotas_organization_id_idx" RENAME TO "provider_quotas_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'discord_connections_organization_id_idx') THEN
    ALTER INDEX "discord_connections_organization_id_idx" RENAME TO "discord_connections_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'idea_items_organization_idx') THEN
    ALTER INDEX "idea_items_organization_idx" RENAME TO "idea_items_workspace_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'seeds_organization_idx') THEN
    ALTER INDEX "seeds_organization_idx" RENAME TO "seeds_workspace_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'planning_sessions_organization_idx') THEN
    ALTER INDEX "planning_sessions_organization_idx" RENAME TO "planning_sessions_workspace_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'integration_batches_organization_idx') THEN
    ALTER INDEX "integration_batches_organization_idx" RENAME TO "integration_batches_workspace_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'todo_items_organization_idx') THEN
    ALTER INDEX "todo_items_organization_idx" RENAME TO "todo_items_workspace_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'invitation_organization_id_idx') THEN
    ALTER INDEX "invitation_organization_id_idx" RENAME TO "invitation_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'member_organization_id_idx') THEN
    ALTER INDEX "member_organization_id_idx" RENAME TO "member_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'skills_organization_id_idx') THEN
    ALTER INDEX "skills_organization_id_idx" RENAME TO "skills_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'scheduled_agent_configs_organization_id_idx') THEN
    ALTER INDEX "scheduled_agent_configs_organization_id_idx" RENAME TO "scheduled_agent_configs_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'scheduled_agent_runs_organization_id_idx') THEN
    ALTER INDEX "scheduled_agent_runs_organization_id_idx" RENAME TO "scheduled_agent_runs_workspace_id_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'ask_documents_organization_idx') THEN
    ALTER INDEX "ask_documents_organization_idx" RENAME TO "ask_documents_workspace_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE c.relkind = 'i' AND ns.nspname = 'public' AND c.relname = 'agent_observations_organization_idx') THEN
    ALTER INDEX "agent_observations_organization_idx" RENAME TO "agent_observations_workspace_idx";
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Unique constraints
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_slug_unique') THEN
    ALTER TABLE "workspace" RENAME CONSTRAINT "organization_slug_unique" TO "workspace_slug_unique";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_settings_organization_id_unique') THEN
    ALTER TABLE "workspace_settings" RENAME CONSTRAINT "organization_settings_organization_id_unique" TO "workspace_settings_workspace_id_unique";
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_settings_workspace_id_unique') THEN
    -- Drift: column was renamed before the constraint in some environments.
    ALTER TABLE "workspace_settings" RENAME CONSTRAINT "organization_settings_workspace_id_unique" TO "workspace_settings_workspace_id_unique";
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Composite primary key (task_id_counters)
-- Handles drift: some environments have the default-named pkey instead of the
-- Drizzle-canonical name. Recreate with the expected name either way.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_id_counters_prefix_organization_id_pk') THEN
    ALTER TABLE "task_id_counters" RENAME CONSTRAINT "task_id_counters_prefix_organization_id_pk" TO "task_id_counters_prefix_workspace_id_pk";
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_id_counters_pkey') THEN
    ALTER TABLE "task_id_counters" DROP CONSTRAINT "task_id_counters_pkey";
    ALTER TABLE "task_id_counters" ADD CONSTRAINT "task_id_counters_prefix_workspace_id_pk" PRIMARY KEY ("prefix", "workspace_id");
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Primary-key constraints of the renamed tables (Postgres does not rename
-- them automatically together with the table).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_pkey') THEN
    ALTER TABLE "workspace" RENAME CONSTRAINT "organization_pkey" TO "workspace_pkey";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_settings_pkey') THEN
    ALTER TABLE "workspace_settings" RENAME CONSTRAINT "organization_settings_pkey" TO "workspace_settings_pkey";
  END IF;
END $$;--> statement-breakpoint
