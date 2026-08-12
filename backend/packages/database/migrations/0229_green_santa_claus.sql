CREATE TYPE "public"."note_actor_kind" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."note_legacy_disposition" AS ENUM('pending', 'converted', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."note_legacy_source_type" AS ENUM('todo', 'idea', 'seed');--> statement-breakpoint
CREATE TYPE "public"."note_page_kind" AS ENUM('page', 'daily');--> statement-breakpoint
CREATE TYPE "public"."note_page_provenance" AS ENUM('web', 'mcp', 'user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."note_page_share_role" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TYPE "public"."note_page_visibility" AS ENUM('private', 'workspace');--> statement-breakpoint
CREATE TABLE "note_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_kind" "note_actor_kind",
	"completed_by_user_id" text,
	"completed_by_agent_job_id" uuid,
	"completed_by_channel" text,
	"completed_by_tool" text,
	"updated_by_user_id" text,
	"updated_by_kind" "note_actor_kind" DEFAULT 'user' NOT NULL,
	"updated_by_agent_job_id" uuid,
	"updated_by_channel" text,
	"updated_by_tool" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_checklist_items_ordinal_nonnegative" CHECK ("note_checklist_items"."ordinal" >= 0),
	CONSTRAINT "note_checklist_items_completion_consistency" CHECK ((("note_checklist_items"."checked" = true AND "note_checklist_items"."completed_at" IS NOT NULL AND (("note_checklist_items"."completed_by_kind" = 'user' AND "note_checklist_items"."completed_by_user_id" IS NOT NULL AND "note_checklist_items"."completed_by_agent_job_id" IS NULL) OR ("note_checklist_items"."completed_by_kind" = 'agent' AND "note_checklist_items"."completed_by_agent_job_id" IS NOT NULL AND "note_checklist_items"."completed_by_user_id" IS NOT NULL))) IS TRUE OR ("note_checklist_items"."checked" = false AND "note_checklist_items"."completed_at" IS NULL AND "note_checklist_items"."completed_by_user_id" IS NULL AND "note_checklist_items"."completed_by_agent_job_id" IS NULL AND "note_checklist_items"."completed_by_kind" IS NULL) IS TRUE)),
	CONSTRAINT "note_checklist_items_updated_actor_check" CHECK (("note_checklist_items"."updated_by_kind" = 'user' AND "note_checklist_items"."updated_by_user_id" IS NOT NULL AND "note_checklist_items"."updated_by_agent_job_id" IS NULL) OR ("note_checklist_items"."updated_by_kind" = 'agent' AND "note_checklist_items"."updated_by_user_id" IS NOT NULL AND "note_checklist_items"."updated_by_agent_job_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "note_legacy_archive_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"source_type" "note_legacy_source_type" NOT NULL,
	"source_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"disposition" "note_legacy_disposition" DEFAULT 'pending' NOT NULL,
	"converted_page_id" uuid,
	"converted_action_id" text,
	"disposition_by_user_id" text,
	"disposition_by_kind" "note_actor_kind",
	"disposition_by_agent_job_id" uuid,
	"disposition_by_channel" text,
	"disposition_by_tool" text,
	"disposition_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_legacy_archive_items_state_check" CHECK ((("note_legacy_archive_items"."disposition" = 'pending' AND "note_legacy_archive_items"."converted_page_id" IS NULL AND "note_legacy_archive_items"."converted_action_id" IS NULL AND "note_legacy_archive_items"."disposition_at" IS NULL AND "note_legacy_archive_items"."disposition_by_user_id" IS NULL AND "note_legacy_archive_items"."disposition_by_agent_job_id" IS NULL AND "note_legacy_archive_items"."disposition_by_kind" IS NULL AND "note_legacy_archive_items"."disposition_by_channel" IS NULL AND "note_legacy_archive_items"."disposition_by_tool" IS NULL) IS TRUE OR ("note_legacy_archive_items"."disposition" = 'converted' AND "note_legacy_archive_items"."converted_page_id" IS NOT NULL AND "note_legacy_archive_items"."converted_action_id" IS NOT NULL AND "note_legacy_archive_items"."disposition_at" IS NOT NULL AND (("note_legacy_archive_items"."disposition_by_kind" = 'user' AND "note_legacy_archive_items"."disposition_by_user_id" IS NOT NULL AND "note_legacy_archive_items"."disposition_by_agent_job_id" IS NULL) OR ("note_legacy_archive_items"."disposition_by_kind" = 'agent' AND "note_legacy_archive_items"."disposition_by_agent_job_id" IS NOT NULL AND "note_legacy_archive_items"."disposition_by_user_id" IS NOT NULL))) IS TRUE OR ("note_legacy_archive_items"."disposition" = 'discarded' AND "note_legacy_archive_items"."converted_page_id" IS NULL AND "note_legacy_archive_items"."converted_action_id" IS NOT NULL AND "note_legacy_archive_items"."disposition_at" IS NOT NULL AND (("note_legacy_archive_items"."disposition_by_kind" = 'user' AND "note_legacy_archive_items"."disposition_by_user_id" IS NOT NULL AND "note_legacy_archive_items"."disposition_by_agent_job_id" IS NULL) OR ("note_legacy_archive_items"."disposition_by_kind" = 'agent' AND "note_legacy_archive_items"."disposition_by_agent_job_id" IS NOT NULL AND "note_legacy_archive_items"."disposition_by_user_id" IS NOT NULL))) IS TRUE))
);
--> statement-breakpoint
CREATE TABLE "note_page_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"anchor_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_page_links_ordinal_nonnegative" CHECK ("note_page_links"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "note_page_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"shared_with_user_id" text NOT NULL,
	"role" "note_page_share_role" DEFAULT 'viewer' NOT NULL,
	"actor_kind" "note_actor_kind" DEFAULT 'user' NOT NULL,
	"actor_agent_job_id" uuid,
	"actor_channel" text,
	"actor_tool" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_page_shares_actor_check" CHECK (("note_page_shares"."actor_kind" <> 'agent' AND "note_page_shares"."actor_agent_job_id" IS NULL) OR ("note_page_shares"."actor_kind" = 'agent' AND "note_page_shares"."actor_agent_job_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "note_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"parent_id" uuid,
	"kind" "note_page_kind" DEFAULT 'page' NOT NULL,
	"daily_date" date,
	"visibility" "note_page_visibility" DEFAULT 'private' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"lexical_json" jsonb DEFAULT '{"root":{"type":"root","version":1,"children":[]}}'::jsonb NOT NULL,
	"lexical_schema_version" integer DEFAULT 1 NOT NULL,
	"markdown_projection" text DEFAULT '' NOT NULL,
	"plaintext_projection" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" DEFAULT to_tsvector('simple', '') NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"provenance" "note_page_provenance" DEFAULT 'user' NOT NULL,
	"created_by_kind" "note_actor_kind" DEFAULT 'user' NOT NULL,
	"updated_by_kind" "note_actor_kind" DEFAULT 'user' NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_by_agent_job_id" uuid,
	"updated_by_agent_job_id" uuid,
	"created_by_channel" text,
	"updated_by_channel" text,
	"created_by_tool" text,
	"updated_by_tool" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_pages_id_workspace_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "note_pages_position_nonnegative" CHECK ("note_pages"."position" >= 0),
	CONSTRAINT "note_pages_state_version_positive" CHECK ("note_pages"."state_version" >= 1),
	CONSTRAINT "note_pages_kind_daily_date_check" CHECK (("note_pages"."kind" = 'daily' AND "note_pages"."daily_date" IS NOT NULL) OR ("note_pages"."kind" = 'page' AND "note_pages"."daily_date" IS NULL)),
	CONSTRAINT "note_pages_created_actor_check" CHECK (("note_pages"."created_by_kind" = 'user' AND "note_pages"."created_by_user_id" IS NOT NULL AND "note_pages"."created_by_agent_job_id" IS NULL) OR ("note_pages"."created_by_kind" = 'agent' AND "note_pages"."created_by_user_id" IS NOT NULL AND "note_pages"."created_by_agent_job_id" IS NOT NULL)),
	CONSTRAINT "note_pages_updated_actor_check" CHECK (("note_pages"."updated_by_kind" = 'user' AND "note_pages"."updated_by_user_id" IS NOT NULL AND "note_pages"."updated_by_agent_job_id" IS NULL) OR ("note_pages"."updated_by_kind" = 'agent' AND "note_pages"."updated_by_user_id" IS NOT NULL AND "note_pages"."updated_by_agent_job_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "note_checklist_items" ADD CONSTRAINT "note_checklist_items_page_id_note_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."note_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_checklist_items" ADD CONSTRAINT "note_checklist_items_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_checklist_items" ADD CONSTRAINT "note_checklist_items_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_checklist_items" ADD CONSTRAINT "note_checklist_items_completed_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("completed_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_checklist_items" ADD CONSTRAINT "note_checklist_items_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_checklist_items" ADD CONSTRAINT "note_checklist_items_updated_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("updated_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_checklist_items" ADD CONSTRAINT "note_checklist_items_page_workspace_fk" FOREIGN KEY ("page_id","workspace_id") REFERENCES "public"."note_pages"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_legacy_archive_items" ADD CONSTRAINT "note_legacy_archive_items_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_legacy_archive_items" ADD CONSTRAINT "note_legacy_archive_items_converted_page_id_note_pages_id_fk" FOREIGN KEY ("converted_page_id") REFERENCES "public"."note_pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_legacy_archive_items" ADD CONSTRAINT "note_legacy_archive_items_disposition_by_user_id_user_id_fk" FOREIGN KEY ("disposition_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_legacy_archive_items" ADD CONSTRAINT "note_legacy_archive_items_disposition_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("disposition_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_legacy_archive_items" ADD CONSTRAINT "note_legacy_archive_items_converted_page_workspace_fk" FOREIGN KEY ("converted_page_id","workspace_id") REFERENCES "public"."note_pages"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_links" ADD CONSTRAINT "note_page_links_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_links" ADD CONSTRAINT "note_page_links_source_page_id_note_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."note_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_links" ADD CONSTRAINT "note_page_links_target_page_id_note_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."note_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_links" ADD CONSTRAINT "note_page_links_source_workspace_fk" FOREIGN KEY ("source_page_id","workspace_id") REFERENCES "public"."note_pages"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_links" ADD CONSTRAINT "note_page_links_target_workspace_fk" FOREIGN KEY ("target_page_id","workspace_id") REFERENCES "public"."note_pages"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_shares" ADD CONSTRAINT "note_page_shares_page_id_note_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."note_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_shares" ADD CONSTRAINT "note_page_shares_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_shares" ADD CONSTRAINT "note_page_shares_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_shares" ADD CONSTRAINT "note_page_shares_shared_with_user_id_user_id_fk" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_shares" ADD CONSTRAINT "note_page_shares_actor_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("actor_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_page_shares" ADD CONSTRAINT "note_page_shares_page_workspace_fk" FOREIGN KEY ("page_id","workspace_id") REFERENCES "public"."note_pages"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_parent_id_note_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."note_pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_created_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("created_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_updated_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("updated_by_agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_pages" ADD CONSTRAINT "note_pages_parent_workspace_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."note_pages"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_checklist_items_item_id_unique_idx" ON "note_checklist_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_checklist_items_page_ordinal_unique_idx" ON "note_checklist_items" USING btree ("page_id","ordinal");--> statement-breakpoint
CREATE INDEX "note_checklist_items_page_idx" ON "note_checklist_items" USING btree ("page_id");--> statement-breakpoint
-- Reject ambiguous historical legacy archive identities before adding the canonical constraint.
-- Multiple snapshots may contain different terminal review evidence, so migration
-- must never guess which row to retain or delete.
DO $$
DECLARE
  duplicate_identity record;
BEGIN
  SELECT source_type, source_id, count(*) AS row_count
  INTO duplicate_identity
  FROM public.note_legacy_archive_items
  GROUP BY source_type, source_id
  HAVING count(*) > 1
  ORDER BY source_type::text, source_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'NOTE_LEGACY_ARCHIVE_DUPLICATE_IDENTITY: source_type=%, source_id=%, rows=%',
      duplicate_identity.source_type,
      duplicate_identity.source_id,
      duplicate_identity.row_count
      USING ERRCODE = 'unique_violation',
            HINT = 'Resolve the duplicate archive evidence explicitly without deleting terminal history, then retry migration 0229.';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "note_legacy_archive_items_source_unique_idx" ON "note_legacy_archive_items" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "note_legacy_archive_items_pending_idx" ON "note_legacy_archive_items" USING btree ("workspace_id","disposition","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "note_legacy_archive_items_action_unique_idx" ON "note_legacy_archive_items" USING btree ("workspace_id","converted_action_id") WHERE "note_legacy_archive_items"."converted_action_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "note_page_links_source_ordinal_unique_idx" ON "note_page_links" USING btree ("source_page_id","ordinal");--> statement-breakpoint
CREATE INDEX "note_page_links_target_idx" ON "note_page_links" USING btree ("target_page_id","ordinal");--> statement-breakpoint
CREATE INDEX "note_page_links_workspace_idx" ON "note_page_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_page_shares_page_user_unique_idx" ON "note_page_shares" USING btree ("page_id","shared_with_user_id");--> statement-breakpoint
CREATE INDEX "note_page_shares_workspace_user_idx" ON "note_page_shares" USING btree ("workspace_id","shared_with_user_id");--> statement-breakpoint
CREATE INDEX "note_page_shares_page_role_idx" ON "note_page_shares" USING btree ("page_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "note_pages_daily_unique_idx" ON "note_pages" USING btree ("workspace_id","owner_user_id","daily_date") WHERE "note_pages"."kind" = 'daily' AND "note_pages"."daily_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "note_pages_workspace_parent_position_idx" ON "note_pages" USING btree ("workspace_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "note_pages_workspace_owner_idx" ON "note_pages" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "note_pages_search_vector_idx" ON "note_pages" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "note_pages_daily_date_idx" ON "note_pages" USING btree ("workspace_id","daily_date");--> statement-breakpoint
-- Notes writes use one global transaction lock at a genuinely pre-row boundary.
-- Statement triggers acquire it before tuple/FK/unique/reference locks; AFTER
-- ROW guards only re-check invariants while that lock is held.
CREATE OR REPLACE FUNCTION public.acquire_notes_global_lock() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(679001122334455::bigint);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_pages_global_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.note_pages FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
CREATE TRIGGER note_page_shares_global_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.note_page_shares FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
CREATE TRIGGER note_checklist_items_global_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.note_checklist_items FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
CREATE TRIGGER note_page_links_global_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.note_page_links FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
CREATE TRIGGER note_legacy_archive_global_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.note_legacy_archive_items FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
CREATE TRIGGER member_notes_global_lock_statement BEFORE UPDATE OF workspace_id, user_id OR DELETE ON public."member" FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
CREATE TRIGGER user_notes_global_lock_statement BEFORE DELETE ON public."user" FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
-- A workspace UPDATE can retain its tuple before later bridged legacy DML in
-- the same transaction, so updates join deletion in the global-first order.
CREATE TRIGGER workspace_notes_global_lock_statement BEFORE UPDATE OR DELETE ON public.workspace FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
-- Project writes can synchronously retain workspace/project locks before a
-- later Todo/Idea/Seed write in the same transaction. A statement trigger
-- cannot predict that later write, so every project UPDATE intentionally joins
-- the canonical global-first order. Full schemas also serialize INSERT for the
-- workspace FK; reduced compatibility schemas still serialize UPDATE/DELETE.
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.projects'::regclass
        AND attname = 'workspace_id'
        AND NOT attisdropped
    ) THEN
      EXECUTE 'CREATE TRIGGER projects_notes_global_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.projects FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock()';
    ELSE
      EXECUTE 'CREATE TRIGGER projects_notes_global_lock_statement BEFORE UPDATE OR DELETE ON public.projects FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock()';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.cascade_note_legacy_workspace_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Remove immutable archive snapshots inside the tenant cascade before page
  -- FKs are evaluated; direct archive deletes still fail closed.
  DELETE FROM public.note_legacy_archive_items WHERE workspace_id = OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER workspace_notes_legacy_cascade BEFORE DELETE ON public.workspace FOR EACH ROW EXECUTE FUNCTION public.cascade_note_legacy_workspace_delete();
--> statement-breakpoint
CREATE TRIGGER agent_jobs_notes_global_lock_statement BEFORE UPDATE OF workspace_id OR DELETE ON public.agent_jobs FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_note_agent_job_workspace_reassignment() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     AND OLD.workspace_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = OLD.workspace_id)
     AND (
       EXISTS (SELECT 1 FROM public.note_pages p WHERE p.created_by_agent_job_id = OLD.id OR p.updated_by_agent_job_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.note_page_shares s WHERE s.actor_agent_job_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.note_checklist_items c WHERE c.completed_by_agent_job_id = OLD.id OR c.updated_by_agent_job_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.note_legacy_archive_items l WHERE l.disposition_by_agent_job_id = OLD.id)
     ) THEN
    RAISE EXCEPTION 'NOTE_AGENT_JOB_WORKSPACE_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER agent_jobs_notes_workspace_guard BEFORE UPDATE OF workspace_id OR DELETE ON public.agent_jobs FOR EACH ROW EXECUTE FUNCTION public.prevent_note_agent_job_workspace_reassignment();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_note_workspace_references() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'note_pages' THEN
    IF NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.owner_user_id) THEN
      RAISE EXCEPTION 'note page owner must be a current workspace member';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id) AND NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'note page creator must be a current workspace member';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.updated_by_user_id IS DISTINCT FROM OLD.updated_by_user_id) AND NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.updated_by_user_id) THEN
      RAISE EXCEPTION 'note page updater must be a current workspace member';
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'note page parent cycle'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.note_pages p WHERE p.id = NEW.parent_id AND p.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'note page parent must belong to the same workspace'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.note_pages p JOIN public."member" m ON m.workspace_id = p.workspace_id AND m.user_id = p.owner_user_id WHERE p.id = NEW.parent_id) THEN RAISE EXCEPTION 'note page parent owner must be a current workspace member'; END IF;
      IF EXISTS (WITH RECURSIVE ancestors(id) AS (
        SELECT NEW.parent_id
        UNION SELECT p.parent_id FROM public.note_pages p JOIN ancestors a ON p.id = a.id WHERE p.parent_id IS NOT NULL
      ) SELECT 1 FROM ancestors WHERE id = NEW.id) THEN RAISE EXCEPTION 'note page parent cycle'; END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.kind = 'daily' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.daily_date IS DISTINCT FROM OLD.daily_date) THEN RAISE EXCEPTION 'daily page identity is immutable'; END IF;
    IF NEW.kind = 'daily' AND NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'daily pages cannot be archived'; END IF;
    IF NEW.created_by_agent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agent_jobs j WHERE j.id = NEW.created_by_agent_job_id AND j.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'note page agent job must belong to the same workspace'; END IF;
    IF NEW.updated_by_agent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agent_jobs j WHERE j.id = NEW.updated_by_agent_job_id AND j.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'note page agent job must belong to the same workspace'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.workspace_id <> OLD.workspace_id AND EXISTS (SELECT 1 FROM public.note_pages c WHERE c.parent_id = OLD.id) THEN
      RAISE EXCEPTION 'cannot move a page with descendants across workspaces';
    END IF;
  ELSIF TG_TABLE_NAME = 'note_page_shares' THEN
    IF NOT EXISTS (SELECT 1 FROM public.note_pages p WHERE p.id = NEW.page_id AND p.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'note page share must belong to the same workspace'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.actor_user_id) THEN RAISE EXCEPTION 'share actor must be a current workspace member'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.shared_with_user_id) THEN RAISE EXCEPTION 'share recipient must be a current workspace member'; END IF;
    IF NEW.actor_agent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agent_jobs j WHERE j.id = NEW.actor_agent_job_id AND j.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'share agent job must belong to the same workspace'; END IF;
  ELSIF TG_TABLE_NAME = 'note_checklist_items' THEN
    IF NOT EXISTS (SELECT 1 FROM public.note_pages p WHERE p.id = NEW.page_id AND p.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'checklist item must belong to the same workspace'; END IF;
    IF (TG_OP = 'INSERT' OR NEW.updated_by_user_id IS DISTINCT FROM OLD.updated_by_user_id) AND NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.updated_by_user_id) THEN RAISE EXCEPTION 'checklist updater must be a current workspace member'; END IF;
    IF NEW.completed_by_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.completed_by_user_id IS DISTINCT FROM OLD.completed_by_user_id) AND NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.completed_by_user_id) THEN RAISE EXCEPTION 'checklist completer must be a current workspace member'; END IF;
    IF NEW.completed_by_agent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agent_jobs j WHERE j.id = NEW.completed_by_agent_job_id AND j.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'checklist agent job must belong to the same workspace'; END IF;
    IF NEW.updated_by_agent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agent_jobs j WHERE j.id = NEW.updated_by_agent_job_id AND j.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'checklist agent job must belong to the same workspace'; END IF;
  ELSIF TG_TABLE_NAME = 'note_page_links' THEN
    IF NOT EXISTS (SELECT 1 FROM public.note_pages p WHERE p.id = NEW.source_page_id AND p.workspace_id = NEW.workspace_id) OR NOT EXISTS (SELECT 1 FROM public.note_pages p WHERE p.id = NEW.target_page_id AND p.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'note link endpoints must belong to the same workspace'; END IF;
  ELSIF TG_TABLE_NAME = 'note_legacy_archive_items' THEN
    IF NEW.disposition_by_agent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agent_jobs j WHERE j.id = NEW.disposition_by_agent_job_id AND j.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'legacy agent job must belong to the same workspace'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_pages_workspace_guard AFTER INSERT OR UPDATE ON public.note_pages FOR EACH ROW EXECUTE FUNCTION public.guard_note_workspace_references();
--> statement-breakpoint
CREATE TRIGGER note_page_shares_workspace_guard AFTER INSERT OR UPDATE ON public.note_page_shares FOR EACH ROW EXECUTE FUNCTION public.guard_note_workspace_references();
--> statement-breakpoint
CREATE TRIGGER note_checklist_items_workspace_guard AFTER INSERT OR UPDATE ON public.note_checklist_items FOR EACH ROW EXECUTE FUNCTION public.guard_note_workspace_references();
--> statement-breakpoint
CREATE TRIGGER note_page_links_workspace_guard AFTER INSERT OR UPDATE ON public.note_page_links FOR EACH ROW EXECUTE FUNCTION public.guard_note_workspace_references();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_note_search_vector() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN NEW.search_vector := to_tsvector('simple', coalesce(NEW.title, '') || E'\n' || coalesce(NEW.plaintext_projection, '')); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER note_pages_search_vector_trigger BEFORE INSERT OR UPDATE OF title, plaintext_projection ON public.note_pages FOR EACH ROW EXECUTE FUNCTION public.update_note_search_vector();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.normalize_note_checklist_completion() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.checked THEN NEW.completed_at := coalesce(NEW.completed_at, now());
  ELSE NEW.completed_at := NULL; NEW.completed_by_user_id := NULL; NEW.completed_by_agent_job_id := NULL; NEW.completed_by_kind := NULL; NEW.completed_by_channel := NULL; NEW.completed_by_tool := NULL; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_checklist_completion_trigger BEFORE INSERT OR UPDATE ON public.note_checklist_items FOR EACH ROW EXECUTE FUNCTION public.normalize_note_checklist_completion();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_note_legacy_state() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN RAISE EXCEPTION 'legacy archive rows are retained immutably'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.disposition <> 'pending' THEN RAISE EXCEPTION 'legacy archive terminal states are immutable'; END IF;
  IF NEW.disposition = 'pending' AND (NEW.converted_page_id IS NOT NULL OR NEW.converted_action_id IS NOT NULL OR NEW.disposition_at IS NOT NULL OR NEW.disposition_by_user_id IS NOT NULL OR NEW.disposition_by_agent_job_id IS NOT NULL OR NEW.disposition_by_kind IS NOT NULL OR NEW.disposition_by_channel IS NOT NULL OR NEW.disposition_by_tool IS NOT NULL) THEN RAISE EXCEPTION 'pending legacy row cannot have disposition metadata'; END IF;
  IF NEW.disposition_by_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.disposition_by_user_id IS DISTINCT FROM OLD.disposition_by_user_id) AND NOT EXISTS (SELECT 1 FROM public."member" m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.disposition_by_user_id) THEN RAISE EXCEPTION 'legacy disposition actor must be a current workspace member'; END IF;
  IF NEW.disposition_by_agent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agent_jobs j WHERE j.id = NEW.disposition_by_agent_job_id AND j.workspace_id = NEW.workspace_id) THEN RAISE EXCEPTION 'legacy agent job must belong to the same workspace'; END IF;
  IF NEW.disposition = 'converted' AND NOT ((NEW.converted_page_id IS NOT NULL AND NEW.converted_action_id IS NOT NULL AND NEW.disposition_at IS NOT NULL AND ((NEW.disposition_by_kind = 'user' AND NEW.disposition_by_user_id IS NOT NULL AND NEW.disposition_by_agent_job_id IS NULL) OR (NEW.disposition_by_kind = 'agent' AND NEW.disposition_by_agent_job_id IS NOT NULL AND NEW.disposition_by_user_id IS NOT NULL))) IS TRUE) THEN RAISE EXCEPTION 'converted legacy row requires complete disposition metadata'; END IF;
  IF NEW.disposition = 'discarded' AND NOT ((NEW.converted_page_id IS NULL AND NEW.converted_action_id IS NOT NULL AND NEW.disposition_at IS NOT NULL AND ((NEW.disposition_by_kind = 'user' AND NEW.disposition_by_user_id IS NOT NULL AND NEW.disposition_by_agent_job_id IS NULL) OR (NEW.disposition_by_kind = 'agent' AND NEW.disposition_by_agent_job_id IS NOT NULL AND NEW.disposition_by_user_id IS NOT NULL))) IS TRUE) THEN RAISE EXCEPTION 'discarded legacy row requires complete disposition metadata'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- State transitions are checked after tuple locks while the global statement
