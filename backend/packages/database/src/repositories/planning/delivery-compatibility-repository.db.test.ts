import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { assertNativePlanCompatibilityReady, loadDeliveryAuthorities } from "./delivery-compatibility-repository";

const url = process.env.DELIVERY_LIFECYCLE_TEST_DATABASE_URL?.trim();
const parsed = url ? new URL(url) : null;
const safe = parsed && ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname.slice(1).startsWith("almirant_delivery_lifecycle_test");
if (url && !safe) throw new Error("DELIVERY_LIFECYCLE_TEST_DATABASE_URL must target a dedicated local test database");
const d = safe ? describe : describe.skip;
const id = (n: number) => `25300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: "authority-test", projectId: id(1), boardId: id(2) };

d("delivery compatibility (dedicated PostgreSQL 17)", () => {
  let sql: ReturnType<typeof postgres>;
  let queries = 0;
  beforeAll(async () => {
    sql = postgres(url!, { max: 1, debug: () => { queries += 1; } });
    await sql`DELETE FROM projects WHERE id IN (${id(1)}, ${id(11)}, ${id(14)})`;
    await sql`DELETE FROM workspace WHERE id IN ('authority-test', 'authority-other')`;
    await sql`INSERT INTO workspace (id, name, slug) VALUES ('authority-test', 'Authority', 'authority-test'), ('authority-other', 'Other', 'authority-other')`;
    await sql`INSERT INTO projects (id, name, workspace_id) VALUES (${id(1)}, 'Project', 'authority-test'), (${id(11)}, 'Other tenant', 'authority-other'), (${id(14)}, 'Other project', 'authority-test')`;
    await sql`INSERT INTO boards (id, workspace_id, name, area) VALUES (${id(2)}, 'authority-test', 'Development', 'desarrollo'), (${id(12)}, 'authority-other', 'Other tenant', 'desarrollo'), (${id(15)}, 'authority-test', 'Other board', 'desarrollo')`;
    await sql`INSERT INTO board_columns (id, board_id, name, role) VALUES (${id(3)}, ${id(2)}, 'Backlog', 'backlog'), (${id(13)}, ${id(12)}, 'Backlog', 'backlog'), (${id(16)}, ${id(15)}, 'Backlog', 'backlog')`;
    await sql`INSERT INTO work_items (id, project_id, board_id, board_column_id, type, title) VALUES (${id(20)}, ${id(1)}, ${id(2)}, ${id(3)}, 'epic', 'Epic'), (${id(21)}, ${id(1)}, ${id(2)}, ${id(3)}, 'feature', 'Feature'), (${id(22)}, ${id(1)}, ${id(2)}, ${id(3)}, 'story', 'Story'), (${id(23)}, ${id(1)}, ${id(2)}, ${id(3)}, 'task', 'Task'), (${id(24)}, ${id(1)}, ${id(2)}, ${id(3)}, 'idea', 'Idea'), (${id(25)}, ${id(11)}, ${id(12)}, ${id(13)}, 'idea', 'Wrong tenant'), (${id(26)}, ${id(14)}, ${id(2)}, ${id(3)}, 'story', 'Wrong project'), (${id(27)}, ${id(1)}, ${id(15)}, ${id(16)}, 'task', 'Wrong board')`;
    await sql`INSERT INTO work_items (id, project_id, board_id, board_column_id, title, work_unit_size, work_unit_size_origin, backlog_intent) VALUES (${id(30)}, ${id(1)}, ${id(2)}, ${id(3)}, 'Current', 'M', 'plan', 'new'), (${id(31)}, ${id(1)}, ${id(2)}, ${id(3)}, 'Retired', 'S', 'plan', 'fix'), (${id(32)}, ${id(11)}, ${id(12)}, ${id(13)}, 'Cross tenant', 'L', 'plan', 'new')`;
    await sql`INSERT INTO delivery_plans (id, workspace_id, project_id, board_id, creation_key, creation_request_sha256, current_revision_number) VALUES (${id(40)}, 'authority-test', ${id(1)}, ${id(2)}, 'authority', ${"a".repeat(64)}, 2)`;
    await sql`INSERT INTO delivery_plan_revisions (id, plan_id, revision_number, contract_version, content_sha256, content_json, accepted_at) VALUES (${id(41)}, ${id(40)}, 1, 1, ${"b".repeat(64)}, '{}', now()), (${id(42)}, ${id(40)}, 2, 1, ${"c".repeat(64)}, '{}', now())`;
    await sql`INSERT INTO delivery_plan_items (id, plan_id, stable_key, kind, work_item_id) VALUES (${id(50)}, ${id(40)}, 'current', 'work_unit', ${id(30)}), (${id(51)}, ${id(40)}, 'retired', 'work_unit', ${id(31)}), (${id(52)}, ${id(40)}, 'cross', 'work_unit', ${id(32)})`;
    await sql`INSERT INTO delivery_plan_revision_items (plan_revision_id, item_id, kind, item_order, item_sha256, item_json) VALUES (${id(42)}, ${id(50)}, 'work_unit', 0, ${"d".repeat(64)}, '{}'), (${id(41)}, ${id(51)}, 'work_unit', 0, ${"e".repeat(64)}, '{}'), (${id(42)}, ${id(52)}, 'work_unit', 1, ${"f".repeat(64)}, '{}')`;
  });
  afterAll(async () => {
    await sql`DELETE FROM projects WHERE id IN (${id(1)}, ${id(11)}, ${id(14)})`;
    await sql`DELETE FROM workspace WHERE id IN ('authority-test', 'authority-other')`;
    await sql.end({ timeout: 5 });
  });

  test("batches mixed authority without exposing out-of-scope starting items", async () => {
    const executor = drizzle(sql);
    queries = 0;
    const authorities = await loadDeliveryAuthorities([id(20), id(21), id(22), id(23), id(24), id(25), id(26), id(27), id(30), id(31), id(32)], scope, executor);
    expect(queries).toBe(1);
    await expect(assertNativePlanCompatibilityReady(scope, executor)).rejects.toMatchObject({ code: "incompatible_native_links", message: "incompatible_native_links" });
    await sql`DELETE FROM delivery_plan_items WHERE id = ${id(52)}`;
    queries = 0;
    await expect(assertNativePlanCompatibilityReady(scope, executor)).resolves.toBeUndefined();
    expect(queries).toBe(1);
    expect(Object.keys(authorities)).toEqual([id(20), id(21), id(22), id(23), id(24), id(30), id(31)]);
    expect(Object.values(authorities).map(({ kind }) => kind)).toEqual(["legacy", "legacy", "legacy", "legacy", "legacy", "native_work_unit", "native_retired"]);
  });

  test("fails on missing and invalid Work Unit sizes", async () => {
    const executor = drizzle(sql);
    await sql`ALTER TABLE work_items DROP CONSTRAINT work_items_work_unit_size_pair_check`;
    await sql`UPDATE work_items SET work_unit_size = NULL WHERE id = ${id(30)}`;
    await sql`ALTER TABLE work_items ADD CONSTRAINT work_items_work_unit_size_pair_check CHECK ((work_unit_size IS NULL AND work_unit_size_origin IS NULL) OR (work_unit_size IS NOT NULL AND work_unit_size_origin IS NOT NULL)) NOT VALID`;
    try { await expect(assertNativePlanCompatibilityReady(scope, executor)).rejects.toMatchObject({ code: "incompatible_native_links" }); }
    finally { await sql`UPDATE work_items SET work_unit_size = 'M' WHERE id = ${id(30)}`; await sql`ALTER TABLE work_items VALIDATE CONSTRAINT work_items_work_unit_size_pair_check`; }
    await sql`ALTER TABLE work_items DROP CONSTRAINT work_items_work_unit_size_check`;
    await sql`UPDATE work_items SET work_unit_size = 'XXL' WHERE id = ${id(30)}`;
    await sql`ALTER TABLE work_items ADD CONSTRAINT work_items_work_unit_size_check CHECK (work_unit_size IS NULL OR work_unit_size IN ('XS', 'S', 'M', 'L', 'XL')) NOT VALID`;
    try { await expect(assertNativePlanCompatibilityReady(scope, executor)).rejects.toMatchObject({ code: "incompatible_native_links" }); }
    finally { await sql`UPDATE work_items SET work_unit_size = 'M' WHERE id = ${id(30)}`; await sql`ALTER TABLE work_items VALIDATE CONSTRAINT work_items_work_unit_size_check`; }
  });

  test("rejects a same-name check on a shadow-schema table", async () => {
    const executor = drizzle(sql);
    await sql`ALTER TABLE work_items DROP CONSTRAINT work_items_backlog_intent_check`;
    await sql`CREATE SCHEMA authority_shadow`;
    await sql`CREATE TABLE authority_shadow.work_items (backlog_intent text CONSTRAINT work_items_backlog_intent_check CHECK (backlog_intent IN ('new', 'fix')))`;
    try { await expect(assertNativePlanCompatibilityReady(scope, executor)).rejects.toMatchObject({ code: "compatibility_schema_not_ready" }); }
    finally { await sql`DROP SCHEMA authority_shadow CASCADE`; await sql`ALTER TABLE work_items ADD CONSTRAINT work_items_backlog_intent_check CHECK (backlog_intent IS NULL OR backlog_intent IN ('new', 'fix'))`; }
    await expect(assertNativePlanCompatibilityReady(scope, executor)).resolves.toBeUndefined();
  });
});
