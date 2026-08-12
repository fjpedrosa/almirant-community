import { afterAll, afterEach, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createNotesRepository, NOTES_GLOBAL_ADVISORY_LOCK } from "./notes-repository-core";
import { createNotesRepository as createProductionNotesRepository } from "./notes-repository";
import { MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES } from "../../notes/legacy-snapshot-serializer";

// Rendezvous helpers intentionally wait on real PostgreSQL lock rows. Keep the
// outer Bun timeout above the helper deadline so cleanup always runs and a
// failed proof cannot poison subsequent database cases.
setDefaultTimeout(20_000);

const migrationSql = await Bun.file(new URL("../../../migrations/0229_green_santa_claus.sql", import.meta.url)).text();
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const adminUrl = process.env.TEST_DATABASE_URL ?? process.env.NOTES_POSTGRES_URL ?? "postgres://localhost:5432/postgres";
const databaseName = `notes_phase1_${process.pid}_${Date.now()}`;
let admin: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let overlapController: ReturnType<typeof postgres>;
let targetUrl: string;
let targetDatabaseOid: number;
const ephemeralConnections = new Set<ReturnType<typeof postgres>>();
const openEphemeral = (url: string, options: any) => {
  const connection = postgres(url, options);
  ephemeralConnections.add(connection);
  return connection;
};
const OVERLAP_LOCK = NOTES_GLOBAL_ADVISORY_LOCK;
const OVERLAP_CLASS_ID = Math.floor(OVERLAP_LOCK / 2 ** 32);
const OVERLAP_OBJECT_ID = OVERLAP_LOCK % 2 ** 32;

const connectionPid = async (connection: ReturnType<typeof postgres>) => Number((await connection`SELECT pg_backend_pid() AS pid`)[0]?.pid);

const waitForOverlapParticipants = async (participantPids: number[], expectedWaiters: number) => {
  const pidList = participantPids.join(",");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await client.unsafe(`SELECT count(DISTINCT pid)::int AS participant_waiting, count(*)::int AS overlap_waiting FROM pg_locks WHERE pid IN (${pidList}) AND locktype = 'advisory' AND database = ${targetDatabaseOid} AND classid = ${OVERLAP_CLASS_ID} AND objid = ${OVERLAP_OBJECT_ID} AND objsubid = 1 AND mode = 'ExclusiveLock' AND granted = false`);
    if (Number(rows[0]?.participant_waiting ?? 0) >= expectedWaiters && Number(rows[0]?.overlap_waiting ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`NOTES_TEST_OVERLAP_TIMEOUT expected=${expectedWaiters} pids=${pidList}`);
};

const waitForNotesRowEdge = async (notesPid: number, rowHolderPid: number) => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = await client.unsafe(`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE pid = ${notesPid} AND locktype = 'advisory' AND database = ${targetDatabaseOid}
          AND classid = ${OVERLAP_CLASS_ID} AND objid = ${OVERLAP_OBJECT_ID} AND objsubid = 1
          AND mode = 'ExclusiveLock' AND granted
      ) AS global_granted,
      EXISTS (
        SELECT 1 FROM pg_locks waiter
        JOIN pg_locks holder ON holder.locktype = 'transactionid'
          AND holder.transactionid = waiter.transactionid
          AND holder.pid = ${rowHolderPid} AND holder.granted
        WHERE waiter.pid = ${notesPid} AND waiter.locktype = 'transactionid' AND NOT waiter.granted
      ) AS row_waiting
    `);
    if (rows[0]?.global_granted && rows[0]?.row_waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const diagnostic = await client.unsafe(`SELECT pid, locktype, mode, granted, transactionid, relation::regclass::text AS relation FROM pg_locks WHERE pid IN (${notesPid}, ${rowHolderPid}) ORDER BY pid, granted, locktype`);
  throw new Error(`NOTES_TEST_ROW_EDGE_TIMEOUT notes=${notesPid} holder=${rowHolderPid} locks=${JSON.stringify(diagnostic)}`);
};

const waitForTransactionEdge = async (waiterPid: number, holderPid: number) => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = await client.unsafe(`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks waiter
        JOIN pg_locks holder ON holder.locktype = 'transactionid'
          AND holder.transactionid = waiter.transactionid
          AND holder.pid = ${holderPid} AND holder.granted
        WHERE waiter.pid = ${waiterPid} AND waiter.locktype = 'transactionid' AND NOT waiter.granted
      ) AS row_waiting
    `);
    if (rows[0]?.row_waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const diagnostic = await client.unsafe(`SELECT pid, locktype, mode, granted, transactionid, relation::regclass::text AS relation FROM pg_locks WHERE pid IN (${waiterPid}, ${holderPid}) ORDER BY pid, granted, locktype`);
  throw new Error(`NOTES_TEST_TRANSACTION_EDGE_TIMEOUT waiter=${waiterPid} holder=${holderPid} locks=${JSON.stringify(diagnostic)}`);
};

const waitForProjectMutationDeletionPhase = async (projectWriterPid: number, deleterPid: number) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await client.unsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE pid = ${projectWriterPid} AND locktype = 'advisory' AND database = ${targetDatabaseOid}
          AND classid = ${OVERLAP_CLASS_ID} AND objid = ${OVERLAP_OBJECT_ID} AND objsubid = 1
          AND mode = 'ExclusiveLock' AND granted
      ) AS creator_global_granted,
      EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE pid = ${deleterPid} AND locktype = 'advisory' AND database = ${targetDatabaseOid}
          AND classid = ${OVERLAP_CLASS_ID} AND objid = ${OVERLAP_OBJECT_ID} AND objsubid = 1
          AND mode = 'ExclusiveLock' AND NOT granted
      ) AS deleter_global_waiting,
      EXISTS (
        SELECT 1
        FROM pg_locks waiter
        JOIN pg_locks holder ON holder.locktype = 'transactionid'
          AND holder.transactionid = waiter.transactionid
          AND holder.pid = ${projectWriterPid} AND holder.granted
        WHERE waiter.pid = ${deleterPid} AND waiter.locktype = 'transactionid' AND NOT waiter.granted
      ) AS deleter_workspace_waiting
    `);
    if (rows[0]?.creator_global_granted && rows[0]?.deleter_global_waiting) return "global-first" as const;
    if (rows[0]?.deleter_workspace_waiting) return "workspace-first" as const;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const diagnostic = await client.unsafe(`SELECT pid, locktype, mode, granted, transactionid, relation::regclass::text AS relation FROM pg_locks WHERE pid IN (${projectWriterPid}, ${deleterPid}) ORDER BY pid, granted, locktype`);
  throw new Error(`NOTES_TEST_PROJECT_MUTATION_DELETE_PHASE_TIMEOUT writer=${projectWriterPid} deleter=${deleterPid} locks=${JSON.stringify(diagnostic)}`);
};

const waitForWorkspaceMutationDeletionPhase = async (
  workspaceWriterPid: number,
  deleterPid: number,
  exactWorkspaceLockQuery: string,
) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await client.unsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE pid = ${workspaceWriterPid} AND locktype = 'advisory' AND database = ${targetDatabaseOid}
          AND classid = ${OVERLAP_CLASS_ID} AND objid = ${OVERLAP_OBJECT_ID} AND objsubid = 1
          AND mode = 'ExclusiveLock' AND granted
      ) AS writer_global_granted,
      EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE pid = ${deleterPid} AND locktype = 'advisory' AND database = ${targetDatabaseOid}
          AND classid = ${OVERLAP_CLASS_ID} AND objid = ${OVERLAP_OBJECT_ID} AND objsubid = 1
          AND mode = 'ExclusiveLock' AND NOT granted
      ) AS deleter_global_waiting,
      EXISTS (
        SELECT 1
        FROM pg_locks waiter
        JOIN pg_locks holder ON holder.locktype = 'transactionid'
          AND holder.transactionid = waiter.transactionid
          AND holder.pid = ${workspaceWriterPid} AND holder.granted
        JOIN pg_stat_activity activity ON activity.pid = waiter.pid
        WHERE waiter.pid = ${deleterPid} AND waiter.locktype = 'transactionid' AND NOT waiter.granted
          AND activity.wait_event_type = 'Lock' AND activity.wait_event = 'transactionid'
          AND activity.query = $1
      ) AS deleter_exact_workspace_row_waiting
    `, [exactWorkspaceLockQuery]);
    if (rows[0]?.writer_global_granted && rows[0]?.deleter_global_waiting) return "global-first" as const;
    if (rows[0]?.deleter_exact_workspace_row_waiting) return "workspace-row-first" as const;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const diagnostic = await client.unsafe(`
    SELECT locks.pid, locks.locktype, locks.mode, locks.granted, locks.transactionid,
      locks.relation::regclass::text AS relation, activity.wait_event_type, activity.wait_event, activity.query
    FROM pg_locks locks
    JOIN pg_stat_activity activity ON activity.pid = locks.pid
    WHERE locks.pid IN (${workspaceWriterPid}, ${deleterPid})
    ORDER BY locks.pid, locks.granted, locks.locktype
  `);
  throw new Error(`NOTES_TEST_WORKSPACE_MUTATION_DELETE_PHASE_TIMEOUT writer=${workspaceWriterPid} deleter=${deleterPid} query=${exactWorkspaceLockQuery} locks=${JSON.stringify(diagnostic)}`);
};

const armOverlapBarrier = async (participantPids: number[]) => {
  await overlapController`SELECT pg_advisory_lock(${OVERLAP_LOCK})`;
  const pidList = participantPids.join(",");
  return async (expectedWaiters: number) => {
    await waitForOverlapParticipants(participantPids, expectedWaiters);
    const rows = await client.unsafe(`SELECT count(DISTINCT pid)::int AS participant_waiting, count(*)::int AS overlap_waiting, array_agg(DISTINCT pid) AS participant_pids FROM pg_locks WHERE pid IN (${pidList}) AND locktype = 'advisory' AND database = ${targetDatabaseOid} AND classid = ${OVERLAP_CLASS_ID} AND objid = ${OVERLAP_OBJECT_ID} AND objsubid = 1 AND mode = 'ExclusiveLock' AND granted = false`);
    expect(Number(rows[0]?.participant_waiting ?? 0)).toBeGreaterThanOrEqual(expectedWaiters);
    expect(Number(rows[0]?.overlap_waiting ?? 0)).toBeGreaterThanOrEqual(1);
    expect((rows[0]?.participant_pids as number[] | null)?.sort()).toEqual([...participantPids].sort());
    await overlapController`SELECT pg_advisory_unlock(${OVERLAP_LOCK})`;
  };
};

const runCanonicalSeedPlanMutations = async (workspaceId: string, seedIds: string[]) => {
  const seedRepositoryUrl = new URL("../ideation/seed-repository.ts", import.meta.url).href;
  const databaseIndexUrl = new URL("../../index.ts", import.meta.url).href;
  const script = `
    const repository = await import(${JSON.stringify(seedRepositoryUrl)});
    const database = await import(${JSON.stringify(databaseIndexUrl)});
    const ids = JSON.parse(process.env.NOTES_TEST_SEED_IDS);
    try {
      const selected = await repository.bulkSelectSeedsForIdeation(process.env.NOTES_TEST_WORKSPACE_ID, ids, true);
      const reviewed = await repository.markSeedsAsToReview(process.env.NOTES_TEST_WORKSPACE_ID, ids);
      console.log(JSON.stringify({ selected, reviewed }));
    } finally {
      await database.closeConnections();
    }
  `;
  const child = Bun.spawn(["bun", "--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: targetUrl,
      NOTES_TEST_WORKSPACE_ID: workspaceId,
      NOTES_TEST_SEED_IDS: JSON.stringify(seedIds),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`NOTES_SEED_PLAN_PROBE_FAILED: ${stderr || stdout}`);
  }
  const line = stdout.trim().split("\n").at(-1);
  return JSON.parse(line ?? "{}") as { selected: number; reviewed: number };
};

