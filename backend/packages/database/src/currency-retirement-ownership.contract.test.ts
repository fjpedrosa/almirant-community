import { describe, expect, test } from "bun:test";

import { scanCurrencyRetirementOwnership } from "./currency-retirement-ownership.contract-support";

const database = '"@almirant/database"';
const retired = ["getLatestExchangeRate", "upsertExchangeRates", "getExchangeRatesForDate"] as const;
const [latest, upsert, forDate] = retired;
const ownerIndex = "backend/packages/database/src/index.ts";
const ownerCopy = "backend/packages/database/src/repositories/billing/renamed-rates.ts";
const repositoryIndex = "backend/packages/database/src/repositories/billing/index.ts";
type Fixture = string | readonly [source: string, path: string];
const scan = (source: string, path = "fixture.ts") => scanCurrencyRetirementOwnership([{ path, source }]);
const result = (fixture: Fixture) => (typeof fixture === "string" ? scan(fixture) : scan(...fixture));
const reject = (fixtures: readonly Fixture[]) => {
  for (const fixture of fixtures) expect(result(fixture), JSON.stringify(fixture)).not.toEqual([]);
};
const allow = (fixtures: readonly Fixture[]) => {
  for (const fixture of fixtures) expect(result(fixture), JSON.stringify(fixture)).toEqual([]);
};

