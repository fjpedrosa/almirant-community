import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Consolidated migration-verification test for 0222_yielding_iron_lad.sql.
 *
 * Per the R1 ledger policy (CLOUD_DELTA.md), community regenerates its own
 * migration file instead of copying cloud's numbered files. Cloud shipped
 * this same DDL union across THREE separate migrations:
 *   - 0233_scheduled_agent_authoritative_dispatch.sql (durable occurrence
 *     identity: due_key/trigger_type/agent_job_id on scheduled_agent_runs,
 *     plus the scheduled_agent_mcp_servers backfill from the legacy inline
 *     target_config blob)
 *   - 0234_agent_output_delivery.sql (the structured-output domain: sinks,
 *     bindings, submissions, deliveries, the immutable-sink-version trigger)
 *   - 0236_rainy_polaris.sql (duplicate-guard sanitization + partial unique
 *     indexes for agent_jobs and integration_batches)
 *
 * Community's 0222 merges all three into one file (see that file's own
 * comments for the DDL correspondence). Cloud's four sibling test files
 * (scheduled-agent-dispatch-migration-0233.test.ts,
 * agent-output-migration-0234.test.ts,
 * agent-jobs-duplicate-guard-migration-0236.test.ts,
 * integration-batches-duplicate-guard-migration-0236.test.ts) each built a
 * standalone PGlite fixture scoped to their own migration file and, for the
 * 0236 pair, filtered statements by table name since 0236 bundled two
 * unrelated concerns. Filtering by table name is not reliable against 0222:
 * several statements from different concerns land in the same
 * statement-breakpoint chunk once merged (e.g. the last scheduled_agent_runs
 * index and the agent_output_sinks trigger function share one chunk), and
 * naive substring filters would also catch FK statements that merely
 * *reference* a table (e.g. agent_output_submissions' FK to agent_jobs)
 * without being "about" it. So this file uses ONE comprehensive fixture
 * covering every table 0222 touches and applies the entire migration once,
 * then asserts the union of all four cloud files' behaviors.
 */
const migrationSql = readFileSync(
  resolve(import.meta.dir, "../../../migrations/0222_yielding_iron_lad.sql"),
  "utf-8",
);

const applyMigration = async (db: PGlite): Promise<void> => {
  for (const statement of migrationSql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    await db.exec(statement);
  }
};

const databases: PGlite[] = [];

const createPreMigrationDatabase = async (): Promise<PGlite> => {
  const db = new PGlite();
  await db.waitReady;
  databases.push(db);
  await db.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY);
    CREATE TABLE workspace (id text PRIMARY KEY);
    CREATE TABLE scheduled_agent_configs (
      id uuid PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspace(id),
      target_config jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE mcp_servers (
      id uuid PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspace(id)
    );
    CREATE TABLE scheduled_agent_mcp_servers (
      agent_id uuid NOT NULL REFERENCES scheduled_agent_configs(id) ON DELETE CASCADE,
      mcp_server_id uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(agent_id, mcp_server_id)
    );
    CREATE TABLE agent_jobs (
      id uuid PRIMARY KEY,
      workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
      work_item_id text,
      job_type text,
      status text NOT NULL DEFAULT 'queued',
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      error_type varchar(255),
      error_message text,
      failed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE scheduled_agent_runs (
      id uuid PRIMARY KEY,
      config_id uuid NOT NULL REFERENCES scheduled_agent_configs(id) ON DELETE CASCADE,
      workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      status varchar(20) NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE integration_batches (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      repository_id text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      error_message text,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  return db;
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("migration 0222: durable dispatch occurrence identity (parity with cloud 0233)", () => {
  it("backfills due_key/trigger_type for legacy rows and normalizes MCP associations from the legacy inline blob", async () => {
    const db = await createPreMigrationDatabase();
    await db.exec(`
      INSERT INTO workspace (id) VALUES ('org-1'), ('org-other');
      INSERT INTO mcp_servers (id, workspace_id) VALUES
        ('11111111-1111-4111-8111-111111111111', 'org-1'),
        ('22222222-2222-4222-8222-222222222222', 'org-other');
      INSERT INTO scheduled_agent_configs (id, workspace_id, target_config)
      VALUES (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'org-1',
        '{
          "customFilters": {
            "__agentTooling": {
              "selectedMcpServerIds": [
                "11111111-1111-4111-8111-111111111111",
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222",
                "not-a-uuid"
              ]
            }
          }
        }'::jsonb
      );
      INSERT INTO scheduled_agent_runs (id, config_id, workspace_id)
      VALUES (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'org-1'
      );
    `);

    await applyMigration(db);

    const legacyRun = await db.query<{
      due_key: string;
      trigger_type: string;
      agent_job_id: string | null;
    }>(`
      SELECT due_key, trigger_type, agent_job_id
      FROM scheduled_agent_runs
      WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    `);
    expect(legacyRun.rows[0]).toEqual({
      due_key: "legacy:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      trigger_type: "legacy",
      agent_job_id: null,
    });

    const associations = await db.query<{
      agent_id: string;
      mcp_server_id: string;
    }>(`
      SELECT agent_id, mcp_server_id
      FROM scheduled_agent_mcp_servers
      ORDER BY mcp_server_id
    `);
    expect(associations.rows).toEqual([
      {
        agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mcp_server_id: "11111111-1111-4111-8111-111111111111",
      },
    ]);

    await expect(db.exec(`
      INSERT INTO scheduled_agent_runs (
        id, config_id, workspace_id, due_key, trigger_type
      ) VALUES (
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'org-1',
        'legacy:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'schedule'
      )
    `)).rejects.toThrow();

    await expect(db.exec(`
      INSERT INTO scheduled_agent_runs (id, config_id, workspace_id)
      VALUES (
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'org-1'
      )
    `)).rejects.toThrow();

    await db.exec(`
      INSERT INTO agent_jobs (id) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
      UPDATE scheduled_agent_runs
      SET agent_job_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      DELETE FROM agent_jobs WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    `);
    const unlinked = await db.query<{ agent_job_id: string | null }>(`
      SELECT agent_job_id FROM scheduled_agent_runs
      WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    `);
    expect(unlinked.rows[0]?.agent_job_id).toBeNull();
  });
});

describe("migration 0222: structured-output domain (parity with cloud 0234)", () => {
  it("creates the five durable output tables and enforces one sink/submission/delivery", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    const tables = await db.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE 'agent_output_%' OR table_name = 'scheduled_agent_output_sinks')
      ORDER BY table_name
    `);
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "agent_output_bindings",
      "agent_output_deliveries",
      "agent_output_sinks",
      "agent_output_submissions",
      "scheduled_agent_output_sinks",
    ]);

    const indexes = await db.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `);
    const indexNames = indexes.rows.map(({ indexname }) => indexname);
    expect(indexNames).toContain("scheduled_agent_output_sinks_config_uidx");
    expect(indexNames).toContain("agent_output_bindings_run_uidx");
    expect(indexNames).toContain("agent_output_submissions_job_uidx");
    expect(indexNames).toContain("agent_output_deliveries_submission_uidx");

    const triggers = await db.query<{ trigger_name: string }>(`
      SELECT trigger_name FROM information_schema.triggers
      WHERE event_object_table = 'agent_output_sinks'
    `);
    expect(triggers.rows.map(({ trigger_name }) => trigger_name)).toContain(
      "agent_output_sinks_immutable_version_trigger",
    );
  });

  it("stores only encrypted binding/header material and never a plaintext delivery URL", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    const columns = await db.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('agent_output_sinks', 'agent_output_bindings')
      ORDER BY table_name, column_name
    `);
    const names = columns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`);

    expect(names).toContain("agent_output_sinks.endpoint_origin");
    expect(names).toContain("agent_output_sinks.path_template");
    expect(names).toContain("agent_output_sinks.encrypted_headers");
    expect(names).toContain("agent_output_bindings.encrypted_binding");
    expect(names).not.toContain("agent_output_sinks.delivery_url");
    expect(names).not.toContain("agent_output_bindings.delivery_url");
    expect(names).not.toContain("agent_output_bindings.headers");
  });

  it("protects hashes, positive versions, leases and delivery state with database checks", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    const constraints = await db.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint WHERE conname LIKE 'agent_output_%' ORDER BY conname
    `);
    const names = constraints.rows.map(({ conname }) => conname);

    expect(names).toContain("agent_output_sinks_version_positive");
    expect(names).toContain("agent_output_sinks_max_payload_bytes_positive");
    expect(names).toContain("agent_output_bindings_hash_check");
    expect(names).toContain("agent_output_submissions_hash_check");
    expect(names).toContain("agent_output_deliveries_status_check");
    expect(names).toContain("agent_output_deliveries_attempts_nonnegative");
    expect(names).toContain("agent_output_deliveries_state_version_positive");
  });

  it("immutable-sink-version trigger rejects mutating an existing sink version", async () => {
    const db = await createPreMigrationDatabase();
    await db.exec(`INSERT INTO workspace (id) VALUES ('org-sink');`);
    await applyMigration(db);
    await db.exec(`
      INSERT INTO agent_output_sinks (
        id, workspace_id, name, version, endpoint_origin, payload_schema, schema_hash
      ) VALUES (
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'org-sink',
        'sink-a',
        1,
        'https://example.test',
        '{"type":"object"}'::jsonb,
        repeat('a', 64)
      );
    `);

    await expect(db.exec(`
      UPDATE agent_output_sinks
      SET endpoint_origin = 'https://changed.test'
      WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    `)).rejects.toThrow();
  });
});

describe("migration 0222: agent_jobs duplicate-active-job guard (parity with cloud 0236)", () => {
  const insertJob = (
    db: PGlite,
    row: { id: string; workItemId: string | null; jobType: string | null; status: string; createdAt: string },
  ) =>
    db.query(
      `INSERT INTO "agent_jobs" ("id", "work_item_id", "job_type", "status", "created_at")
       VALUES ($1, $2, $3, $4, $5);`,
      [row.id, row.workItemId, row.jobType, row.status, row.createdAt],
    );

  it("keeps the most-advanced active job per (work_item_id, job_type) and fails the rest", async () => {
    const db = await createPreMigrationDatabase();
    await insertJob(db, { id: "10000000-0000-4000-8000-000000000001", workItemId: "wi-1", jobType: "implementation", status: "queued", createdAt: "2026-07-01T00:00:00Z" });
    await insertJob(db, { id: "10000000-0000-4000-8000-000000000002", workItemId: "wi-1", jobType: "implementation", status: "running", createdAt: "2026-07-01T00:05:00Z" });
    await insertJob(db, { id: "10000000-0000-4000-8000-000000000003", workItemId: "wi-1", jobType: "implementation", status: "finalizing", createdAt: "2026-07-01T00:10:00Z" });

    await applyMigration(db);

    const { rows } = await db.query<{ id: string; status: string; error_type: string | null; error_message: string | null }>(`
      SELECT "id", "status", "error_type", "error_message" FROM "agent_jobs"
      WHERE "work_item_id" = 'wi-1' ORDER BY "id" ASC;
    `);
    expect(rows).toEqual([
      { id: "10000000-0000-4000-8000-000000000001", status: "failed", error_type: "duplicate_active_job_superseded", error_message: "superseded by duplicate-guard migration" },
      { id: "10000000-0000-4000-8000-000000000002", status: "failed", error_type: "duplicate_active_job_superseded", error_message: "superseded by duplicate-guard migration" },
      { id: "10000000-0000-4000-8000-000000000003", status: "finalizing", error_type: null, error_message: null },
    ]);
  });

  it("breaks status ties by keeping the oldest job", async () => {
    const db = await createPreMigrationDatabase();
    await insertJob(db, { id: "20000000-0000-4000-8000-000000000001", workItemId: "wi-2", jobType: "review", status: "queued", createdAt: "2026-07-01T00:00:00Z" });
    await insertJob(db, { id: "20000000-0000-4000-8000-000000000002", workItemId: "wi-2", jobType: "review", status: "queued", createdAt: "2026-07-01T00:01:00Z" });

    await applyMigration(db);

    const { rows } = await db.query<{ id: string; status: string }>(`
      SELECT "id", "status" FROM "agent_jobs" WHERE "work_item_id" = 'wi-2' ORDER BY "id" ASC;
    `);
    expect(rows).toEqual([
      { id: "20000000-0000-4000-8000-000000000001", status: "queued" },
      { id: "20000000-0000-4000-8000-000000000002", status: "failed" },
    ]);
  });

  it("does not touch jobs that are not duplicates: different job_type, different work item, or terminal status", async () => {
    const db = await createPreMigrationDatabase();
    await insertJob(db, { id: "30000000-0000-4000-8000-000000000001", workItemId: "wi-3", jobType: "implementation", status: "running", createdAt: "2026-07-01T00:00:00Z" });
    await insertJob(db, { id: "30000000-0000-4000-8000-000000000002", workItemId: "wi-3", jobType: "review", status: "running", createdAt: "2026-07-01T00:00:00Z" });
    await insertJob(db, { id: "30000000-0000-4000-8000-000000000003", workItemId: "wi-3", jobType: "implementation", status: "completed", createdAt: "2026-06-30T00:00:00Z" });
    await insertJob(db, { id: "30000000-0000-4000-8000-000000000004", workItemId: null, jobType: "scheduled", status: "queued", createdAt: "2026-07-01T00:00:00Z" });
    await insertJob(db, { id: "30000000-0000-4000-8000-000000000005", workItemId: null, jobType: "scheduled", status: "queued", createdAt: "2026-07-01T00:00:01Z" });

    await applyMigration(db);

    const { rows } = await db.query<{ id: string; status: string }>(`
      SELECT "id", "status" FROM "agent_jobs" ORDER BY "id" ASC;
    `);
    expect(rows).toEqual([
      { id: "30000000-0000-4000-8000-000000000001", status: "running" },
      { id: "30000000-0000-4000-8000-000000000002", status: "running" },
      { id: "30000000-0000-4000-8000-000000000003", status: "completed" },
      { id: "30000000-0000-4000-8000-000000000004", status: "queued" },
      { id: "30000000-0000-4000-8000-000000000005", status: "queued" },
    ]);
  });

  it("creates a partial unique index that rejects a second active job for the same (work_item_id, job_type)", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertJob(db, { id: "40000000-0000-4000-8000-000000000001", workItemId: "wi-4", jobType: "implementation", status: "queued", createdAt: "2026-07-01T00:00:00Z" });

    await expect(insertJob(db, { id: "40000000-0000-4000-8000-000000000002", workItemId: "wi-4", jobType: "implementation", status: "queued", createdAt: "2026-07-01T00:00:01Z" })).rejects.toThrow();
    await expect(insertJob(db, { id: "40000000-0000-4000-8000-000000000003", workItemId: "wi-4", jobType: "review", status: "queued", createdAt: "2026-07-01T00:00:02Z" })).resolves.toBeDefined();
    await expect(insertJob(db, { id: "40000000-0000-4000-8000-000000000004", workItemId: "wi-4", jobType: "implementation", status: "failed", createdAt: "2026-07-01T00:00:03Z" })).resolves.toBeDefined();
  });
});

describe("migration 0222: integration_batches duplicate-open-batch guard (parity with cloud 0236)", () => {
  const insertBatch = (
    db: PGlite,
    row: { id: string; workspaceId: string; repositoryId: string; status: string; createdAt: string },
  ) =>
    db.query(
      `INSERT INTO "integration_batches" ("id", "workspace_id", "repository_id", "status", "created_at")
       VALUES ($1, $2, $3, $4, $5);`,
      [row.id, row.workspaceId, row.repositoryId, row.status, row.createdAt],
    );

  it("keeps the most-advanced open batch per (workspace_id, repository_id) and aborts the rest", async () => {
    const db = await createPreMigrationDatabase();
    await insertBatch(db, { id: "batch-queued-early", workspaceId: "ws-1", repositoryId: "repo-1", status: "queued", createdAt: "2026-07-01T00:00:00Z" });
    await insertBatch(db, { id: "batch-running", workspaceId: "ws-1", repositoryId: "repo-1", status: "running", createdAt: "2026-07-01T00:05:00Z" });
    await insertBatch(db, { id: "batch-merging-latest", workspaceId: "ws-1", repositoryId: "repo-1", status: "merging", createdAt: "2026-07-01T00:10:00Z" });

    await applyMigration(db);

    const { rows } = await db.query<{ id: string; status: string; error_message: string | null }>(`
      SELECT "id", "status", "error_message" FROM "integration_batches"
      WHERE "repository_id" = 'repo-1' ORDER BY "id" ASC;
    `);
    expect(rows).toEqual([
      { id: "batch-merging-latest", status: "merging", error_message: null },
      { id: "batch-queued-early", status: "aborted", error_message: "superseded by duplicate-guard migration" },
      { id: "batch-running", status: "aborted", error_message: "superseded by duplicate-guard migration" },
    ]);
  });

  it("breaks status ties by keeping the oldest batch", async () => {
    const db = await createPreMigrationDatabase();
    await insertBatch(db, { id: "batch-queued-oldest", workspaceId: "ws-2", repositoryId: "repo-2", status: "queued", createdAt: "2026-07-01T00:00:00Z" });
    await insertBatch(db, { id: "batch-queued-newest", workspaceId: "ws-2", repositoryId: "repo-2", status: "queued", createdAt: "2026-07-01T00:01:00Z" });

    await applyMigration(db);

    const { rows } = await db.query<{ id: string; status: string }>(`
      SELECT "id", "status" FROM "integration_batches" WHERE "repository_id" = 'repo-2' ORDER BY "id" ASC;
    `);
    expect(rows).toEqual([
      { id: "batch-queued-newest", status: "aborted" },
      { id: "batch-queued-oldest", status: "queued" },
    ]);
  });

  it("does not touch batches that are not duplicates: different repository, different workspace, or terminal status", async () => {
    const db = await createPreMigrationDatabase();
    await insertBatch(db, { id: "batch-repo-a", workspaceId: "ws-3", repositoryId: "repo-a", status: "running", createdAt: "2026-07-01T00:00:00Z" });
    await insertBatch(db, { id: "batch-repo-b", workspaceId: "ws-3", repositoryId: "repo-b", status: "running", createdAt: "2026-07-01T00:00:00Z" });
    await insertBatch(db, { id: "batch-other-workspace", workspaceId: "ws-4", repositoryId: "repo-a", status: "running", createdAt: "2026-07-01T00:00:00Z" });
    await insertBatch(db, { id: "batch-completed", workspaceId: "ws-3", repositoryId: "repo-a", status: "completed", createdAt: "2026-06-30T00:00:00Z" });

    await applyMigration(db);

    const { rows } = await db.query<{ id: string; status: string }>(`
      SELECT "id", "status" FROM "integration_batches" ORDER BY "id" ASC;
    `);
    expect(rows).toEqual([
      { id: "batch-completed", status: "completed" },
      { id: "batch-other-workspace", status: "running" },
      { id: "batch-repo-a", status: "running" },
      { id: "batch-repo-b", status: "running" },
    ]);
  });

  it("creates a partial unique index that rejects a second open batch for the same (workspace_id, repository_id)", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertBatch(db, { id: "batch-a", workspaceId: "ws-5", repositoryId: "repo-5", status: "queued", createdAt: "2026-07-01T00:00:00Z" });

    await expect(insertBatch(db, { id: "batch-b", workspaceId: "ws-5", repositoryId: "repo-5", status: "running", createdAt: "2026-07-01T00:00:01Z" })).rejects.toThrow();
    await expect(insertBatch(db, { id: "batch-c", workspaceId: "ws-5", repositoryId: "repo-6", status: "queued", createdAt: "2026-07-01T00:00:02Z" })).resolves.toBeDefined();
  });
});

describe("migration 0222: metadata lockstep", () => {
  it("keeps journal and snapshot metadata in lockstep", async () => {
    const migrationsDir = new URL("../../../migrations/", import.meta.url);
    const journal = (await Bun.file(new URL("meta/_journal.json", migrationsDir)).json()) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.find((candidate) => candidate.idx === 222)?.tag).toBe(
      "0222_yielding_iron_lad",
    );
    expect(await Bun.file(new URL("meta/0222_snapshot.json", migrationsDir)).exists()).toBe(true);
  });
});
