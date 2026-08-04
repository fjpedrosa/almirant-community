import { afterEach, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const migrationSql = await Bun.file(
  new URL("../../../migrations/0227_canonical_development_board_workflow.sql", import.meta.url),
).text();
const migrationJournal = await Bun.file(
  new URL("../../../migrations/meta/_journal.json", import.meta.url),
).json() as { entries: Array<{ idx: number; tag: string }> };
const dbs: PGlite[] = [];

const createDb = async () => {
  const db = new PGlite();
  await db.waitReady;
  dbs.push(db);
  await db.exec(`
    CREATE TYPE column_role AS ENUM ('backlog','todo','in_progress','review','testing','needs_fix','validating','release','to_document','done','other');
    CREATE TYPE board_area AS ENUM ('desarrollo','ventas','prospeccion','marketing','general');
    CREATE TABLE boards (id uuid PRIMARY KEY, workspace_id text NOT NULL, name text NOT NULL, area board_area NOT NULL);
    CREATE TABLE board_columns (
      id uuid PRIMARY KEY, board_id uuid NOT NULL REFERENCES boards(id), name text NOT NULL,
      color text NOT NULL, "order" integer NOT NULL, role column_role NOT NULL, is_done boolean NOT NULL
    );
    CREATE TABLE work_items (
      id uuid PRIMARY KEY, board_id uuid NOT NULL REFERENCES boards(id), board_column_id uuid,
      metadata jsonb, updated_at timestamptz NOT NULL
    );
    CREATE TABLE work_item_events (
      id uuid PRIMARY KEY, work_item_id uuid NOT NULL, field_name text, old_value text, new_value text, metadata jsonb
    );
    CREATE TABLE scheduled_agent_configs (id uuid PRIMARY KEY, target_config jsonb NOT NULL);
    CREATE TABLE board_templates (id uuid PRIMARY KEY, area board_area NOT NULL, columns jsonb NOT NULL);
  `);
  return db;
};
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

afterEach(async () => { await Promise.all(dbs.splice(0).map((db) => db.close())); });

describe("migration 0227 canonical development workflow", () => {
  it("uses the reserved-safe migration identity", () => {
    const canonicalEntryIndex = migrationJournal.entries.findIndex(
      (entry) => entry.tag === "0227_canonical_development_board_workflow",
    );
    const canonicalEntry = migrationJournal.entries[canonicalEntryIndex];
    const previousEntry = migrationJournal.entries[canonicalEntryIndex - 1];
    expect(canonicalEntryIndex).toBe(migrationJournal.entries.length - 1);
    expect(canonicalEntry?.idx).toBe(227);
    expect(previousEntry?.idx).toBe(226);
    expect(canonicalEntry?.idx).toBeGreaterThan(previousEntry?.idx ?? -1);
    expect(migrationJournal.entries.some((entry) => entry.tag === "0255_canonical_development_board_workflow")).toBe(false);
  });

  it("freezes original rows and gives canonical roles precedence", () => {
    const sourceTable = migrationSql.indexOf("CREATE TEMP TABLE development_board_source");
    const firstColumnMutation = migrationSql.indexOf("UPDATE board_columns");
    const classification = migrationSql.slice(sourceTable, migrationSql.indexOf("CREATE TEMP TABLE development_board_column_map"));
    expect(sourceTable).toBeGreaterThan(-1);
    expect(sourceTable).toBeLessThan(firstColumnMutation);
    expect(migrationSql).toContain("FROM development_board_source source");
    expect(classification).toContain("WHEN bc.role::text IN ('backlog', 'todo', 'in_progress', 'review', 'validating', 'release', 'done')");
    expect(classification.indexOf("WHEN bc.role::text IN")).toBeLessThan(
      classification.indexOf("WHEN lower(trim(bc.name))"),
    );
  });

  it("normalizes only desarrollo boards, remaps dependants, preserves metadata and is idempotent", async () => {
    const db = await createDb();
    await db.exec(`
      INSERT INTO boards VALUES ('${u(1)}','ws-a','dev','desarrollo'), ('${u(2)}','ws-b','sales','ventas');
      INSERT INTO board_columns VALUES
        ('${u(11)}','${u(1)}','Backlog','#000000',0,'backlog',false),
        ('${u(12)}','${u(1)}','To Do','#000000',1,'todo',false),
        ('${u(13)}','${u(1)}','In Progress','#000000',2,'in_progress',false),
        ('${u(14)}','${u(1)}','Needs Fix','#000000',3,'needs_fix',false),
        ('${u(15)}','${u(1)}','Reviewing','#000000',4,'review',false),
        ('${u(16)}','${u(1)}','Testing','#000000',5,'testing',false),
        ('${u(17)}','${u(1)}','Release','#000000',6,'release',false),
        ('${u(18)}','${u(1)}','Done','#000000',7,'done',false),
        ('${u(21)}','${u(2)}','Custom','#123456',0,'other',false);
      INSERT INTO work_items VALUES
        ('${u(31)}','${u(1)}','${u(14)}','{}', '2024-01-01T00:00:00Z'),
        ('${u(32)}','${u(1)}','${u(16)}','{}', '2024-01-01T00:00:00Z');
      INSERT INTO work_item_events VALUES
        ('${u(41)}','${u(31)}','boardColumnId','${u(14)}','${u(13)}');
      INSERT INTO scheduled_agent_configs VALUES
        ('${u(51)}','{"columnIds":["${u(14)}","other-column"]}');
      INSERT INTO board_templates VALUES ('${u(61)}','desarrollo','[]'), ('${u(62)}','ventas','[{"name":"Custom"}]');
    `);

    await db.exec(migrationSql);
    const { rows: columns } = await db.query<{ name: string; role: string; order: number; is_done: boolean }>(`SELECT name,role,"order",is_done FROM board_columns WHERE board_id='${u(1)}' ORDER BY "order"`);
    expect(columns).toEqual([
      { name: "Backlog", role: "backlog", order: 0, is_done: false },
      { name: "To Do", role: "todo", order: 1, is_done: false },
      { name: "In Progress", role: "in_progress", order: 2, is_done: false },
      { name: "To Review", role: "review", order: 3, is_done: false },
      { name: "Validating", role: "validating", order: 4, is_done: false },
      { name: "To Release", role: "release", order: 5, is_done: false },
      { name: "Done", role: "done", order: 6, is_done: true },
    ]);
    const { rows: itemRows } = await db.query<{ board_column_id: string; metadata: Record<string, unknown>; updated_at: string }>(`SELECT board_column_id,metadata,updated_at FROM work_items ORDER BY id`);
    expect(itemRows[0]?.board_column_id).toBe(u(13));
    expect(itemRows[0]?.metadata.lastValidationResult).toBe("fail");
    expect(itemRows[1]?.board_column_id).toBe(u(16));
    expect(new Date(itemRows[1]!.updated_at).toISOString()).toBe("2024-01-01T00:00:00.000Z");
    const { rows: eventRows } = await db.query<{ old_value: string }>(`SELECT old_value FROM work_item_events`);
    expect(eventRows[0]?.old_value).toBe(u(13));
    const { rows: configRows } = await db.query<{ target_config: { columnIds: string[] } }>(`SELECT target_config FROM scheduled_agent_configs`);
    expect(configRows[0]?.target_config.columnIds).toEqual([u(13), "other-column"]);
    const { rows: otherBoard } = await db.query(`SELECT name,role FROM board_columns WHERE board_id='${u(2)}'`);
    expect(otherBoard).toEqual([{ name: "Custom", role: "other" }]);

    await db.exec(migrationSql);
    const { rows: second } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM board_columns WHERE board_id='${u(1)}'`);
    expect(second[0]?.count).toBe(7);
  });

  it("rolls back when a desarrollo board has an unknown column", async () => {
    const db = await createDb();
    await db.exec(`
      INSERT INTO boards VALUES ('${u(70)}','ws','dev','desarrollo');
      INSERT INTO board_columns VALUES ('${u(71)}','${u(70)}','Mystery','#000000',0,'other',false);
    `);
    await expect(db.exec(migrationSql)).rejects.toThrow(/Unknown column/);
    const { rows } = await db.query<{ name: string }>(`SELECT name FROM board_columns WHERE id='${u(71)}'`);
    expect(rows).toEqual([{ name: "Mystery" }]);
  });

  it("creates all seven columns for an empty desarrollo board", async () => {
    const db = await createDb();
    await db.exec(`INSERT INTO boards VALUES ('${u(80)}','ws','empty','desarrollo');`);
    await db.exec(migrationSql);
    const { rows } = await db.query<{ role: string; order: number }>(`SELECT role,"order" FROM board_columns WHERE board_id='${u(80)}' ORDER BY "order"`);
    expect(rows.map((row) => row.role)).toEqual(["backlog", "todo", "in_progress", "review", "validating", "release", "done"]);
  });
});
