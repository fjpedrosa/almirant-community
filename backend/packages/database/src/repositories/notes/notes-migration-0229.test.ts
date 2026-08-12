import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const migrationSql = await Bun.file(new URL("../../../migrations/0229_green_santa_claus.sql", import.meta.url)).text();

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const createLegacyDatabase = async () => {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(`
    CREATE TABLE "workspace" ("id" text PRIMARY KEY);
    CREATE TABLE "user" ("id" text PRIMARY KEY);
    CREATE TABLE "session" (
      "id" text PRIMARY KEY, "expires_at" timestamptz NOT NULL, "token" text NOT NULL,
      "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "active_workspace_id" text
    );
    CREATE TABLE "member" ("id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "role" text NOT NULL DEFAULT 'member');
    CREATE TABLE "agent_jobs" ("id" uuid PRIMARY KEY, "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL);
    CREATE TABLE "projects" (
      "id" uuid PRIMARY KEY, "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL,
      "updated_at" timestamptz NOT NULL
    );
    CREATE TABLE "todo_items" (
      "id" uuid PRIMARY KEY, "workspace_id" text NOT NULL, "title" text NOT NULL,
      "description" text, "status" text, "priority" text, "owner_user_id" text,
      "created_by_user_id" text, "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL, "due_date" timestamptz, "completed_at" timestamptz, "metadata" jsonb,
      "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL
    );
    CREATE TABLE "idea_items" (
      "id" uuid PRIMARY KEY, "workspace_id" text NOT NULL, "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
      "title" text NOT NULL, "description" text, "type" text, "status" text,
      "owner_user_id" text, "created_by_user_id" text, "due_date" timestamptz,
      "discussed" boolean DEFAULT false, "metadata" jsonb, "completed_at" timestamptz,
      "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL
    );
    CREATE TABLE "seeds" (
      "id" uuid PRIMARY KEY, "workspace_id" text NOT NULL, "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
      "status" text, "title" text NOT NULL, "description" text, "source" text, "priority" text,
      "selected_for_ideation" boolean DEFAULT false, "owner_user_id" text,
      "created_by_user_id" text, "metadata" jsonb, "maturity_level" integer DEFAULT 1,
      "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL
    );
    INSERT INTO "workspace" VALUES ('w1'), ('w2'), ('w-session');
    INSERT INTO "user" VALUES ('u1'), ('u2'), ('u4');
    INSERT INTO "session" ("id", "expires_at", "token", "created_at", "updated_at", "user_id", "active_workspace_id")
      VALUES ('s-valid', now() + interval '1 day', 'token-valid', now(), now(), 'u1', 'w-session'),
             ('s-dangling', now() + interval '1 day', 'token-dangling', now(), now(), 'u1', 'missing-workspace');
    INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m1', 'w1', 'u1'), ('m2', 'w1', 'u2'), ('m3', 'w2', 'u2');
    INSERT INTO "todo_items" ("id", "workspace_id", "title", "description", "status", "priority", "owner_user_id", "created_by_user_id", "project_id", "due_date", "completed_at", "metadata", "created_at", "updated_at") VALUES ('${uuid(1)}', 'w1', 'legacy todo', 'todo body', 'pending', 'high', 'u1', 'u1', NULL, '2026-08-11T10:00:00Z', NULL, '{"source":"legacy"}', '2026-08-01T10:00:00Z', '2026-08-02T10:00:00Z');
    INSERT INTO "idea_items" ("id", "workspace_id", "project_id", "title", "description", "type", "status", "owner_user_id", "created_by_user_id", "due_date", "discussed", "metadata", "completed_at", "created_at", "updated_at") VALUES ('${uuid(2)}', 'w1', NULL, 'legacy idea', 'idea body', 'idea', 'active', 'u1', 'u1', NULL, true, '{"source":"legacy"}', NULL, '2026-08-03T10:00:00Z', '2026-08-04T10:00:00Z');
    INSERT INTO "seeds" ("id", "workspace_id", "project_id", "status", "title", "description", "source", "priority", "selected_for_ideation", "owner_user_id", "created_by_user_id", "metadata", "maturity_level", "created_at", "updated_at") VALUES ('${uuid(3)}', 'w1', NULL, 'active', 'legacy seed', 'seed body', 'manual', 'urgent', true, 'u1', 'u1', '{"source":"legacy"}', 3, '2026-08-05T10:00:00Z', '2026-08-06T10:00:00Z');
  `);
  return database;
};

