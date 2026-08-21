import { describe, expect, test } from "bun:test";

import { scanCurrencyRetirementOwnership } from "./currency-retirement-ownership.contract-support";

const database = '"@almirant/database"';
const retired = ["getLatestExchangeRate", "upsertExchangeRates", "getExchangeRatesForDate"] as const;
const [latest, upsert, forDate] = retired;
const ownerIndex = "backend/packages/database/src/index.ts";
const ownerCopy = "backend/packages/database/src/repositories/billing/renamed-rates.ts";
const repositoryIndex = "backend/packages/database/src/repositories/billing/index.ts";
const ownerManifest = "backend/packages/database/package.json";
const retiredManifestPath = "./src/repositories/billing/currency-rate-repository.ts?raw#v1";
type Fixture = string | readonly [source: string, path: string];
const scan = (source: string, path = "fixture.ts") => scanCurrencyRetirementOwnership([{ path, source }]);
const result = (fixture: Fixture) => (typeof fixture === "string" ? scan(fixture) : scan(...fixture));
const manifest = (value: unknown, path = ownerManifest): Fixture => [typeof value === "string" ? value : JSON.stringify(value), path];
const reject = (fixtures: readonly Fixture[]) => {
  for (const fixture of fixtures) expect(result(fixture), JSON.stringify(fixture)).not.toEqual([]);
};
const allow = (fixtures: readonly Fixture[]) => {
  for (const fixture of fixtures) expect(result(fixture), JSON.stringify(fixture)).toEqual([]);
};

