import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(import.meta.dir, "../../../migrations/0228_entered_done_retention.sql");
const schemaPath = resolve(import.meta.dir, "../../schema/work-items.ts");
const snapshotPath = resolve(import.meta.dir, "../../../migrations/meta/0228_snapshot.json");
const previousSnapshotPath = resolve(import.meta.dir, "../../../migrations/meta/0226_snapshot.json");

const read = (path: string) => readFileSync(path, "utf8");

describe("entered Done retention migration", () => {
  test("declares the internal entered_done_at column and active partial index", () => {
    const migration = read(migrationPath);
    expect(migration).toContain('ADD COLUMN "entered_done_at" timestamp with time zone');
    expect(migration).toMatch(/CREATE INDEX .*entered_done.*ON "work_items"/);
    expect(migration).toMatch(/WHERE "archived_at" IS NULL/);
  });

  test("installs database-owned transition triggers and updated_at backfill", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION set_work_item_entered_done_at");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION sync_work_item_done_clock");
    expect(migration).toContain("CREATE TRIGGER work_items_entered_done_at_trigger");
    expect(migration).toContain("CREATE TRIGGER board_columns_done_clock_trigger");
    expect(migration).toContain('IF NEW."board_column_id" IS NULL THEN');
    expect(migration).toMatch(/SET "entered_done_at" = wi\."updated_at"/);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION guard_work_item_parent_archival");
    expect(migration).toContain("CREATE TRIGGER work_items_parent_archive_guard");
  });

  test("keeps the Drizzle schema aligned with the persisted column", () => {
    const schema = read(schemaPath);
    expect(schema).toContain('enteredDoneAt: timestamp("entered_done_at"');
    expect(schema).toContain("work_items_entered_done_at_active_idx");
  });

  test("records the schema delta so a subsequent generation is empty", () => {
    const snapshot = JSON.parse(read(snapshotPath)) as {
      id: string;
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, unknown> }>;
    };
    const previous = JSON.parse(read(previousSnapshotPath)) as { id: string };
    const workItems = snapshot.tables["public.work_items"];
    const migration = read(migrationPath);

    expect(snapshot.prevId).toBe(previous.id);
    expect(workItems.columns.entered_done_at).toEqual({
      name: "entered_done_at",
      type: "timestamp with time zone",
      primaryKey: false,
      notNull: false,
    });
    expect(workItems.indexes.work_items_entered_done_at_active_idx).toEqual(
      expect.objectContaining({
        name: "work_items_entered_done_at_active_idx",
        where: '"work_items"."archived_at" IS NULL',
      })
    );
    expect(migration.match(/ADD COLUMN "entered_done_at"/g)).toHaveLength(1);
    expect(migration.match(/CREATE INDEX "work_items_entered_done_at_active_idx"/g)).toHaveLength(1);
    expect(existsSync(resolve(import.meta.dir, "../../../migrations/0229_snapshot.json"))).toBe(false);
  });

  test("prevents parent archival with active descendants and active children under archived parents", () => {
    const migration = read(migrationPath);
    expect(migration).toContain('FOR SHARE');
    expect(migration).not.toContain('FOR KEY SHARE');
    expect(migration).toContain('child."parent_id" = NEW."id"');
    expect(migration).toContain('child."archived_at" IS NULL');
    expect(migration).toContain('cannot archive work item');
    expect(migration).toContain('cannot attach active child to archived work item');
  });
});
