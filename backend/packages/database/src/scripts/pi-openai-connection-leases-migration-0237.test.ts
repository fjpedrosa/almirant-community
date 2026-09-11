import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../schema";
import type { NewPiOpenaiConnectionLease, PiOpenaiConnectionLease } from "../schema";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const table = "pi_openai_connection_leases";
const previousTag = "0236_delivery_plan_acceptance_receipts";
const timestamp = "timestamp with time zone";
const columns = [
  ["connection_id", "uuid", true, false],
  ["job_id", "uuid", false, false],
  ["worker_id", "text", false, false],
  ["claim_attempt_id", "text", false, false],
  ["credential_version", "timestamp (3) with time zone", false, false],
  ["expires_at", timestamp, false, false],
  ["created_at", timestamp, false, true],
  ["updated_at", timestamp, false, true],
] as const;
const identities = ["worker_id", "claim_attempt_id"] as const;
const references = [["connection_id", "provider_connections"], ["job_id", "agent_jobs"]] as const;
const indexes = [["job_id", "job_unique_idx", true], ["expires_at", "expires_at_idx", false]] as const;
const checkExpression = (column: string) =>
  `"${table}"."${column}" <> '' AND "${table}"."${column}" = btrim("${table}"."${column}")`;

function migrationFile(files = readdirSync(resolve(root, "migrations"))) {
  const matches = files.filter((name) => /^0237_.*\.sql$/.test(name));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

// Fail closed on every statement and declaration, rather than searching for
// reassuring substrings that comments, extra columns or later DDL can spoof.
function assertSql(sql: string) {
  // A generator breakpoint is valid only immediately after a statement.
  expect(sql.trim().endsWith(";")).toBe(true);
  const statements = sql.split(/;\s*(?:--> statement-breakpoint)?/)
    .map((statement) => statement.trim()).filter(Boolean);
  expect(statements).toHaveLength(7);
  const create = statements.filter((statement) => statement.startsWith(`CREATE TABLE "${table}" (`));
  expect(create).toHaveLength(1);
  expect(statements[0]).toBe(create[0]);
  const body = create[0]!.match(/^CREATE TABLE "pi_openai_connection_leases" \(\n([\s\S]*)\n\)$/);
  expect(body).not.toBeNull();
  const declarations = body![1]!.split(/,\s*\n/).map((line) => line.trim());
  expect(declarations).toHaveLength(columns.length + identities.length);
  for (const [name, type, primaryKey, defaultNow] of columns) {
    expect(declarations).toContain(
      `"${name}" ${type}${primaryKey ? " PRIMARY KEY" : ""}${defaultNow ? " DEFAULT now()" : ""} NOT NULL`,
    );
  }
  for (const column of identities) {
    expect(declarations).toContain(
      `CONSTRAINT "${table}_${column}_check" CHECK (${checkExpression(column)})`,
    );
  }
  const remaining = statements.filter((statement) => statement !== create[0]);
  expect(remaining).toContain(
    'ALTER TABLE "provider_connections" ALTER COLUMN "updated_at" SET DATA TYPE timestamp (3) with time zone',
  );
  // Drizzle reasserts the existing default when changing timestamp precision.
  expect(remaining).toContain('ALTER TABLE "provider_connections" ALTER COLUMN "updated_at" SET DEFAULT now()');
  for (const [column, target] of references) {
    expect(remaining).toContain(
      `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_${column}_${target}_id_fk" FOREIGN KEY ("${column}") REFERENCES "public"."${target}"("id") ON DELETE cascade ON UPDATE no action`,
    );
  }
  for (const [column, suffix, unique] of indexes) {
    expect(remaining).toContain(
      `CREATE ${unique ? "UNIQUE " : ""}INDEX "${table}_${suffix}" ON "${table}" USING btree ("${column}")`,
    );
  }
}

function assertSnapshot(snapshot: ReturnType<typeof JSON.parse>, previous: ReturnType<typeof JSON.parse>) {
  expect(snapshot.prevId).toBe(previous.id);
  expect(snapshot.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  expect(snapshot.id).not.toBe(previous.id);
  expect(snapshot.version).toBe("7");
  expect(snapshot.dialect).toBe("postgresql");
  const lease = snapshot.tables[`public.${table}`];
  expect(lease.name).toBe(table);
  expect(lease.schema).toBe("");
  expect(lease.columns).toEqual(Object.fromEntries(columns.map(([name, type, primaryKey, defaultNow]) => [
    name, { name, type, primaryKey, notNull: true, ...(defaultNow ? { default: "now()" } : {}) },
  ])));
  expect(lease.foreignKeys).toEqual(Object.fromEntries(references.map(([column, target]) => {
    const name = `${table}_${column}_${target}_id_fk`;
    return [name, { name, tableFrom: table, tableTo: target, columnsFrom: [column], columnsTo: ["id"], onDelete: "cascade", onUpdate: "no action" }];
  })));
  expect(lease.indexes).toEqual(Object.fromEntries(indexes.map(([column, suffix, unique]) => {
    const name = `${table}_${suffix}`;
    return [name, { name, columns: [{ expression: column, isExpression: false, asc: true, nulls: "last" }], isUnique: unique, concurrently: false, method: "btree", with: {} }];
  })));
  expect(lease.checkConstraints).toEqual(Object.fromEntries(identities.map((column) => {
    const name = `${table}_${column}_check`;
    return [name, { name, value: checkExpression(column) }];
  })));
  expect(lease.compositePrimaryKeys).toEqual({});
  expect(lease.uniqueConstraints).toEqual({});
  expect(lease.policies).toEqual({});
  expect(lease.isRLSEnabled).toBe(false);
  const updated = snapshot.tables["public.provider_connections"].columns.updated_at;
  expect(updated).toEqual({ ...previous.tables["public.provider_connections"].columns.updated_at, type: "timestamp (3) with time zone" });
  expect(updated.notNull).toBe(true);
  expect(updated.default).toBe("now()");
  // The complete remaining snapshot must be identical: no unrelated schema drift.
  const restored = structuredClone(snapshot);
  delete restored.tables[`public.${table}`];
  restored.tables["public.provider_connections"].columns.updated_at.type = timestamp;
  expect({ ...restored, id: previous.id, prevId: previous.prevId }).toEqual(previous);
}

function assertJournal(journal: ReturnType<typeof JSON.parse>, file: string) {
  const entries = journal.entries as Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
  const index = entries.findIndex((entry) => entry.idx === 237);
  expect(index).toBe(231);
  expect(entries.filter((entry) => entry.idx === 237 || entry.tag.startsWith("0237_"))).toHaveLength(1);
  expect(journal.version).toBe("7");
  expect(journal.dialect).toBe("postgresql");
  expect(entries[index - 1]!.tag).toBe(previousTag);
  expect(entries[index]!).toEqual({ idx: 237, version: "7", when: expect.any(Number), tag: file.slice(0, -4), breakpoints: true });
  expect(Number.isSafeInteger(entries[index]!.when)).toBe(true);
  expect(entries[index]!.when).toBeGreaterThan(Math.max(...entries.slice(0, index).map((entry) => entry.when)));
  expect(hash(JSON.stringify(entries.slice(0, index)))).toBe("536cdae319bf1b55cba15b721eac4b0bf6e222562be0104421ac43eb93bf6b9d");
}

describe("Pi OpenAI connection lease migration 0237", () => {
  test("generates exactly one scoped SQL migration with non-secret lease constraints", () => {
    assertSql(read(`migrations/${migrationFile()}`));
  });

  test("links the generated snapshot and monotonic journal to unchanged 0236 artifacts", () => {
    const file = migrationFile();
    assertSnapshot(JSON.parse(read("migrations/meta/0237_snapshot.json")), JSON.parse(read("migrations/meta/0236_snapshot.json")));
    assertJournal(JSON.parse(read("migrations/meta/_journal.json")), file);
    expect(hash(read(`migrations/${previousTag}.sql`))).toBe("098774cc7bff3e2231d7fc4da7db525a109be21f101ad1a778a5ef1d8d670796");
    expect(hash(read("migrations/meta/0236_snapshot.json"))).toBe("1ce12d3b48bae712438523b1d16e9dce458870817f823cbdaaa5f8ff9cee3c4d");
  });

  test("exports only the lease table and inferred select/insert types through the schema barrel", () => {
    const config = getTableConfig(schema.piOpenaiConnectionLeases);
    expect(config.name).toBe(table);
    expect(config.columns.map((column) => [column.name, column.getSQLType(), column.primary, column.notNull, column.hasDefault]))
      .toEqual(columns.map(([name, type, primary, defaultNow]) => [name, type, primary, true, defaultNow]));
    expect(schema.providerConnections.updatedAt.getSQLType()).toBe("timestamp (3) with time zone");
    expect(schema.providerConnections.updatedAt.notNull).toBe(true);
    expect(schema.providerConnections.updatedAt.hasDefault).toBe(true);
    expect(Object.keys(schema).filter((name) => /piOpenaiConnectionLease/i.test(name))).toEqual(["piOpenaiConnectionLeases"]);
    const insert: NewPiOpenaiConnectionLease = {
      connectionId: "00000000-0000-4000-8000-000000000001", jobId: "00000000-0000-4000-8000-000000000002",
      workerId: "worker", claimAttemptId: "claim", credentialVersion: new Date(0), expiresAt: new Date(1),
    };
    const selected: PiOpenaiConnectionLease = { ...insert, createdAt: new Date(0), updatedAt: new Date(0) };
    expect(Object.keys(selected)).toHaveLength(8);
  });

  test("rejects missing or duplicate migration files regardless of suffix", () => {
    expect(() => migrationFile([])).toThrow();
    expect(() => migrationFile(["0237_one.sql", "0237_two.sql"])).toThrow();
    expect(migrationFile(["0236_old.sql", "0237_fresh_name.sql"])).toBe("0237_fresh_name.sql");
  });

  const mutants: Array<[string, (sql: string) => string]> = [
    ["missing PK", (sql) => sql.replace(" PRIMARY KEY", "")],
    ["nullable identity", (sql) => sql.replace('"worker_id" text NOT NULL', '"worker_id" text')],
    ["wrong FK target", (sql) => sql.replace('"agent_jobs"("id")', '"provider_connections"("id")')],
    ["wrong FK column", (sql) => sql.replace('FOREIGN KEY ("job_id")', 'FOREIGN KEY ("connection_id")')],
    ["missing cascade", (sql) => sql.replace("ON DELETE cascade", "ON DELETE restrict")],
    ["nonunique job", (sql) => sql.replace("CREATE UNIQUE INDEX", "CREATE INDEX")],
    ["partial job index", (sql) => sql.replace('USING btree ("job_id")', 'USING btree ("job_id") WHERE false')],
    ["composite job index", (sql) => sql.replace('USING btree ("job_id")', 'USING btree ("job_id", "worker_id")')],
    ["wrong expiry index", (sql) => sql.replace('USING btree ("expires_at")', 'USING btree ("created_at")')],
    ["weak check", (sql) => sql.replace(" <> '' AND ", " <> '' OR ")],
    ["lost precision", (sql) => sql.replace("timestamp (3)", "timestamp")],
    ["lost provider precision", (sql) => sql.replace("SET DATA TYPE timestamp (3)", "SET DATA TYPE timestamp")],
    ["lost default", (sql) => sql.replace(" DEFAULT now()", "")],
    ["commented SQL", (sql) => `/* ${sql} */`],
    ["embedded breakpoint comment", (sql) => sql.replace('"job_id" uuid', '"job_id" uu--> statement-breakpointid')],
    ["DDL before table creation", (sql) => {
      const end = sql.indexOf(";") + 1;
      return `${sql.slice(end)}\n${sql.slice(0, end)}`;
    }],
    ["line-commented FK", (sql) => sql.replace(`ALTER TABLE "${table}"`, `-- ALTER TABLE "${table}"`)],
    ["later destructive DDL", (sql) => `${sql}\nDROP TABLE "${table}";`],
    ["same-statement extra column", (sql) => sql.replace('"job_id" uuid', 'token text, "job_id" uuid')],
  ];
  for (const name of ["token", "refresh_token", "secret", "receipt", "account_id", "encrypted_state", "provider_payload", "innocent_metadata"]) {
    for (const identifier of [`"${name}"`, name.toUpperCase()]) {
      mutants.push([`forbidden/extra column ${identifier}`, (sql) => sql.replace('"job_id" uuid', `${identifier} text,\n\t"job_id" uuid`)]);
    }
  }
  test.each(mutants)("rejects SQL mutation: %s", (_name, mutate) => {
    const sql = read(`migrations/${migrationFile()}`);
    const changed = mutate(sql);
    expect(changed).not.toBe(sql);
    expect(() => assertSql(changed)).toThrow();
  });

  test("rejects forged snapshot links, secret columns and journal history", () => {
    const previous = JSON.parse(read("migrations/meta/0236_snapshot.json"));
    const snapshot = JSON.parse(read("migrations/meta/0237_snapshot.json"));
    expect(() => assertSnapshot({ ...snapshot, prevId: snapshot.id }, previous)).toThrow();
    snapshot.tables[`public.${table}`].columns.token = { name: "token", type: "text" };
    expect(() => assertSnapshot(snapshot, previous)).toThrow();
    const journal = JSON.parse(read("migrations/meta/_journal.json"));
    const nonMonotonic = structuredClone(journal);
    nonMonotonic.entries.find((entry: { idx: number }) => entry.idx === 237).when = 1788125048199;
    expect(() => assertJournal(nonMonotonic, migrationFile())).toThrow();
    journal.entries[0].tag = "0000_forged";
    expect(() => assertJournal(journal, migrationFile())).toThrow();
  });
});
