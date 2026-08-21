import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as publicBarrel from "./index";
import * as schemaBarrel from "./schema";
import { currencyCodeEnum } from "./schema/enums";
import { currencyRates } from "./schema/currency-rates";
import { expenses } from "./schema/expenses";
import { recurringExpenses } from "./schema/recurring-expenses";
import { scanCurrencyRetirementOwnership, type TrackedSource } from "./currency-retirement-ownership.contract-support";
import { scanCurrencyRateMigrationSafety, type SqlSource } from "./currency-rates-preservation.contract-support";

const root = resolve(import.meta.dir, "../migrations");
const repositoryRoot = resolve(import.meta.dir, "../../../..");
const supportedSource = /(?:\.d\.(?:ts|mts|cts)|\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonc))$/iu;
const retirementNeedles = ["currency-rate-repository", "getLatestExchangeRate", "upsertExchangeRates", "getExchangeRatesForDate"];
const digest = (source: string) => new Bun.CryptoHasher("sha256").update(source).digest("hex");
const read = (path: string) => Bun.file(resolve(root, path)).text();
const file = (source: string, path = "fixture.sql"): SqlSource => ({ path, source });
const defaultSql = (column: { default: unknown }) => (column.default as { queryChunks?: Array<{ value?: string | string[] }> } | undefined)?.queryChunks?.flatMap(({ value }) => value ?? []).join("");
const pg = await PGlite.create();
const describeSql = async (statement: string) => {
  try { await pg.describeQuery(statement); }
  catch (error) { if ((error as { code?: string }).code !== "42P01") throw error; }
};
const loadTrackedSources = (inventory: string, readSource: (path: string) => string): readonly TrackedSource[] => {
  if (!inventory) return [];
  if (!inventory.endsWith("\0")) throw new Error("invalid tracked inventory framing");
  const paths = inventory.slice(0, -1).split("\0");
  if (paths.some((path) => !path || path.includes("\\") || path === ".." || path.startsWith("../") || posix.isAbsolute(path) || /^[A-Z]:\//iu.test(path) || posix.normalize(path) !== path) || new Set(paths).size !== paths.length) throw new Error("invalid tracked inventory path");
  return paths.filter((path) => supportedSource.test(path)).sort().map((path) => ({ path, source: readSource(path) }));
};
const retirementCandidates = (sources: readonly TrackedSource[]) => sources.filter(({ path, source }) => retirementNeedles.some((needle) => path.includes(needle) || source.includes(needle)));
const trackedSources = loadTrackedSources(execFileSync("git", ["ls-files", "-z", "--cached"], { cwd: repositoryRoot, encoding: "utf8" }), (path) => {
  const absolute = resolve(repositoryRoot, path);
  if (!lstatSync(absolute).isFile()) throw new Error(`tracked source is not a regular file: ${path}`);
  return readFileSync(absolute, "utf8");
});
afterAll(() => pg.close());

describe("currency rates preservation foundation", () => {
  test("activates retirement enforcement across cached tracked inventory", () => {
    expect(scanCurrencyRetirementOwnership(retirementCandidates(trackedSources))).toEqual([]);
  });

  test("loads only canonical supported cached paths and fails closed", () => {
    const fixtures = ["backend/packages/database/src/currency-retirement-ownership.contract-support.ts", "backend/packages/database/src/currency-retirement-ownership.contract.test.ts"];
    expect(loadTrackedSources("", () => "unused")).toEqual([]);
    expect(loadTrackedSources(`b.jsonc\0a\nb.d.mts\0skip.md\0${fixtures[0]}\0${fixtures[1]}\0`, (path) => path)).toEqual([
      { path: "a\nb.d.mts", source: "a\nb.d.mts" }, { path: "b.jsonc", source: "b.jsonc" }, ...fixtures.map((path) => ({ path, source: path })),
    ]);
    const fixtureSources = loadTrackedSources(`${fixtures.join("\0")}\0`, () => 'export const note = "getLatestExchangeRate";');
    expect(scanCurrencyRetirementOwnership(retirementCandidates(fixtureSources))).toEqual([]);
    for (const inventory of ["a.ts", "\0", "a.ts\0\0", "a.ts\0a.ts\0", "../a.ts\0", "a/../b.ts\0", "/a.ts\0", "C:/a.ts\0", "a\\b.ts\0"]) expect(() => loadTrackedSources(inventory, () => "safe")).toThrow();
    expect(() => loadTrackedSources("a.ts\0", () => { throw new Error("unreadable"); })).toThrow("unreadable");
  });

  test("preserves the live table, enum, public barrels, defaults, and workspace lineage", () => {
    const table = getTableConfig(currencyRates);
    expect(table.columns.map((column) => [column.name, column.columnType, column.notNull, column.primary])).toEqual([
      ["id", "PgUUID", true, true], ["from_currency", "PgEnumColumn", true, false], ["to_currency", "PgEnumColumn", true, false],
      ["rate", "PgNumeric", true, false], ["rate_date", "PgTimestamp", true, false], ["fetched_at", "PgTimestamp", true, false],
    ]);
    expect(table.columns.map((column) => [column.name, defaultSql(column), (column as { precision?: number }).precision, (column as { scale?: number }).scale, (column as { withTimezone?: boolean }).withTimezone])).toEqual([
      ["id", "gen_random_uuid()", undefined, undefined, undefined], ["from_currency", undefined, undefined, undefined, undefined], ["to_currency", undefined, undefined, undefined, undefined],
      ["rate", undefined, 16, 8, undefined], ["rate_date", undefined, undefined, undefined, true], ["fetched_at", "now()", undefined, undefined, true],
    ]);
    expect(table.indexes.map((index) => [index.config.name, index.config.unique, index.config.columns.map((column) => "name" in column ? column.name : undefined)])).toEqual([["currency_rates_pair_date_idx", true, ["from_currency", "to_currency", "rate_date"]]]);
    expect([currencyCodeEnum.enumName, currencyCodeEnum.enumValues]).toEqual(["currency_code", ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "MXN", "BRL", "CLP", "COP", "ARS"]]);
    expect(table.columns[1]!.enumValues).toBe(currencyCodeEnum.enumValues); expect(table.columns[2]!.enumValues).toBe(currencyCodeEnum.enumValues);
    expect([schemaBarrel.currencyRates, publicBarrel.currencyRates]).toEqual([currencyRates, currencyRates]);
    for (const model of [expenses, recurringExpenses]) {
      const config = getTableConfig(model), currency = config.columns.find(({ name }) => name === "currency")!, workspace = config.columns.find(({ name }) => name === "workspace_id")!;
      const workspaceFk = config.foreignKeys.find((foreignKey) => foreignKey.reference().columns.includes(workspace))!;
      expect([workspace.notNull, getTableConfig(workspaceFk.reference().foreignTable).name, currency.columnType, currency.notNull, currency.default, currency.enumValues]).toEqual([true, "workspace", "PgEnumColumn", true, "EUR", currencyCodeEnum.enumValues]);
      expect(currency.enumValues).toBe(currencyCodeEnum.enumValues);
    }
  });

  test("preserves audited migrations, snapshots, and journal order", async () => {
    const immutable = {
      "0096_complex_magik.sql": "8abd19966dcfe215fab4662c011600db95a0447cc742c9918eceabd85dd6d9f0",
      "0212_rename_organization_to_workspace.sql": "f4cbd88c31f32cb5c82a433fdf0dac8886071af65d441218f64ba09410c1eb82",
      "meta/0096_snapshot.json": "79b45b77d633335231a33d23eb146ae2ad72de451cf2c89f40c6098faad0dd5c",
      "meta/0212_snapshot.json": "901801c05c9f79c504fb7f3023559cc8fe9dbee3c982e33073bbbbf934279c8b",
    } as const;
    for (const [path, expected] of Object.entries(immutable)) expect(digest(await read(path)), path).toBe(expected);
    const journal = JSON.parse(await read("meta/_journal.json")) as { entries: Array<{ idx: number; tag: string; version: string; when: number; breakpoints: boolean }> };
    const tags = journal.entries.map(({ tag }) => tag), sqlTags = [...new Bun.Glob("*.sql").scanSync({ cwd: root })].map((path) => path.slice(0, -4)).sort();
    expect(new Set(tags).size).toBe(tags.length); expect(new Set(journal.entries.map(({ idx }) => idx)).size).toBe(journal.entries.length); expect([...tags].sort()).toEqual(sqlTags);
    expect(journal.entries.find(({ tag }) => tag === "0096_complex_magik")).toEqual({ idx: 96, version: "7", when: 1772928653576, tag: "0096_complex_magik", breakpoints: true });
    expect(journal.entries.find(({ tag }) => tag === "0212_rename_organization_to_workspace")).toEqual({ idx: 212, version: "7", when: 1782982128506, tag: "0212_rename_organization_to_workspace", breakpoints: true });
    expect(tags.indexOf("0096_complex_magik")).toBeLessThan(tags.indexOf("0212_rename_organization_to_workspace"));
    for (const name of ["0096", "0212"]) {
      const snapshot = JSON.parse(await read(`meta/${name}_snapshot.json`));
      const rates = snapshot.tables["public.currency_rates"];
      expect(Object.keys(rates.columns)).toEqual(["id", "from_currency", "to_currency", "rate", "rate_date", "fetched_at"]);
      expect([rates.columns.from_currency.type, rates.columns.from_currency.notNull, rates.columns.to_currency.type, rates.columns.to_currency.notNull, rates.indexes.currency_rates_pair_date_idx.isUnique, rates.indexes.currency_rates_pair_date_idx.columns.map(({ expression }: { expression: string }) => expression)]).toEqual(["currency_code", true, "currency_code", true, true, ["from_currency", "to_currency", "rate_date"]]);
      for (const model of ["expenses", "recurring_expenses"]) { const columns = snapshot.tables[`public.${model}`].columns; expect(["organization_id" in columns, "workspace_id" in columns, columns.currency.typeSchema, columns.currency.type, columns.currency.notNull, columns.currency.default]).toEqual([...(name === "0096" ? [true, false] : [false, true]), "public", "currency_code", true, "'EUR'"]); }
    }
  });

  test("fails closed for destructive static and dynamic PostgreSQL", async () => {
    const destructive = [
      `DROP TABLE currency_rates`, `DrOp TaBlE IF EXISTS public.currency_rates CASCADE`, `DROP TABLE "public"."currency_rates"`, `DROP TABLE safe, currency_rates RESTRICT`, `DROP/*x*/TYPE IF EXISTS public.currency_code`, `DROP INDEX public.currency_rates_pair_date_idx`, `ALTER TABLE public.currency_rates DROP COLUMN rate`, `SELECT '\\'; DROP TABLE currency_rates`,
      `DO $$ BEGIN DROP TABLE currency_rates; END $$`, `DO $body$ BEGIN EXECUTE 'DROP TABLE ' || 'currency_rates'; END $body$`,
      `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE format('DROP TABLE %I', 'currency_rates'); END $$`,
      `DO $$ DECLARE q text := 'currency_rates'; BEGIN EXECUTE 'DROP TABLE ' || q; END $$`, `DO $$ BEGIN EXECUTE 'DROP TABLE currency_rates ' || unknown_name; END $$`,
      `DO $$ BEGIN EXECUTE E'DROP TABLE \\x63urrency_rates'; END $$`, `DO $$ BEGIN EXECUTE E'DROP TABLE \\143urrency_rates'; END $$`, `DO $$ BEGIN EXECUTE E'DROP TABLE \\u0063urrency_rates'; END $$`, `DO $$ BEGIN EXECUTE U&'DROP TABLE \\0063urrency_rates'; END $$`,
      `DO $$ BEGIN EXECUTE U&'DROP TABLE !0063urrency_rates' UESCAPE '!'; END $$`,
      `DO $$ BEGIN EXECUTE format('DROP TABLE %1$I', unknown_table); END $$`, `COMMENT ON TABLE currency_rates IS 'keep'; DO $$ BEGIN EXECUTE unknown_sql; END $$`, `COMMENT ON INDEX currency_rates_pair_date_idx IS 'keep'; DO $$ BEGIN EXECUTE unknown_sql; END $$`,
      `DO $$ DECLARE q text; BEGIN q = 'DROP TABLE currency_rates'; EXECUTE q; END $$`, `DO $$ DECLARE q text DEFAULT 'DROP TABLE currency_rates'; BEGIN EXECUTE q; END $$`,
      ...[`SELECT * FROM currency_rates`, `DELETE FROM currency_rates`, `UPDATE currency_rates SET rate = rate`, `CREATE TABLE safe (rate currency_code)`, `CREATE TRIGGER safe AFTER INSERT ON currency_rates EXECUTE FUNCTION safe()`].map((lineage) => `${lineage}; DO $$ BEGIN EXECUTE unknown_sql; END $$`),
    ];
    for (const source of destructive) expect(await scanCurrencyRateMigrationSafety([file(source)], describeSql), source).not.toEqual([]);
    for (const source of [`SELECT 'unterminated`, `SELECT /* unterminated`, `DO $x$ BEGIN SELECT 1; END $$`, `SEL ECT 1`, `SELECT E'\\u12';`, `SELECT U&'safe' UESCAPE '0'`]) expect(await scanCurrencyRateMigrationSafety([file(source)], describeSql), source).not.toEqual([]);
  });

  test("keeps inert SQL and unrelated dynamic migrations safe", async () => {
    const safe = [
      `SELECT 'DROP TABLE currency_rates'`, `-- DROP TABLE currency_rates\nSELECT 1`, `SELECT /* outer /* DROP TABLE currency_rates */ safe */ 1`, `SELECT $$DROP TABLE currency_rates$$`, `SELECT $tag$DROP TABLE currency_rates$tag$`, `DROP TABLE currency_rates_archive`, `DROP TABLE archive_currency_rates`, `DROP TABLE archived.currency_rates`, `DROP TABLE "Currency_Rates"`,
      `GRANT EXECUTE ON FUNCTION currency_rates() TO app`, `CREATE TRIGGER t AFTER INSERT ON safe EXECUTE FUNCTION currency_rates()`,
      `DO $$ BEGIN EXECUTE 'SEL' || 'ECT 1'; END $$`, `DO $$ BEGIN EXECUTE format('SELECT %I', unknown_table); END $$`,
      `DO $$ BEGIN EXECUTE E'SELECT \\x31'; END $$`,
      `DO $$ BEGIN EXECUTE U&'SELECT 1' UESCAPE '!'; END $$`, `SELECT U&'DROP TABLE !0063urrency_rates' UESCAPE '!'`,
      `DO $$ DECLARE q text := 'currency_rates'; BEGIN q := unknown_table; EXECUTE q; END $$`, `SELECT E'it\\'s;safe'; SELECT 2`, `DROP FUNCTION currency_rates()`, `ALTER TABLE currency_rates ADD COLUMN safe text`,
      `COMMENT ON TABLE currency_rates IS 'keep'; DO $$ DECLARE q text; BEGIN q = 'SELECT 1'; EXECUTE q; END $$`, `COMMENT ON TABLE currency_rates IS 'keep'; DO $$ DECLARE q text DEFAULT 'SELECT 1'; BEGIN EXECUTE q; END $$`,
      `COMMENT ON TABLE currency_rates IS 'keep'; DO $$ BEGIN RAISE NOTICE 'execute'; END $$`, `COMMENT ON INDEX currency_rates_pair_date_idx IS 'keep'; DO $$ BEGIN PERFORM 'execute'; END $$`,
      `SELECT 'table' currency_rates; DO $$ BEGIN EXECUTE unknown_sql; END $$`, `SELECT 'from' currency_rates; DO $$ BEGIN EXECUTE unknown_sql; END $$`,
      ...[`SELECT * FROM archived.currency_rates`, `SELECT 'currency_rates'`, `SELECT * FROM currency_rates_archive`, `SELECT * FROM "Currency_Rates"`, `CREATE TRIGGER safe AFTER INSERT ON safe EXECUTE FUNCTION currency_rates()`].map((lineage) => `${lineage}; DO $$ BEGIN EXECUTE unknown_sql; END $$`),
    ];
    for (const source of safe) expect(await scanCurrencyRateMigrationSafety([file(source)], describeSql), source).toEqual([]);
    const inputs = Object.freeze([Object.freeze(file("SELECT 1; SELECT ';';", "b.sql")), Object.freeze(file("SELECT 2", "a.sql"))]);
    const before = JSON.stringify(inputs), first = await scanCurrencyRateMigrationSafety(inputs, describeSql), second = await scanCurrencyRateMigrationSafety(inputs, describeSql);
    expect([first, second, JSON.stringify(inputs)]).toEqual([[], [], before]);
  });

  test("scans every supplied tracked migration deterministically", async () => {
    const paths = [...new Bun.Glob("*.sql").scanSync({ cwd: root, absolute: true })].sort();
    const migrations = await Promise.all(paths.map(async (path) => file(await Bun.file(path).text(), path)));
    const result = await scanCurrencyRateMigrationSafety(migrations, describeSql);
    expect(result).toEqual([]); expect(result).toEqual([...new Set(result)].sort());
  });
});