-- lock remains held.
CREATE TRIGGER note_legacy_state_guard AFTER INSERT OR UPDATE OR DELETE ON public.note_legacy_archive_items FOR EACH ROW EXECUTE FUNCTION public.enforce_note_legacy_state();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_note_legacy_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    RAISE EXCEPTION 'legacy archive snapshots are immutable';
  END IF;
  -- The only mutable provenance/snapshot path is the nested source-table bridge
  -- relocating or refreshing a still-pending review row. Direct archive DML
  -- runs at trigger depth one and therefore remains rejected.
  IF (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot)
     AND NOT (pg_trigger_depth() > 1 AND OLD.disposition = 'pending' AND NEW.disposition = 'pending') THEN
    RAISE EXCEPTION 'legacy archive snapshots are immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_legacy_snapshot_immutable BEFORE UPDATE ON public.note_legacy_archive_items FOR EACH ROW EXECUTE FUNCTION public.prevent_note_legacy_snapshot_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.capture_note_legacy_source_write() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  source_kind public.note_legacy_source_type;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' THEN
    RAISE EXCEPTION 'unsupported legacy source table';
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'todo_items' THEN source_kind := 'todo';
    WHEN 'idea_items' THEN source_kind := 'idea';
    WHEN 'seeds' THEN source_kind := 'seed';
    ELSE RAISE EXCEPTION 'unsupported legacy source table';
  END CASE;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM public.note_legacy_archive_items archive_item
    WHERE archive_item.source_type = source_kind
      AND archive_item.source_id = OLD.id::text
      AND archive_item.disposition <> 'pending'
  ) THEN
    -- pg_trigger_depth() is one for both direct UPDATE and the immediate FK
    -- action. The deleted parent is invisible only during genuine ON DELETE
    -- SET NULL cleanup; combine that provenance with a complete record delta
    -- so no caller-set flag or direct detachment can broaden this exception.
    IF OLD.project_id IS NOT NULL
       AND NEW.project_id IS NULL
       AND (to_jsonb(OLD) - 'project_id') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'project_id')
       AND NOT EXISTS (SELECT 1 FROM public.projects project_row WHERE project_row.id = OLD.project_id) THEN
      RETURN NEW;
    END IF;
    -- Seed is still the canonical Plan record after review. Terminalization
    -- freezes only its archive snapshot, so ordinary Plan/status/selection
    -- edits remain valid while workspace/project authority stays identical.
    -- Todo and Idea sources remain fully frozen after terminal review.
    IF source_kind = 'seed'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'legacy source item has already been reviewed';
  END IF;

  INSERT INTO public.note_legacy_archive_items (workspace_id, source_type, source_id, snapshot, disposition)
  VALUES (
    NEW.workspace_id,
    source_kind,
    NEW.id::text,
    to_jsonb(NEW) || jsonb_build_object('_legacy_source_type', source_kind::text),
    'pending'
  )
  ON CONFLICT (source_type, source_id) DO UPDATE
    SET workspace_id = excluded.workspace_id,
        snapshot = excluded.snapshot,
        updated_at = now()
    WHERE public.note_legacy_archive_items.disposition = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy source item has already been reviewed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.capture_note_legacy_source_write() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_note_owner_offboarding() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Cascading workspace deletion removes the tenant before member cascades
  -- reach this trigger; skip invariant lookup when the tenant is disappearing.
  IF to_regclass('public.workspace') IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = OLD.workspace_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)))
     AND EXISTS (SELECT 1 FROM public.note_pages p WHERE p.workspace_id = OLD.workspace_id AND p.owner_user_id = OLD.user_id)
     AND NOT EXISTS (SELECT 1 FROM public."member" other WHERE other.workspace_id = OLD.workspace_id AND other.user_id = OLD.user_id AND other.id <> OLD.id) THEN
    RAISE EXCEPTION 'NOTE_OWNER_OFFBOARDING_BLOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER member_notes_owner_offboarding_guard
  AFTER DELETE OR UPDATE OF workspace_id, user_id ON public."member"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_note_owner_offboarding();
