import { describe, expect, test } from "bun:test";

const migrations = new URL("../../../migrations/", import.meta.url);
const migrationFiles = Array.from(
  new Bun.Glob("0234_*.sql").scanSync({ cwd: migrations.pathname }),
);
const tableNames = [
  "delivery_plan_items",
  "delivery_plan_revision_dependencies",
  "delivery_plan_revision_items",
  "delivery_plan_revisions",
  "delivery_plans",
];

const readSnapshot = async (index: string) =>
  JSON.parse(
    await Bun.file(new URL(`meta/${index}_snapshot.json`, migrations)).text(),
  ) as { tables: Record<string, unknown> };

describe("migration 0234 dormant delivery Plan authority", () => {
  test("adds exactly five dormant tables without changing work_items", async () => {
    expect(migrationFiles).toEqual(["0234_delivery_plan_authority.sql"]);
    const sql = await Bun.file(new URL(migrationFiles[0]!, migrations)).text();
    const [before, after] = await Promise.all([
      readSnapshot("0233"),
      readSnapshot("0234"),
    ]);
    const addedTables = Object.keys(after.tables)
      .filter((name) => !(name in before.tables))
      .map((name) => name.replace("public.", ""))
      .sort();

    expect(addedTables).toEqual(tableNames);
    expect(after.tables["public.work_items"]).toEqual(
      before.tables["public.work_items"],
    );
    expect(sql).not.toMatch(/^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\b/im);
    expect(sql).not.toContain('ALTER TABLE "work_items"');
    expect(sql).not.toMatch(/work_unit_(?:size|size_origin)|backlog_intent/);
  });

  test("exports only the five table definitions", async () => {
    const schema = await import("../../schema/delivery-plans");
    expect(Object.keys(schema).sort()).toEqual([
      "deliveryPlanItems",
      "deliveryPlanRevisionDependencies",
      "deliveryPlanRevisionItems",
      "deliveryPlanRevisions",
      "deliveryPlans",
    ]);
  });
});