describe("currency retirement ownership Slice 1B static completion", () => {
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

  test("fails closed for code parse errors while explicitly deferring later forms", () => {
    reject([
      ["export {", "broken.ts"],
      ["const =", "broken.js"],
      ["const x: number = 1", "invalid.js"],
      ["interface X {}", "invalid.mjs"],
      ["enum X {}", "invalid.cjs"],
    ]);
    allow([
      `const holder = { database: require(${database}) }; holder.database.${forDate}`,
      `module.exports = { ${upsert}: require(${database}).safe }`,
      `Object.assign(exports, require(${database}))`,
      [`{"exports":{"./rates":"./currency-rate-repository.ts"}`, "broken.yaml"],
      [`{"scripts":{"check":"currency-rate-repository"}}`, "package.yaml"],
    ]);
  });

  test("follows bounded value provenance and owner-file function fingerprints", () => {
    reject([
      `import * as database from ${database}; const first = database, second = first; second.${latest}`,
      `import * as database from ${database}; const { ${upsert}: write } = database; export { write }`,
      `let database; database = require(${database}); const alias = database; alias.${forDate}`,
      `import * as database from ${database}; let write; ({ ${latest}: write } = database); export { write }`,
      `(require(${database})).${forDate}`,
      `import * as database from ${database}; const alias = database; export const outward = alias`,
      [`const ${latest} = () => 1; export { ${latest} as read }`, ownerCopy],
      [`let ${upsert}; ${upsert} = function () {}; export { ${upsert} as write }`, ownerCopy],
      [`let ${forDate}, inner, outer; outer = inner = ${forDate} = class {}; export { inner, outer }`, ownerCopy],
      [`let ${upsert}, inner; const outer = inner = ${upsert} = () => 1; export { outer }`, ownerCopy],
      [`let inner; const ${upsert} = inner = () => 1; export { inner as write }`, ownerCopy],
      [`const ${latest} = exports.read = () => 1`, ownerCopy],
      [`let ${forDate}; ${forDate} = module.exports.write = () => 1`, ownerCopy],
      [`let ${latest}, outer; { let inner; outer = inner = ${latest} = () => 1; } export { outer }`, ownerCopy],
      [`function ${upsert}() {}; export { ${upsert} as write }`, ownerCopy],
      [`class ${latest} {}; export { ${latest} as read }`, ownerCopy],
      [`(exports).${latest} = () => 1; (module.exports)["${upsert}"] = () => 1`, ownerIndex],
      ...["(() => 1)", "(() => 1) as unknown", "<unknown>(() => 1)", "(() => 1)!", "(() => 1) satisfies unknown"].map(
        (rhs): Fixture => [`let ${latest}, alias; alias = ${latest} = ${rhs}; export { alias }`, ownerCopy],
      ),
    ]);
    allow([
      `const holder = { database: require(${database}) }; holder.database.${latest}`,
      `let first, second; second = first = () => 1; export { second as ${latest} }`,
      [`let ${latest}, alias; alias = ${latest} = () => 1; export { alias }`, "other/index.ts"],
      [`exports = require(${database})`, ownerIndex],
      [`const exports = {}; (exports).${latest} = 1`, ownerIndex],
      [`function ${upsert}() {}; class ${latest} {}; export { ${upsert} as write, ${latest} as read }`, "other/index.ts"],
    ]);
  });

  test("keeps value and type provenance separate and converges static type aliases", () => {
    reject([
      `import type * as DB from ${database}; const DB = {}; type Rate = DB.${latest}; export type { Rate }`,
      `import * as DB from ${database}; type DB = {}; type Snapshot = typeof DB; export type { Snapshot }`,
      `type A = B; type B = C; type C = D; type D = E; type E = F; type F = DB.${upsert}; import type * as DB from ${database}; export { A as Rate }`,
      `import { safe as read } from ${database}; type T = typeof read; export { type T as ${latest} }`,
      `import database from ${database}; type T = typeof database; export type { T }`,
      `import * as database from ${database}; type T = typeof database; export { T }`,
      `import database = require(${database}); type T = typeof database; export type { T }`,
      `import type database = require(${database}); import type Alias = database; type T = Alias.${forDate}; export { type T }`,
      `import type A = B; import type B = C; import type C = D; import type D = E; import type E = F; import type F = require(${database}); type T = A.${latest}; export type { T }`,
      `import type { safe as require } from ${database}; require(${database}).${latest}`,
      `export { T as ${latest} }; type T = DB.safe; import type * as DB from ${database}`,
      `export type { T as ${upsert} }; type T = DB.safe; import type * as DB from ${database}`,
      `export { type T as ${forDate} }; type T = DB.safe; import type * as DB from ${database}`,
      `type T = import(${database}).default.${latest}; export type { T }`,
      [`export type ${latest} = {}; export enum ${upsert} { value }`, ownerCopy],
      `import type * as DB from ${database}; type T = readonly DB.${forDate}[]; export type { T }`,
    ]);
    allow([
      `import type * as DB from ${database}; namespace local { enum DB { x }; type T = DB.${latest} }`,
      `import type * as DB from ${database}; namespace local { namespace DB {}; type T = DB.${upsert} }`,
      `import type * as DB from ${database}; namespace local { class DB {}; type T = DB.${forDate} }`,
      `import type * as DB from ${database}; type Box<DB> = DB.${latest}`,
      `import type * as DB from ${database}; interface Box<DB> { value: DB.${upsert} }`,
      `import * as DB from ${database}; type K = keyof typeof DB.${latest}; export { type K as ${latest} }`,
      [`export type ${latest} = {}; export enum ${upsert} { value }`, "other/index.ts"],
      [`type ${latest} = {}; enum ${upsert} { value }; function ${forDate}() {}; class local {}`, ownerCopy],
    ]);
  });

  test("completes recursive type provenance, heritage, and public declaration sinks", () => {
    reject([
      `import type * as DB from ${database}; export type Deep<T> = Promise<readonly (DB.${latest} | T)[]>`,
      `export type Deep<T> = T extends import(${database}).default.safe ? { readonly [K in keyof T]: (value: import(${database}).default.${upsert}) => [T[K], string] } : never`,
      `export type Deep<T extends import(${database}).default.${latest} = import(${database}).default.${upsert}> = T & { value: typeof import(${database}).default.${forDate} }`,
      `import * as DB from ${database}; export interface Read { (value: Readonly<[typeof DB.${forDate}]>): void }`,
      `import type * as DB from ${database}; export interface Rates extends DB.${latest} {}`,
      `import * as DB from ${database}; export class Rates extends DB.${upsert} implements DB.${forDate} {}`,
      `import type * as DB from ${database}; const DB = {}; export class Rates implements DB.${latest} {}`,
      `import * as DB from ${database}; namespace local { type DB = {}; class Rates extends DB.${upsert} {} }`,
      [`export interface ${latest} {}; export namespace ${upsert} {}; export module ${forDate} {}`, ownerCopy],
      [`export as namespace ${latest}`, ownerCopy],
      [`import * as DB from ${database}; export as namespace DB`, "consumer.d.ts"],
    ]);
    allow([
      `import * as DB from ${database}; type Safe = Readonly<[keyof typeof DB.${latest}]>`,
      `import type * as DB from "@other/database"; interface Safe extends DB.${upsert} {}`,
      `import type * as DB from ${database}; const DB = {}; class Safe extends DB.${latest} {}`,
      `import * as DB from ${database}; namespace local { type DB = {}; interface Safe extends DB.${forDate} {} }`,
      [`interface ${latest} {}; namespace ${upsert} {}; module ${forDate} {}`, ownerCopy],
      [`export interface ${latest} {}; export namespace ${upsert} {}`, "other/index.ts"],
    ]);
  });

  test("contains mapped and infer type scopes without crossing value and type spaces", () => {
    reject([
      `import type * as DB from ${database}; type M = { [DB in keyof object]: DB.${latest} }; type Outside = DB.${upsert}`,
      `import type * as DB from ${database}; type M = { [DB in DB.${latest}]: DB.${upsert} }`,
      `import type * as DB from ${database}; type Pick<X> = X extends infer DB ? DB.${latest} : never; type Outside = DB.${forDate}`,
      `import type * as DB from ${database}; type Pick<X> = X extends infer DB ? DB.${latest} : DB.${upsert}`,
      `import type * as DB from ${database}; type Pick<X, Y> = X extends (Y extends infer DB ? DB.${latest} : never) ? DB.${forDate} : never`,
      `import * as DB from ${database}; type DB = {}; type T = typeof DB.${latest}`,
    ]);
    allow([
      `import type * as DB from ${database}; type M = { [DB in keyof object]: DB.${latest} }`,
      `import type * as DB from ${database}; type Pick<X> = X extends infer DB ? DB.${upsert} : never`,
      `import type * as DB from ${database}; const DB = {}; type T = typeof DB.${forDate}`,
    ]);
  });

  test("recognizes only direct literal awaited and optional owner member access", () => {
    reject([
      `(await import(${database})).${latest}`,
      `(await import(${database}))?.${upsert}`,
      `(await import(${database})).default?.["${forDate}"]`,
      `const key = "${latest}"; require(${database})?.[key]`,
      `import * as DB from ${database}; DB?.${upsert}`,
    ]);
    allow([
      `const source = ${database}; (await import(source)).${latest}`,
      `const pending = import(${database}); (await pending).${latest}`,
      `(await loader(${database})).${upsert}`,
      `const holder = { database: require(${database}) }; holder.database?.${forDate}`,
      `require("@other/database")?.${latest}`,
    ]);
  });

  test("covers exported owner binding patterns and nested cross-seam combinations", () => {
    reject([
      [`const local = {}; export const { ${latest} } = local`, ownerCopy],
      [`export const { safe: ${upsert} } = { safe: 1 }`, ownerCopy],
      [`export let [${forDate}] = []`, ownerCopy],
      [`export const { ${latest}: read } = require(${database})`, ownerCopy],
      [`const source = require(${database}); export const { ${upsert}: write } = source`, ownerCopy],
      `export interface Combined extends Readonly<import(${database}).default.${forDate}> {}`,
    ]);
    allow([
      [`const local = {}; export const { ${latest} } = local`, "other/index.ts"],
      [`export const { safe: read } = require(${database})`, ownerCopy],
      [`export let [${forDate}] = []`, "other/index.ts"],
      `const holder = { database: require(${database}) }; export interface Safe extends holder.database.${latest} {}`,
    ]);
  });

  test("propagates interface heritage provenance into later public type exports", () => {
    reject([
      `import type * as DB from ${database}; interface Surface extends DB.safe {}; export { Surface as ${latest} }`,
      `import type * as DB from ${database}; interface Surface extends Local<DB.safe> {}; export type { Surface as ${upsert} }`,
      `import type * as DB from ${database}; interface Surface extends DB {}; export type { Surface }`,
    ]);
    allow([
      `import type * as DB from "@other/database"; interface Surface extends DB.safe {}; export { Surface as ${latest} }`,
      `interface Surface extends Local<Safe> {}; export type { Surface as ${upsert} }`,
      `import type * as DB from ${database}; interface Surface extends DB.safe {}; export type { Surface }`,
    ]);
  });

  test("merges recursive interface member and type-parameter provenance", () => {
    reject([
      `import type * as DB from ${database}; interface Surface { value: Readonly<DB.safe>; map(input: DB.other): Promise<DB.safe> }; export type { Surface as ${latest} }`,
      `import type * as DB from ${database}; interface Surface<T extends Box<DB.safe> = import(${database}).default.safe> { [key: string]: T; (input: DB.other): T; new (input: T): DB.safe }; export { Surface as ${upsert} }`,
      `import type * as DB from ${database}; interface Surface { value: DB }; export type { Surface }`,
    ]);
    allow([
      `import * as DB from ${database}; interface Surface { value: keyof typeof DB.${latest} }; export type { Surface as ${latest} }`,
      `import type * as DB from "@other/database"; interface Surface { value: DB.safe }; export type { Surface as ${upsert} }`,
      `interface Surface<T extends Local<Safe>> { value: T }; export type { Surface as ${forDate} }`,
      `import type * as DB from ${database}; interface Surface<T extends DB.safe> { value: T }`,
      `import type * as DB from ${database}; interface Surface { value: DB.safe }; export type { Surface }`,
    ]);
  });

  test("recognizes only direct dotted export ancestry as implicit public modules", () => {
    reject([
      [`export namespace Api.${latest} {}`, ownerCopy],
      [`export namespace Api.Rates.${upsert} {}`, ownerCopy],
      [`export module Api.${forDate} {}`, ownerCopy],
      [`export namespace Api.${latest}.Internal {}`, ownerCopy],
      [`export module Api.${upsert}.Internal.${forDate}.Leaf {}`, ownerCopy],
      [`export namespace Api { export namespace ${latest} {} }`, ownerCopy],
    ]);
    allow([
      [`export namespace Api.${latest} {}`, "other/index.ts"],
      [`namespace Api.${upsert} {}`, ownerCopy],
      [`export namespace Api { namespace ${forDate} {} }`, ownerCopy],
      [`namespace Private { export namespace ${latest} {} }`, ownerCopy],
      [`export namespace Api { namespace Hidden { export namespace ${upsert} {} } }`, ownerCopy],
      [`declare module "${forDate}" {}`, ownerCopy],
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

  test("parses strict JSON and JSONC fail-closed while preserving duplicate active fields", () => {
    const deepJson = `${'{"data":'.repeat(20_000)}0${"}".repeat(20_000)}`;
    reject([manifest(`{// comment\n"main":"safe"}`), manifest(`{"main":"safe",}`), manifest(`{'main':'safe'}`), manifest(`{main:"safe"}`), manifest(`{"main":"unterminated}`), manifest(`{} {}`), manifest(`{"main":"\\x"}`), manifest(`{'main':'safe'}`, "fixture.jsonc"), manifest(`{main:"safe"}`, "fixture.jsonc"), manifest(`{"main":"unterminated}`, "fixture.jsonc"), manifest(`{} {}`, "fixture.jsonc"), manifest(`#!/usr/bin/env node`, "fixture.jsonc"), manifest(`\uFEFF{// lead\n"main":"${retiredManifestPath}",}`, "fixture.jsonc"), manifest(`{"main":"${retiredManifestPath}","main":"safe"}`), manifest(`{"main":"safe","main":"${retiredManifestPath}"}`), [deepJson, "deep.json"]]);
    allow([manifest(`{"description":"safe"}`), manifest(`\uFEFF{// lead\n"description":"safe",}`, "fixture.jsonc"), manifest(`// inert\n/* still inert */`, "fixture.jsonc"), manifest(``, "fixture.jsonc"), manifest(`[{"path":"${retiredManifestPath}"},]`, "fixture.jsonc"), manifest(`"scalar"`, "fixture.jsonc"), manifest(`{"main":"safe","main":"also-safe"}`)]);
  });

  test("scans only the finite manifest selector trees and exact nested fields", () => {
    let deepReject: unknown = { path: retiredManifestPath };
    let deepAllow: unknown = { text: retiredManifestPath };
    for (let depth = 0; depth < 260; depth++) {
      deepReject = { data: deepReject };
      deepAllow = { data: deepAllow };
    }
    reject([
      ...["main", "module", "types", "typings"].map((key) => manifest({ [key]: retiredManifestPath })),
      manifest({ browser: { "./safe": retiredManifestPath } }),
      manifest({ bin: { safe: retiredManifestPath } }),
      manifest({ files: [retiredManifestPath] }),
      manifest({ exports: { "./currency-rate-repository": { import: [retiredManifestPath] } } }),
      manifest({ imports: { "#getLatestExchangeRate?condition": { default: "@almirant/database/repositories/billing/currency-rate-repository.js" } } }),
      manifest({ main: "@almirant/database/currency-rate-repository/index.js" }),
      manifest({ compilerOptions: { paths: { "@almirant/database/currency-rate-repository": ["safe"], safe: [retiredManifestPath] } } }),
      manifest({ scripts: { [latest]: "echo safe" } }),
      ...["path", "entry"].map((key) => manifest({ data: { [key]: retiredManifestPath } })),
      ...["paths", "entries"].map((key) => manifest({ data: { [key]: [retiredManifestPath] } })),
      manifest({ data: { command: `node ${retiredManifestPath}` } }),
      ...["path", "entry"].map((key) => manifest({ tool: { [key]: ["./safe.ts", retiredManifestPath] } })),
      manifest({ tool: { command: ["echo safe", `node ${retiredManifestPath}`] } }),
      manifest({ exports: { ".": { command: `node ${retiredManifestPath}` } } }),
      manifest({ tool: { path: { command: `node ${retiredManifestPath}` } } }),
      manifest({ main: "..\\database\\src\\repositories\\billing\\currency-rate-repository.d.cts#types" }, "backend/packages/api/package.json"),
      manifest({ main: "C:\\repo\\backend\\packages\\database\\src\\getLatestExchangeRate.mts" }, "C:\\repo\\package.json"),
      manifest({ main: "currency-rate-repository" }, "package.json"),
      manifest({ main: "dist/currency-rate-repository.js", files: ["dist/currency-rate-repository.js"], bin: { safe: "dist/currency-rate-repository.js" }, browser: { "currency-rate-repository/*": "safe" } }),
      manifest({ compilerOptions: { paths: { "currency-rate-repository/*": ["dist/currency-rate-repository.js"] } } }),
      manifest(deepReject),
    ]);
    allow([
      manifest({ description: retiredManifestPath, data: { exports: retiredManifestPath, main: retiredManifestPath, scripts: retiredManifestPath, commands: retiredManifestPath } }),
      manifest({ main: { path: retiredManifestPath }, files: retiredManifestPath, browser: [retiredManifestPath], compilerOptions: { paths: retiredManifestPath }, scripts: [retiredManifestPath] }),
      manifest({ data: { compilerOptions: { paths: { retired: [retiredManifestPath] } } } }),
      manifest({ tool: { paths: { retired: retiredManifestPath }, entries: { retired: retiredManifestPath } } }),
      manifest({ exports: { ".": "another-package/currency-rate-repository.ts" } }),
      manifest({ tool: { path: "another-package/currency-rate-repository.ts", entry: "another-package/currency-rate-repository.ts" } }),
      manifest({ Main: retiredManifestPath, script: retiredManifestPath, commands: retiredManifestPath }),
      manifest({ dependencies: { "@almirant/database": retiredManifestPath } }),
      manifest({ main: "@almirant/database-tools/currency-rate-repository" }),
      manifest({ main: "./src/currency-rate-repository-copy.ts" }),
      manifest({ main: "https://example.test/@almirant/database/currency-rate-repository.ts" }),
      manifest({ main: "./currency-rate-repository.ts" }, "other/package.json"),
      manifest({ main: "../api/currency-rate-repository.ts" }),
      manifest({ typesVersions: { "*": { getLatestExchangeRate: [retiredManifestPath] } } }),
      manifest(deepAllow),
      manifest({ path: retiredManifestPath }, "package-lock.json"),
      manifest({ main: retiredManifestPath }, "fixture.js.map"),
      manifest({ main: retiredManifestPath }, "fixture.yaml"),
      manifest({ main: retiredManifestPath }, "fixture.json.bak"),
    ]);
  });

  test("tokenizes bounded shell commands without interpreting substitutions or prose", () => {
    const commands = [`node '${retiredManifestPath}'`, `node "./src/"repositories/billing/currency-rate-repository.ts`, `node --entry=${retiredManifestPath}`, `node --entry = ${retiredManifestPath}`, `ENTRY=${retiredManifestPath} node`, `echo safe; ${latest}`, `echo safe && ${upsert}`, `echo safe || ${forDate}`, `echo safe | currency-rate-repository`, `echo safe\n\t${latest}`, `node C:\\repo\\backend\\packages\\database\\src\\repositories\\billing\\currency-rate-repository.ts`, `node ./src/repositories/billing/currency-rate-\\\nrepository.ts`, `https://safe/;currency-rate-repository`, `echo https://safe.test/?x=y&currency-rate-repository`, `echo https://safe.test/?x=y&repo=safe&currency-rate-repository`, `echo https://safe.test/?x=y#fragment&repo=currency-rate-repository`, `echo https://safe.test/?x=y#frag?again=yes&repo=currency-rate-repository`, `echo "https://safe.test/?x=y"&repo=currency-rate-repository`, `echo "https://safe.test/"?x=y&repo=currency-rate-repository`, `echo https://safe.test/?x=$(echo y)&repo=currency-rate-repository`, `echo https://safe.test/?x=y\\ &repo=currency-rate-repository`, `echo "safe\n<<EOF"\n${latest}\nEOF`, `echo $((1\n<< EOF))\n${latest}\nEOF`, `echo $(printf\n<<EOF)\n${latest}\nEOF`, `${"echo safe ".repeat(500)}${retiredManifestPath}`];
    const delimiters = Array.from({ length: 512 }, (_, index) => `D${index}`);
    const manyHeredocs = `cat ${delimiters.map((name) => `<<'${name}'`).join(" ")}\n${delimiters.map((name) => `${retiredManifestPath}\n${name}`).join("\n")}`;
    const originalShift = Array.prototype.shift, originalIncludes = String.prototype.includes;
    let shiftCalls = 0, queryIncludes = 0;
    let manyResult: readonly string[] | undefined;
    Array.prototype.shift = function <T>(this: T[]) { shiftCalls++; return originalShift.call(this) as T | undefined; };
    String.prototype.includes = function (search, position) { if (search === "?" && String(this).startsWith("https://safe.test/?")) queryIncludes++; return originalIncludes.call(this, search, position); };
    try {
      manyResult = result(manifest({ scripts: { check: manyHeredocs } }));
      result(manifest({ scripts: { check: `echo https://safe.test/?x=y${"&safe=value".repeat(512)}` } }));
    } finally {
      Array.prototype.shift = originalShift;
      String.prototype.includes = originalIncludes;
    }
    expect(manyResult).toEqual([]);
    expect(shiftCalls).toBe(0);
    expect(queryIncludes).toBe(0); expect([`cat <<$(printf EOF)\n${retiredManifestPath}\n$\necho safe`, `cat <<\${TAG}\n${retiredManifestPath}\n\${TAG}\necho safe`, `cat <<\`printf EOF\`\n${retiredManifestPath}\n\`printf\necho safe`, `cat <<EOF\${TAG}\n${retiredManifestPath}\nEOF\${TAG}`, `cat <<#EOF\n${retiredManifestPath}\n#EOF`].map((check) => result(manifest({ scripts: { check } })))).toEqual(Array.from({ length: 5 }, () => [`${ownerManifest}: invalid manifest command`]));
    reject([...commands.map((command) => manifest({ scripts: { check: command } })), ...[`echo 'unterminated`, `echo "unterminated`, `echo dangling\\`].map((command) => manifest({ scripts: { check: command } }))]);
    allow([
      manifest({ scripts: { check: `echo safe # ${retiredManifestPath}` } }),
      manifest({ scripts: { check: `echo $${latest} $(printf '${retiredManifestPath}') \`${retiredManifestPath}\`` } }),
      manifest({ scripts: { check: `echo ${latest}\\ safe ${upsert}\\;safe` } }),
      manifest({ scripts: { check: `echo "prose ${retiredManifestPath} suffix"` } }),
      manifest({ scripts: { check: `cat <<'EOF'\n${retiredManifestPath}\nEOF\necho safe` } }),
      manifest({ scripts: { check: `echo https://example.test/docs?symbol=${latest}&repo=currency-rate-repository` } }),
      manifest({ scripts: { check: `runner --url=https://example.test/?symbol=${latest}` } }),
      manifest({ scripts: { check: `run --url=https://example.test/?symbol=${latest}&repo=currency-rate-repository` } }),
      manifest({ scripts: { check: `echo "<<EOF"\necho safe` } }),
      manifest({ scripts: { check: `echo safe\\\n# <<EOF\n${retiredManifestPath}\nEOF` } }), manifest({ scripts: { check: `cat <<\\EOF\r\n${retiredManifestPath}\r\nEOF\r\necho safe` } }), manifest({ scripts: { check: `cat <<E\\OF\n${retiredManifestPath}\nEOF\necho safe` } }), manifest({ scripts: { check: `cat <<123\n${retiredManifestPath}\n123\necho safe` } }), manifest({ scripts: { check: `cat <<E"OF"\n${retiredManifestPath}\nEOF\necho safe` } }), manifest({ scripts: { check: `cat <<'E'\\OF\n${retiredManifestPath}\nEOF\necho safe` } }), manifest({ scripts: { check: `cat <<EOF.txt\n${retiredManifestPath}\nEOF.txt\necho safe` } }), manifest({ scripts: { check: `cat <<END+MARK\n${retiredManifestPath}\nEND+MARK\necho safe` } }), manifest({ scripts: { check: `cat <<''\n${retiredManifestPath}\n\necho safe` } }), manifest({ scripts: { check: `cat <<""\n${retiredManifestPath}\n\necho safe` } }), manifest({ scripts: { check: `cat <<\\#EOF\n${retiredManifestPath}\n#EOF\necho safe` } }), manifest({ scripts: { check: `cat <<''#EOF\n${retiredManifestPath}\n#EOF\necho safe` } }), manifest({ scripts: { check: `cat <<EOF#\n${retiredManifestPath}\nEOF#\necho safe` } }), manifest({ scripts: { check: `echo $(printf safe # ) "\n)` } }), manifest({ scripts: { check: `echo ${"${#value}"}` } }), manifest({ scripts: { check: `echo $( (echo)# ignored )\n)` } }), manifest({ scripts: { check: `echo $( (echo)# ) "\n)` } }), manifest({ scripts: { check: `echo https://safe.test/?x=y\\&repo=currency-rate-repository` } }),
      manifest({ scripts: { check: `cat <<'ONE' <<"TWO"\n${retiredManifestPath}\nONE\n${latest}\nTWO` } }),
      manifest({ command: `currency-rate-repository` }, "other/package.json"),
    ]);
  });
});
