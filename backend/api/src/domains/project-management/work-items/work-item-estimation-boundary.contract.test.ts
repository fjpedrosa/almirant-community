import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../../../");
const self = "backend/api/src/domains/project-management/work-items/work-item-estimation-boundary.contract.test.ts";
const oldPath = "backend/api/src/mcp/tools/work-item-estimation-enqueue";
const newPath = "backend/api/src/domains/project-management/work-items/services/work-item-estimation-enqueue";
const text = (n: ts.Node | undefined) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
const stem = (p: string) => p.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\/index$/u, "");
const resolveRef = (file: string, spec: string) => spec.startsWith("@/") ? stem(`backend/api/src/${spec.slice(2)}`) : spec.startsWith(".") ? stem(posix.normalize(posix.join(posix.dirname(file), spec))) : undefined;
const files = () => {
  const result: Record<string, string> = {};
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  for (const file of listed.trim().split("\n").filter((p) => p !== self && /\.[cm]?[jt]sx?$/u.test(p))) if (existsSync(resolve(root, file))) result[file] = readFileSync(resolve(root, file), "utf8");
  return result;
};
function refs(code: string): string[] {
  const source = ts.createSourceFile("scan.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), result: string[] = [];
  const add = (n: ts.Node | undefined) => { const value = text(n); if (value) result.push(value); };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
const scan = (sources: Record<string, string>) => {
  const hasPath = (path: string) => Object.keys(sources).some((file) => stem(file) === path);
  if (!hasPath(newPath) || hasPath(oldPath)) return false;
  for (const [file, code] of Object.entries(sources)) for (const spec of refs(code)) if (resolveRef(file, spec) === oldPath) return false;
  return true;
};
const withSource = (source: Record<string, string>, file: string, code: string) => ({ ...source, [file]: code });
const without = (source: Record<string, string>, path: string) => Object.fromEntries(Object.entries(source).filter(([file]) => stem(file) !== path));

describe("work-item estimation helper boundary", () => {
  test("moves the helper out of MCP tools", () => expect(scan(files())).toBe(true));
  test("rejects restored/relocated helpers and every old import form", () => {
    const live = files(), importer = "backend/api/src/mcp/tools/work-items.tools.ts";
    expect(scan(withSource(live, oldPath, "export {};"))).toBe(false);
    const missing = without(live, newPath);
    expect(scan(missing)).toBe(false);
    const relocated = withSource(without(live, newPath), `${oldPath}.ts`, live[`${newPath}.ts`]!);
    expect(scan(relocated)).toBe(false);
    for (const spec of ["./work-item-estimation-enqueue", "./work-item-estimation-enqueue.ts", "./work-item-estimation-enqueue/index", "@/mcp/tools/work-item-estimation-enqueue"]) expect(scan(withSource(live, importer, `import x from "${spec}";`))).toBe(false);
    for (const expression of ["import(\"./work-item-estimation-enqueue\")", "require(\"./work-item-estimation-enqueue\")", "export * from \"./work-item-estimation-enqueue\""]) expect(scan(withSource(live, importer, expression))).toBe(false);
    expect(scan(withSource(live, importer, '// import "./work-item-estimation-enqueue"; const prose = `require("./work-item-estimation-enqueue")`;'))).toBe(true);
  });
});
