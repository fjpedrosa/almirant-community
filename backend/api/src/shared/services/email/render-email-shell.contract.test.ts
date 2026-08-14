import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildEmailWorkItemMoved } from "./templates";

const root = resolve(import.meta.dir, "../../../../../../");
const templatePath = resolve(root, "backend/api/src/shared/services/email/templates.ts");
const helperPath = resolve(root, "backend/api/src/shared/services/email/render-email-shell.ts");
const read = (path: string) => readFileSync(path, "utf8");
const parse = (path: string, source: string) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const changed = (source: string, needle: string, replacement: string) => {
  const next = source.replace(needle, replacement);
  expect(next).not.toBe(source);
  return next;
};
const append = (source: string, value: string) => changed(source, "", `${value}\n`);
const check = (template = read(templatePath), helper = read(helperPath)) => {
  const source = parse(templatePath, template);
  const imports = source.statements.filter((node): node is ts.ImportDeclaration =>
    ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier));
  const moduleName = (node: ts.ImportDeclaration) => (node.moduleSpecifier as ts.StringLiteral).text;
  const shellImports = imports.filter((node) => moduleName(node) === "./render-email-shell");
  const importedShellElsewhere = imports.some((node) => {
    const bindings = node.importClause?.namedBindings;
    return moduleName(node) !== "./render-email-shell" && bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => ts.isIdentifier(element.name) && element.name.text === "renderEmailShell");
  });
  const binding = shellImports[0]?.importClause?.namedBindings;
  const canonical = binding !== undefined && ts.isNamedImports(binding) && binding.elements.some((element) =>
    ts.isIdentifier(element.name) && element.name.text === "renderEmailShell" && !element.propertyName);
  let shellCalls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "renderEmailShell") shellCalls++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const preheaders = helper.match(/escapeHtml\(args\.preheader\)/gu)?.length ?? 0;
  return shellImports.length === 1 && !importedShellElsewhere && canonical && shellCalls === 6 &&
    !/wrapInLayout|<!DOCTYPE html>|\b(?:const|let|var|function|class)\s+renderEmailShell\b/u.test(template) &&
    preheaders === 1 && /renderEmailDocument\(\{/u.test(helper) && /<html lang="\$\{escapeHtml\(args\.locale\)\}">/u.test(helper) &&
    !/@almirant\/i18n|emails\./u.test(helper) &&
    /escapeHtml\(args\.ctaUrl\)|escapeHtml\(args\.ctaLabel\)|escapeHtml\(args\.footerText\)/u.test(helper);
};

const representative = {
  taskId: "WI-42", title: "Migration", projectName: "Project", boardName: "Board",
  fromColumnName: "Todo", toColumnName: "Done", url: "https://example.com/work-items/42", locale: "en" as const,
};

describe("neutral email shell boundary", () => {
  test("uses one canonical pure shell adapter and preserves rendered output", () => {
    expect(check()).toBe(true);
    const html = buildEmailWorkItemMoved(representative).html;
    expect(createHash("sha256").update(html).digest("hex")).toBe("2a7a4e2f276f7d9d090ffa3a21c93c83055347f742002c0591aa0106f55be4d8");
  });

  test("rejects aliases, fake imports, local shells, copied i18n, and unsafe preheaders", () => {
    const template = read(templatePath);
    const helper = read(helperPath);
    expect(check(append(template, 'import { renderEmailShell } from \"./render-email-shell-fake\";'))).toBe(false);
    expect(check(append(template, 'import { renderEmailShell as shell } from "./render-email-shell";'))).toBe(false);
    expect(check(append(template, "const renderEmailShell = () => '';"))).toBe(false);
    expect(check(template, changed(helper, 'export const escapeHtml', 'import { t } from "@almirant/i18n"; export const escapeHtml'))).toBe(false);
    expect(check(template, changed(helper, "escapeHtml(args.preheader)", "args.preheader"))).toBe(false);
    expect(check(template, changed(helper, "escapeHtml(args.locale)", "args.locale"))).toBe(false);
    expect(check(append(template, "const text = '<!DOCTYPE html>';"))).toBe(false);
  });
});
