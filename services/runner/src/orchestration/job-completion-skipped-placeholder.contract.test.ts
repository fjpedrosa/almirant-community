import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const target = "services/runner/src/orchestration/job-completion-guards.test.ts";
const placeholder = "RED: Known issues requiring fixes (A-1755)";
const read = () => readFileSync(resolve(root, target), "utf8");
const textOf = (n: ts.Node | undefined) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
const memberText = (n: ts.Expression | undefined): string | undefined => {
  if (n && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = memberText(n.left), right = memberText(n.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return textOf(n);
};
const isRetired = (n: ts.Expression | undefined) => {
  const text = memberText(n);
  return !!text && (text.includes(placeholder) || text.includes("A-1755"));
};
const isBunTest = (n: ts.Expression | undefined) => !!n && ts.isStringLiteral(n) && n.text === "bun:test";

function scan(raw: string): boolean {
  const source = ts.createSourceFile(target, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bindings = new Set<string>();
  let imported = false;
  for (const s of source.statements) {
    if (!ts.isImportDeclaration(s) || !isBunTest(s.moduleSpecifier) || !s.importClause?.namedBindings || !ts.isNamedImports(s.importClause.namedBindings)) continue;
    imported = true;
    for (const e of s.importClause.namedBindings.elements) {
      const name = e.propertyName?.text ?? e.name.text;
      if (["describe", "it", "test"].includes(name)) bindings.add(e.name.text);
    }
  }
  for (const s of source.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
    const initializer = d.initializer;
    if (ts.isIdentifier(d.name) && initializer && ts.isIdentifier(initializer) && bindings.has(initializer.text)) bindings.add(d.name.text);
  }
  let skipped = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      const chain = ts.isCallExpression(c) ? c.expression : c;
      const base = ts.isPropertyAccessExpression(chain) || ts.isElementAccessExpression(chain) ? chain.expression : undefined;
      const member = ts.isPropertyAccessExpression(chain) ? chain.name.text : ts.isElementAccessExpression(chain) ? memberText(chain.argumentExpression!) : undefined;
      const bound = (ts.isIdentifier(chain) && bindings.has(chain.text)) || (base && ts.isIdentifier(base) && bindings.has(base.text));
      if (bound && isRetired(node.arguments[0]) && (!base || member === "skip" || member === "skipIf")) skipped = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imported && bindings.size > 0 && !skipped;
}
const append = (raw: string, value: string) => raw + "\n" + value + "\n";
const safeBase = ['import { describe, it, test } from "bun:test";', 'describe("live suite", () => { it("runs", () => {}); });'].join("\n");

describe("runner skipped placeholder boundary", () => {
  test("removes inert A-1755 placeholder and preserves real tests", () => {
    const targetPath = resolve(root, target);
    if (!existsSync(targetPath)) throw new Error(`missing target: ${target}`);
    const source = read();
    expect(scan(source)).toBe(true);
    expect(source).toContain('describe("extractStructuredSummary"');
    expect(source).toContain('describe("validateRunnerImplementCompletion"');
  });
  test("fails closed for aliases/computed forms while ignoring prose", () => {
    const aliases = 'import { describe as suite } from "bun:test"; const local = describe;';
    const mutations = [
      'describe.skip("RED: Known issues requiring fixes (A-1755)");', `${aliases} suite.skip("RED: Known issues requiring fixes (A-1755)");`, 'const suite = describe; suite.skip("RED: Known issues requiring fixes (A-1755)");',
      'describe["skip"]("RED: Known issues requiring fixes (A-1755)");', 'describe["sk" + "ip"]("RED: Known issues requiring fixes (A-1755)");', 'describe?.skip("RED: Known issues requiring fixes (A-1755)");',
      'describe?.["skip"]("RED: Known issues requiring fixes (A-1755)");', 'describe("RED: Known issues requiring fixes (A-1755)", () => {});',
      '// describe.skip("prose"); const text = `describe.skip()`;', 'const unrelated = { skip: () => {} }; unrelated.skip();',
    ].map((m) => append(safeBase, m));
    for (const mutation of mutations.slice(0, 8)) expect(scan(mutation)).toBe(false);
    expect(scan(mutations[8]!)).toBe(true);
    expect(scan(mutations[9]!)).toBe(true);
    expect(scan(safeBase.replace('from "bun:test"', 'from "not-bun:test"'))).toBe(false);
  });
  test("rejects A-1755 skipIf chains but allows unrelated Bun skips", () => {
    const aliases = 'import { describe as suite } from "bun:test"; const local = suite;';
    const retired = [
      'describe.skipIf(true)("RED: Known issues requiring fixes (A-1755)", () => {});',
      `${aliases} suite.skipIf(true)("RED: Known issues requiring fixes (A-1755)", () => {});`,
      'const suite = describe; suite.skipIf(true)("RED: Known issues requiring fixes (A-1755)", () => {});',
    ].map((m) => append(safeBase, m));
    for (const mutation of retired) expect(scan(mutation)).toBe(false);
    expect(scan(append(safeBase, 'test.skip("valid reason", () => {}); describe.skip("valid reason", () => {});'))).toBe(true);
  });
});
