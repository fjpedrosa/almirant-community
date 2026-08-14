import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import * as ts from "typescript";

const root = resolve(import.meta.dir, "../../../../../../../");
const retired = "backend/api/src/domains/billing/expenses/services/currency-service.ts";
const contract = "backend/api/src/domains/billing/expenses/services/currency-service-retirement.contract.test.ts";
const forbidden = new Set(["refreshExchangeRates", "getExchangeRate", "convertAmount"]);
const sentinels: Array<[string, string[]]> = [
  ["backend/packages/database/src/repositories/billing/currency-rate-repository.ts", ["getLatestExchangeRate", "upsertExchangeRates", "getExchangeRatesForDate"]],
  ["backend/packages/database/src/schema/currency-rates.ts", ["currencyRates", "currency_rates", "fromCurrency", "toCurrency", "currency_rates_pair_date_idx"]],
  ["backend/packages/database/src/repositories/index.ts", ['export * from "./billing/currency-rate-repository"']],
  ["backend/api/src/domains/billing/expenses/routes/expenses.routes.ts", ["CURRENCY_SCHEMA", "currency"]],
  ["backend/api/src/domains/billing/expenses/routes/recurring-expenses.routes.ts", ["CURRENCY_SCHEMA", "currency"]],
];

const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const sourcePaths = () => execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n").filter((path) => /\.(?:[cm]?[jt]sx?|json)$/u.test(path) && path !== retired && path !== contract && existsSync(resolve(root, path)));
const normalize = (path: string) => path.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\/index$/u, "");
const resolveImport = (importer: string, spec: string) => {
  if (spec.startsWith("@/")) return normalize(posix.normalize(`backend/api/src/${spec.slice(2)}`));
  if (spec.startsWith(".")) return normalize(posix.normalize(posix.join(dirname(importer), spec)));
  return null;
};
const literalText = (node: ts.Node | undefined) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const scriptKind = (path: string) => path.endsWith(".json") ? ts.ScriptKind.JSON : path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
const manifestKeys = /^(?:scripts|bin|main|module|exports|types|typings|imports|files|paths|command|path|entry|entries)$/u;
const manifestIssue = (value: string) => value.replaceAll("\\", "/").includes(retired) || [...forbidden].some((name) => new RegExp(`\\b${name}\\b`, "u").test(value));
const jsonIssue = (raw: string) => {
  try {
    const visit = (value: unknown, active = false): boolean => {
      if (typeof value === "string") return active && manifestIssue(value);
      if (Array.isArray(value)) return value.some((item) => visit(item, active));
      if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => visit(item, active || manifestKeys.test(key)));
      return false;
    };
    return visit(JSON.parse(raw));
  } catch { return false; }
};
const repoPaths = sourcePaths();
const retiredSource = "";
const scanOne = (path: string, raw: string) => {
  if (path.endsWith(".json")) return !jsonIssue(raw);
  const source = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, scriptKind(path));
  const specs: string[] = [];
  let executableIssue = false;
  const add = (node: ts.Node | undefined) => { const value = literalText(node); if (value) specs.push(value); };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) executableIssue = true;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return !executableIssue && !specs.some((spec) => resolveImport(path, spec) === normalize(retired));
};
const baseline = new Map(repoPaths.map((path) => [path, scanOne(path, read(path))]));
const scan = (overrides: Record<string, string | undefined> = {}) => {
  const paths = [...new Set([...repoPaths, ...Object.keys(overrides)])].filter((path) => path !== retired && path !== contract);
  return paths.every((path) => overrides[path] !== undefined ? scanOne(path, overrides[path]!) : (baseline.get(path) ?? scanOne(path, read(path))));
};
const retiredPresent = (overrides: Record<string, string | undefined> = {}) => existsSync(resolve(root, retired)) || overrides[retired] !== undefined;
const append = (raw: string, value: string) => { const next = `${raw}\n${value}\n`; expect(next).not.toBe(raw); return next; };
const manifestMutation = (raw: string) => {
  const packageJson = JSON.parse(raw) as Record<string, unknown>;
  const scripts = typeof packageJson.scripts === "object" && packageJson.scripts ? { ...(packageJson.scripts as Record<string, unknown>) } : {};
  scripts.retire = `bun ${retired}`;
  const next = JSON.stringify({ ...packageJson, scripts }, null, 2);
  expect(next).not.toBe(raw);
  return next;
};

describe("currency service retirement boundary", () => {
  test("retires only the API service and preserves live currency seams", () => {
    expect(retiredPresent()).toBe(false);
    expect(scan()).toBe(true);
    for (const [path, needles] of sentinels) {
      const raw = read(path);
      expect(needles.every((needle) => raw.includes(needle))).toBe(true);
    }
  });

  test("fails closed for relocated imports and executable symbols while ignoring prose", () => {
    const importer = "backend/api/src/domains/billing/expenses/routes/expenses.routes.ts";
    const valid = read(importer);
    const mutations = [
      { ["backend/api/src/domains/billing/expenses/services/archive/currency-service.ts"]: "export async function refreshExchangeRates() {}" },
      { [importer]: append(valid, 'import { convertAmount } from "../services/currency-service";') },
      { [importer]: append(valid, 'import { getExchangeRate } from "@/domains/billing/expenses/services/currency-service";') },
      { [importer]: append(valid, 'import {\n  convertAmount,\n} from "../services/currency-service.ts";') },
      { [importer]: append(valid, 'export { refreshExchangeRates } from "../services/currency-service";') },
      { [importer]: append(valid, 'const load = () => import("../services/currency-service.ts");') },
      { [importer]: append(valid, "const retained = `getExchangeRate is retired`; /* convertAmount */") },
      { [importer]: append(valid, "void refreshExchangeRates;") },
      { [retired]: retiredSource },
      { [importer]: append(valid, "const load = () => import(`../services/currency-service.ts`);") },
      { [importer]: append(valid, 'const load = require("../services/currency-service");') },
      { [importer]: append(valid, 'import CurrencyService = require("../services/currency-service");') },
      { [importer]: append(valid, 'const total = `${convertAmount(1, "EUR", "USD")}`;') },
      { ["package.json"]: manifestMutation(read("package.json")) },
    ];
    expect(scan(mutations[0]!)).toBe(false);
    expect(scan(mutations[1]!)).toBe(false);
    expect(scan(mutations[2]!)).toBe(false);
    expect(scan(mutations[3]!)).toBe(false);
    expect(scan(mutations[4]!)).toBe(false);
    expect(scan(mutations[5]!)).toBe(false);
    expect(scan(mutations[6]!)).toBe(true);
    expect(scan(mutations[7]!)).toBe(false);
    expect(retiredPresent(mutations[8]!)).toBe(true);
    expect(scan(mutations[9]!)).toBe(false);
    expect(scan(mutations[10]!)).toBe(false);
    expect(scan(mutations[11]!)).toBe(false);
    expect(scan(mutations[12]!)).toBe(false);
    expect(scan(mutations[13]!)).toBe(false);
  });
});
