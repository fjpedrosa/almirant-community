import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const databaseUrl = process.env.DELIVERY_LIFECYCLE_TEST_DATABASE_URL?.trim();
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const databaseName = parsedUrl?.pathname.slice(1) ?? "";
const isDedicated =
  parsedUrl !== null &&
  ["127.0.0.1", "localhost"].includes(parsedUrl.hostname) &&
  databaseName.startsWith("almirant_delivery_lifecycle_test");
if (databaseUrl && !isDedicated) {
  throw new Error(
    "DELIVERY_LIFECYCLE_TEST_DATABASE_URL must name a dedicated local almirant_delivery_lifecycle_test* database",
  );
}
const d = isDedicated ? describe : describe.skip;
const tables = [
  "delivery_plan_items",
  "delivery_plan_revision_dependencies",
  "delivery_plan_revision_items",
  "delivery_plan_revisions",
  "delivery_plans",
];

d("migration 0234 delivery Plan catalog (dedicated PostgreSQL)", () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(() => {
    sql = postgres(databaseUrl!, { max: 1 });
  });
  afterEach(async () => {
    await sql`DELETE FROM projects WHERE id = '00000000-0000-4000-8000-000000000001'`;
    await sql`DELETE FROM workspace WHERE id = 'delivery-plan-test'`;
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  test("installs an empty dormant catalog while preserving board placement", async () => {
    const found = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ANY(${tables})
      ORDER BY tablename
    `;
    expect(found.map(({ tablename }) => tablename)).toEqual(tables);
    for (const table of tables) {
      const [{ count }] = await sql.unsafe<{ count: string }[]>(
        `SELECT count(*) FROM "${table}"`,
      );
      expect(Number(count)).toBe(0);
    }

    const [boardColumn] = await sql<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'work_items'
        AND column_name = 'board_column_id'
    `;
    expect(boardColumn?.is_nullable).toBe("NO");
    const workItemChecks = await sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'public.work_items'::regclass AND contype = 'c'
    `;
    expect(
      workItemChecks.some(({ definition }) =>
        /feature|task|board_column_id/i.test(definition),
      ),
    ).toBe(false);
  });

  test("enforces Plan identity, digest, projection, and same-revision graph constraints", async () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await sql`INSERT INTO workspace (id, name, slug) VALUES ('delivery-plan-test', 'Plan test', 'delivery-plan-test')`;
    await sql`INSERT INTO projects (id, name, workspace_id) VALUES (${id(1)}, 'Plan project', 'delivery-plan-test')`;
    await sql`INSERT INTO boards (id, workspace_id, name) VALUES (${id(2)}, 'delivery-plan-test', 'Plan board')`;
    await sql`INSERT INTO board_columns (id, board_id, name) VALUES (${id(3)}, ${id(2)}, 'Backlog')`;
    await sql`INSERT INTO work_items (id, project_id, board_id, board_column_id, title) VALUES (${id(4)}, ${id(1)}, ${id(2)}, ${id(3)}, 'WU1'), (${id(5)}, ${id(1)}, ${id(2)}, ${id(3)}, 'WU2'), (${id(6)}, ${id(1)}, ${id(2)}, ${id(3)}, 'Unused')`;
    await sql`INSERT INTO delivery_plans (id, workspace_id, project_id, board_id, creation_key, creation_request_sha256) VALUES (${id(10)}, 'delivery-plan-test', ${id(1)}, ${id(2)}, 'create-1', ${"a".repeat(64)})`;
    await sql`INSERT INTO delivery_plan_revisions (id, plan_id, revision_number, contract_version, content_sha256, content_json, accepted_at) VALUES (${id(11)}, ${id(10)}, 1, 1, ${"b".repeat(64)}, '{}', now()), (${id(12)}, ${id(10)}, 2, 1, ${"c".repeat(64)}, '{}', now())`;
    await sql`INSERT INTO delivery_plan_items (id, plan_id, stable_key, kind, work_item_id) VALUES (${id(20)}, ${id(10)}, 'feature', 'feature', NULL), (${id(21)}, ${id(10)}, 'wu1', 'work_unit', ${id(4)}), (${id(22)}, ${id(10)}, 'wu2', 'work_unit', ${id(5)})`;
    await sql`INSERT INTO delivery_plan_revision_items (plan_revision_id, item_id, kind, parent_feature_item_id, item_order, item_sha256, item_json) VALUES (${id(11)}, ${id(20)}, 'feature', NULL, 0, ${"d".repeat(64)}, '{}'), (${id(11)}, ${id(21)}, 'work_unit', ${id(20)}, 1, ${"e".repeat(64)}, '{}'), (${id(11)}, ${id(22)}, 'work_unit', ${id(20)}, 2, ${"f".repeat(64)}, '{}'), (${id(12)}, ${id(21)}, 'work_unit', NULL, 0, ${"e".repeat(64)}, '{}')`;
    await sql`INSERT INTO delivery_plan_revision_dependencies VALUES (${id(11)}, ${id(22)}, ${id(21)}, 0)`;

    await expect(sql`INSERT INTO delivery_plans (workspace_id, project_id, board_id, creation_key, creation_request_sha256) VALUES ('delivery-plan-test', ${id(1)}, ${id(2)}, 'create-1', ${"a".repeat(64)})`.execute()).rejects.toMatchObject({ code: "23505" });
    await expect(sql`INSERT INTO delivery_plan_revisions (plan_id, revision_number, contract_version, content_sha256, content_json, accepted_at) VALUES (${id(10)}, 3, 1, 'bad', '{}', now())`.execute()).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO delivery_plan_items (plan_id, stable_key, kind, work_item_id) VALUES (${id(10)}, 'bad-feature', 'feature', ${id(6)})`.execute()).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO delivery_plan_items (plan_id, stable_key, kind) VALUES (${id(10)}, 'bad-work-unit', 'work_unit')`.execute()).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO delivery_plan_revision_items VALUES (${id(12)}, ${id(22)}, 'work_unit', ${id(20)}, 1, ${"f".repeat(64)}, '{}')`.execute()).rejects.toMatchObject({ code: "23503" });
    await expect(sql`INSERT INTO delivery_plan_revision_dependencies VALUES (${id(12)}, ${id(21)}, ${id(22)}, 0)`.execute()).rejects.toMatchObject({ code: "23503" });
    await expect(sql`INSERT INTO work_items (project_id, board_id, board_column_id, title) VALUES (${id(1)}, ${id(2)}, NULL, 'No column')`.execute()).rejects.toMatchObject({ code: "23502" });
    await expect(sql.begin(async (tx) => {
      const txSql = tx as unknown as typeof sql;
      await txSql`INSERT INTO delivery_plans (id, workspace_id, project_id, board_id, creation_key, creation_request_sha256) VALUES (${id(30)}, 'delivery-plan-test', ${id(1)}, ${id(2)}, 'rollback', ${"a".repeat(64)})`;
      await txSql`INSERT INTO delivery_plan_revisions (plan_id, revision_number, contract_version, content_sha256, content_json, accepted_at) VALUES (${id(30)}, 1, 1, 'bad', '{}', now())`;
    })).rejects.toMatchObject({ code: "23514" });
    expect(await sql`SELECT id FROM delivery_plans WHERE id = ${id(30)}`).toHaveLength(0);
  });
});
