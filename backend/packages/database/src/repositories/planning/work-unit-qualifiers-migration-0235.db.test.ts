import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const databaseUrl = process.env.DELIVERY_LIFECYCLE_TEST_DATABASE_URL?.trim();
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const databaseName = parsedUrl?.pathname.slice(1) ?? "";
const isDedicated = parsedUrl !== null &&
  ["127.0.0.1", "localhost"].includes(parsedUrl.hostname) &&
  databaseName.startsWith("almirant_delivery_lifecycle_test");
if (databaseUrl && !isDedicated) {
  throw new Error("DELIVERY_LIFECYCLE_TEST_DATABASE_URL must name a dedicated local almirant_delivery_lifecycle_test* database");
}
const d = isDedicated ? describe : describe.skip;
const id = (n: number) => `25100000-0000-4000-8000-${String(n).padStart(12, "0")}`;

d("migration 0235 Work Unit qualifier catalog (dedicated PostgreSQL)", () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 1 });
    await sql`DELETE FROM projects WHERE id = ${id(1)}`;
    await sql`DELETE FROM workspace WHERE id = 'work-unit-qualifier-test'`;
    await sql`INSERT INTO workspace (id, name, slug) VALUES ('work-unit-qualifier-test', 'Qualifier test', 'work-unit-qualifier-test')`;
    await sql`INSERT INTO projects (id, name, workspace_id) VALUES (${id(1)}, 'Qualifier project', 'work-unit-qualifier-test')`;
    await sql`INSERT INTO boards (id, workspace_id, name) VALUES (${id(2)}, 'work-unit-qualifier-test', 'Qualifier board')`;
    await sql`INSERT INTO board_columns (id, board_id, name) VALUES (${id(3)}, ${id(2)}, 'Backlog')`;
  });
  afterAll(async () => {
    await sql`DELETE FROM projects WHERE id = ${id(1)}`;
    await sql`DELETE FROM workspace WHERE id = 'work-unit-qualifier-test'`;
    await sql.end({ timeout: 5 });
  });

  test("keeps qualifiers nullable and board placement required", async () => {
    const columns = await sql<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'work_items'
        AND column_name = ANY(${["work_unit_size", "work_unit_size_origin", "backlog_intent", "board_column_id"]})
      ORDER BY column_name
    `;
    expect(columns.map(({ column_name, is_nullable }) => ({ column_name, is_nullable }))).toEqual([
      { column_name: "backlog_intent", is_nullable: "YES" },
      { column_name: "board_column_id", is_nullable: "NO" },
      { column_name: "work_unit_size", is_nullable: "YES" },
      { column_name: "work_unit_size_origin", is_nullable: "YES" },
    ]);
  });

  test("preserves unqualified legacy values and stores valid pairs", async () => {
    await sql`INSERT INTO work_items (id, project_id, board_id, board_column_id, title, estimated_hours, metadata) VALUES (${id(10)}, ${id(1)}, ${id(2)}, ${id(3)}, 'Legacy', 8, ${sql.json({ points: 8 })}), (${id(11)}, ${id(1)}, ${id(2)}, ${id(3)}, 'Plan WU', NULL, '{}')`;
    await sql`UPDATE work_items SET work_unit_size = 'XL', work_unit_size_origin = 'plan', backlog_intent = 'new' WHERE id = ${id(11)}`;
    const rows = await sql<Array<{ id: string; estimated_hours: number | null; metadata: unknown; work_unit_size: string | null; work_unit_size_origin: string | null; backlog_intent: string | null }>>`
      SELECT id, estimated_hours, metadata, work_unit_size, work_unit_size_origin, backlog_intent
      FROM work_items WHERE id IN (${id(10)}, ${id(11)}) ORDER BY id
    `;
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { id: id(10), estimated_hours: 8, metadata: { points: 8 }, work_unit_size: null, work_unit_size_origin: null, backlog_intent: null },
      { id: id(11), estimated_hours: null, metadata: {}, work_unit_size: "XL", work_unit_size_origin: "plan", backlog_intent: "new" },
    ]);
  });

  test("rejects invalid and partial qualifiers", async () => {
    const insert = (size: string | null, origin: string | null, intent: string | null) => sql`
      INSERT INTO work_items (project_id, board_id, board_column_id, title, work_unit_size, work_unit_size_origin, backlog_intent)
      VALUES (${id(1)}, ${id(2)}, ${id(3)}, 'Invalid', ${size}, ${origin}, ${intent})
    `.execute();
    const invalid: Array<[string | null, string | null, string | null]> = [
      ["XXL", "plan", "new"], ["M", "guess", "new"], ["M", "plan", "todo"],
      ["M", null, "new"], [null, "legacy_points", "fix"],
    ];
    for (const [size, origin, intent] of invalid) {
      await expect(insert(size, origin, intent)).rejects.toMatchObject({ code: "23514" });
    }
    await expect(insert("S", "legacy_points", "fix")).resolves.toBeDefined();
  });
});
