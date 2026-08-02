import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Migration 0223 (community numbering; ports cloud's
// 0237_skinny_captain_britain.sql — see CLOUD_DELTA.md's R1 ledger for why
// community regenerates its own migration file instead of copying cloud's
// numbered one; this is a clean 1:1 port, no unrelated concerns bundled in)
// adds the dev-flow (issue #230/#235/#240) ownership columns to
// scheduled_agent_configs: a `managed_by` enum ('user' | 'system', default
// 'user' so every pre-existing row is untouched) and a nullable
// `builtin_automation_id` text column, plus a partial unique index
// (`scheduled_agent_configs_system_builtin_automation_uidx`) guarding at most
// one system-managed config per (project_id, builtin_automation_id) — the
// stable identity `dev-flow-provisioning.ts`'s idempotent upsert relies on.
// This is a purely additive migration (no backfill/sanitize step is needed,
// unlike migration 0236's duplicate-guard), so this test focuses on: (1) the
// default preserves existing rows as 'user'-managed, and (2) the new index's
// exact partial-match semantics.
const migrationSql = readFileSync(
  resolve(import.meta.dir, "../../../migrations/0223_sudden_shiver_man.sql"),
  "utf-8",
);

const migrationStatements = migrationSql
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const databases: PGlite[] = [];

const createPreMigrationDatabase = async (): Promise<PGlite> => {
  const db = new PGlite();
  await db.waitReady;
  databases.push(db);
  // Minimal pre-migration shape: only the columns this migration and the
  // test touch. Real `scheduled_agent_configs` has many more NOT NULL
  // columns, but they're irrelevant to what's being exercised here.
  await db.query(`
    CREATE TABLE "scheduled_agent_configs" (
      "id" text PRIMARY KEY,
      "project_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  return db;
};

const applyMigration = async (db: PGlite): Promise<void> => {
  for (const statement of migrationStatements) {
    await db.query(statement);
  }
};

const insertConfig = (
  db: PGlite,
  row: { id: string; projectId: string | null },
) =>
  db.query(
    `INSERT INTO "scheduled_agent_configs" ("id", "project_id") VALUES ($1, $2);`,
    [row.id, row.projectId],
  );

const setManagedBy = (
  db: PGlite,
  row: { id: string; managedBy: "user" | "system"; builtinAutomationId: string | null },
) =>
  db.query(
    `UPDATE "scheduled_agent_configs" SET "managed_by" = $2, "builtin_automation_id" = $3 WHERE "id" = $1;`,
    [row.id, row.managedBy, row.builtinAutomationId],
  );

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("migration 0223 scheduled_agent_configs dev-flow ownership columns", () => {
  it("defaults every pre-existing row to managed_by='user' with a null builtin_automation_id", async () => {
    const db = await createPreMigrationDatabase();
    await insertConfig(db, { id: "cfg-legacy-1", projectId: "proj-1" });

    await applyMigration(db);

    const { rows } = await db.query<{
      id: string;
      managed_by: string;
      builtin_automation_id: string | null;
    }>(`
      SELECT "id", "managed_by", "builtin_automation_id" FROM "scheduled_agent_configs" WHERE "id" = 'cfg-legacy-1';
    `);

    expect(rows).toEqual([
      { id: "cfg-legacy-1", managed_by: "user", builtin_automation_id: null },
    ]);
  });

  it("rejects a second system-managed config for the same (project_id, builtin_automation_id)", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertConfig(db, { id: "cfg-system-a", projectId: "proj-1" });
    await setManagedBy(db, {
      id: "cfg-system-a",
      managedBy: "system",
      builtinAutomationId: "backlog-drain",
    });

    await insertConfig(db, { id: "cfg-system-b", projectId: "proj-1" });
    await expect(
      setManagedBy(db, {
        id: "cfg-system-b",
        managedBy: "system",
        builtinAutomationId: "backlog-drain",
      }),
    ).rejects.toThrow();
  });

  it("allows the same builtin_automation_id across different projects", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertConfig(db, { id: "cfg-proj-1", projectId: "proj-1" });
    await setManagedBy(db, {
      id: "cfg-proj-1",
      managedBy: "system",
      builtinAutomationId: "backlog-drain",
    });

    await insertConfig(db, { id: "cfg-proj-2", projectId: "proj-2" });
    await expect(
      setManagedBy(db, {
        id: "cfg-proj-2",
        managedBy: "system",
        builtinAutomationId: "backlog-drain",
      }),
    ).resolves.toBeDefined();
  });

  it("allows any number of user-managed configs sharing the same project — the guard only applies to managed_by='system'", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertConfig(db, { id: "cfg-user-a", projectId: "proj-1" });
    await setManagedBy(db, { id: "cfg-user-a", managedBy: "user", builtinAutomationId: "backlog-drain" });

    await insertConfig(db, { id: "cfg-user-b", projectId: "proj-1" });
    await expect(
      setManagedBy(db, { id: "cfg-user-b", managedBy: "user", builtinAutomationId: "backlog-drain" }),
    ).resolves.toBeDefined();
  });

  it("allows multiple system-managed configs for the same project when builtin_automation_id differs (one row per automation)", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertConfig(db, { id: "cfg-backlog-drain", projectId: "proj-1" });
    await setManagedBy(db, {
      id: "cfg-backlog-drain",
      managedBy: "system",
      builtinAutomationId: "backlog-drain",
    });

    await insertConfig(db, { id: "cfg-dod-review", projectId: "proj-1" });
    await expect(
      setManagedBy(db, {
        id: "cfg-dod-review",
        managedBy: "system",
        builtinAutomationId: "dod-review",
      }),
    ).resolves.toBeDefined();
  });

  it("does not constrain system-managed rows with a null builtin_automation_id", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertConfig(db, { id: "cfg-system-null-a", projectId: "proj-1" });
    await setManagedBy(db, { id: "cfg-system-null-a", managedBy: "system", builtinAutomationId: null });

    await insertConfig(db, { id: "cfg-system-null-b", projectId: "proj-1" });
    await expect(
      setManagedBy(db, { id: "cfg-system-null-b", managedBy: "system", builtinAutomationId: null }),
    ).resolves.toBeDefined();
  });

  it("rejects a managed_by value outside the enum", async () => {
    const db = await createPreMigrationDatabase();
    await applyMigration(db);

    await insertConfig(db, { id: "cfg-bad-enum", projectId: "proj-1" });
    await expect(
      setManagedBy(db, {
        id: "cfg-bad-enum",
        // @ts-expect-error deliberately invalid for the enum-rejection assertion
        managedBy: "robot",
        builtinAutomationId: null,
      }),
    ).rejects.toThrow();
  });
});
