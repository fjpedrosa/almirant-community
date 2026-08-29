import { describe, expect, test } from "bun:test";

const migrations = new URL("../../../migrations/", import.meta.url);
const readSnapshot = async (index: string) => JSON.parse(
  await Bun.file(new URL(`meta/${index}_snapshot.json`, migrations)).text(),
) as { tables: Record<string, { columns: Record<string, unknown>; checkConstraints: Record<string, { value: string }> }> };

describe("migration 0235 dormant Work Unit qualifiers", () => {
  test("adds only nullable qualifier columns and checks without backfill", async () => {
    const files = [...new Bun.Glob("0235_*.sql").scanSync({ cwd: migrations.pathname })];
    expect(files).toEqual(["0235_work_unit_qualifiers.sql"]);
    const sql = await Bun.file(new URL(files[0]!, migrations)).text();
    const [before, after] = await Promise.all([readSnapshot("0234"), readSnapshot("0235")]);
    const beforeWorkItems = before.tables["public.work_items"]!;
    const afterWorkItems = after.tables["public.work_items"]!;
    const addedColumns = Object.keys(afterWorkItems.columns)
      .filter((name) => !(name in beforeWorkItems.columns));

    expect(addedColumns).toEqual([
      "work_unit_size",
      "work_unit_size_origin",
      "backlog_intent",
    ]);
    for (const name of addedColumns) {
      expect(afterWorkItems.columns[name]).toMatchObject({ notNull: false });
    }
    expect(afterWorkItems.columns.board_column_id).toEqual(
      beforeWorkItems.columns.board_column_id,
    );
    expect(Object.keys(afterWorkItems.checkConstraints).sort()).toEqual([
      "work_items_backlog_intent_check",
      "work_items_work_unit_size_check",
      "work_items_work_unit_size_origin_check",
      "work_items_work_unit_size_pair_check",
    ]);
    expect(sql).not.toMatch(/^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\b/im);
    expect(sql).not.toMatch(/DROP NOT NULL|DROP COLUMN|estimated_hours|metadata/i);
  });
});
