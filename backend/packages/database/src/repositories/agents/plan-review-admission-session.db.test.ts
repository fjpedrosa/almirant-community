import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const d = databaseUrl ? describe : describe.skip;

d("plan-review admission PostgreSQL session isolation", () => {
  let sql: ReturnType<typeof postgres>;
  const schemaName = `plan_review_session_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const sessionsTable = `"${schemaName}"."sessions"`;
  const admissionsTable = `"${schemaName}"."admissions"`;

  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 4 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`CREATE TABLE ${sessionsTable} (
      id uuid PRIMARY KEY
    )`);
    await sql.unsafe(`CREATE TABLE ${admissionsTable} (
      workspace_id text NOT NULL,
      planning_session_id uuid NOT NULL REFERENCES ${sessionsTable}(id) ON DELETE CASCADE,
      plan_sha256 varchar(64) NOT NULL,
      UNIQUE (workspace_id, planning_session_id, plan_sha256)
    )`);
  });

  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE ${admissionsTable}, ${sessionsTable}`);
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  test("permits the same plan in different planning sessions", async () => {
    const sessionIds = [crypto.randomUUID(), crypto.randomUUID()];
    await sql.unsafe(
      `INSERT INTO ${sessionsTable} (id) VALUES ${sessionIds.map((id) => `('${id}')`).join(", ")}`,
    );

    const results = await Promise.allSettled(sessionIds.map((planningSessionId) =>
      sql.unsafe(
        `INSERT INTO ${admissionsTable} (workspace_id, planning_session_id, plan_sha256) VALUES ('workspace-1', '${planningSessionId}', '${"a".repeat(64)}')`,
      ),
    ));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
  });

  test("allows only one concurrent admission for the same session and plan", async () => {
    const planningSessionId = crypto.randomUUID();
    await sql.unsafe(`INSERT INTO ${sessionsTable} (id) VALUES ('${planningSessionId}')`);

    const results = await Promise.allSettled([
      sql.unsafe(
        `INSERT INTO ${admissionsTable} (workspace_id, planning_session_id, plan_sha256) VALUES ('workspace-1', '${planningSessionId}', '${"b".repeat(64)}')`,
      ),
      sql.unsafe(
        `INSERT INTO ${admissionsTable} (workspace_id, planning_session_id, plan_sha256) VALUES ('workspace-1', '${planningSessionId}', '${"b".repeat(64)}')`,
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason.code).toBe("23505");
  });

  test("deletes linked admissions when their planning session is deleted", async () => {
    const planningSessionId = crypto.randomUUID();
    await sql.unsafe(`INSERT INTO ${sessionsTable} (id) VALUES ('${planningSessionId}')`);
    await sql.unsafe(
      `INSERT INTO ${admissionsTable} (workspace_id, planning_session_id, plan_sha256) VALUES ('workspace-1', '${planningSessionId}', '${"c".repeat(64)}')`,
    );

    await sql.unsafe(`DELETE FROM ${sessionsTable} WHERE id = '${planningSessionId}'`);
    const rows = await sql.unsafe(
      `SELECT * FROM ${admissionsTable} WHERE planning_session_id = '${planningSessionId}'`,
    );
    expect(rows).toHaveLength(0);
  });
});