--> statement-breakpoint
-- User deletion cascades memberships, but must fail with the same stable
-- domain error before owner/audit foreign keys are evaluated when Notes rows
-- still depend on that user. Workspace deletion removes those rows first.
CREATE OR REPLACE FUNCTION public.prevent_note_user_offboarding() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.note_pages p WHERE p.owner_user_id = OLD.id) THEN
    RAISE EXCEPTION 'NOTE_OWNER_OFFBOARDING_BLOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.note_pages p WHERE p.created_by_user_id = OLD.id OR p.updated_by_user_id = OLD.id
    UNION ALL SELECT 1 FROM public.note_page_shares s WHERE s.actor_user_id = OLD.id
    UNION ALL SELECT 1 FROM public.note_checklist_items c WHERE c.completed_by_user_id = OLD.id OR c.updated_by_user_id = OLD.id
    UNION ALL SELECT 1 FROM public.note_legacy_archive_items l WHERE l.disposition_by_user_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'NOTE_USER_AUDIT_RETENTION_BLOCKED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_notes_owner_offboarding_guard
  BEFORE DELETE ON public."user"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_note_user_offboarding();
--> statement-breakpoint
-- Existing self-hosted databases may contain stale active workspace IDs from
-- before Notes used the Better-Auth session field. Clean those values before
-- installing the production FK so the migration remains deploy-safe.
DO $$
BEGIN
  IF to_regclass('public.session') IS NOT NULL AND to_regclass('public.workspace') IS NOT NULL THEN
    UPDATE public.session s
    SET active_workspace_id = NULL
    WHERE s.active_workspace_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = s.active_workspace_id);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.session'::regclass
        AND c.conname = 'session_active_workspace_id_workspace_id_fk'
    ) THEN
      ALTER TABLE public.session
        ADD CONSTRAINT session_active_workspace_id_workspace_id_fk
        FOREIGN KEY (active_workspace_id) REFERENCES public.workspace(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE source_table text; source_type text;
BEGIN
  FOR source_table, source_type IN SELECT * FROM (VALUES ('todo_items','todo'), ('idea_items','idea'), ('seeds','seed')) AS sources(table_name, kind) LOOP
    IF to_regclass(format('public.%I', source_table)) IS NOT NULL THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_notes_global_lock()',
        source_table || '_notes_archive_lock_statement',
        source_table
      );
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_note_legacy_source_write()',
        source_table || '_notes_archive_capture_row',
        source_table
      );
      EXECUTE format($sql$
        INSERT INTO public.note_legacy_archive_items (workspace_id, source_type, source_id, snapshot, disposition)
        SELECT t.workspace_id, %L::public.note_legacy_source_type, t.id::text, to_jsonb(t) || jsonb_build_object('_legacy_source_type', %L), 'pending'::public.note_legacy_disposition
        FROM public.%I t ON CONFLICT (source_type, source_id) DO NOTHING
      $sql$, source_type, source_type, source_table);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Every mounted legacy source must resolve to exactly one archive row carrying
