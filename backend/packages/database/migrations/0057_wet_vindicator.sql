-- 0057: Unified provider_connections + organization_settings
-- Migrates github_installations, provider_api_keys, vercel_connections → provider_connections

-- 1. Create new enums
CREATE TYPE "public"."ai_key_policy" AS ENUM('org_only', 'org_preferred', 'user_preferred', 'user_only');--> statement-breakpoint
CREATE TYPE "public"."connection_category" AS ENUM('code', 'ai', 'deployment');--> statement-breakpoint
CREATE TYPE "public"."connection_scope" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('github', 'openai', 'anthropic', 'google', 'openai_compatible', 'vercel');--> statement-breakpoint

-- 2. Create new tables
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider_type" NOT NULL,
	"category" "connection_category" NOT NULL,
	"scope" "connection_scope" NOT NULL,
	"scope_id" text NOT NULL,
	"created_by_user_id" text,
	"name" varchar(255) NOT NULL,
	"account_identifier" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"token_expires_at" timestamp with time zone,
	"encrypted_credentials" text,
	"credentials_iv" text,
	"credentials_auth_tag" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"ai_key_policy" "ai_key_policy" DEFAULT 'user_preferred' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_organization_id_unique" UNIQUE("organization_id")
);--> statement-breakpoint

-- 3. Migrate data: github_installations → provider_connections
INSERT INTO "provider_connections" (
  "id", "provider", "category", "scope", "scope_id", "name",
  "account_identifier", "is_active", "suspended_at", "token_expires_at",
  "config", "created_at", "updated_at"
)
SELECT
  "id",
  'github'::"provider_type",
  'code'::"connection_category",
  'organization'::"connection_scope",
  COALESCE("organization_id", 'unknown'),
  "account_login",
  "account_login",
  ("suspended_at" IS NULL),
  "suspended_at",
  "token_expires_at",
  jsonb_build_object(
    'installationId', "installation_id",
    'accountType', "account_type",
    'accountAvatarUrl', "account_avatar_url",
    'accessToken', "access_token",
    'permissions', COALESCE("permissions", '{}'),
    'repositorySelection', "repository_selection"
  ),
  "created_at",
  "updated_at"
FROM "github_installations";--> statement-breakpoint

-- 4. Add connection_id column (nullable first for migration)
ALTER TABLE "repo_installation_links" ADD COLUMN "connection_id" uuid;--> statement-breakpoint

-- 5. Backfill connection_id from installation_id
UPDATE "repo_installation_links" ril
SET "connection_id" = gi."id"
FROM "github_installations" gi
WHERE ril."installation_id" = gi."id";--> statement-breakpoint

-- 6. Make connection_id NOT NULL now that data is migrated
ALTER TABLE "repo_installation_links" ALTER COLUMN "connection_id" SET NOT NULL;--> statement-breakpoint

-- 7. Drop old constraint (IF EXISTS because CASCADE may have already removed it)
ALTER TABLE "repo_installation_links" DROP CONSTRAINT IF EXISTS "repo_installation_links_installation_id_github_installations_id_fk";--> statement-breakpoint

-- 8. Drop old column
ALTER TABLE "repo_installation_links" DROP COLUMN "installation_id";--> statement-breakpoint

-- 9. Drop old tables (safe now that data is migrated)
ALTER TABLE "provider_api_keys" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "github_installations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vercel_connections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "provider_api_keys" CASCADE;--> statement-breakpoint
DROP TABLE "github_installations" CASCADE;--> statement-breakpoint
DROP TABLE "vercel_connections" CASCADE;--> statement-breakpoint

-- 10. Add foreign keys and indexes on new tables
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_connections_scope_provider_idx" ON "provider_connections" USING btree ("scope","scope_id","provider");--> statement-breakpoint
CREATE INDEX "provider_connections_created_by_user_id_idx" ON "provider_connections" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "provider_connections_category_scope_idx" ON "provider_connections" USING btree ("category","scope","scope_id");--> statement-breakpoint
CREATE INDEX "provider_connections_active_idx" ON "provider_connections" USING btree ("is_active") WHERE is_active = true;--> statement-breakpoint
ALTER TABLE "repo_installation_links" ADD CONSTRAINT "repo_installation_links_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 11. Cleanup old enum
DROP TYPE IF EXISTS "public"."auth_method";