describe("notes foundation PostgreSQL concurrency contracts", () => {
  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 2 });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    targetUrl = adminUrl.replace(/\/[^/]+$/, `/${databaseName}`);
    client = postgres(targetUrl, { max: 4 });
    overlapController = postgres(targetUrl, { max: 1 });
    targetDatabaseOid = Number((await client`SELECT oid FROM pg_database WHERE datname = current_database()`)[0]?.oid);
    await client.unsafe(`
      CREATE TABLE "workspace" ("id" text PRIMARY KEY, "name" text);
      CREATE TABLE "user" ("id" text PRIMARY KEY);
      CREATE TABLE "member" ("id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "role" text NOT NULL DEFAULT 'member');
      CREATE TABLE "session" ("id" text PRIMARY KEY, "expires_at" timestamptz NOT NULL, "token" text NOT NULL UNIQUE, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "active_workspace_id" text);
      CREATE TABLE "agent_jobs" ("id" uuid PRIMARY KEY, "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL, "status" text NOT NULL DEFAULT 'pending');
      CREATE TABLE "projects" ("id" uuid PRIMARY KEY, "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL, "description" text, "updated_at" timestamptz NOT NULL);
      CREATE TABLE "todo_items" ("id" uuid PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "title" text NOT NULL, "description" text, "status" text, "priority" text, "owner_user_id" text, "created_by_user_id" text, "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL, "due_date" timestamptz, "completed_at" timestamptz, "metadata" jsonb, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL);
      CREATE TABLE "idea_items" ("id" uuid PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL, "title" text NOT NULL, "description" text, "type" text, "status" text, "owner_user_id" text, "created_by_user_id" text, "due_date" timestamptz, "discussed" boolean DEFAULT false, "metadata" jsonb, "completed_at" timestamptz, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL);
      CREATE TABLE "seeds" ("id" uuid PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL, "status" text, "title" text NOT NULL, "description" text, "source" text, "priority" text, "selected_for_ideation" boolean DEFAULT false, "owner_user_id" text, "created_by_user_id" text, "metadata" jsonb, "maturity_level" integer DEFAULT 1, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL);
      INSERT INTO "workspace" ("id") VALUES ('w1');
      INSERT INTO "workspace" ("id") VALUES ('w2');
      INSERT INTO "user" VALUES ('u1');
      INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m1', 'w1', 'u1');
      INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m2', 'w2', 'u1');
      INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id) VALUES ('s1', now() + interval '1 day', 'token-s1', now(), now(), 'u1', 'w1'), ('s2', now() + interval '1 day', 'token-s2', now(), now(), 'u1', 'w2');
    `);
    await client.unsafe(migrationSql);
  });

  it("keeps the production facade root-bound even when handed a nested handle", async () => {
    const nestedHandle = drizzle(client) as never;
    const facade = (createProductionNotesRepository as unknown as (handle: unknown) => ReturnType<typeof createProductionNotesRepository>)(nestedHandle);
    expect(createProductionNotesRepository.length).toBe(0);
    expect(facade.createPage).toBeDefined();
  });

  it("transactionally bridges post-migration legacy writes and retains review snapshots after source deletion", async () => {
    const rolledBackId = id(909);
    await expect(client.begin(async (transaction) => {
      await transaction.unsafe(`INSERT INTO todo_items (id, workspace_id, title, created_at, updated_at) VALUES ('${rolledBackId}', 'w1', 'rolled back', now(), now())`);
      expect(await transaction.unsafe(`SELECT source_id FROM note_legacy_archive_items WHERE source_id = '${rolledBackId}'`)).toHaveLength(1);
      throw new Error("ROLLBACK_LEGACY_BRIDGE");
    })).rejects.toThrow("ROLLBACK_LEGACY_BRIDGE");
    expect(await client`SELECT id FROM todo_items WHERE id = ${rolledBackId}`).toHaveLength(0);
    expect(await client`SELECT source_id FROM note_legacy_archive_items WHERE source_id = ${rolledBackId}`).toHaveLength(0);

    const todoId = id(910);
    const ideaId = id(911);
    const seedId = id(912);
    await client.begin(async (transaction) => {
      await transaction.unsafe(`INSERT INTO todo_items (id, workspace_id, title, created_at, updated_at) VALUES ('${todoId}', 'w1', 'bridge todo', now(), now())`);
      await transaction.unsafe(`INSERT INTO idea_items (id, workspace_id, title, type, status, created_at, updated_at) VALUES ('${ideaId}', 'w1', 'bridge idea', 'idea', 'active', now(), now())`);
      await transaction.unsafe(`INSERT INTO seeds (id, workspace_id, title, status, source, maturity_level, created_at, updated_at) VALUES ('${seedId}', 'w1', 'bridge seed', 'active', 'manual', 1, now(), now())`);
      await transaction.unsafe(`UPDATE todo_items SET title = 'bridge todo updated', updated_at = now() WHERE id = '${todoId}'`);
      await transaction.unsafe(`UPDATE idea_items SET status = 'approved', updated_at = now() WHERE id = '${ideaId}'`);
      await transaction.unsafe(`UPDATE seeds SET maturity_level = 4, updated_at = now() WHERE id = '${seedId}'`);
    });
    const snapshots = await client<{ source_type: string; source_id: string; snapshot: Record<string, unknown> }[]>`SELECT source_type, source_id, snapshot FROM note_legacy_archive_items WHERE source_id IN (${todoId}, ${ideaId}, ${seedId}) ORDER BY source_type`;
    expect(snapshots).toHaveLength(3);
    expect(snapshots.find((row) => row.source_id === todoId)?.snapshot).toMatchObject({ title: "bridge todo updated", _legacy_source_type: "todo" });
    expect(snapshots.find((row) => row.source_id === ideaId)?.snapshot).toMatchObject({ status: "approved", _legacy_source_type: "idea" });
    expect(snapshots.find((row) => row.source_id === seedId)?.snapshot).toMatchObject({ maturity_level: 4, _legacy_source_type: "seed" });

    await client`DELETE FROM todo_items WHERE id = ${todoId}`;
    await client`DELETE FROM idea_items WHERE id = ${ideaId}`;
    expect(await client`SELECT source_id FROM note_legacy_archive_items WHERE source_id IN (${todoId}, ${ideaId})`).toHaveLength(2);
    expect(await client`SELECT id FROM seeds WHERE id = ${seedId}`).toHaveLength(1);
    await expect(client`UPDATE note_legacy_archive_items SET snapshot = '{"tampered":true}'::jsonb WHERE source_id = ${seedId}`.execute()).rejects.toThrow("legacy archive snapshots are immutable");
  });

  it("atomically converts the complete bridged snapshot into one private page with stable replay", async () => {
    const ideaId = id(990);
    await client.unsafe(`
      INSERT INTO idea_items (
        id, workspace_id, title, description, type, status, discussed, metadata, created_at, updated_at
      ) VALUES (
        '${ideaId}', 'w1', 'Atomic legacy page', 'Preserve the complete source snapshot',
        'idea', 'active', false, '{"nested":{"answer":42},"tags":["one","two"]}'::jsonb,
        now(), now()
      )
    `);
    const [archiveBefore] = await client<{ id: string; snapshot: Record<string, unknown> }[]>`
      SELECT id, snapshot FROM note_legacy_archive_items
      WHERE source_type = 'idea' AND source_id = ${ideaId}
    `;
    expect(archiveBefore).toBeDefined();
    const repo = createNotesRepository(drizzle(client) as never);
    const converted = await repo.convertLegacy({
      workspaceId: "w1",
      userId: "u1",
      archiveId: archiveBefore!.id,
      actionId: "real-pg-atomic-legacy",
    });
    const replay = await repo.convertLegacy({
      workspaceId: "w1",
      userId: "u1",
      archiveId: archiveBefore!.id,
      actionId: "real-pg-atomic-legacy",
    });

    expect(replay.convertedPageId).toBe(converted.convertedPageId);
    const pages = await client<{ id: string; visibility: string; parent_id: string | null; lexical_json: any }[]>`
      SELECT id, visibility, parent_id, lexical_json
      FROM note_pages WHERE id = ${converted.convertedPageId!}
    `;
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual(expect.objectContaining({ visibility: "private", parent_id: null }));
    const code = pages[0]!.lexical_json.root.children.find((child: any) => child.type === "code");
    expect(JSON.parse(code.children[0].text)).toEqual(archiveBefore!.snapshot);
    expect((await client<{ snapshot: Record<string, unknown> }[]>`
      SELECT snapshot FROM note_legacy_archive_items WHERE id = ${archiveBefore!.id}
    `)[0]?.snapshot).toEqual(archiveBefore!.snapshot);
  });

  it("preflights exact legacy snapshot bytes before transfer and accepts the documented boundary", async () => {
    const repository = createNotesRepository(drizzle(client) as never);
    const oversizedArchiveId = id(13_100);
    const boundaryArchiveId = id(13_101);
    const [empty] = await client<{ bytes: number }[]>`
      SELECT octet_length(jsonb_build_object('title', 'Boundary', 'description', '')::text)::int AS bytes
    `;
    const boundaryDescriptionBytes = MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES - empty!.bytes;
    await client`
      INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot)
      VALUES
        (${oversizedArchiveId}, 'w1', 'todo', 'real-pg-oversized',
          jsonb_build_object('title', 'Boundary', 'description', repeat('x', ${boundaryDescriptionBytes + 1}))),
        (${boundaryArchiveId}, 'w1', 'todo', 'real-pg-boundary',
          jsonb_build_object('title', 'Boundary', 'description', repeat('x', ${boundaryDescriptionBytes})))
    `;
    const byteSizes = await client<{ id: string; bytes: number }[]>`
      SELECT id, octet_length(snapshot::text)::int AS bytes
      FROM note_legacy_archive_items
      WHERE id IN (${oversizedArchiveId}, ${boundaryArchiveId})
      ORDER BY id
    `;
    expect(byteSizes.find((row) => row.id === oversizedArchiveId)?.bytes).toBe(
      MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES + 1,
    );
    expect(byteSizes.find((row) => row.id === boundaryArchiveId)?.bytes).toBe(
      MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES,
    );
    const pageCountBefore = Number((await client`SELECT count(*)::int AS count FROM note_pages`)[0]?.count);

    await expect(repository.convertLegacy({
      workspaceId: "w1",
      userId: "u1",
      archiveId: oversizedArchiveId,
      actionId: "real-pg-oversized-action",
    })).rejects.toThrow("LEGACY_SNAPSHOT_TOO_LARGE");
    expect((await client`
      SELECT disposition, converted_action_id, converted_page_id
      FROM note_legacy_archive_items WHERE id = ${oversizedArchiveId}
    `)[0]).toEqual(expect.objectContaining({
      disposition: "pending",
      converted_action_id: null,
      converted_page_id: null,
    }));
    expect(Number((await client`SELECT count(*)::int AS count FROM note_pages`)[0]?.count)).toBe(pageCountBefore);

    const converted = await repository.convertLegacy({
      workspaceId: "w1",
      userId: "u1",
      archiveId: boundaryArchiveId,
      actionId: "real-pg-boundary-action",
    });
    const replay = await repository.convertLegacy({
      workspaceId: "w1",
      userId: "u1",
      archiveId: boundaryArchiveId,
      actionId: "real-pg-boundary-action",
    });
    expect(replay).toEqual(converted);
    const [convertedPage] = await client<{ lexical_json: any }[]>`
      SELECT lexical_json FROM note_pages WHERE id = ${converted.convertedPageId!}
    `;
    const code = convertedPage!.lexical_json.root.children.find((child: any) => child.type === "code");
    const acceptedSnapshot = JSON.parse(code.children[0].text);
    expect(acceptedSnapshot.title).toBe("Boundary");
    expect(acceptedSnapshot.description).toHaveLength(boundaryDescriptionBytes);
  });

  it("preserves PostgreSQL JSONB numeric fidelity without JavaScript number parsing", async () => {
    const repository = createNotesRepository(drizzle(client) as never);
    const archiveId = id(13_102);
    const numericSnapshotText = `{
      "title": "Exact PostgreSQL numerics",
      "unsafeInteger": 9007199254740993,
      "largeDecimal": 123456789012345678901234567890.123456789012345678901234567890,
      "tinyExponent": 1.2345678901234567890123456789e-1000,
      "hugeExponent": 1e100000
    }`;
    await client.unsafe(
      `INSERT INTO note_legacy_archive_items
         (id, workspace_id, source_type, source_id, snapshot)
       VALUES ($1, 'w1', 'idea', 'numeric-fidelity', $2::jsonb)`,
      [archiveId, numericSnapshotText],
    );
    const [before] = await client<{ snapshot_text: string; snapshot_bytes: number }[]>`
      SELECT snapshot::text AS snapshot_text,
             octet_length(snapshot::text)::int AS snapshot_bytes
      FROM note_legacy_archive_items
      WHERE id = ${archiveId}
    `;
    expect(before!.snapshot_bytes).toBeLessThan(MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES);

    const converted = await repository.convertLegacy({
      workspaceId: "w1",
      userId: "u1",
      archiveId,
      actionId: "numeric-fidelity-action",
    });
    const replay = await repository.convertLegacy({
      workspaceId: "w1",
      userId: "u1",
      archiveId,
      actionId: "numeric-fidelity-action",
    });
    expect(replay).toEqual(converted);
    expect(converted).not.toHaveProperty("snapshot");

    const [proof] = await client<{
      archive_count: number;
      page_count: number;
      disposition: string;
      converted_action_id: string;
      snapshot_unchanged: boolean;
      lexical_text_exact: boolean;
      lexical_jsonb_equal: boolean;
    }[]>`
      WITH archive AS (
        SELECT snapshot, snapshot::text AS snapshot_text, disposition, converted_action_id
        FROM note_legacy_archive_items
        WHERE id = ${archiveId}
      ), code AS (
        SELECT child->'children'->0->>'text' AS snapshot_text
        FROM note_pages page
        CROSS JOIN LATERAL jsonb_array_elements(page.lexical_json->'root'->'children') child
        WHERE page.id = ${converted.convertedPageId!}
          AND child->>'type' = 'code'
      )
      SELECT
        (SELECT count(*)::int FROM note_legacy_archive_items WHERE id = ${archiveId}) AS archive_count,
        (SELECT count(*)::int FROM note_pages WHERE id = ${converted.convertedPageId!}) AS page_count,
        archive.disposition,
        archive.converted_action_id,
        archive.snapshot_text = ${before!.snapshot_text} AS snapshot_unchanged,
        code.snapshot_text = archive.snapshot_text AS lexical_text_exact,
        code.snapshot_text::jsonb = archive.snapshot AS lexical_jsonb_equal
      FROM archive CROSS JOIN code
    `;
    expect(proof).toEqual({
      archive_count: 1,
      page_count: 1,
      disposition: "converted",
      converted_action_id: "numeric-fidelity-action",
      snapshot_unchanged: true,
      lexical_text_exact: true,
      lexical_jsonb_equal: true,
    });
  });

  it("keeps terminal Seed snapshots frozen while canonical Plan mutations remain live", async () => {
    const workspaceId = "w1";
    const projectId = id(913);
    const otherProjectId = id(914);
    const convertedSeedId = id(915);
    const discardedSeedId = id(916);
    const repository = createNotesRepository(drizzle(client) as never);

    await client.begin(async (transaction) => {
      await transaction.unsafe(
        "INSERT INTO projects (id, workspace_id, description, updated_at) VALUES ($1, $2, 'seed authority', now()), ($3, $2, 'other authority', now())",
        [projectId, workspaceId, otherProjectId],
      );
      await transaction.unsafe(
        "INSERT INTO seeds (id, workspace_id, project_id, title, status, source, selected_for_ideation, maturity_level, created_at, updated_at) VALUES ($1, $2, $3, 'converted live seed', 'active', 'manual', false, 1, now(), now()), ($4, $2, $3, 'discarded live seed', 'active', 'manual', false, 1, now(), now())",
        [convertedSeedId, workspaceId, projectId, discardedSeedId],
      );
    });

    const destination = await repository.createPage({ workspaceId, userId: "u1", title: "seed review destination" });
    const archives = await client<{ id: string; source_id: string }[]>`SELECT id, source_id FROM note_legacy_archive_items WHERE source_type = 'seed' AND source_id IN (${convertedSeedId}, ${discardedSeedId}) ORDER BY source_id`;
    const convertedArchive = archives.find((row) => row.source_id === convertedSeedId);
    const discardedArchive = archives.find((row) => row.source_id === discardedSeedId);
    if (!convertedArchive || !discardedArchive) throw new Error("missing Seed archive fixtures");
    await repository.convertLegacy({ workspaceId, userId: "u1", archiveId: convertedArchive.id, pageId: destination.id, actionId: "seed-live-convert" });
    await repository.discardLegacy({ workspaceId, userId: "u1", archiveId: discardedArchive.id, actionId: "seed-live-discard" });

    const before = await client<{ id: string; bytes: string }[]>`
      SELECT id, encode(convert_to(to_jsonb(archive_row)::text, 'UTF8'), 'hex') AS bytes
      FROM note_legacy_archive_items archive_row
      WHERE id IN (${convertedArchive.id}, ${discardedArchive.id})
      ORDER BY id
    `;

    expect(await runCanonicalSeedPlanMutations(workspaceId, [convertedSeedId, discardedSeedId])).toEqual({ selected: 2, reviewed: 2 });
    const canonicalRows = await client<{ id: string; status: string; selected_for_ideation: boolean }[]>`SELECT id, status, selected_for_ideation FROM seeds WHERE id IN (${convertedSeedId}, ${discardedSeedId}) ORDER BY id`;
    expect(canonicalRows.map((row) => ({ ...row }))).toEqual([
      { id: convertedSeedId, status: "to_review", selected_for_ideation: false },
      { id: discardedSeedId, status: "to_review", selected_for_ideation: false },
    ]);

    for (const seedId of [convertedSeedId, discardedSeedId]) {
      await expect(client`UPDATE seeds SET project_id = ${otherProjectId} WHERE id = ${seedId}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE seeds SET workspace_id = 'w2' WHERE id = ${seedId}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
    }
    for (const [seedId, replacementId] of [
      [convertedSeedId, id(917)],
      [discardedSeedId, id(918)],
    ] as const) {
      await expect(client`UPDATE seeds SET id = ${replacementId} WHERE id = ${seedId}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
    }

    const after = await client<{ id: string; bytes: string }[]>`
      SELECT id, encode(convert_to(to_jsonb(archive_row)::text, 'UTF8'), 'hex') AS bytes
      FROM note_legacy_archive_items archive_row
      WHERE id IN (${convertedArchive.id}, ${discardedArchive.id})
      ORDER BY id
    `;
    expect(after).toEqual(before);
  });

  it("proves trigger depth cannot distinguish FK cleanup while deleted-parent visibility can", async () => {
    const probe = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    await probe.unsafe(`
      CREATE TEMP TABLE depth_probe_parent (id integer PRIMARY KEY);
      CREATE TEMP TABLE depth_probe_child (id integer PRIMARY KEY, parent_id integer REFERENCES depth_probe_parent(id) ON DELETE SET NULL);
      CREATE TEMP TABLE depth_probe_events (depth integer NOT NULL, parent_exists boolean NOT NULL);
      CREATE FUNCTION pg_temp.capture_depth_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pg_temp.depth_probe_events (depth, parent_exists)
        VALUES (pg_trigger_depth(), EXISTS (SELECT 1 FROM pg_temp.depth_probe_parent WHERE id = OLD.parent_id));
        RETURN NEW;
      END $$;
      CREATE TRIGGER depth_probe_child_update AFTER UPDATE OF parent_id ON depth_probe_child FOR EACH ROW EXECUTE FUNCTION pg_temp.capture_depth_probe();
      INSERT INTO depth_probe_parent (id) VALUES (1), (2);
      INSERT INTO depth_probe_child (id, parent_id) VALUES (1, 1);
      UPDATE depth_probe_child SET parent_id = 2 WHERE id = 1;
    `);
    const directEvidence = await probe<{ depth: number; parent_exists: boolean }[]>`SELECT depth, parent_exists FROM depth_probe_events`;
    await probe`TRUNCATE depth_probe_events`;
    await probe`DELETE FROM depth_probe_parent WHERE id = 2`;
    const referentialActionEvidence = await probe<{ depth: number; parent_exists: boolean }[]>`SELECT depth, parent_exists FROM depth_probe_events`;
    expect(directEvidence.map((row) => ({ depth: Number(row.depth), parentExists: row.parent_exists }))).toEqual([{ depth: 1, parentExists: true }]);
    expect(referentialActionEvidence.map((row) => ({ depth: Number(row.depth), parentExists: row.parent_exists }))).toEqual([{ depth: 1, parentExists: false }]);
  });

  it("preserves terminal legacy archives while project deletion nulls every source project link", async () => {
    const workspaceId = "w-terminal-project-delete";
    const projectId = id(922);
    const sourceIds = {
      convertedTodo: id(923),
      discardedTodo: id(924),
      convertedIdea: id(925),
      discardedIdea: id(926),
      convertedSeed: id(927),
      discardedSeed: id(928),
    };
    const allSourceIds = Object.values(sourceIds);
    try {
      await client`INSERT INTO workspace (id) VALUES (${workspaceId})`;
      await client`INSERT INTO member (id, workspace_id, user_id) VALUES ('m-terminal-project-delete', ${workspaceId}, 'u1')`;
      await client`INSERT INTO projects (id, workspace_id, updated_at) VALUES (${projectId}, ${workspaceId}, now())`;
      await client`
        INSERT INTO todo_items (id, workspace_id, project_id, title, created_at, updated_at)
        VALUES
          (${sourceIds.convertedTodo}, ${workspaceId}, ${projectId}, 'converted todo', now(), now()),
          (${sourceIds.discardedTodo}, ${workspaceId}, ${projectId}, 'discarded todo', now(), now())
      `;
      await client`
        INSERT INTO idea_items (id, workspace_id, project_id, title, type, status, created_at, updated_at)
        VALUES
          (${sourceIds.convertedIdea}, ${workspaceId}, ${projectId}, 'converted idea', 'idea', 'active', now(), now()),
          (${sourceIds.discardedIdea}, ${workspaceId}, ${projectId}, 'discarded idea', 'idea', 'active', now(), now())
      `;
      await client`
        INSERT INTO seeds (id, workspace_id, project_id, title, status, source, maturity_level, created_at, updated_at)
        VALUES
          (${sourceIds.convertedSeed}, ${workspaceId}, ${projectId}, 'converted seed', 'active', 'manual', 1, now(), now()),
          (${sourceIds.discardedSeed}, ${workspaceId}, ${projectId}, 'discarded seed', 'active', 'manual', 1, now(), now())
      `;

      const repository = createNotesRepository(drizzle(client) as never);
      const destination = await repository.createPage({ workspaceId, userId: "u1", title: "legacy conversion destination" });
      const archives = await client<{ id: string; source_id: string }[]>`
        SELECT id, source_id
        FROM note_legacy_archive_items
        WHERE workspace_id = ${workspaceId} AND source_id IN ${client(allSourceIds)}
      `;
      const archiveId = (sourceId: string) => {
        const row = archives.find((candidate) => candidate.source_id === sourceId);
        if (!row) throw new Error(`missing archive for ${sourceId}`);
        return row.id;
      };
      for (const [sourceId, actionId] of [
        [sourceIds.convertedTodo, "convert-terminal-todo"],
        [sourceIds.convertedIdea, "convert-terminal-idea"],
        [sourceIds.convertedSeed, "convert-terminal-seed"],
      ] as const) {
        await repository.convertLegacy({ workspaceId, userId: "u1", archiveId: archiveId(sourceId), pageId: destination.id, actionId });
      }
      for (const [sourceId, actionId] of [
        [sourceIds.discardedTodo, "discard-terminal-todo"],
        [sourceIds.discardedIdea, "discard-terminal-idea"],
        [sourceIds.discardedSeed, "discard-terminal-seed"],
      ] as const) {
        await repository.discardLegacy({ workspaceId, userId: "u1", archiveId: archiveId(sourceId), actionId });
      }

      const archiveBytes = async () => (await client<{ source_id: string; disposition: string; bytes: string }[]>`
        SELECT source_id, disposition, encode(convert_to(to_jsonb(archive_row)::text, 'UTF8'), 'hex') AS bytes
        FROM note_legacy_archive_items archive_row
        WHERE workspace_id = ${workspaceId} AND source_id IN ${client(allSourceIds)}
        ORDER BY source_type, source_id
      `).map((row) => ({ sourceId: row.source_id, disposition: row.disposition, bytes: row.bytes }));
      const sourceBytes = async () => (await client<{ source_type: string; source_id: string; bytes: string }[]>`
        SELECT 'todo' AS source_type, id::text AS source_id, encode(convert_to(to_jsonb(source_row)::text, 'UTF8'), 'hex') AS bytes
        FROM todo_items source_row WHERE id IN ${client([sourceIds.convertedTodo, sourceIds.discardedTodo])}
        UNION ALL
        SELECT 'idea' AS source_type, id::text AS source_id, encode(convert_to(to_jsonb(source_row)::text, 'UTF8'), 'hex') AS bytes
        FROM idea_items source_row WHERE id IN ${client([sourceIds.convertedIdea, sourceIds.discardedIdea])}
        UNION ALL
        SELECT 'seed' AS source_type, id::text AS source_id, encode(convert_to(to_jsonb(source_row)::text, 'UTF8'), 'hex') AS bytes
        FROM seeds source_row WHERE id IN ${client([sourceIds.convertedSeed, sourceIds.discardedSeed])}
        ORDER BY source_type, source_id
      `).map((row) => ({ sourceType: row.source_type, sourceId: row.source_id, bytes: row.bytes }));
      const terminalArchivesBefore = await archiveBytes();
      const terminalSourcesBefore = await sourceBytes();
      expect(terminalArchivesBefore.map(({ sourceId, disposition }) => ({ sourceId, disposition }))).toEqual([
        { sourceId: sourceIds.convertedTodo, disposition: "converted" },
        { sourceId: sourceIds.discardedTodo, disposition: "discarded" },
        { sourceId: sourceIds.convertedIdea, disposition: "converted" },
        { sourceId: sourceIds.discardedIdea, disposition: "discarded" },
        { sourceId: sourceIds.convertedSeed, disposition: "converted" },
        { sourceId: sourceIds.discardedSeed, disposition: "discarded" },
      ]);

      await expect(client`UPDATE todo_items SET project_id = NULL WHERE id = ${sourceIds.convertedTodo}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE todo_items SET project_id = NULL WHERE id = ${sourceIds.discardedTodo}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE idea_items SET project_id = NULL WHERE id = ${sourceIds.convertedIdea}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE idea_items SET project_id = NULL WHERE id = ${sourceIds.discardedIdea}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE seeds SET project_id = NULL WHERE id = ${sourceIds.convertedSeed}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE seeds SET project_id = NULL WHERE id = ${sourceIds.discardedSeed}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      expect(await sourceBytes()).toEqual(terminalSourcesBefore);
      expect(await archiveBytes()).toEqual(terminalArchivesBefore);

      const deletionOutcome = await client`DELETE FROM projects WHERE id = ${projectId}`.execute().then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      if (deletionOutcome.status === "rejected") {
        expect((deletionOutcome.reason as { code?: string }).code).not.toBe("40P01");
      }
      expect(deletionOutcome.status).toBe("fulfilled");

      const sourceRows = await client<{ source_type: string; source_id: string; project_id: string | null }[]>`
        SELECT 'todo' AS source_type, id::text AS source_id, project_id::text AS project_id FROM todo_items WHERE id IN ${client([sourceIds.convertedTodo, sourceIds.discardedTodo])}
        UNION ALL
        SELECT 'idea' AS source_type, id::text AS source_id, project_id::text AS project_id FROM idea_items WHERE id IN ${client([sourceIds.convertedIdea, sourceIds.discardedIdea])}
        UNION ALL
        SELECT 'seed' AS source_type, id::text AS source_id, project_id::text AS project_id FROM seeds WHERE id IN ${client([sourceIds.convertedSeed, sourceIds.discardedSeed])}
        ORDER BY source_type, source_id
      `;
      expect(sourceRows.map((row) => ({ sourceType: row.source_type, sourceId: row.source_id, projectId: row.project_id }))).toEqual([
        { sourceType: "idea", sourceId: sourceIds.convertedIdea, projectId: null },
        { sourceType: "idea", sourceId: sourceIds.discardedIdea, projectId: null },
        { sourceType: "seed", sourceId: sourceIds.convertedSeed, projectId: null },
        { sourceType: "seed", sourceId: sourceIds.discardedSeed, projectId: null },
        { sourceType: "todo", sourceId: sourceIds.convertedTodo, projectId: null },
        { sourceType: "todo", sourceId: sourceIds.discardedTodo, projectId: null },
      ]);
      expect(await archiveBytes()).toEqual(terminalArchivesBefore);

      await expect(client`UPDATE todo_items SET title = 'forbidden terminal todo edit' WHERE id = ${sourceIds.convertedTodo}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE idea_items SET title = 'forbidden terminal idea edit' WHERE id = ${sourceIds.discardedIdea}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE seeds SET title = 'live canonical seed edit' WHERE id = ${sourceIds.convertedSeed}`.execute()).resolves.toBeDefined();
      expect((await client<{ title: string }[]>`SELECT title FROM seeds WHERE id = ${sourceIds.convertedSeed}`)[0]?.title).toBe("live canonical seed edit");
      await expect(client`UPDATE todo_items SET workspace_id = 'w2' WHERE id = ${sourceIds.discardedTodo}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE seeds SET workspace_id = 'w2' WHERE id = ${sourceIds.discardedSeed}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      expect(await archiveBytes()).toEqual(terminalArchivesBefore);
    } finally {
      await client`DELETE FROM workspace WHERE id = ${workspaceId}`.catch(() => undefined);
      await client`DELETE FROM projects WHERE id = ${projectId}`.catch(() => undefined);
    }
  });

  it("moves one canonical pending Idea archive with project authority and rejects terminal re-transfer", async () => {
    const sourceWorkspaceId = "w-project-transfer-source";
    const targetWorkspaceId = "w-project-transfer-target";
    const duplicateWorkspaceId = "w-project-transfer-duplicate";
    const projectId = id(930);
    const convertedIdeaId = id(931);
    const discardedIdeaId = id(932);
    const ideaIds = [convertedIdeaId, discardedIdeaId];
    try {
      await client`INSERT INTO workspace (id) VALUES (${sourceWorkspaceId}), (${targetWorkspaceId}), (${duplicateWorkspaceId})`;
      await client`
        INSERT INTO member (id, workspace_id, user_id)
        VALUES
          ('m-project-transfer-source', ${sourceWorkspaceId}, 'u1'),
          ('m-project-transfer-target', ${targetWorkspaceId}, 'u1'),
          ('m-project-transfer-duplicate', ${duplicateWorkspaceId}, 'u1')
      `;
      await client`INSERT INTO projects (id, workspace_id, updated_at) VALUES (${projectId}, ${sourceWorkspaceId}, now())`;
      await client`
        INSERT INTO idea_items (id, workspace_id, project_id, title, type, status, created_at, updated_at)
        VALUES
          (${convertedIdeaId}, ${sourceWorkspaceId}, ${projectId}, 'convert after transfer', 'idea', 'active', now(), now()),
          (${discardedIdeaId}, ${sourceWorkspaceId}, ${projectId}, 'discard after transfer', 'idea', 'active', now(), now())
      `;

      const repository = createNotesRepository(drizzle(client) as never);
      const sourcePage = await repository.createPage({ workspaceId: sourceWorkspaceId, userId: "u1", title: "source-only destination" });
      const targetPage = await repository.createPage({ workspaceId: targetWorkspaceId, userId: "u1", title: "target destination" });
      const transferOutcome = await client.begin(async (transaction) => {
        const updatedProjects = await transaction.unsafe(
          "UPDATE projects SET workspace_id = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 RETURNING id",
          [targetWorkspaceId, projectId, sourceWorkspaceId],
        );
        if (updatedProjects.length === 0) return false;
        await transaction.unsafe(
          "UPDATE idea_items SET workspace_id = $1, updated_at = now() WHERE project_id = $2 AND workspace_id = $3",
          [targetWorkspaceId, projectId, sourceWorkspaceId],
        );
        return true;
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      if (transferOutcome.status === "rejected") {
        expect((transferOutcome.reason as { code?: string }).code).not.toBe("40P01");
      }
      expect(transferOutcome).toEqual({ status: "fulfilled", value: true });

      const authoritativeRows = await client<{ id: string; source_id: string; workspace_id: string; disposition: string }[]>`
        SELECT id, source_id, workspace_id, disposition
        FROM note_legacy_archive_items
        WHERE source_type = 'idea' AND source_id IN ${client(ideaIds)}
        ORDER BY source_id
      `;
      expect(authoritativeRows.map((row) => ({ sourceId: row.source_id, workspaceId: row.workspace_id, disposition: row.disposition }))).toEqual([
        { sourceId: convertedIdeaId, workspaceId: targetWorkspaceId, disposition: "pending" },
        { sourceId: discardedIdeaId, workspaceId: targetWorkspaceId, disposition: "pending" },
      ]);
      const sourceAuthority = await repository.legacy({ workspaceId: sourceWorkspaceId, userId: "u1" });
      expect(sourceAuthority.items.filter((row) => ideaIds.includes(row.sourceId))).toHaveLength(0);
      const targetAuthority = (await repository.legacy({ workspaceId: targetWorkspaceId, userId: "u1" })).items.filter((row) => ideaIds.includes(row.sourceId));
      expect(targetAuthority.map((row) => row.sourceId).sort()).toEqual([...ideaIds].sort());
      expect((await client<{ id: string; workspace_id: string }[]>`SELECT id, workspace_id FROM idea_items WHERE id IN ${client(ideaIds)} ORDER BY id`).map((row) => ({ id: row.id, workspaceId: row.workspace_id }))).toEqual([
        { id: convertedIdeaId, workspaceId: targetWorkspaceId },
        { id: discardedIdeaId, workspaceId: targetWorkspaceId },
      ]);
      expect((await client<{ workspace_id: string }[]>`SELECT workspace_id FROM projects WHERE id = ${projectId}`)[0]?.workspace_id).toBe(targetWorkspaceId);

      await expect(client`
        INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot)
        VALUES (${id(933)}, ${duplicateWorkspaceId}, 'idea', ${convertedIdeaId}, '{}')
      `.execute()).rejects.toThrow("note_legacy_archive_items_source_unique_idx");

      const convertedArchive = targetAuthority.find((row) => row.sourceId === convertedIdeaId);
      const discardedArchive = targetAuthority.find((row) => row.sourceId === discardedIdeaId);
      if (!convertedArchive || !discardedArchive) throw new Error("missing target archive authority");
      await expect(repository.convertLegacy({ workspaceId: sourceWorkspaceId, userId: "u1", archiveId: convertedArchive.id, pageId: sourcePage.id, actionId: "source-convert-denied" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");
      await expect(repository.discardLegacy({ workspaceId: sourceWorkspaceId, userId: "u1", archiveId: discardedArchive.id, actionId: "source-discard-denied" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");
      await repository.convertLegacy({ workspaceId: targetWorkspaceId, userId: "u1", archiveId: convertedArchive.id, pageId: targetPage.id, actionId: "target-convert-authority" });
      await repository.discardLegacy({ workspaceId: targetWorkspaceId, userId: "u1", archiveId: discardedArchive.id, actionId: "target-discard-authority" });

      const terminalArchiveBytes = await client<{ source_id: string; disposition: string; bytes: string }[]>`
        SELECT source_id, disposition, encode(convert_to(to_jsonb(archive_row)::text, 'UTF8'), 'hex') AS bytes
        FROM note_legacy_archive_items archive_row
        WHERE source_type = 'idea' AND source_id IN ${client(ideaIds)}
        ORDER BY source_id
      `;
      expect(terminalArchiveBytes.map((row) => ({ sourceId: row.source_id, disposition: row.disposition }))).toEqual([
        { sourceId: convertedIdeaId, disposition: "converted" },
        { sourceId: discardedIdeaId, disposition: "discarded" },
      ]);
      await expect(client`UPDATE idea_items SET workspace_id = ${sourceWorkspaceId} WHERE id = ${convertedIdeaId}`.execute()).rejects.toThrow("legacy source item has already been reviewed");
      await expect(client`UPDATE idea_items SET workspace_id = ${sourceWorkspaceId} WHERE id = ${discardedIdeaId}`.execute()).rejects.toThrow("legacy source item has already been reviewed");

      const reverseTransferOutcome = await client.begin(async (transaction) => {
        await transaction.unsafe(
          "UPDATE projects SET workspace_id = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3",
          [sourceWorkspaceId, projectId, targetWorkspaceId],
        );
        await transaction.unsafe(
          "UPDATE idea_items SET workspace_id = $1, updated_at = now() WHERE project_id = $2 AND workspace_id = $3",
          [sourceWorkspaceId, projectId, targetWorkspaceId],
        );
      }).then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      if (reverseTransferOutcome.status === "rejected") {
        expect((reverseTransferOutcome.reason as { code?: string }).code).not.toBe("40P01");
        expect(String((reverseTransferOutcome.reason as { message?: string }).message)).toContain("legacy source item has already been reviewed");
      }
      expect(reverseTransferOutcome.status).toBe("rejected");
      expect((await client<{ workspace_id: string }[]>`SELECT workspace_id FROM projects WHERE id = ${projectId}`)[0]?.workspace_id).toBe(targetWorkspaceId);
      expect((await client<{ workspace_id: string }[]>`SELECT workspace_id FROM idea_items WHERE id IN ${client(ideaIds)}`).map((row) => row.workspace_id)).toEqual([targetWorkspaceId, targetWorkspaceId]);
      const terminalArchivesAfter = await client<{ source_id: string; disposition: string; bytes: string }[]>`
        SELECT source_id, disposition, encode(convert_to(to_jsonb(archive_row)::text, 'UTF8'), 'hex') AS bytes
        FROM note_legacy_archive_items archive_row
        WHERE source_type = 'idea' AND source_id IN ${client(ideaIds)}
        ORDER BY source_id
      `;
      expect(terminalArchivesAfter.map((row) => ({ sourceId: row.source_id, disposition: row.disposition, bytes: row.bytes }))).toEqual(
        terminalArchiveBytes.map((row) => ({ sourceId: row.source_id, disposition: row.disposition, bytes: row.bytes })),
      );
    } finally {
      await client`DELETE FROM workspace WHERE id IN ${client([sourceWorkspaceId, targetWorkspaceId, duplicateWorkspaceId])}`.catch(() => undefined);
      await client`DELETE FROM projects WHERE id = ${projectId}`.catch(() => undefined);
    }
  });

  it("orders production project transfer behind atomic workspace deletion before project rows", async () => {
    const sourceWorkspaceId = "w-project-lock-source";
    const targetWorkspaceId = "w-project-lock-target";
    const projectId = id(920);
    const ideaId = id(921);
    const targetUrl = adminUrl.replace(/\/[^/]+$/, `/${databaseName}`);
    const transfer = openEphemeral(targetUrl, { max: 1 });
    const deleter = openEphemeral(targetUrl, { max: 1 });
    let deleterTransactionOpen = false;
    try {
      await client.unsafe(`
        INSERT INTO workspace (id) VALUES ('${sourceWorkspaceId}'), ('${targetWorkspaceId}');
        INSERT INTO projects (id, workspace_id, updated_at) VALUES ('${projectId}', '${sourceWorkspaceId}', now());
        INSERT INTO idea_items (id, workspace_id, project_id, title, type, status, created_at, updated_at)
          VALUES ('${ideaId}', '${sourceWorkspaceId}', '${projectId}', 'project lock graph', 'idea', 'active', now(), now());
      `);
      expect(await client`SELECT source_id FROM note_legacy_archive_items WHERE source_id = ${ideaId}`).toHaveLength(1);

      const transferPid = await connectionPid(transfer);
      await deleter`BEGIN`;
      deleterTransactionOpen = true;
      await deleter.unsafe("SET LOCAL deadlock_timeout = '100ms'");
      await deleter`SELECT pg_advisory_xact_lock(${NOTES_GLOBAL_ADVISORY_LOCK}::bigint)`;

      // This is the production transfer order: project workspace first, then
      // the bridged idea row. The project statement must wait on the global
      // lock before it can retain a project tuple lock.
      const transferOperation = transfer.begin(async (transaction) => {
        const updatedProjects = await transaction.unsafe(
          "UPDATE projects SET workspace_id = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 RETURNING id",
          [targetWorkspaceId, projectId, sourceWorkspaceId],
        );
        if (updatedProjects.length === 0) return false;
        await transaction.unsafe(
          "UPDATE idea_items SET workspace_id = $1, updated_at = now() WHERE project_id = $2 AND workspace_id = $3",
          [targetWorkspaceId, projectId, sourceWorkspaceId],
        );
        return true;
      });
      void transferOperation.then(() => undefined, () => undefined);
      await waitForOverlapParticipants([transferPid], 1);

      // Atomic organization deletion already owns the Notes global lock. Its
      // production FK graph sets projects.workspace_id NULL and cascades the
      // source idea row. With the canonical order it cannot wait on transfer.
      const deletionOutcome = await deleter`DELETE FROM workspace WHERE id = ${sourceWorkspaceId}`.execute().then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      if (deletionOutcome.status === "fulfilled") {
        await deleter`COMMIT`;
      } else {
        await deleter`ROLLBACK`;
      }
      deleterTransactionOpen = false;
      const [transferOutcome] = await Promise.allSettled([transferOperation]);

      if (deletionOutcome.status === "rejected") {
        expect((deletionOutcome.reason as { code?: string }).code).not.toBe("40P01");
      }
      if (transferOutcome.status === "rejected") {
        expect((transferOutcome.reason as { code?: string }).code).not.toBe("40P01");
      }
      expect(deletionOutcome.status).toBe("fulfilled");
      expect(transferOutcome).toEqual({ status: "fulfilled", value: false });
      expect(await client`SELECT id FROM workspace WHERE id = ${sourceWorkspaceId}`).toHaveLength(0);
      const survivingProjects = await client<{ workspace_id: string | null }[]>`SELECT workspace_id FROM projects WHERE id = ${projectId}`;
      expect(survivingProjects).toHaveLength(1);
      expect(survivingProjects[0]?.workspace_id).toBeNull();
      expect(await client`SELECT id FROM idea_items WHERE id = ${ideaId}`).toHaveLength(0);
      expect(await client`SELECT source_id FROM note_legacy_archive_items WHERE source_id = ${ideaId}`).toHaveLength(0);
      expect(await client`SELECT id FROM workspace WHERE id = ${targetWorkspaceId}`).toHaveLength(1);
    } finally {
      if (deleterTransactionOpen) try { await deleter`ROLLBACK`; } catch { /* cleanup is best effort */ }
      await client.unsafe(`DELETE FROM workspace WHERE id IN ('${sourceWorkspaceId}', '${targetWorkspaceId}')`).catch(() => undefined);
      await client.unsafe(`DELETE FROM projects WHERE id = '${projectId}'`).catch(() => undefined);
    }
  });

  it("orders uncommitted project creation and every bridged source before atomic workspace deletion", async () => {
    const workspaceId = "w-project-insert-lock";
    const memberId = "m-project-insert-lock";
    const sessionId = "s-project-insert-lock";
    const projectId = id(940);
    const todoId = id(941);
    const ideaId = id(942);
    const seedId = id(943);
    const targetUrl = adminUrl.replace(/\/[^/]+$/, `/${databaseName}`);
    const creator = openEphemeral(targetUrl, { max: 1 });
    const deleter = openEphemeral(targetUrl, { max: 1 });
    let releaseSources: (() => void) | undefined;
    let creationOperation: Promise<unknown> | undefined;
    let deletionOperation: Promise<unknown> | undefined;
    try {
      await client.unsafe(`
        INSERT INTO workspace (id) VALUES ('${workspaceId}');
        INSERT INTO member (id, workspace_id, user_id, role) VALUES ('${memberId}', '${workspaceId}', 'u1', 'owner');
        INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id)
          VALUES ('${sessionId}', now() + interval '1 day', 'token-${sessionId}', now(), now(), 'u1', '${workspaceId}');
      `);
      const creatorPid = await connectionPid(creator);
      const deleterPid = await connectionPid(deleter);

      let markProjectInserted!: () => void;
      const projectInserted = new Promise<void>((resolve) => { markProjectInserted = resolve; });
      const sourceGate = new Promise<void>((resolve) => { releaseSources = resolve; });
      creationOperation = creator.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL deadlock_timeout = '100ms'");
        await transaction.unsafe(
          "INSERT INTO projects (id, workspace_id, updated_at) VALUES ($1, $2, now())",
          [projectId, workspaceId],
        );
        markProjectInserted();
        await sourceGate;
        await transaction.unsafe(
          "INSERT INTO todo_items (id, workspace_id, project_id, title, created_at, updated_at) VALUES ($1, $2, $3, 'new project todo', now(), now())",
          [todoId, workspaceId, projectId],
        );
        await transaction.unsafe(
          "INSERT INTO idea_items (id, workspace_id, project_id, title, type, status, created_at, updated_at) VALUES ($1, $2, $3, 'new project idea', 'idea', 'active', now(), now())",
          [ideaId, workspaceId, projectId],
        );
        await transaction.unsafe(
          "INSERT INTO seeds (id, workspace_id, project_id, title, status, source, maturity_level, created_at, updated_at) VALUES ($1, $2, $3, 'new project seed', 'active', 'manual', 1, now(), now())",
          [seedId, workspaceId, projectId],
        );
        const archiveRows = await transaction.unsafe(
          "SELECT source_id FROM note_legacy_archive_items WHERE source_id IN ($1, $2, $3) ORDER BY source_id",
          [todoId, ideaId, seedId],
        );
        return { projectId, sourceIds: [todoId, ideaId, seedId], archiveSourceIds: archiveRows.map((row) => row.source_id) };
      });
      void creationOperation.catch(() => undefined);
      await Promise.race([
        projectInserted,
        creationOperation.then(
          () => { throw new Error("project creation settled before the source gate"); },
          (reason) => Promise.reject(reason),
        ),
      ]);

      // Mirror deleteOrganizationAtomically's production sequence: global
      // lock, membership row, workspace row, session cleanup, then parent delete.
      deletionOperation = deleter.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL deadlock_timeout = '100ms'");
        await transaction.unsafe("SELECT pg_advisory_xact_lock($1::bigint)", [NOTES_GLOBAL_ADVISORY_LOCK]);
        const memberships = await transaction.unsafe(
          "SELECT id FROM member WHERE workspace_id = $1 AND user_id = 'u1' FOR UPDATE",
          [workspaceId],
        );
        if (memberships.length !== 1) throw new Error("missing deletion membership");
        const workspaces = await transaction.unsafe("SELECT id FROM workspace WHERE id = $1 FOR UPDATE", [workspaceId]);
        if (workspaces.length !== 1) throw new Error("missing deletion workspace");
        await transaction.unsafe("UPDATE session SET active_workspace_id = NULL WHERE active_workspace_id = $1", [workspaceId]);
        const deleted = await transaction.unsafe("DELETE FROM workspace WHERE id = $1 RETURNING id", [workspaceId]);
        return { membershipId: memberships[0]?.id, deletedWorkspaceId: deleted[0]?.id };
      });
      void deletionOperation.catch(() => undefined);

      const observedPhase = await waitForProjectMutationDeletionPhase(creatorPid, deleterPid);
      releaseSources?.();
      const [creationOutcome, deletionOutcome] = await Promise.allSettled([creationOperation, deletionOperation]);
      for (const outcome of [creationOutcome, deletionOutcome]) {
        if (outcome.status === "rejected") expect((outcome.reason as { code?: string }).code).not.toBe("40P01");
      }
      expect(observedPhase).toBe("global-first");
      expect(creationOutcome).toEqual({ status: "fulfilled", value: { projectId, sourceIds: [todoId, ideaId, seedId], archiveSourceIds: [todoId, ideaId, seedId] } });
      expect(deletionOutcome).toEqual({ status: "fulfilled", value: { membershipId: memberId, deletedWorkspaceId: workspaceId } });

      expect(await client`SELECT id FROM workspace WHERE id = ${workspaceId}`).toHaveLength(0);
      expect(await client`SELECT id FROM member WHERE id = ${memberId}`).toHaveLength(0);
      expect((await client<{ active_workspace_id: string | null }[]>`SELECT active_workspace_id FROM session WHERE id = ${sessionId}`)[0]?.active_workspace_id).toBeNull();
      expect(await client`SELECT id FROM todo_items WHERE id = ${todoId}`).toHaveLength(0);
      expect(await client`SELECT id FROM idea_items WHERE id = ${ideaId}`).toHaveLength(0);
      expect(await client`SELECT id FROM seeds WHERE id = ${seedId}`).toHaveLength(0);
      expect(await client`SELECT source_id FROM note_legacy_archive_items WHERE source_id IN (${todoId}, ${ideaId}, ${seedId})`).toHaveLength(0);
      expect((await client<{ workspace_id: string | null }[]>`SELECT workspace_id FROM projects WHERE id = ${projectId}`).map((row) => ({ workspaceId: row.workspace_id }))).toEqual([{ workspaceId: null }]);
    } finally {
      releaseSources?.();
      await Promise.allSettled([creationOperation, deletionOperation].filter((operation): operation is Promise<unknown> => operation !== undefined));
      await client`DELETE FROM session WHERE id = ${sessionId}`.catch(() => undefined);
      await client`DELETE FROM workspace WHERE id = ${workspaceId}`.catch(() => undefined);
      await client`DELETE FROM projects WHERE id = ${projectId}`.catch(() => undefined);
    }
  });

  it("orders uncommitted project content updates and every bridged source before atomic workspace deletion", async () => {
    const workspaceId = "w-project-update-lock";
    const memberId = "m-project-update-lock";
    const sessionId = "s-project-update-lock";
    const projectId = id(944);
    const todoId = id(945);
    const ideaId = id(946);
    const seedId = id(947);
    const targetUrl = adminUrl.replace(/\/[^/]+$/, `/${databaseName}`);
    const updater = openEphemeral(targetUrl, { max: 1 });
    const deleter = openEphemeral(targetUrl, { max: 1 });
    let releaseSources: (() => void) | undefined;
    let updateOperation: Promise<unknown> | undefined;
    let deletionOperation: Promise<unknown> | undefined;
    try {
      await client.unsafe(`
        INSERT INTO workspace (id) VALUES ('${workspaceId}');
        INSERT INTO member (id, workspace_id, user_id, role) VALUES ('${memberId}', '${workspaceId}', 'u1', 'owner');
        INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id)
          VALUES ('${sessionId}', now() + interval '1 day', 'token-${sessionId}', now(), now(), 'u1', '${workspaceId}');
        INSERT INTO projects (id, workspace_id, updated_at) VALUES ('${projectId}', '${workspaceId}', now());
      `);
      const updaterPid = await connectionPid(updater);
      const deleterPid = await connectionPid(deleter);

      let markProjectUpdated!: () => void;
      const projectUpdated = new Promise<void>((resolve) => { markProjectUpdated = resolve; });
      const sourceGate = new Promise<void>((resolve) => { releaseSources = resolve; });
      updateOperation = updater.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL deadlock_timeout = '100ms'");
        const updatedProjects = await transaction.unsafe(
          "UPDATE projects SET description = 'updated project content', updated_at = updated_at + interval '1 second' WHERE id = $1 RETURNING id, workspace_id, description",
          [projectId],
        );
        markProjectUpdated();
        await sourceGate;
        await transaction.unsafe(
          "INSERT INTO todo_items (id, workspace_id, project_id, title, created_at, updated_at) VALUES ($1, $2, $3, 'updated project todo', now(), now())",
          [todoId, workspaceId, projectId],
        );
        await transaction.unsafe(
          "INSERT INTO idea_items (id, workspace_id, project_id, title, type, status, created_at, updated_at) VALUES ($1, $2, $3, 'updated project idea', 'idea', 'active', now(), now())",
          [ideaId, workspaceId, projectId],
        );
        await transaction.unsafe(
          "INSERT INTO seeds (id, workspace_id, project_id, title, status, source, maturity_level, created_at, updated_at) VALUES ($1, $2, $3, 'updated project seed', 'active', 'manual', 1, now(), now())",
          [seedId, workspaceId, projectId],
        );
        const archiveRows = await transaction.unsafe(
          "SELECT source_id FROM note_legacy_archive_items WHERE source_id IN ($1, $2, $3) ORDER BY source_id",
          [todoId, ideaId, seedId],
        );
        return {
          updatedProjects: updatedProjects.map((row) => ({ id: row.id, workspaceId: row.workspace_id, description: row.description })),
          sourceIds: [todoId, ideaId, seedId],
          archiveSourceIds: archiveRows.map((row) => row.source_id),
        };
      });
      void updateOperation.catch(() => undefined);
      await Promise.race([
        projectUpdated,
        updateOperation.then(
          () => { throw new Error("project update settled before the source gate"); },
          (reason) => Promise.reject(reason),
        ),
      ]);

      // Mirror deleteOrganizationAtomically's production sequence: global
      // lock, membership row, workspace row, session cleanup, then parent delete.
      deletionOperation = deleter.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL deadlock_timeout = '100ms'");
        await transaction.unsafe("SELECT pg_advisory_xact_lock($1::bigint)", [NOTES_GLOBAL_ADVISORY_LOCK]);
        const memberships = await transaction.unsafe(
          "SELECT id FROM member WHERE workspace_id = $1 AND user_id = 'u1' FOR UPDATE",
          [workspaceId],
        );
        if (memberships.length !== 1) throw new Error("missing deletion membership");
        const workspaces = await transaction.unsafe("SELECT id FROM workspace WHERE id = $1 FOR UPDATE", [workspaceId]);
        if (workspaces.length !== 1) throw new Error("missing deletion workspace");
        await transaction.unsafe("UPDATE session SET active_workspace_id = NULL WHERE active_workspace_id = $1", [workspaceId]);
        const deleted = await transaction.unsafe("DELETE FROM workspace WHERE id = $1 RETURNING id", [workspaceId]);
        return { membershipId: memberships[0]?.id, deletedWorkspaceId: deleted[0]?.id };
      });
      void deletionOperation.catch(() => undefined);

      const observedPhase = await waitForProjectMutationDeletionPhase(updaterPid, deleterPid);
      releaseSources?.();
      const [updateOutcome, deletionOutcome] = await Promise.allSettled([updateOperation, deletionOperation]);
      for (const outcome of [updateOutcome, deletionOutcome]) {
        if (outcome.status === "rejected") expect((outcome.reason as { code?: string }).code).not.toBe("40P01");
      }
      expect(observedPhase).toBe("global-first");
      expect(updateOutcome).toEqual({
        status: "fulfilled",
        value: {
          updatedProjects: [{ id: projectId, workspaceId, description: "updated project content" }],
          sourceIds: [todoId, ideaId, seedId],
          archiveSourceIds: [todoId, ideaId, seedId],
        },
      });
      expect(deletionOutcome).toEqual({ status: "fulfilled", value: { membershipId: memberId, deletedWorkspaceId: workspaceId } });

      expect(await client`SELECT id FROM workspace WHERE id = ${workspaceId}`).toHaveLength(0);
      expect(await client`SELECT id FROM member WHERE id = ${memberId}`).toHaveLength(0);
      expect((await client<{ active_workspace_id: string | null }[]>`SELECT active_workspace_id FROM session WHERE id = ${sessionId}`)[0]?.active_workspace_id).toBeNull();
      expect(await client`SELECT id FROM todo_items WHERE id = ${todoId}`).toHaveLength(0);
      expect(await client`SELECT id FROM idea_items WHERE id = ${ideaId}`).toHaveLength(0);
      expect(await client`SELECT id FROM seeds WHERE id = ${seedId}`).toHaveLength(0);
      expect(await client`SELECT source_id FROM note_legacy_archive_items WHERE source_id IN (${todoId}, ${ideaId}, ${seedId})`).toHaveLength(0);
      expect((await client<{ id: string; workspace_id: string | null; description: string | null }[]>`SELECT id, workspace_id, description FROM projects WHERE id = ${projectId}`).map((row) => ({ id: row.id, workspaceId: row.workspace_id, description: row.description }))).toEqual([{ id: projectId, workspaceId: null, description: "updated project content" }]);
    } finally {
      releaseSources?.();
      await Promise.allSettled([updateOperation, deletionOperation].filter((operation): operation is Promise<unknown> => operation !== undefined));
      await client`DELETE FROM session WHERE id = ${sessionId}`.catch(() => undefined);
      await client`DELETE FROM workspace WHERE id = ${workspaceId}`.catch(() => undefined);
      await client`DELETE FROM projects WHERE id = ${projectId}`.catch(() => undefined);
    }
  });

  it("orders an uncommitted exact-key workspace update and every bridged source before atomic workspace deletion", async () => {
    const workspaceId = "w-workspace-update-lock";
    const memberId = "m-workspace-update-lock";
    const sessionId = "s-workspace-update-lock";
    const todoId = id(948);
    const ideaId = id(949);
    const seedId = id(950);
    const exactWorkspaceLockQuery = `SELECT id FROM workspace WHERE id = '${workspaceId}' FOR UPDATE`;
    const targetUrl = adminUrl.replace(/\/[^/]+$/, `/${databaseName}`);
    const writer = openEphemeral(targetUrl, { max: 1 });
    const deleter = openEphemeral(targetUrl, { max: 1 });
    let releaseSources: (() => void) | undefined;
    let writeOperation: Promise<unknown> | undefined;
    let deletionOperation: Promise<unknown> | undefined;
    try {
      await client.unsafe(`
        INSERT INTO workspace (id, name) VALUES ('${workspaceId}', 'original workspace');
        INSERT INTO member (id, workspace_id, user_id, role) VALUES ('${memberId}', '${workspaceId}', 'u1', 'owner');
        INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id)
          VALUES ('${sessionId}', now() + interval '1 day', 'token-${sessionId}', now(), now(), 'u1', '${workspaceId}');
      `);
      const writerPid = await connectionPid(writer);
      const deleterPid = await connectionPid(deleter);

      let markWorkspaceUpdated!: () => void;
      const workspaceUpdated = new Promise<void>((resolve) => { markWorkspaceUpdated = resolve; });
      const sourceGate = new Promise<void>((resolve) => { releaseSources = resolve; });
      writeOperation = writer.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL deadlock_timeout = '100ms'");
        const updatedWorkspaces = await transaction.unsafe(
          "UPDATE workspace SET name = 'updated workspace content' WHERE id = $1 RETURNING id, name",
          [workspaceId],
        );
        markWorkspaceUpdated();
        await sourceGate;
        await transaction.unsafe(
          "INSERT INTO todo_items (id, workspace_id, title, created_at, updated_at) VALUES ($1, $2, 'workspace update todo', now(), now())",
          [todoId, workspaceId],
        );
        await transaction.unsafe(
          "INSERT INTO idea_items (id, workspace_id, title, type, status, created_at, updated_at) VALUES ($1, $2, 'workspace update idea', 'idea', 'active', now(), now())",
          [ideaId, workspaceId],
        );
        await transaction.unsafe(
          "INSERT INTO seeds (id, workspace_id, title, status, source, maturity_level, created_at, updated_at) VALUES ($1, $2, 'workspace update seed', 'active', 'manual', 1, now(), now())",
          [seedId, workspaceId],
        );
        const archiveRows = await transaction.unsafe(
          "SELECT source_id FROM note_legacy_archive_items WHERE source_id IN ($1, $2, $3) ORDER BY source_id",
          [todoId, ideaId, seedId],
        );
        return {
          updatedWorkspaces: updatedWorkspaces.map((row) => ({ id: row.id, name: row.name })),
          sourceIds: [todoId, ideaId, seedId],
          archiveSourceIds: archiveRows.map((row) => row.source_id),
        };
      });
      void writeOperation.catch(() => undefined);
      await Promise.race([
        workspaceUpdated,
        writeOperation.then(
          () => { throw new Error("workspace update settled before the source gate"); },
          (reason) => Promise.reject(reason),
        ),
      ]);

      // Mirror deleteOrganizationAtomically and keep the exact workspace-key
      // SELECT visible in pg_stat_activity so the RED row wait is unambiguous.
      deletionOperation = deleter.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL deadlock_timeout = '100ms'");
        await transaction.unsafe("SELECT pg_advisory_xact_lock($1::bigint)", [NOTES_GLOBAL_ADVISORY_LOCK]);
        const memberships = await transaction.unsafe(
          "SELECT id FROM member WHERE workspace_id = $1 AND user_id = 'u1' FOR UPDATE",
          [workspaceId],
        );
        if (memberships.length !== 1) throw new Error("missing deletion membership");
        const workspaces = await transaction.unsafe(exactWorkspaceLockQuery);
        if (workspaces.length !== 1) throw new Error("missing deletion workspace");
        await transaction.unsafe("UPDATE session SET active_workspace_id = NULL WHERE active_workspace_id = $1", [workspaceId]);
        const deleted = await transaction.unsafe("DELETE FROM workspace WHERE id = $1 RETURNING id", [workspaceId]);
        return { membershipId: memberships[0]?.id, deletedWorkspaceId: deleted[0]?.id };
      });
      void deletionOperation.catch(() => undefined);

      const observedPhase = await waitForWorkspaceMutationDeletionPhase(writerPid, deleterPid, exactWorkspaceLockQuery);
      releaseSources?.();
      const [writeOutcome, deletionOutcome] = await Promise.allSettled([writeOperation, deletionOperation]);
      for (const outcome of [writeOutcome, deletionOutcome]) {
        if (outcome.status === "rejected") expect((outcome.reason as { code?: string }).code).not.toBe("40P01");
      }
      expect(observedPhase).toBe("global-first");
      expect(writeOutcome).toEqual({
        status: "fulfilled",
        value: {
          updatedWorkspaces: [{ id: workspaceId, name: "updated workspace content" }],
          sourceIds: [todoId, ideaId, seedId],
          archiveSourceIds: [todoId, ideaId, seedId],
        },
      });
      expect(deletionOutcome).toEqual({ status: "fulfilled", value: { membershipId: memberId, deletedWorkspaceId: workspaceId } });

      expect(await client`SELECT id FROM workspace WHERE id = ${workspaceId}`).toHaveLength(0);
      expect(await client`SELECT id FROM member WHERE id = ${memberId}`).toHaveLength(0);
      expect((await client<{ active_workspace_id: string | null }[]>`SELECT active_workspace_id FROM session WHERE id = ${sessionId}`)[0]?.active_workspace_id).toBeNull();
      expect(await client`SELECT id FROM todo_items WHERE id = ${todoId}`).toHaveLength(0);
      expect(await client`SELECT id FROM idea_items WHERE id = ${ideaId}`).toHaveLength(0);
      expect(await client`SELECT id FROM seeds WHERE id = ${seedId}`).toHaveLength(0);
      expect(await client`SELECT source_id FROM note_legacy_archive_items WHERE source_id IN (${todoId}, ${ideaId}, ${seedId})`).toHaveLength(0);
    } finally {
      releaseSources?.();
      await Promise.allSettled([writeOperation, deletionOperation].filter((operation): operation is Promise<unknown> => operation !== undefined));
      await client`DELETE FROM session WHERE id = ${sessionId}`.catch(() => undefined);
      await client`DELETE FROM workspace WHERE id = ${workspaceId}`.catch(() => undefined);
    }
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
    await overlapController?.end({ timeout: 5 });
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
  });

  afterEach(async () => {
    // A failed rendezvous/assertion must not leak an open transaction or the
    // global advisory lock into the next contract. Closing a postgres-js
    // connection rolls back active work, while these explicit cleanup calls
    // make the intent and advisory release deterministic.
    try { await overlapController?.unsafe("SELECT pg_advisory_unlock_all()"); } catch { /* connection may already be closed */ }
    for (const connection of ephemeralConnections) {
      try { await connection.unsafe("ROLLBACK"); } catch { /* connection may already be closed */ }
      try { await connection.unsafe("SELECT pg_advisory_unlock_all()"); } catch { /* connection may already be closed */ }
      try { await connection.end({ timeout: 5 }); } catch { /* connection may already be closed */ }
    }
    ephemeralConnections.clear();
  });

  it("serializes same-owner daily identity races", async () => {
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const leftRepo = createNotesRepository(drizzle(left) as never);
    const rightRepo = createNotesRepository(drizzle(right) as never);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const daily = async (repo: ReturnType<typeof createNotesRepository>) => { await barrier; return repo.getOrCreateDaily({ workspaceId: "w1", userId: "u1" }, "2026-08-10"); };
    const participantPids = [await connectionPid(left), await connectionPid(right)];
    const releaseOverlap = await armOverlapBarrier(participantPids);
    const calls = [daily(leftRepo), daily(rightRepo)];
    release();
    await releaseOverlap(2);
    const results = await Promise.all(calls);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    expect(results[0]?.id).toBe(results[1]?.id);
    const rows = await client`SELECT id FROM note_pages WHERE workspace_id = 'w1' AND owner_user_id = 'u1' AND kind = 'daily' AND daily_date = '2026-08-10'`;
    expect(rows).toHaveLength(1);
  });

  it("prevents opposite concurrent hierarchy moves at the database boundary", async () => {
    const setupRepo = createNotesRepository(drizzle(client) as never);
    const first = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "first" });
    const second = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "second" });
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const leftRepo = createNotesRepository(drizzle(left) as never);
    const rightRepo = createNotesRepository(drizzle(right) as never);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const releaseOverlap = await armOverlapBarrier([await connectionPid(left), await connectionPid(right)]);
    const moveCalls = [
      (async () => { await barrier; return leftRepo.reparent({ workspaceId: "w1", userId: "u1", pageId: first.id, parentId: second.id, expectedStateVersion: first.stateVersion }); })(),
      (async () => { await barrier; return rightRepo.reparent({ workspaceId: "w1", userId: "u1", pageId: second.id, parentId: first.id, expectedStateVersion: second.stateVersion }); })(),
    ];
    release();
    await releaseOverlap(2);
    const moves = await Promise.allSettled(moveCalls);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    const rejected = moves.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason?.message ?? rejected[0]?.reason)).toContain("NOTE_PAGE_CYCLE");
  });

  it("keeps mixed page writers deadlock-free under the global Notes lock order", async () => {
    const setupRepo = createNotesRepository(drizzle(client) as never);
    const page = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "mixed" });
    const secondPage = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "mixed-share" });
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const leftRepo = createNotesRepository(drizzle(left) as never);
    const rightRepo = createNotesRepository(drizzle(right) as never);
    const releaseOverlap = await armOverlapBarrier([await connectionPid(left), await connectionPid(right)]);
    const update = leftRepo.updatePage({ workspaceId: "w1", userId: "u1", pageId: page.id, expectedStateVersion: page.stateVersion, title: "updated" });
    const share = rightRepo.setShare({ workspaceId: "w1", userId: "u1", pageId: secondPage.id, sharedWithUserId: "u1", role: "viewer" });
    await releaseOverlap(2);
    await Promise.all([update, share]);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    const rows = await client`SELECT title FROM note_pages WHERE id = ${page.id}`;
    expect(rows[0]?.title).toBe("updated");
  });

  it("keeps raw page DML and repository writers deadlock-free", async () => {
    const setupRepo = createNotesRepository(drizzle(client) as never);
    const first = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-one" });
    const second = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-two" });
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const repo = createNotesRepository(drizzle(left) as never);
    const participantPids = [await connectionPid(left), await connectionPid(right)];
    const releaseOverlap = await armOverlapBarrier(participantPids);
    const rawWrite = right.begin(async (transaction) => {
      return transaction.unsafe(`UPDATE note_pages SET title = 'raw' WHERE id = '${second.id}' AND workspace_id = 'w1'`);
    });
    await waitForOverlapParticipants([participantPids[1]!], 1);
    const repositoryWrite = new Promise<unknown>((resolve, reject) => setTimeout(() => repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: first.id, expectedStateVersion: first.stateVersion, title: "repository" }).then(resolve, reject), 0));
    await releaseOverlap(2);
    await Promise.all([repositoryWrite, rawWrite]);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    const rows = await client`SELECT id, title FROM note_pages WHERE id IN (${first.id}, ${second.id}) ORDER BY id`;
    expect(rows.map((row) => row.title).sort()).toEqual(["raw", "repository"]);
  });

  it("serializes raw share/checklist/link inserts with a repository page writer", async () => {
    const setupRepo = createNotesRepository(drizzle(client) as never);
    const source = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-source" });
    const target = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-target" });
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const repo = createNotesRepository(drizzle(left) as never);
    const participantPids = [await connectionPid(left), await connectionPid(right)];
    const releaseOverlap = await armOverlapBarrier(participantPids);
    const rawWrite = right.begin(async (transaction) => {
      await transaction.unsafe(`INSERT INTO note_page_shares (page_id, workspace_id, actor_user_id, shared_with_user_id, role, actor_kind) VALUES ('${target.id}', 'w1', 'u1', 'u1', 'viewer', 'user')`);
      await transaction.unsafe(`INSERT INTO note_checklist_items (page_id, workspace_id, ordinal, text, checked, updated_by_kind, updated_by_user_id) VALUES ('${target.id}', 'w1', 0, 'raw item', false, 'user', 'u1')`);
      return transaction.unsafe(`INSERT INTO note_page_links (workspace_id, source_page_id, target_page_id, ordinal, anchor_text) VALUES ('w1', '${source.id}', '${target.id}', 0, 'raw link')`);
    });
    await waitForOverlapParticipants([participantPids[1]!], 1);
    const repositoryWrite = new Promise<unknown>((resolve, reject) => setTimeout(() => repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: target.id, expectedStateVersion: target.stateVersion, title: "repository writer" }).then(resolve, reject), 0));
    await releaseOverlap(2);
    await Promise.all([rawWrite, repositoryWrite]);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    expect((await client`SELECT role FROM note_page_shares WHERE page_id = ${target.id} AND shared_with_user_id = 'u1'`)).toHaveLength(1);
    expect((await client`SELECT text FROM note_checklist_items WHERE page_id = ${target.id}`).map((row) => row.text)).toEqual(["raw item"]);
    expect((await client`SELECT anchor_text FROM note_page_links WHERE source_page_id = ${source.id}`).map((row) => row.anchor_text)).toEqual(["raw link"]);
  });

  it("serializes internal link targets under the global Notes lock", async () => {
    const setupRepo = createNotesRepository(drizzle(client) as never);
    const source = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "link-source" });
    const target = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "link-target" });
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const repo = createNotesRepository(drizzle(left) as never);
    const participantPids = [await connectionPid(left), await connectionPid(right)];
    const releaseOverlap = await armOverlapBarrier(participantPids);
    const targetLock = right.begin(async (transaction) => {
      return transaction.unsafe(`UPDATE note_pages SET title = title WHERE id = '${target.id}' AND workspace_id = 'w1'`);
    });
    await waitForOverlapParticipants([participantPids[1]!], 1);
    const lexicalJson = { root: { type: "root", version: 1, children: [{ type: "paragraph", children: [{ type: "link", url: `note://${target.id}`, children: [{ type: "text", text: "target" }] }] }] } };
    const sourceWrite = new Promise<unknown>((resolve, reject) => setTimeout(() => repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: source.id, expectedStateVersion: source.stateVersion, lexicalJson }).then(resolve, reject), 0));
    await releaseOverlap(2);
    await Promise.all([targetLock, sourceWrite]);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    const links = await client`SELECT target_page_id, anchor_text FROM note_page_links WHERE source_page_id = ${source.id}`;
    expect(links.map((row) => ({ target_page_id: row.target_page_id, anchor_text: row.anchor_text }))).toEqual([{ target_page_id: target.id, anchor_text: "target" }]);
  });

  it("serializes raw reparent, link-retarget, and legacy conversion under the real global lock", async () => {
    const setupRepo = createNotesRepository(drizzle(client) as never);
    const root = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-root" });
    const child = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-child" });
    const source = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-link-source" });
    const target = await setupRepo.createPage({ workspaceId: "w1", userId: "u1", title: "raw-link-target" });
    await setupRepo.updatePage({ workspaceId: "w1", userId: "u1", pageId: source.id, expectedStateVersion: source.stateVersion, lexicalJson: { root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: `note://${target.id}`, children: [{ type: "text", text: "target" }] }] }] } } });
    const archiveId = id(990);
    await client.unsafe(`INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot) VALUES ('${archiveId}', 'w1', 'todo', 'raw-conversion', '{}')`);
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const repo = createNotesRepository(drizzle(left) as never);
    const participantPids = [await connectionPid(left), await connectionPid(right)];
    const releaseOverlap = await armOverlapBarrier(participantPids);
    const rawWrite = right.begin(async (transaction) => {
      await transaction.unsafe(`UPDATE note_pages SET parent_id = '${root.id}' WHERE id = '${child.id}' AND workspace_id = 'w1'`);
      await transaction.unsafe(`UPDATE note_page_links SET target_page_id = '${root.id}' WHERE source_page_id = '${source.id}' AND target_page_id = '${target.id}'`);
      return transaction.unsafe(`UPDATE note_legacy_archive_items SET disposition = 'converted', converted_page_id = '${target.id}', converted_action_id = 'raw-action-990', disposition_at = now(), disposition_by_kind = 'user', disposition_by_user_id = 'u1' WHERE id = '${archiveId}' AND workspace_id = 'w1'`);
    });
    await waitForOverlapParticipants([participantPids[1]!], 1);
    const repositoryWrite = repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: root.id, expectedStateVersion: root.stateVersion, title: "root-updated" });
    await releaseOverlap(2);
    await Promise.all([rawWrite, repositoryWrite]);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    expect((await client`SELECT parent_id FROM note_pages WHERE id = ${child.id}`)[0]?.parent_id).toBe(root.id);
    expect((await client`SELECT target_page_id FROM note_page_links WHERE source_page_id = ${source.id}`)[0]?.target_page_id).toBe(root.id);
    expect((await client`SELECT disposition FROM note_legacy_archive_items WHERE id = ${archiveId}`)[0]?.disposition).toBe("converted");
  });

  it("does not deadlock owner offboarding against workspace cascade", async () => {
    const setupRepo = createNotesRepository(drizzle(client) as never);
    await setupRepo.createPage({ workspaceId: "w2", userId: "u1", title: "cascade-owner" });
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const participantPids = [await connectionPid(left), await connectionPid(right)];
    const releaseOverlap = await armOverlapBarrier(participantPids);
    const memberDelete = left`DELETE FROM member WHERE workspace_id = 'w2' AND user_id = 'u1'`;
    const workspaceDelete = right`DELETE FROM workspace WHERE id = 'w2'`;
    void memberDelete.then(() => undefined, () => undefined);
    void workspaceDelete.then(() => undefined, () => undefined);
    await releaseOverlap(2);
    const outcome = await Promise.allSettled([memberDelete, workspaceDelete]);
    expect(outcome[1]?.status).toBe("fulfilled");
    if (outcome[0]?.status === "rejected") expect(outcome[0].reason?.message).toContain("NOTE_OWNER_OFFBOARDING_BLOCKED");
    for (const result of outcome) if (result.status === "rejected") expect(result.reason?.code).not.toBe("40P01");
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
    expect((await client`SELECT 1 FROM workspace WHERE id = 'w2'`)).toHaveLength(0);
    expect((await client`SELECT 1 FROM member WHERE workspace_id = 'w2'`)).toHaveLength(0);
    expect((await client`SELECT 1 FROM note_pages WHERE workspace_id = 'w2'`)).toHaveLength(0);
  });

  it("allows agent job status updates to coexist with agent-authored Notes creation", async () => {
    const agentJobId = id(995);
    await client.unsafe(`INSERT INTO "workspace" (id) VALUES ('w3'); INSERT INTO "user" (id) VALUES ('u3'); INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m3', 'w3', 'u3'); INSERT INTO "agent_jobs" (id, workspace_id, status) VALUES ('${agentJobId}', 'w3', 'pending')`);
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const repo = createNotesRepository(drizzle(right) as never);
    const holderPid = await connectionPid(left);
    const notesPid = await connectionPid(right);
    await left`BEGIN`;
    await left`SELECT id FROM agent_jobs WHERE id = ${agentJobId} FOR UPDATE`;
    const create = repo.createPage({ workspaceId: "w3", userId: "u3", actorKind: "agent", agentJobId, title: "agent status race" });
    await waitForNotesRowEdge(notesPid, holderPid);
    const statusUpdate = left`UPDATE agent_jobs SET status = 'running' WHERE id = ${agentJobId}`;
    const statusResult = await Promise.allSettled([statusUpdate]);
    await left`COMMIT`;
    const createResult = await Promise.allSettled([create]);
    const outcomes = [...statusResult, ...createResult];
    for (const outcome of outcomes) if (outcome.status === "rejected") expect((outcome.reason as { code?: string })?.code).not.toBe("40P01");
    expect((await client`SELECT status FROM agent_jobs WHERE id = ${agentJobId}`)[0]?.status).toBe("running");
    expect((await client`SELECT title FROM note_pages WHERE workspace_id = 'w3' AND title = 'agent status race'`)).toHaveLength(1);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
  });

  it("allows a FOR UPDATE member role/status change to coexist with user Notes creation", async () => {
    await client.unsafe(`INSERT INTO "workspace" (id) VALUES ('w5'); INSERT INTO "user" (id) VALUES ('u5'); INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m5', 'w5', 'u5')`);
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const repo = createNotesRepository(drizzle(right) as never);
    const holderPid = await connectionPid(left);
    const notesPid = await connectionPid(right);
    await left`BEGIN`;
    await left`SELECT id FROM "user" WHERE id = 'u5' FOR UPDATE`;
    await left`SELECT id FROM member WHERE id = 'm5' FOR UPDATE`;
    const create = repo.createPage({ workspaceId: "w5", userId: "u5", title: "member role race" });
    await waitForNotesRowEdge(notesPid, holderPid);
    const roleUpdate = left`UPDATE member SET role = 'admin' WHERE id = 'm5'`;
    const roleResult = await Promise.allSettled([roleUpdate]);
    await left`COMMIT`;
    const createResult = await Promise.allSettled([create]);
    const outcomes = [...roleResult, ...createResult];
    for (const outcome of outcomes) if (outcome.status === "rejected") expect((outcome.reason as { code?: string })?.code).not.toBe("40P01");
    expect((await client`SELECT role FROM member WHERE id = 'm5'`)[0]?.role).toBe("admin");
    expect((await client`SELECT title FROM note_pages WHERE workspace_id = 'w5' AND title = 'member role race'`)).toHaveLength(1);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
  });

  it("proves production user deletion cascades memberships but blocks Notes owners", async () => {
    await client.unsafe(`
      INSERT INTO "workspace" (id) VALUES ('w6'), ('w7');
      INSERT INTO "user" (id) VALUES ('u6'), ('u7');
      INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m6', 'w6', 'u6'), ('m7', 'w7', 'u7');
    `);
    await client`DELETE FROM "user" WHERE id = 'u6'`;
    expect((await client`SELECT 1 FROM member WHERE id = 'm6'`)).toHaveLength(0);
    expect((await client`SELECT 1 FROM "user" WHERE id = 'u6'`)).toHaveLength(0);

    const repo = createNotesRepository(drizzle(client) as never);
    const ownerPage = await repo.createPage({ workspaceId: "w7", userId: "u7", title: "owner deletion guard" });
    let deletionError: unknown;
    try {
      await client`DELETE FROM "user" WHERE id = 'u7'`;
    } catch (error) {
      deletionError = error;
    }
    expect(deletionError).toBeDefined();
    expect(String((deletionError as { message?: string })?.message ?? deletionError)).toContain("NOTE_OWNER_OFFBOARDING_BLOCKED");
    expect((await client`SELECT id FROM "user" WHERE id = 'u7'`)).toHaveLength(1);
    expect((await client`SELECT id FROM member WHERE id = 'm7'`)).toHaveLength(1);
    expect((await client`SELECT id FROM note_pages WHERE id = ${ownerPage.id}`)).toHaveLength(1);
  });

  it("observes global-lock and user-row wait phases for unreferenced user cascade", async () => {
    await client.unsafe(`INSERT INTO "workspace" (id) VALUES ('w9'); INSERT INTO "user" (id) VALUES ('u9'); INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m9', 'w9', 'u9')`);
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const holderPid = await connectionPid(left);
    const notesPid = await connectionPid(right);
    await left`BEGIN`;
    await left`SELECT id FROM "user" WHERE id = 'u9' FOR UPDATE`;
    const deletion = right`DELETE FROM "user" WHERE id = 'u9'`;
    void deletion.then(() => undefined, () => undefined);
    await waitForNotesRowEdge(notesPid, holderPid);
    await left`COMMIT`;
    const result = await Promise.allSettled([deletion]);
    expect(result[0]?.status).toBe("fulfilled");
    expect((await client`SELECT 1 FROM "user" WHERE id = 'u9'`)).toHaveLength(0);
    expect((await client`SELECT 1 FROM member WHERE id = 'm9'`)).toHaveLength(0);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
  });

  it("blocks deletion of users retained only by Notes audit fields", async () => {
    const pageId = id(996);
    await client.unsafe(`
      INSERT INTO "workspace" (id) VALUES ('w8');
      INSERT INTO "user" (id) VALUES ('u8');
      INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m8', 'w8', 'u1'), ('m8-audit', 'w8', 'u8');
      INSERT INTO note_pages (id, workspace_id, owner_user_id, created_by_kind, updated_by_kind, created_by_user_id, updated_by_user_id, search_vector)
      VALUES ('${pageId}', 'w8', 'u1', 'user', 'user', 'u8', 'u8', to_tsvector('simple', 'audit retention'));
    `);
    let deletionError: unknown;
    try {
      await client`DELETE FROM "user" WHERE id = 'u8'`;
    } catch (error) {
      deletionError = error;
    }
    expect(String((deletionError as { message?: string })?.message ?? deletionError)).toContain("NOTE_USER_AUDIT_RETENTION_BLOCKED");
    expect((await client`SELECT id FROM "user" WHERE id = 'u8'`)).toHaveLength(1);
    expect((await client`SELECT id FROM member WHERE id = 'm8-audit'`)).toHaveLength(1);
    expect((await client`SELECT created_by_user_id, updated_by_user_id FROM note_pages WHERE id = ${pageId}`).map((row) => ({ created_by_user_id: row.created_by_user_id, updated_by_user_id: row.updated_by_user_id }))).toEqual([{ created_by_user_id: "u8", updated_by_user_id: "u8" }]);
  });

  it("allows recipient-only user deletion and cascades their shares", async () => {
    await client.unsafe(`INSERT INTO "workspace" (id) VALUES ('w10'); INSERT INTO "user" (id) VALUES ('u10'); INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m10-owner', 'w10', 'u1'), ('m10-recipient', 'w10', 'u10')`);
    const repo = createNotesRepository(drizzle(client) as never);
    const page = await repo.createPage({ workspaceId: "w10", userId: "u1", title: "recipient share" });
    await repo.setShare({ workspaceId: "w10", userId: "u1", pageId: page.id, sharedWithUserId: "u10", role: "viewer" });
    await client`DELETE FROM "user" WHERE id = 'u10'`;
    expect((await client`SELECT 1 FROM "user" WHERE id = 'u10'`)).toHaveLength(0);
    expect((await client`SELECT 1 FROM member WHERE id = 'm10-recipient'`)).toHaveLength(0);
    expect((await client`SELECT 1 FROM note_page_shares WHERE page_id = ${page.id} AND shared_with_user_id = 'u10'`)).toHaveLength(0);
  });

  it("bounds every collection summary before 100 independent near-1MiB pages leave PostgreSQL", async () => {
    const targetPageId = id(13_000);
    await client.unsafe(`
      INSERT INTO "workspace" (id) VALUES ('w13');
      INSERT INTO "user" (id) VALUES ('u13');
      INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m13', 'w13', 'u13');
      INSERT INTO note_pages (
        id, workspace_id, owner_user_id, title, visibility,
        created_by_kind, updated_by_kind, created_by_user_id, updated_by_user_id,
        search_vector
      ) VALUES (
        '${targetPageId}', 'w13', 'u13', 'Backlink target', 'private',
        'user', 'user', 'u13', 'u13', to_tsvector('simple', 'backlink target')
      );

      INSERT INTO note_pages (
        id, workspace_id, owner_user_id, kind, daily_date, title, visibility,
        plaintext_projection, created_by_kind, updated_by_kind,
        created_by_user_id, updated_by_user_id, search_vector
      )
      SELECT
        ('70000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        'w13',
        'u13',
        'daily',
        DATE '2020-01-01' + (series - 1),
        'needle-' || series || repeat(' 🧱', 32768),
        'private',
        repeat(' 📝', 32768),
        'user',
        'user',
        'u13',
        'u13',
        to_tsvector('simple', 'needle')
      FROM generate_series(1, 100) AS series;

      INSERT INTO note_checklist_items (
        id, item_id, page_id, workspace_id, ordinal, text, checked,
        updated_by_user_id, updated_by_kind
      )
      SELECT
        ('71000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        ('71100000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        ('70000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        'w13',
        0,
        repeat('🧾', 131072),
        false,
        'u13',
        'user'
      FROM generate_series(1, 100) AS series;

      INSERT INTO note_page_links (
        id, workspace_id, source_page_id, target_page_id, ordinal, anchor_text
      )
      SELECT
        ('72000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        'w13',
        ('70000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        '${targetPageId}',
        0,
        repeat('🔗', 131072)
      FROM generate_series(1, 100) AS series;
    `);

    const repo = createNotesRepository(drizzle(client) as never);
    const actor = { workspaceId: "w13", userId: "u13" };
    const [carryover, backlinks, tree, search] = await Promise.all([
      repo.dailyCarryover({ ...actor, dailyDate: "2021-01-01" }, { limit: 100 }),
      repo.backlinks({ ...actor, pageId: targetPageId }, { limit: 100 }),
      repo.pageTree(actor, { limit: 100 }),
      repo.search(actor, "needle", { limit: 100 }),
    ]);

    expect(carryover.items).toHaveLength(100);
    expect(backlinks.items).toHaveLength(100);
    expect(tree.items).toHaveLength(100);
    expect(search.items).toHaveLength(100);
    expect(carryover.pagination).toEqual({ limit: 100, offset: 0, hasMore: false, nextOffset: null });
    expect(backlinks.pagination).toEqual({ limit: 100, offset: 0, hasMore: false, nextOffset: null });
    expect(carryover.items.every((item) => [...item.text].length <= 512 && Buffer.byteLength(item.text) <= 2048)).toBe(true);
    expect(backlinks.items.every((item) => [...item.anchorText].length <= 512 && Buffer.byteLength(item.anchorText) <= 2048)).toBe(true);
    expect(tree.items.every((item) => [...item.title].length <= 512 && Buffer.byteLength(item.title) <= 2048)).toBe(true);
    expect(search.items.every((item) => [...item.title].length <= 512 && Buffer.byteLength(item.title) <= 2048)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(carryover))).toBeLessThan(300_000);
    expect(Buffer.byteLength(JSON.stringify(backlinks))).toBeLessThan(300_000);
    expect(Buffer.byteLength(JSON.stringify(tree))).toBeLessThan(300_000);
    expect(Buffer.byteLength(JSON.stringify(search))).toBeLessThan(300_000);
  });

  it("serializes workspace cascade with agent-authored Notes creation under the exact global lock", async () => {
    const agentJobId = id(997);
    await client.unsafe(`INSERT INTO "workspace" (id) VALUES ('w4'); INSERT INTO "user" (id) VALUES ('u4'); INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m4', 'w4', 'u4'); INSERT INTO "agent_jobs" (id, workspace_id, status) VALUES ('${agentJobId}', 'w4', 'pending'); INSERT INTO note_pages (id, workspace_id, owner_user_id, created_by_kind, updated_by_kind, created_by_user_id, updated_by_user_id, created_by_agent_job_id, updated_by_agent_job_id, search_vector) VALUES ('${id(998)}', 'w4', 'u4', 'agent', 'agent', 'u4', 'u4', '${agentJobId}', '${agentJobId}', to_tsvector('simple', 'agent cascade')); INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot, disposition, converted_page_id, converted_action_id, disposition_at, disposition_by_kind, disposition_by_user_id, disposition_by_agent_job_id) VALUES ('${id(999)}', 'w4', 'todo', 'cascade-legacy', '{}', 'converted', '${id(998)}', 'cascade-action', now(), 'agent', 'u4', '${agentJobId}')`);
    const left = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const right = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const repo = createNotesRepository(drizzle(right) as never);
    const participantPids = [await connectionPid(left), await connectionPid(right)];
    const releaseOverlap = await armOverlapBarrier(participantPids);
    const workspaceDelete = left`DELETE FROM workspace WHERE id = 'w4'`;
    void workspaceDelete.then(() => undefined, () => undefined);
    const create = repo.createPage({ workspaceId: "w4", userId: "u4", actorKind: "agent", agentJobId, title: "cascade race" });
    await releaseOverlap(2);
    const outcomes = await Promise.allSettled([workspaceDelete, create]);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect((outcome.reason as { code?: string; message?: string })?.code).not.toBe("40P01");
    expect(outcomes[0]?.status).toBe("fulfilled");
    expect((await client`SELECT workspace_id FROM agent_jobs WHERE id = ${agentJobId}`)[0]?.workspace_id).toBeNull();
    expect((await client`SELECT 1 FROM note_pages WHERE workspace_id = 'w4'`)).toHaveLength(0);
    expect((await client`SELECT 1 FROM note_legacy_archive_items WHERE workspace_id = 'w4'`)).toHaveLength(0);
    await left.end({ timeout: 5 });
    await right.end({ timeout: 5 });
  });

  it("serializes session active-workspace updates with organization deletion", async () => {
    await client.unsafe(`INSERT INTO "workspace" (id) VALUES ('w11'); INSERT INTO "user" (id) VALUES ('u11'); INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m11', 'w11', 'u11'); INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id) VALUES ('s11', now() + interval '1 day', 'token-s11', now(), now(), 'u11', 'w11')`);
    const deleter = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const writer = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    let committed = false;
    try {
      const deleterPid = await connectionPid(deleter);
      const writerPid = await connectionPid(writer);
      await deleter`BEGIN`;
      await deleter`SELECT pg_advisory_xact_lock(${NOTES_GLOBAL_ADVISORY_LOCK}::bigint)`;
      await deleter`DELETE FROM workspace WHERE id = 'w11'`;
      const update = writer`UPDATE session SET active_workspace_id = 'w11' WHERE id = 's11'`;
      void update.then(() => undefined, () => undefined);
      await waitForTransactionEdge(writerPid, deleterPid);
      await deleter`COMMIT`;
      committed = true;
      const outcome = await Promise.allSettled([update]);
      expect(outcome[0]?.status).toBe("rejected");
      if (outcome[0]?.status === "rejected") {
        expect(outcome[0].reason?.code).toBe("23503");
        expect(outcome[0].reason?.code).not.toBe("40P01");
      }
      expect((await client`SELECT active_workspace_id FROM session WHERE id = 's11'`)[0]?.active_workspace_id).toBeNull();
      expect((await client`SELECT 1 FROM workspace WHERE id = 'w11'`)).toHaveLength(0);
      expect((await client`SELECT 1 FROM workspace WHERE id = 'w1'`)).toHaveLength(1);
    } finally {
      if (!committed) try { await deleter`ROLLBACK`; } catch { /* transaction already failed */ }
      try { await deleter.end({ timeout: 5 }); } catch { /* cleanup is idempotent */ }
      try { await writer.end({ timeout: 5 }); } catch { /* cleanup is idempotent */ }
    }
  });

  it("rejects session inserts targeting an organization deleted concurrently", async () => {
    await client.unsafe(`INSERT INTO "workspace" (id) VALUES ('w12'); INSERT INTO "user" (id) VALUES ('u12'); INSERT INTO "member" (id, workspace_id, user_id) VALUES ('m12', 'w12', 'u12')`);
    const deleter = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    const writer = openEphemeral(adminUrl.replace(/\/[^/]+$/, `/${databaseName}`), { max: 1 });
    let committed = false;
    try {
      const deleterPid = await connectionPid(deleter);
      const writerPid = await connectionPid(writer);
      await deleter`BEGIN`;
      await deleter`SELECT pg_advisory_xact_lock(${NOTES_GLOBAL_ADVISORY_LOCK}::bigint)`;
      await deleter`DELETE FROM workspace WHERE id = 'w12'`;
      const insert = writer`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id) VALUES ('s12', now() + interval '1 day', 'token-s12', now(), now(), 'u12', 'w12')`;
      void insert.then(() => undefined, () => undefined);
      await waitForTransactionEdge(writerPid, deleterPid);
      await deleter`COMMIT`;
      committed = true;
      const outcome = await Promise.allSettled([insert]);
      expect(outcome[0]?.status).toBe("rejected");
      if (outcome[0]?.status === "rejected") {
        expect(outcome[0].reason?.code).toBe("23503");
        expect(outcome[0].reason?.code).not.toBe("40P01");
      }
      expect((await client`SELECT 1 FROM session WHERE id = 's12'`)).toHaveLength(0);
      expect((await client`SELECT 1 FROM workspace WHERE id = 'w12'`)).toHaveLength(0);
      expect((await client`SELECT 1 FROM workspace WHERE id = 'w1'`)).toHaveLength(1);
    } finally {
      if (!committed) try { await deleter`ROLLBACK`; } catch { /* transaction already failed */ }
      try { await deleter.end({ timeout: 5 }); } catch { /* cleanup is idempotent */ }
      try { await writer.end({ timeout: 5 }); } catch { /* cleanup is idempotent */ }
    }
  });

});