-- its current workspace authority. A historical terminal mismatch is evidence
-- that requires explicit operator resolution rather than automatic rewriting.
DO $$
DECLARE
  source_table text;
  source_type text;
  mismatch record;
BEGIN
  FOR source_table, source_type IN
    SELECT * FROM (VALUES ('todo_items','todo'), ('idea_items','idea'), ('seeds','seed')) AS sources(table_name, kind)
  LOOP
    IF to_regclass(format('public.%I', source_table)) IS NOT NULL THEN
      EXECUTE format($sql$
        SELECT t.id::text AS source_id,
               t.workspace_id AS source_workspace_id,
               archive_item.workspace_id AS archive_workspace_id,
               archive_item.disposition::text AS disposition
        FROM public.%I t
        LEFT JOIN public.note_legacy_archive_items archive_item
          ON archive_item.source_type = %L::public.note_legacy_source_type
         AND archive_item.source_id = t.id::text
        WHERE archive_item.id IS NULL
           OR archive_item.workspace_id IS DISTINCT FROM t.workspace_id
        ORDER BY t.id::text
        LIMIT 1
      $sql$, source_table, source_type)
      INTO mismatch;

      IF mismatch.source_id IS NOT NULL THEN
        RAISE EXCEPTION 'NOTE_LEGACY_ARCHIVE_SOURCE_AUTHORITY_MISMATCH: source_type=%, source_id=%, source_workspace=%, archive_workspace=%, disposition=%',
          source_type,
          mismatch.source_id,
          mismatch.source_workspace_id,
          mismatch.archive_workspace_id,
          mismatch.disposition
          USING ERRCODE = 'integrity_constraint_violation',
                HINT = 'Resolve the legacy source/archive workspace authority explicitly without rewriting terminal evidence, then retry migration 0229.';
      END IF;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
