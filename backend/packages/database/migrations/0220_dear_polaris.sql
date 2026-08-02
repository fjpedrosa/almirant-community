CREATE TYPE "public"."mcp_auth_type" AS ENUM('none', 'bearer', 'custom_header');--> statement-breakpoint
CREATE TYPE "public"."mcp_visibility" AS ENUM('user', 'workspace', 'official');--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text,
	"project_id" uuid,
	"owner_user_id" text,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"transport" varchar(50) DEFAULT 'remote' NOT NULL,
	"visibility" "mcp_visibility" DEFAULT 'user' NOT NULL,
	"auth_type" "mcp_auth_type" DEFAULT 'none' NOT NULL,
	"auth_header_name" varchar(255),
	"template_key" varchar(64),
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"encrypted_credentials" text,
	"credentials_iv" text,
	"credentials_auth_tag" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_servers_slug_scope_idx" UNIQUE NULLS NOT DISTINCT("slug","workspace_id","project_id","owner_user_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_agent_mcp_servers" (
	"agent_id" uuid NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_agent_mcp_servers_agent_id_mcp_server_id_pk" PRIMARY KEY("agent_id","mcp_server_id")
);
--> statement-breakpoint
CREATE TABLE "agent_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"instructions" text NOT NULL,
	"owner_user_id" text,
	"visibility" varchar(32) DEFAULT 'workspace' NOT NULL,
	"provider" varchar(50) DEFAULT 'portable' NOT NULL,
	"source_type" varchar(32) DEFAULT 'instructions' NOT NULL,
	"marketplace_id" uuid,
	"external_id" varchar(255),
	"source_reference" text,
	"version" varchar(100),
	"checksum_sha256" varchar(64),
	"storage_object_id" uuid,
	"manifest" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_plugins_slug_workspace_owner_idx" UNIQUE NULLS NOT DISTINCT("slug","workspace_id","owner_user_id"),
	CONSTRAINT "agent_plugins_visibility_check" CHECK ("agent_plugins"."visibility" IN ('user', 'workspace', 'official')),
	CONSTRAINT "agent_plugins_provider_check" CHECK ("agent_plugins"."provider" IN ('portable', 'claude-code', 'opencode', 'codex')),
	CONSTRAINT "agent_plugins_source_type_check" CHECK ("agent_plugins"."source_type" IN ('instructions', 'marketplace', 'upload'))
);
--> statement-breakpoint
CREATE TABLE "plugin_marketplaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"provider" varchar(50) DEFAULT 'claude-code' NOT NULL,
	"source" text NOT NULL,
	"source_type" varchar(32) DEFAULT 'github' NOT NULL,
	"catalog" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"owner_user_id" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_marketplaces_slug_workspace_idx" UNIQUE NULLS NOT DISTINCT("slug","workspace_id","owner_user_id"),
	CONSTRAINT "plugin_marketplaces_provider_check" CHECK ("plugin_marketplaces"."provider" IN ('claude-code', 'opencode')),
	CONSTRAINT "plugin_marketplaces_source_type_check" CHECK ("plugin_marketplaces"."source_type" IN ('github', 'url', 'npm'))
);
--> statement-breakpoint
CREATE TABLE "user_storage_deletions" (
	"object_key" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_storage_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"workspace_id" text,
	"object_key" text NOT NULL,
	"virtual_path" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(255) DEFAULT 'application/octet-stream' NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"kind" varchar(32) DEFAULT 'file' NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reservation_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_storage_objects_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "user_storage_objects_size_nonnegative" CHECK ("user_storage_objects"."size_bytes" >= 0),
	CONSTRAINT "user_storage_objects_kind_check" CHECK ("user_storage_objects"."kind" IN ('file', 'plugin_bundle')),
	CONSTRAINT "user_storage_objects_status_check" CHECK ("user_storage_objects"."status" IN ('pending', 'ready'))
);
--> statement-breakpoint
CREATE TABLE "user_storage_usage" (
	"owner_user_id" text PRIMARY KEY NOT NULL,
	"quota_bytes" bigint DEFAULT 1073741824 NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"quota_objects" integer DEFAULT 10000 NOT NULL,
	"used_objects" integer DEFAULT 0 NOT NULL,
	"reserved_objects" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_storage_usage_quota_nonnegative" CHECK ("user_storage_usage"."quota_bytes" >= 0),
	CONSTRAINT "user_storage_usage_used_nonnegative" CHECK ("user_storage_usage"."used_bytes" >= 0),
	CONSTRAINT "user_storage_usage_reserved_nonnegative" CHECK ("user_storage_usage"."reserved_bytes" >= 0),
	CONSTRAINT "user_storage_usage_capacity_check" CHECK ("user_storage_usage"."used_bytes" + "user_storage_usage"."reserved_bytes" <= "user_storage_usage"."quota_bytes"),
	CONSTRAINT "user_storage_usage_object_quota_nonnegative" CHECK ("user_storage_usage"."quota_objects" >= 0),
	CONSTRAINT "user_storage_usage_used_objects_nonnegative" CHECK ("user_storage_usage"."used_objects" >= 0),
	CONSTRAINT "user_storage_usage_reserved_objects_nonnegative" CHECK ("user_storage_usage"."reserved_objects" >= 0),
	CONSTRAINT "user_storage_usage_object_capacity_check" CHECK ("user_storage_usage"."used_objects" + "user_storage_usage"."reserved_objects" <= "user_storage_usage"."quota_objects")
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_mcp_servers" ADD CONSTRAINT "scheduled_agent_mcp_servers_agent_id_scheduled_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."scheduled_agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_mcp_servers" ADD CONSTRAINT "scheduled_agent_mcp_servers_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plugins" ADD CONSTRAINT "agent_plugins_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plugins" ADD CONSTRAINT "agent_plugins_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plugins" ADD CONSTRAINT "agent_plugins_marketplace_id_plugin_marketplaces_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."plugin_marketplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plugins" ADD CONSTRAINT "agent_plugins_storage_object_id_user_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."user_storage_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plugins" ADD CONSTRAINT "agent_plugins_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_marketplaces" ADD CONSTRAINT "plugin_marketplaces_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_marketplaces" ADD CONSTRAINT "plugin_marketplaces_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_marketplaces" ADD CONSTRAINT "plugin_marketplaces_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_objects" ADD CONSTRAINT "user_storage_objects_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_objects" ADD CONSTRAINT "user_storage_objects_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_usage" ADD CONSTRAINT "user_storage_usage_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_servers_workspace_id_idx" ON "mcp_servers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_project_id_idx" ON "mcp_servers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_owner_user_id_idx" ON "mcp_servers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_visibility_idx" ON "mcp_servers" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "mcp_servers_template_key_idx" ON "mcp_servers" USING btree ("template_key");--> statement-breakpoint
CREATE INDEX "mcp_servers_archived_at_idx" ON "mcp_servers" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "scheduled_agent_mcp_servers_mcp_server_id_idx" ON "scheduled_agent_mcp_servers" USING btree ("mcp_server_id");--> statement-breakpoint
CREATE INDEX "agent_plugins_workspace_id_idx" ON "agent_plugins" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_plugins_owner_user_id_idx" ON "agent_plugins" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_plugins_marketplace_id_idx" ON "agent_plugins" USING btree ("marketplace_id");--> statement-breakpoint
CREATE INDEX "agent_plugins_storage_object_id_idx" ON "agent_plugins" USING btree ("storage_object_id");--> statement-breakpoint
CREATE INDEX "agent_plugins_archived_at_idx" ON "agent_plugins" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "plugin_marketplaces_workspace_id_idx" ON "plugin_marketplaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "plugin_marketplaces_owner_user_id_idx" ON "plugin_marketplaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "plugin_marketplaces_provider_idx" ON "plugin_marketplaces" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "user_storage_deletions_next_attempt_idx" ON "user_storage_deletions" USING btree ("next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "user_storage_deletions_owner_user_id_idx" ON "user_storage_deletions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "user_storage_objects_owner_user_id_idx" ON "user_storage_objects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "user_storage_objects_workspace_id_idx" ON "user_storage_objects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "user_storage_objects_kind_idx" ON "user_storage_objects" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "user_storage_objects_status_idx" ON "user_storage_objects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_storage_objects_owner_ready_path_uidx" ON "user_storage_objects" USING btree ("owner_user_id","virtual_path") WHERE "user_storage_objects"."status" = 'ready';
--> statement-breakpoint
-- Drizzle's schema DSL cannot express triggers/functions, so this is a hand
-- append on top of the generated DDL above (mirrors cloud's own migration
-- 0218_agent_user_storage.sql, which added this the same way). Without it,
-- `deleteUserStorageObject` in storage/user-storage-repository.ts deletes the
-- user_storage_objects row but never enqueues its S3 cleanup: it relies
-- entirely on this AFTER DELETE trigger to make the deletion outbox durable
-- against any deletion path, not only the repository's own code path.
CREATE OR REPLACE FUNCTION queue_user_storage_object_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_storage_deletions (object_key, owner_user_id)
  VALUES (OLD.object_key, OLD.owner_user_id)
  ON CONFLICT (object_key) DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_storage_objects_queue_deletion
AFTER DELETE ON user_storage_objects
FOR EACH ROW
EXECUTE FUNCTION queue_user_storage_object_deletion();