describe("migration 0229 notes foundation", () => {
  it("creates constraints and backfills legacy rows without deleting sources", async () => {
    const database = await createLegacyDatabase();
    try {
      await database.exec(migrationSql);
      const triggerTiming = await database.query<{ tgname: string; timing: string }>(`SELECT tgname, CASE WHEN (tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing FROM pg_trigger WHERE tgname IN ('note_pages_workspace_guard', 'note_page_shares_workspace_guard', 'note_checklist_items_workspace_guard', 'note_page_links_workspace_guard', 'note_legacy_state_guard', 'member_notes_owner_offboarding_guard') ORDER BY tgname`);
      expect(triggerTiming.rows).toEqual([
        { tgname: "member_notes_owner_offboarding_guard", timing: "AFTER" },
        { tgname: "note_checklist_items_workspace_guard", timing: "AFTER" },
        { tgname: "note_legacy_state_guard", timing: "AFTER" },
        { tgname: "note_page_links_workspace_guard", timing: "AFTER" },
        { tgname: "note_page_shares_workspace_guard", timing: "AFTER" },
        { tgname: "note_pages_workspace_guard", timing: "AFTER" },
      ]);
      const agentGuard = await database.query<{ tgname: string; timing: string; level: string }>(`SELECT tgname, CASE WHEN (tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing, CASE WHEN (tgtype & 1) = 1 THEN 'ROW' ELSE 'STATEMENT' END AS level FROM pg_trigger WHERE tgname = 'agent_jobs_notes_workspace_guard'`);
      expect(agentGuard.rows).toEqual([{ tgname: "agent_jobs_notes_workspace_guard", timing: "BEFORE", level: "ROW" }]);
      const agentLockDefinition = await database.query<{ definition: string }>(`SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = 'agent_jobs_notes_global_lock_statement'`);
      expect(agentLockDefinition.rows[0]?.definition).toContain("BEFORE DELETE OR UPDATE OF workspace_id");
      const memberLockDefinition = await database.query<{ definition: string }>(`SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = 'member_notes_global_lock_statement'`);
      expect(memberLockDefinition.rows[0]?.definition).toContain("BEFORE DELETE OR UPDATE OF workspace_id, user_id");
      const workspaceLockDefinition = await database.query<{ definition: string }>(`SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = 'workspace_notes_global_lock_statement'`);
      expect(workspaceLockDefinition.rows[0]?.definition).toContain("BEFORE DELETE OR UPDATE ON public.workspace");
      expect(workspaceLockDefinition.rows[0]?.definition).not.toContain("INSERT");
      const statementTriggers = await database.query<{ tgname: string; timing: string; level: string }>(`SELECT tgname, CASE WHEN (tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing, CASE WHEN (tgtype & 1) = 1 THEN 'ROW' ELSE 'STATEMENT' END AS level FROM pg_trigger WHERE tgname IN ('note_pages_global_lock_statement', 'note_page_shares_global_lock_statement', 'note_checklist_items_global_lock_statement', 'note_page_links_global_lock_statement', 'note_legacy_archive_global_lock_statement', 'member_notes_global_lock_statement', 'user_notes_global_lock_statement', 'workspace_notes_global_lock_statement', 'agent_jobs_notes_global_lock_statement', 'projects_notes_global_lock_statement') ORDER BY tgname`);
      expect(statementTriggers.rows).toEqual([
        { tgname: "agent_jobs_notes_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "member_notes_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "note_checklist_items_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "note_legacy_archive_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "note_page_links_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "note_page_shares_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "note_pages_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "projects_notes_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "user_notes_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "workspace_notes_global_lock_statement", timing: "BEFORE", level: "STATEMENT" },
      ]);
      const projectLockDefinition = await database.query<{ definition: string }>(`SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = 'projects_notes_global_lock_statement'`);
      expect(projectLockDefinition.rows[0]?.definition).toContain("BEFORE INSERT OR DELETE OR UPDATE ON public.projects");
      const bridgeTriggers = await database.query<{ tgname: string; timing: string; level: string }>(`SELECT tgname, CASE WHEN (tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing, CASE WHEN (tgtype & 1) = 1 THEN 'ROW' ELSE 'STATEMENT' END AS level FROM pg_trigger WHERE tgname IN ('todo_items_notes_archive_lock_statement', 'todo_items_notes_archive_capture_row', 'idea_items_notes_archive_lock_statement', 'idea_items_notes_archive_capture_row', 'seeds_notes_archive_lock_statement', 'seeds_notes_archive_capture_row') ORDER BY tgname`);
      expect(bridgeTriggers.rows).toEqual([
        { tgname: "idea_items_notes_archive_capture_row", timing: "AFTER", level: "ROW" },
        { tgname: "idea_items_notes_archive_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "seeds_notes_archive_capture_row", timing: "AFTER", level: "ROW" },
        { tgname: "seeds_notes_archive_lock_statement", timing: "BEFORE", level: "STATEMENT" },
        { tgname: "todo_items_notes_archive_capture_row", timing: "AFTER", level: "ROW" },
        { tgname: "todo_items_notes_archive_lock_statement", timing: "BEFORE", level: "STATEMENT" },
      ]);
      const bridgeFunction = await database.query<{ security_definer: boolean; return_type: string }>(`SELECT prosecdef AS security_definer, prorettype::regtype::text AS return_type FROM pg_proc WHERE oid = 'public.capture_note_legacy_source_write()'::regprocedure`);
      expect(bridgeFunction.rows).toEqual([{ security_definer: false, return_type: "trigger" }]);
      const sourceIdentityIndex = await database.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'note_legacy_archive_items_source_unique_idx'`);
      expect(sourceIdentityIndex.rows).toHaveLength(1);
      expect(sourceIdentityIndex.rows[0]?.indexdef.replaceAll('"', "")).toContain("USING btree (source_type, source_id)");
      expect(sourceIdentityIndex.rows[0]?.indexdef).not.toContain("workspace_id");
      expect(migrationSql).toContain("NOTE_LEGACY_ARCHIVE_DUPLICATE_IDENTITY");
      expect(migrationSql).toContain("NOTE_LEGACY_ARCHIVE_SOURCE_AUTHORITY_MISMATCH");
      await database.exec(`INSERT INTO public."user" VALUES ('shadow-owner'); INSERT INTO public.agent_jobs ("id", "workspace_id") VALUES ('${uuid(985)}', 'w1'); SET search_path = pg_temp, public; CREATE TEMP TABLE member (workspace_id text, user_id text); INSERT INTO member VALUES ('w1', 'shadow-owner'), ('w2', 'u2'); CREATE TEMP TABLE agent_jobs (id uuid, workspace_id text); INSERT INTO agent_jobs VALUES ('${uuid(985)}', 'w2');`);
      await expect(database.query(`INSERT INTO public.note_pages ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(980)}', 'w1', 'shadow-owner', 'user', 'user', 'shadow-owner', 'shadow-owner', to_tsvector('simple', 'shadow'))`)).rejects.toThrow("note page owner must be a current workspace member");
      await expect(database.query(`INSERT INTO public.note_pages ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "created_by_agent_job_id", "updated_by_agent_job_id", "search_vector") VALUES ('${uuid(986)}', 'w2', 'u2', 'agent', 'agent', 'u2', 'u2', '${uuid(985)}', '${uuid(985)}', to_tsvector('simple', 'shadow-agent'))`)).rejects.toThrow("note page agent job must belong to the same workspace");
      await database.exec(`DROP TABLE agent_jobs; DROP TABLE member; SET search_path = public;`);
      const archive = await database.query<{ source_id: string; disposition: string; snapshot: Record<string, unknown> }>(`SELECT "source_id", "disposition", "snapshot" FROM "note_legacy_archive_items" ORDER BY "source_id"`);
      expect((await database.query(`SELECT active_workspace_id FROM "session" WHERE id = 's-dangling'`)).rows).toEqual([{ active_workspace_id: null }]);
      await database.query(`DELETE FROM "workspace" WHERE id = 'w-session'`);
      expect((await database.query(`SELECT active_workspace_id FROM "session" WHERE id = 's-valid'`)).rows).toEqual([{ active_workspace_id: null }]);
      expect(archive.rows).toHaveLength(3);
      expect(archive.rows.find((row) => row.source_id === uuid(1))?.snapshot).toEqual({ id: uuid(1), workspace_id: "w1", title: "legacy todo", description: "todo body", status: "pending", priority: "high", owner_user_id: "u1", created_by_user_id: "u1", project_id: null, due_date: "2026-08-11T10:00:00+00:00", completed_at: null, metadata: { source: "legacy" }, created_at: "2026-08-01T10:00:00+00:00", updated_at: "2026-08-02T10:00:00+00:00", _legacy_source_type: "todo" });
      expect(archive.rows.find((row) => row.source_id === uuid(2))?.snapshot).toEqual({ id: uuid(2), workspace_id: "w1", project_id: null, title: "legacy idea", description: "idea body", type: "idea", status: "active", owner_user_id: "u1", created_by_user_id: "u1", due_date: null, discussed: true, metadata: { source: "legacy" }, completed_at: null, created_at: "2026-08-03T10:00:00+00:00", updated_at: "2026-08-04T10:00:00+00:00", _legacy_source_type: "idea" });
      expect(archive.rows.find((row) => row.source_id === uuid(3))?.snapshot).toEqual({ id: uuid(3), workspace_id: "w1", project_id: null, status: "active", title: "legacy seed", description: "seed body", source: "manual", priority: "urgent", selected_for_ideation: true, owner_user_id: "u1", created_by_user_id: "u1", metadata: { source: "legacy" }, maturity_level: 3, created_at: "2026-08-05T10:00:00+00:00", updated_at: "2026-08-06T10:00:00+00:00", _legacy_source_type: "seed" });
      const source = await database.query(`SELECT "id" FROM "todo_items" WHERE "id" = '${uuid(1)}'`);
      expect(source.rows).toHaveLength(1);

      await database.exec(`
        INSERT INTO "todo_items" ("id", "workspace_id", "title", "description", "status", "priority", "owner_user_id", "created_by_user_id", "project_id", "due_date", "completed_at", "metadata", "created_at", "updated_at") VALUES ('${uuid(10)}', 'w1', 'post todo', 'post todo body', 'pending', 'medium', 'u1', 'u1', NULL, NULL, NULL, '{}', now(), now());
        INSERT INTO "idea_items" ("id", "workspace_id", "project_id", "title", "description", "type", "status", "owner_user_id", "created_by_user_id", "due_date", "discussed", "metadata", "completed_at", "created_at", "updated_at") VALUES ('${uuid(11)}', 'w1', NULL, 'post idea', 'post idea body', 'idea', 'active', 'u1', 'u1', NULL, false, '{}', NULL, now(), now());
        INSERT INTO "seeds" ("id", "workspace_id", "project_id", "status", "title", "description", "source", "priority", "selected_for_ideation", "owner_user_id", "created_by_user_id", "metadata", "maturity_level", "created_at", "updated_at") VALUES ('${uuid(12)}', 'w1', NULL, 'active', 'post seed', 'post seed body', 'manual', 'low', false, 'u1', 'u1', '{}', 1, now(), now());
        UPDATE "todo_items" SET "title" = 'post todo updated', "updated_at" = now() WHERE "id" = '${uuid(10)}';
        UPDATE "idea_items" SET "status" = 'approved', "updated_at" = now() WHERE "id" = '${uuid(11)}';
        UPDATE "seeds" SET "maturity_level" = 4, "updated_at" = now() WHERE "id" = '${uuid(12)}';
      `);
      const bridged = await database.query<{ source_type: string; source_id: string; snapshot: Record<string, unknown> }>(`SELECT source_type, source_id, snapshot FROM note_legacy_archive_items WHERE source_id IN ('${uuid(10)}', '${uuid(11)}', '${uuid(12)}') ORDER BY source_type`);
      expect(bridged.rows).toHaveLength(3);
      expect(bridged.rows.find((row) => row.source_id === uuid(10))?.snapshot).toMatchObject({ id: uuid(10), title: "post todo updated", _legacy_source_type: "todo" });
      expect(bridged.rows.find((row) => row.source_id === uuid(11))?.snapshot).toMatchObject({ id: uuid(11), status: "approved", _legacy_source_type: "idea" });
      expect(bridged.rows.find((row) => row.source_id === uuid(12))?.snapshot).toMatchObject({ id: uuid(12), maturity_level: 4, _legacy_source_type: "seed" });
      await database.query(`UPDATE "idea_items" SET "workspace_id" = 'w2', "updated_at" = now() WHERE "id" = '${uuid(11)}'`);
      const relocatedIdea = await database.query<{ workspace_id: string; snapshot: Record<string, unknown> }>(`SELECT workspace_id, snapshot FROM note_legacy_archive_items WHERE source_type = 'idea' AND source_id = '${uuid(11)}'`);
      expect(relocatedIdea.rows).toEqual([{ workspace_id: "w2", snapshot: expect.objectContaining({ id: uuid(11), workspace_id: "w2", _legacy_source_type: "idea" }) }]);
      await expect(database.query(`UPDATE note_legacy_archive_items SET workspace_id = 'w1' WHERE source_type = 'idea' AND source_id = '${uuid(11)}'`)).rejects.toThrow("legacy archive snapshots are immutable");
      await expect(database.query(`INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot) VALUES ('${uuid(913)}', 'w1', 'idea', '${uuid(11)}', '{}')`)).rejects.toThrow("note_legacy_archive_items_source_unique_idx");
      await database.exec(`DELETE FROM "todo_items" WHERE "id" = '${uuid(10)}'; DELETE FROM "idea_items" WHERE "id" = '${uuid(11)}';`);
      expect((await database.query(`SELECT source_type, source_id FROM note_legacy_archive_items WHERE source_id IN ('${uuid(10)}', '${uuid(11)}') ORDER BY source_type::text`)).rows).toEqual([
        { source_type: "idea", source_id: uuid(11) },
        { source_type: "todo", source_id: uuid(10) },
      ]);
      expect((await database.query(`SELECT id FROM seeds WHERE id = '${uuid(12)}'`)).rows).toHaveLength(1);
      await expect(database.query(`UPDATE "note_legacy_archive_items" SET "snapshot" = '{"tampered":true}' WHERE "source_id" = '${uuid(1)}'`)).rejects.toThrow("legacy archive snapshots are immutable");
      await expect(database.query(`UPDATE "note_legacy_archive_items" SET "snapshot" = '{"tampered":true}' WHERE "source_id" = '${uuid(12)}'`)).rejects.toThrow("legacy archive snapshots are immutable");

      await database.query(`INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "kind", "daily_date", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(2)}', 'w1', 'u1', 'daily', '2026-08-01', 'user', 'user', 'u1', 'u1', to_tsvector('simple', 'day'))`);
      await database.query(`INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES ('${uuid(900)}', 'w1', 'todo', 'state-test', '{}')`);
      await expect(database.query(`UPDATE "note_legacy_archive_items" SET "disposition" = 'converted', "converted_page_id" = '${uuid(2)}' WHERE "id" = '${uuid(900)}'`)).rejects.toThrow("note_legacy_archive_items_state_check");
      await database.query(`UPDATE "note_legacy_archive_items" SET "disposition" = 'converted', "converted_page_id" = '${uuid(2)}', "converted_action_id" = 'action-900', "disposition_by_user_id" = 'u1', "disposition_by_kind" = 'user', "disposition_at" = now() WHERE "id" = '${uuid(900)}'`);
      await expect(database.query(`UPDATE "note_legacy_archive_items" SET "disposition" = 'discarded' WHERE "id" = '${uuid(900)}'`)).rejects.toThrow("note_legacy_archive_items_state_check");
      await expect(database.query(`DELETE FROM "note_legacy_archive_items" WHERE "id" = '${uuid(900)}'`)).rejects.toThrow("legacy archive rows are retained immutably");
      await expect(database.query(`INSERT INTO "note_pages" ("workspace_id", "owner_user_id", "kind", "daily_date", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('w1', 'u1', 'daily', (SELECT "daily_date" FROM "note_pages" WHERE "id" = '${uuid(2)}'), 'user', 'user', 'u1', 'u1', to_tsvector('simple', 'duplicate'))`)).rejects.toThrow("note_pages_daily_unique_idx");
      await expect(database.query(`INSERT INTO "note_pages" ("workspace_id", "owner_user_id", "parent_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('w1', 'u1', '${uuid(2)}', 'user', 'user', 'u1', 'u1', to_tsvector('simple', 'cross'))`)).resolves.toBeDefined();
      await expect(database.query(`INSERT INTO "note_pages" ("workspace_id", "owner_user_id", "parent_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('w2', 'u2', '${uuid(2)}', 'user', 'user', 'u2', 'u2', to_tsvector('simple', 'cross'))`)).rejects.toThrow("note_pages_parent_workspace_fk");
      await expect(database.query(`UPDATE "note_pages" SET "daily_date" = '2026-08-02' WHERE "id" = '${uuid(2)}'`)).rejects.toThrow("daily page identity is immutable");
      await expect(database.query(`UPDATE "note_pages" SET "kind" = 'page', "daily_date" = NULL WHERE "id" = '${uuid(2)}'`)).rejects.toThrow("daily page identity is immutable");
      await expect(database.query(`UPDATE "note_pages" SET "archived_at" = now() WHERE "id" = '${uuid(2)}'`)).rejects.toThrow("daily pages cannot be archived");
      await expect(database.query(`UPDATE "member" SET "workspace_id" = "workspace_id", "user_id" = "user_id" WHERE "id" = 'm1'`)).resolves.toBeDefined();
      await expect(database.query(`INSERT INTO "note_pages" ("workspace_id", "owner_user_id", "created_by_kind", "created_by_user_id", "updated_by_kind", "updated_by_user_id", "created_by_agent_job_id", "search_vector") VALUES ('w1', 'u1', 'agent', 'u1', 'user', 'u1', NULL, to_tsvector('simple', 'spoof'))`)).rejects.toThrow("note_pages_created_actor_check");
      await database.query(`INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(4)}', 'w1', 'u1', 'user', 'user', 'u1', 'u1', to_tsvector('simple', 'root'))`);
      await database.query(`INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "parent_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(5)}', 'w1', 'u1', '${uuid(4)}', 'user', 'user', 'u1', 'u1', to_tsvector('simple', 'child'))`);
      await expect(database.query(`UPDATE "note_pages" SET "parent_id" = '${uuid(5)}' WHERE "id" = '${uuid(4)}'`)).rejects.toThrow("note page parent cycle");
      await database.query(`INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m5', 'w1', 'u4')`);
      await database.query(`UPDATE "member" SET "user_id" = 'u2' WHERE "id" = 'm5'`);
      expect((await database.query(`SELECT "user_id" FROM "member" WHERE "id" = 'm5'`)).rows).toEqual([{ user_id: "u2" }]);
      await expect(database.query(`UPDATE "member" SET "user_id" = 'u2' WHERE "id" = 'm1'`)).rejects.toThrow("NOTE_OWNER_OFFBOARDING_BLOCKED");
      await expect(database.query(`UPDATE "member" SET "workspace_id" = 'w2' WHERE "id" = 'm1'`)).rejects.toThrow("NOTE_OWNER_OFFBOARDING_BLOCKED");
      await expect(database.query(`DELETE FROM "member" WHERE "workspace_id" = 'w1' AND "user_id" = 'u1'`)).rejects.toThrow("NOTE_OWNER_OFFBOARDING_BLOCKED");
      await database.query(`DELETE FROM "member" WHERE "workspace_id" = 'w1' AND "user_id" = 'u2'`);
      await expect(database.query(`INSERT INTO "note_pages" ("workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('w1', 'u2', 'user', 'user', 'u2', 'u2', to_tsvector('simple', 'revoked'))`)).rejects.toThrow("note page owner must be a current workspace member");
      await database.exec(`INSERT INTO "workspace" VALUES ('w8'); INSERT INTO "user" VALUES ('u8'); INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m8-audit', 'w8', 'u8'), ('m8-owner', 'w8', 'u1'); INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(987)}', 'w8', 'u1', 'user', 'user', 'u8', 'u8', to_tsvector('simple', 'audit retention'));`);
      await expect(database.query(`DELETE FROM "user" WHERE "id" = 'u8'`)).rejects.toThrow("NOTE_USER_AUDIT_RETENTION_BLOCKED");
      expect((await database.query(`SELECT "user_id" FROM "member" WHERE "id" = 'm8-audit'`)).rows).toEqual([{ user_id: "u8" }]);
      await expect(database.query(`INSERT INTO "note_checklist_items" ("page_id", "workspace_id", "ordinal", "text", "checked", "completed_at", "completed_by_kind", "completed_by_user_id", "updated_by_kind", "updated_by_user_id") VALUES ('${uuid(4)}', 'w1', 0, 'spoof', true, now(), 'user', 'u1', 'user', 'u2')`)).rejects.toThrow("checklist updater must be a current workspace member");
      await expect(database.query(`INSERT INTO "note_checklist_items" ("page_id", "workspace_id", "ordinal", "text", "checked", "completed_at", "completed_by_kind", "updated_by_kind", "updated_by_user_id") VALUES ('${uuid(4)}', 'w1', 1, 'null-kind', true, now(), NULL, 'user', 'u1')`)).rejects.toThrow("note_checklist_items_completion_consistency");
      await database.query(`INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES ('${uuid(901)}', 'w1', 'idea', 'null-kind', '{}')`);
      await expect(database.query(`UPDATE "note_legacy_archive_items" SET "disposition" = 'converted', "converted_page_id" = '${uuid(4)}', "converted_action_id" = 'null-kind', "disposition_at" = now(), "disposition_by_kind" = NULL, "disposition_by_user_id" = 'u1' WHERE "id" = '${uuid(901)}'`)).rejects.toThrow("note_legacy_archive_items_state_check");
      await database.query(`INSERT INTO "workspace" VALUES ('w4')`);
      await database.query(`INSERT INTO "user" VALUES ('u5')`);
      await database.query(`INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m7', 'w4', 'u5'), ('m8', 'w4', 'u5')`);
      await database.query(`INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(960)}', 'w4', 'u5', 'user', 'user', 'u5', 'u5', to_tsvector('simple', 'duplicate-owner'))`);
      await database.query(`UPDATE "member" SET "user_id" = 'u4' WHERE "id" = 'm7'`);
      await database.query(`DELETE FROM "member" WHERE "id" = 'm7'`);
      await expect(database.query(`DELETE FROM "member" WHERE "id" = 'm8'`)).rejects.toThrow("NOTE_OWNER_OFFBOARDING_BLOCKED");
      await database.query(`DELETE FROM "user" WHERE "id" = 'u4'`);
      await database.query(`INSERT INTO "workspace" VALUES ('w5'), ('w6')`);
      await database.query(`INSERT INTO "user" VALUES ('u6')`);
      await database.query(`INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m9', 'w5', 'u6')`);
      await database.query(`INSERT INTO "agent_jobs" ("id", "workspace_id") VALUES ('${uuid(970)}', 'w5')`);
      await database.query(`INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "created_by_agent_job_id", "updated_by_agent_job_id", "search_vector") VALUES ('${uuid(971)}', 'w5', 'u6', 'agent', 'agent', 'u6', 'u6', '${uuid(970)}', '${uuid(970)}', to_tsvector('simple', 'agent'))`);
      await expect(database.query(`UPDATE "agent_jobs" SET "workspace_id" = 'w6' WHERE "id" = '${uuid(970)}'`)).rejects.toThrow("NOTE_AGENT_JOB_WORKSPACE_IMMUTABLE");
      await expect(database.query(`UPDATE "agent_jobs" SET "workspace_id" = NULL WHERE "id" = '${uuid(970)}'`)).rejects.toThrow("NOTE_AGENT_JOB_WORKSPACE_IMMUTABLE");
      await database.query(`DELETE FROM "workspace" WHERE "id" = 'w5'`);
      expect((await database.query(`SELECT "workspace_id" FROM "agent_jobs" WHERE "id" = '${uuid(970)}'`)).rows).toEqual([{ workspace_id: null }]);
      await database.query(`INSERT INTO "agent_jobs" ("id", "workspace_id") VALUES ('${uuid(972)}', 'w1')`);
      await database.query(`INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot", "disposition", "converted_page_id", "converted_action_id", "disposition_at", "disposition_by_kind", "disposition_by_user_id", "disposition_by_agent_job_id") VALUES ('${uuid(973)}', 'w1', 'todo', 'agent-disposition', '{}', 'converted', '${uuid(4)}', 'agent-disposition-action', now(), 'agent', 'u1', '${uuid(972)}')`);
      await expect(database.query(`DELETE FROM "agent_jobs" WHERE "id" = '${uuid(972)}'`)).rejects.toThrow("note_legacy_archive_items_disposition_by_agent_job_id_agent_job");
      expect((await database.query(`SELECT "workspace_id" FROM "agent_jobs" WHERE "id" = '${uuid(972)}'`)).rows).toEqual([{ workspace_id: "w1" }]);
      expect((await database.query(`SELECT "workspace_id", "disposition" FROM "note_legacy_archive_items" WHERE "id" = '${uuid(973)}'`)).rows).toEqual([{ workspace_id: "w1", disposition: "converted" }]);
      await database.query(`INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES ('${uuid(902)}', 'w1', 'todo', 'terminal-valid', '{}')`);
      await database.query(`UPDATE "note_legacy_archive_items" SET "disposition" = 'converted', "converted_page_id" = '${uuid(4)}', "converted_action_id" = 'terminal-action', "disposition_at" = now(), "disposition_by_kind" = 'user', "disposition_by_user_id" = 'u1' WHERE "id" = '${uuid(902)}'`);
      await expect(database.query(`UPDATE "note_legacy_archive_items" SET "disposition" = 'converted', "converted_page_id" = '${uuid(4)}', "converted_action_id" = 'terminal-action', "disposition_at" = "disposition_at", "disposition_by_kind" = 'user', "disposition_by_user_id" = 'u1' WHERE "id" = '${uuid(902)}'`)).rejects.toThrow("legacy archive terminal states are immutable");
      await database.query(`INSERT INTO "workspace" VALUES ('w3')`);
      await database.query(`INSERT INTO "user" VALUES ('u3')`);
      await database.query(`INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m4', 'w3', 'u3')`);
      await database.query(`INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(950)}', 'w3', 'u3', 'user', 'user', 'u3', 'u3', to_tsvector('simple', 'deletable'))`);
      await database.query(`DELETE FROM "workspace" WHERE "id" = 'w3'`);
      expect((await database.query(`SELECT 1 FROM "note_pages" WHERE "workspace_id" = 'w3'`)).rows).toHaveLength(0);
      await database.query(`INSERT INTO "workspace" VALUES ('w7')`);
      await database.query(`INSERT INTO "user" VALUES ('u7')`);
      await database.query(`INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m7-cascade', 'w7', 'u7')`);
      await database.query(`INSERT INTO "agent_jobs" ("id", "workspace_id") VALUES ('${uuid(975)}', 'w7')`);
      await database.query(`INSERT INTO "note_pages" ("id", "workspace_id", "owner_user_id", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id", "search_vector") VALUES ('${uuid(976)}', 'w7', 'u7', 'user', 'user', 'u7', 'u7', to_tsvector('simple', 'cascade target'))`);
      await database.query(`INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot", "disposition", "converted_page_id", "converted_action_id", "disposition_at", "disposition_by_kind", "disposition_by_user_id", "disposition_by_agent_job_id") VALUES ('${uuid(977)}', 'w7', 'todo', 'cascade-legacy', '{}', 'converted', '${uuid(976)}', 'cascade-action', now(), 'agent', 'u7', '${uuid(975)}')`);
      await database.query(`DELETE FROM "workspace" WHERE "id" = 'w7'`);
      expect((await database.query(`SELECT 1 FROM "note_legacy_archive_items" WHERE "id" = '${uuid(977)}'`)).rows).toHaveLength(0);
      expect((await database.query(`SELECT "workspace_id" FROM "agent_jobs" WHERE "id" = '${uuid(975)}'`)).rows).toEqual([{ workspace_id: null }]);
      const snapshot0228 = JSON.parse(await Bun.file(new URL("../../../migrations/meta/0228_snapshot.json", import.meta.url)).text()) as { id: string };
      const snapshot0229 = JSON.parse(await Bun.file(new URL("../../../migrations/meta/0229_snapshot.json", import.meta.url)).text()) as {
        prevId: string;
        tables: Record<string, { indexes?: Record<string, { columns: Array<{ expression: string }> }> }>;
      };
      expect(snapshot0229.prevId).toBe(snapshot0228.id);
      expect(snapshot0229.tables["public.note_legacy_archive_items"]?.indexes?.note_legacy_archive_items_source_unique_idx?.columns.map((column) => column.expression)).toEqual(["source_type", "source_id"]);
    } finally {
      await database.close();
    }
  }, 20_000);

  it("keeps the project lock trigger installable for a reduced schema without workspace authority", async () => {
    const database = await createLegacyDatabase();
    try {
      await database.exec(`DROP TABLE todo_items, idea_items, seeds, projects CASCADE; CREATE TABLE projects (id uuid PRIMARY KEY);`);
      await database.exec(migrationSql);
      const projectLockDefinition = await database.query<{ definition: string }>(`SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = 'projects_notes_global_lock_statement'`);
      expect(projectLockDefinition.rows).toHaveLength(1);
      expect(projectLockDefinition.rows[0]?.definition).toContain("BEFORE DELETE OR UPDATE ON public.projects");
      expect(projectLockDefinition.rows[0]?.definition).not.toContain("INSERT");
    } finally {
      await database.close();
    }
  }, 20_000);

  it("fails closed before constraining ambiguous historical legacy archive identities", async () => {
    const database = await createLegacyDatabase();
    try {
      const guardMarker = "-- Reject ambiguous historical legacy archive identities before adding the canonical constraint.";
      const guardOffset = migrationSql.indexOf(guardMarker);
      expect(guardOffset).toBeGreaterThan(0);
      if (guardOffset <= 0) return;

      await database.exec(migrationSql.slice(0, guardOffset));
      await database.exec(`
        INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot)
        VALUES
          ('${uuid(990)}', 'w1', 'idea', 'historical-duplicate', '{"workspace_id":"w1"}'),
          ('${uuid(991)}', 'w2', 'idea', 'historical-duplicate', '{"workspace_id":"w2"}')
      `);
      await expect(database.exec(migrationSql.slice(guardOffset))).rejects.toThrow("NOTE_LEGACY_ARCHIVE_DUPLICATE_IDENTITY");
      expect((await database.query(`SELECT workspace_id, snapshot FROM note_legacy_archive_items WHERE source_type = 'idea' AND source_id = 'historical-duplicate' ORDER BY workspace_id`)).rows).toEqual([
        { workspace_id: "w1", snapshot: { workspace_id: "w1" } },
        { workspace_id: "w2", snapshot: { workspace_id: "w2" } },
      ]);
    } finally {
      await database.close();
    }
  }, 20_000);
});
