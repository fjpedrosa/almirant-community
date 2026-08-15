import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAssignmentEmail, buildStatusChangedEmail } from "./email-templates";
import { renderEmailDocumentWithEscapedTitle } from "../../../shared/services/email/render-email-document-with-escaped-title";

const root = resolve(import.meta.dir, "../../../../../../");
const templatePath = resolve(root, "backend/api/src/domains/notifications/services/email-templates.ts");
const adapterPath = resolve(root, "backend/api/src/shared/services/email/render-email-document-with-escaped-title.ts");
const read = (path: string): string => existsSync(path) ? readFileSync(path, "utf8") : "";
const parse = (path: string, source: string): ts.SourceFile =>
  ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const changed = (source: string, needle: string, replacement: string): string => {
  const next = source.replace(needle, replacement);
  expect(next).not.toBe(source);
  return next;
};
const append = (source: string, value: string): string => {
  const next = `${source}\n${value}`;
  expect(next).not.toBe(source);
  return next;
};
const namedImport = (file: ts.SourceFile, moduleName: string, name: string): boolean =>
  file.statements.filter((node): node is ts.ImportDeclaration =>
    ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === moduleName).length === 1 &&
  file.statements.some((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === moduleName && node.importClause?.namedBindings !== undefined &&
    ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some((element) =>
      element.name.text === name && element.propertyName === undefined));

const bindingContains = (name: ts.BindingName | undefined, names: string[]): boolean => {
  if (!name) return false;
  if (ts.isIdentifier(name)) return names.includes(name.text);
  return name.elements.some((element) => ts.isBindingElement(element) &&
    (bindingContains(element.name, names) || (element.propertyName !== undefined && ts.isIdentifier(element.propertyName) &&
      names.includes(element.propertyName.text))));
};
const hasLocalBinding = (file: ts.SourceFile, names: string[]): boolean => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(node)) return;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)) && bindingContains(node.name, names)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return found;
};
const isFunctionLike = (node: ts.Node): boolean => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
const functionBody = (file: ts.SourceFile, name: string): ts.Block | undefined => {
  let body: ts.Block | undefined;
  const visit = (node: ts.Node): void => {
    if (body) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) && ts.isBlock(node.initializer.body)) {
      body = node.initializer.body;
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      body = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return body;
};
const activeCalls = (file: ts.SourceFile, owner: string, name: string): ts.CallExpression[] => {
  const body = functionBody(file, owner);
  const found: ts.CallExpression[] = [];
  if (!body) return found;
  const visit = (node: ts.Node): void => {
    if (node !== body && isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
};

const check = (template = read(templatePath), adapter = read(adapterPath)): boolean => {
  const source = parse(templatePath, template);
  const helper = parse(adapterPath, adapter);
  const builders = ["buildAssignmentEmail", "buildCommentEmail", "buildMentionEmail", "buildStatusChangedEmail"];
  const validCalls = builders.every((builder) => {
    const [call] = activeCalls(source, builder, "renderEmailDocumentWithEscapedTitle");
    if (!call || activeCalls(source, builder, "renderEmailDocumentWithEscapedTitle").length !== 1) return false;
    const arg = call.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
    const property = (name: string) => arg.properties.filter((node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === name);
    const locale = arg.properties.filter((node) => (ts.isShorthandPropertyAssignment(node) && node.name.text === "locale") ||
      (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "locale"));
    const title = property("title")[0]?.initializer;
    return property("title").length === 1 && locale.length === 1 && property("body").length === 1 &&
      title !== undefined && ts.isIdentifier(title) && title.text === "subject";
  });
  const helperImports = namedImport(helper, "./render-email-shell", "renderEmailDocument");
  const helperImportCount = helper.statements.filter((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === "./render-email-shell").length;
  const adapterExport = /export\s+(?:const|function)\s+renderEmailDocumentWithEscapedTitle\b/u.test(adapter);
  const titleEscape = /.replace\(\/&\/g,\s*"&amp;"\).*\.replace\(\/<\/g,\s*"&lt;"\).*\.replace\(\/>\/g,\s*"&gt;"\).*\.replace\(\/"\/g,\s*"&quot;"\)/su.test(adapter);
  const titleMarker = /titleMarker\s*=\s*"__ALMIRANT_EMAIL_TITLE__"/u.test(adapter) &&
    /<title>\$\{titleMarker\}<\/title>/u.test(adapter) && /<title>\$\{escapedTitle\}<\/title>/u.test(adapter);
  return helperImports && helperImportCount === 1 && adapterExport && activeCalls(helper, "renderEmailDocumentWithEscapedTitle", "renderEmailDocument").length === 1 &&
    titleEscape && !/\.replace\(\/'\/g|&#039;|<!DOCTYPE html>|@almirant\/i18n|emails\./u.test(adapter) && titleMarker &&
    namedImport(source, "../../../shared/services/email/render-email-document-with-escaped-title", "renderEmailDocumentWithEscapedTitle") &&
    validCalls && !hasLocalBinding(source, ["renderEmailDocumentWithEscapedTitle"]) &&
    !hasLocalBinding(helper, ["renderEmailDocument"]) &&
    !/\b(?:htmlOpen|htmlClose|wrapInLayout)\b|<!DOCTYPE html>/u.test(template);
};

const assignment = {
  recipientName: "Taylor",
  assignments: [{ ideaItemId: "idea-1", ideaItemTitle: "Plan <Q3>", assignerName: "Alice", itemLink: "https://app.example.com/ideas/i1" }],
  locale: "en" as const,
};
const status = {
  recipientName: "Taylor",
  updates: [{ title: "Quota update", body: "Ready & waiting", itemLink: "https://app.example.com/settings/quota" }],
  locale: "es" as const,
};

describe("notifications email document boundary", () => {
  test("delegates all four builders and preserves raw parity", () => {
    expect(check()).toBe(true);
    expect(createHash("sha256").update(buildAssignmentEmail(assignment.recipientName, assignment.assignments, assignment.locale).html).digest("hex"))
      .toBe("92e0b75a2d8717e9045721eb572e8f304060d75ff0b833674f6e44ae124aa6fb");
    expect(createHash("sha256").update(buildStatusChangedEmail(status.recipientName, status.updates, status.locale).html).digest("hex"))
      .toBe("d9fb5c950c2b6d1c3897ccc6f35220ad86af053514391c83af521f14e19f08e2");
    const rawTitle = "$& $' $` $$";
    expect(renderEmailDocumentWithEscapedTitle({ locale: "en", title: rawTitle, body: "" }))
      .toContain("<title>$&amp; $' $` $$</title>");
  });

  test("rejects aliases, shadows, copied wrappers, and weakened escaping", () => {
    const template = read(templatePath);
    const adapter = read(adapterPath);
    if (!adapter) {
      expect(check(template, adapter)).toBe(false);
      return;
    }
    expect(check(append(template, 'import { renderEmailDocumentWithEscapedTitle as render } from "../../../shared/services/email/render-email-document-with-escaped-title";'), adapter)).toBe(false);
    expect(check(append(template, "const shadow = ({ renderEmailDocumentWithEscapedTitle }: { renderEmailDocumentWithEscapedTitle: string }) => shadow;"), adapter)).toBe(false);
    expect(check(append(template, "const shadow = ({ renderEmailDocumentWithEscapedTitle: local }: { renderEmailDocumentWithEscapedTitle: string }) => local;"), adapter)).toBe(false);
    expect(check(template, append(adapter, "const nested = ({ renderEmailDocument: local }: { renderEmailDocument: unknown }) => local;"))).toBe(false);
    expect(check(changed(template, "const html = renderEmailDocumentWithEscapedTitle({", "const html = \"\";"), adapter)).toBe(false);
    expect(check(changed(template, "  return { subject, html };", "  renderEmailDocumentWithEscapedTitle({ title: subject, locale, body: \"\" });\n  return { subject, html };"), adapter)).toBe(false);
    expect(check(template, append(adapter, "const renderEmailDocument = () => '';"))).toBe(false);
    expect(check(template, append(adapter, 'const local = "<!DOCTYPE html>";'))).toBe(false);
    expect(check(template, append(adapter, 'import { t } from "@almirant/i18n";'))).toBe(false);
    expect(check(template, changed(adapter, ".replace(/</g, \"&lt;\")", ".replace(/</g, \"<\")"))).toBe(false);
    expect(check(template, changed(adapter, '<title>${titleMarker}</title>', '<title>${titleMarker}-wrong</title>'))).toBe(false);
    expect(check(changed(template, "title: subject", "title: escapeHtml(subject)"), adapter)).toBe(false);
    expect(check(append(template, "const htmlOpen = () => ''; const htmlClose = '';"), adapter)).toBe(false);
  });
});