describe("currency retirement ownership Slice 1A foundation", () => {
  test("rejects exact owner modules, terminal paths, loaders, imports, and reexports", () => {
    reject([
      `import { ${latest} } from ${database}`,
      `import type { ${upsert} as Rate } from ${database}`,
      `import database from ${database}; database.${latest}`,
      `import { default as database } from ${database}; database.${upsert}`,
      `import * as database from ${database}; const key = "${upsert}"; database[key]`,
      `import database = require(${database}); database.${forDate}`,
      `export import database = require(${database})`,
      `import database = require(${database}); export import ${latest} = database.safe`,
      `import type * as database from ${database}; type Rate = database.${latest}`,
      `require(${database}).${latest}()`,
      `import(${database}, { with: { type: "json" } }).${upsert}`,
      `type Rate = import(${database}).${forDate}`,
      `export { ${latest} } from ${database}`,
      `export * from ${database}`,
      `export * as database from ${database}`,
      `export { default as database } from ${database}`,
      `export { ${upsert} } from "@almirant/database/repositories/billing"`,
      `import "@almirant/database/repositories/billing/currency-rate-repository.js?raw#v1"`,
      `require("@almirant\\\\database\\\\repositories\\\\billing\\\\currency-rate-repository.d.cts")`,
      [`import safe from "./currency-rate-repository.mts?worker"`, repositoryIndex],
      [`export { default as safe } from "../billing/currency-rate-repository.d.mts#types"`, repositoryIndex],
      [`import("./currency-rate-repository.ts", { with: { type: "json" } })`, repositoryIndex],
    ]);
    allow([
      `import ${database}`,
      `import { safe } from ${database}; safe()`,
      `import { ${latest} } from "@other/database"; ${latest}()`,
      `import "@almirant/database-tools/repositories/billing/currency-rate-repository"`,
      `import "@other/database/repositories/billing/currency-rate-repository"`,
      [`import "currency-rate-repository"`, ownerIndex],
      [`import "another-package/currency-rate-repository"`, ownerIndex],
      `import "./currency-rate-repository-copy.ts"`,
      `export * as database from "@other/database"`,
      `const prose = "currency-rate-repository ${latest}"`,
    ]);
  });

  test("rejects canonical files, owner-qualified public exports, and constant CJS names", () => {
    for (const extension of ".ts,.tsx,.mts,.cts,.js,.jsx,.mjs,.cjs,.d.ts,.d.mts,.d.cts".split(","))
      expect(scan("export {};", `nested/currency-rate-repository${extension}`)).not.toEqual([]);
    reject([
      [`export const ${latest} = () => 1`, ownerIndex],
      [`export function ${upsert}() {}`, ownerCopy],
      [`export class ${forDate} {}`, ownerCopy],
      [`exports.${latest} = () => 1`, ownerIndex],
      [`module.exports.${upsert} = () => 1`, ownerIndex],
      [`const key = "${forDate}"; module["exports"][key] = () => 1`, ownerIndex],
      [`const root = "exports", key = "${latest}"; module[root][key] = () => 1`, ownerIndex],
      [`const safe = () => 1; export { safe as ${latest} }`, ownerCopy],
      [`export { ${upsert} } from "./rates"`, ownerCopy],
      [`import { safe } from ${database}; export { safe as ${upsert} }`, "consumer.ts"],
      [`import database from ${database}; export default database`, "consumer.ts"],
      [`module.exports = require(${database})`, "consumer.cjs"],
      [retired.map((name) => `export function ${name}() {}`).join("\n"), ownerCopy],
    ]);
    allow([
      [`export const ${latest} = () => 1`, "other/index.ts"],
      [`exports.${upsert} = () => 1`, "other/index.cjs"],
      [retired.map((name) => `export function ${name}() {}`).join("\n"), "other/renamed.ts"],
      [`export const getLatestExchangeRates = () => 1`, ownerIndex],
      [`export { ${upsert} } from "./rates"`, "other/index.ts"],
      [`export const ${latest} = () => 1`, "fixtures/backend/packages/database/src/index.ts"],
      [`export {}`, "nested/currency-rate-repository-copy.d.ts"],
    ]);
  });

  test("respects lexical scopes and shadows for bindings, constants, and CommonJS globals", () => {
    reject([
      `import * as database from ${database}; { database.${latest} }`,
      `import * as database from ${database}; function use() { database.${upsert} }`,
      `function use() { database.${forDate} } import * as database from ${database}`,
      `{ const database = require(${database}); database.${forDate} }`,
      `try {} catch (error) { require(${database}).${latest} }`,
      `for (const value of [1]) { const database = require(${database}); database.${upsert} }`,
      `switch (value) { case 1: { const database = require(${database}); database.${forDate} } }`,
      `import * as database from ${database}; { const database = {}; } database.${latest}`,
      [`const key = "${upsert}"; exports[key] = () => 1`, ownerIndex],
    ]);
    allow([
      `import * as database from ${database}; { const database = {}; database.${latest} }`,
      `import * as database from ${database}; (function database() { database.${upsert} })()`,
      `import * as database from ${database}; (class database { static value = database.${forDate} })`,
      `import * as database from ${database}; function use(database: unknown) { database.${latest} }`,
      `import * as database from ${database}; try {} catch (database) { database.${upsert} }`,
      `import * as database from ${database}; for (const database of [{}]) database.${forDate}`,
      `import * as database from ${database}; switch (value) { case 1: { const database = {}; database.${latest} } }`,
      [`function require() { return { ${latest}: 1 }; } require("./currency-rate-repository").${latest}`, ownerIndex],
      [`const exports = {}; exports.${upsert} = 1; const module = { exports: {} }; module.exports.${forDate} = 1`, ownerIndex],
      [`const key = "safe"; require(${database})[key]`, ownerIndex],
      [`const Object = { defineProperty() {} }; Object.defineProperty(exports, "${latest}", {})`, ownerIndex],
    ]);
  });

  test("fails closed for code parse errors while explicitly deferring Slice 1B forms", () => {
    reject([
      ["export {", "broken.ts"],
      ["const =", "broken.js"],
      ["const x: number = 1", "invalid.js"],
      ["interface X {}", "invalid.mjs"],
      ["enum X {}", "invalid.cjs"],
    ]);
    allow([
      `const database = require(${database}); const alias = database; alias.${latest}`,
      `let database; database = require(${database}); database.${upsert}`,
      `const holder = { database: require(${database}) }; holder.database.${forDate}`,
      `const { ${latest} } = require(${database}); ${latest}()`,
      `module.exports = { ${upsert}: require(${database}).safe }`,
      `Object.assign(exports, require(${database}))`,
      `(require(${database})).${forDate}`,
      `(await import(${database})).${latest}`,
      `require(${database})?.${upsert}`,
      [`{"exports":{"./rates":"./currency-rate-repository.ts"}`, "broken.json"],
      [`{"scripts":{"check":"currency-rate-repository"}}`, "package.jsonc"],
    ]);
  });

  test("returns sorted deduplicated violations without mutating supplied inputs", () => {
    const files = Object.freeze([
      Object.freeze({ path: "z/currency-rate-repository.ts", source: "export {}" }),
      Object.freeze({ path: "a/currency-rate-repository.ts", source: "export {}" }),
      Object.freeze({ path: "z/currency-rate-repository.ts", source: "export {}" }),
    ]);
    const first = scanCurrencyRetirementOwnership(files);
    expect(first).toEqual([...new Set(first)].sort());
    expect(scanCurrencyRetirementOwnership(files)).toEqual(first);
    expect(files[0]?.source).toBe("export {}");
  });
});
