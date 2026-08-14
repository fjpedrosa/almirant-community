import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const retired = "frontend/src/domains/goals/presentation/components/milestone-checklist.tsx";
const typePath = "frontend/src/domains/goals/domain/types.ts";
const contract = "frontend/milestone-checklist-retirement.contract.test.ts";
const forbidden = new Set(["MilestoneChecklist", "MilestoneChecklistProps"]);
const retiredToken = "milestone-checklist";
const retiredBasename = posix.basename(retired);
const sentinels: Array<[string, string[]]> = [
  ["frontend/src/domains/goals/presentation/containers/goals-page-container.tsx", ["GoalsPageContainer", "useGoalsReadiness"]],
  ["frontend/src/domains/goals/presentation/components/goals-page.tsx", ["GoalsPage"]],
  ["frontend/src/domains/goals/presentation/components/radial-progress.tsx", ["RadialProgress"]],
  ["frontend/src/domains/goals/presentation/components/milestone-form-dialog.tsx", ["MilestoneFormDialog"]],
  ["backend/api/src/mcp/tools/milestones.tools.ts", [
    "list_milestones", "get_milestone", "get_milestone_progress", "create_milestone",
    "update_milestone", "delete_milestone", "add_work_items_to_milestone", "remove_work_item_from_milestone",
  ]],
];
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const literal = (node: ts.Node | undefined) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const normalize = (path: string) => path.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\/index$/u, "");
const resolveImport = (importer: string, specifier: string) => {
  if (specifier.startsWith("@/")) return normalize(posix.normalize(`frontend/src/${specifier.slice(2)}`));
  if (specifier.startsWith(".")) return normalize(posix.normalize(posix.join(dirname(importer), specifier)));
  return null;
};
const scriptKind = (path: string) => path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
const sourcePaths = () => execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((path) => /\.(?:[cm]?[jt]sx?)$/u.test(path) && path !== retired && path !== contract && existsSync(resolve(root, path)));
const scanOne = (path: string, raw: string) => {
  const relocatedPath = posix.basename(path) === retiredBasename;
  if (!relocatedPath && !raw.includes(retiredToken) && ![...forbidden].some((token) => raw.includes(token))) return true;
  const file = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, scriptKind(path));
  const specs: string[] = [];
  let issue = relocatedPath;
  const visit = (node: ts.Node): void => {
    if (path === typePath && ts.isInterfaceDeclaration(node) && node.name.text === "MilestoneChecklistProps") return;
    if (ts.isIdentifier(node) && forbidden.has(node.text)) issue = true;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { const value = literal(node.moduleSpecifier); if (value) specs.push(value); }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) { const value = literal(node.moduleReference.expression); if (value) specs.push(value); }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const value = literal(node.arguments[0]); if (value) specs.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return !issue && !specs.some((specifier) => resolveImport(path, specifier) === normalize(retired));
};
const repoPaths = sourcePaths();
const baseline = new Map(repoPaths.map((path) => [path, scanOne(path, read(path))]));
const scan = (overrides: Record<string, string | undefined> = {}) => [...new Set([...repoPaths, ...Object.keys(overrides)])]
  .filter((path) => path !== contract)
  .every((path) => overrides[path] !== undefined ? scanOne(path, overrides[path]!) : (baseline.get(path) ?? scanOne(path, read(path))));
const retiredPresent = (overrides: Record<string, string | undefined> = {}) => existsSync(resolve(root, retired)) || overrides[retired] !== undefined;
const append = (raw: string, value: string) => { const next = `${raw}\n${value}\n`; expect(next).not.toBe(raw); return next; };

describe("milestone checklist retirement boundary", () => {
  test("retires only the orphan checklist and preserves goal/backend seams", () => {
    expect(retiredPresent()).toBe(false);
    expect(scan()).toBe(true);
    expect(read(typePath).includes("MilestoneChecklistProps")).toBe(false);
    expect(read(typePath).includes("MilestoneWorkItem")).toBe(true);
    for (const [path, needles] of sentinels) expect(needles.every((needle) => read(path).includes(needle))).toBe(true);
  });

  test("fails closed for relocated imports, symbols, and templates while ignoring prose", () => {
    const importer = "frontend/src/domains/goals/presentation/components/goals-page.tsx";
    const valid = read(importer);
    const relocated = "frontend/src/domains/goals/presentation/archive/milestone-checklist.tsx";
    const mutations = [
      { [relocated]: "export const MilestoneChecklist = () => null;" },
      { [importer]: append(valid, 'import { MilestoneChecklist } from "./milestone-checklist";') },
      { [importer]: append(valid, 'import type { MilestoneChecklistProps } from "@/domains/goals/domain/types";') },
      { [importer]: append(valid, 'import {\n  MilestoneChecklist,\n} from "./milestone-checklist.tsx";') },
      { [importer]: append(valid, 'export { MilestoneChecklist } from "./milestone-checklist";') },
      { [importer]: append(valid, 'const load = () => import(`./milestone-checklist.tsx`);') },
      { [importer]: append(valid, 'const load = require("./milestone-checklist");') },
      { [importer]: append(valid, 'import Checklist = require("./milestone-checklist");') },
      { [importer]: append(valid, "const copy = `${MilestoneChecklistProps}`;") },
      { [importer]: append(valid, "const prose = `MilestoneChecklist is retired`; // MilestoneChecklistProps") },
      { [typePath]: append(read(typePath), "export const restoredChecklistProps: MilestoneChecklistProps | null = null;") },
      { [retired]: "" },
    ];
    for (const mutation of mutations.slice(0, 9)) expect(scan(mutation)).toBe(false);
    expect(scan(mutations[9]!)).toBe(true);
    expect(scan(mutations[10]!)).toBe(false);
    expect(retiredPresent(mutations[11]!)).toBe(true);
    expect(scan({ [relocated]: "export default () => null;" })).toBe(false);
  });
});
