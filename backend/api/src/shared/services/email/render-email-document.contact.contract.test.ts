import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildContactNotificationHtml } from "./templates/contact-notification";

const root = resolve(import.meta.dir, "../../../../../../");
const helperPath = resolve(root, "backend/api/src/shared/services/email/render-email-shell.ts");
const contactPath = resolve(root, "backend/api/src/shared/services/email/templates/contact-notification.ts");
const read = (path: string) => readFileSync(path, "utf8");
const parse = (path: string, source: string) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const changed = (source: string, needle: string, replacement: string) => {
  const next = source.replace(needle, replacement);
  expect(next).not.toBe(source);
  return next;
};
const append = (source: string, value: string) => changed(source, "", `${value}\n`);

const namedImport = (file: ts.SourceFile, moduleName: string, imported: string, count = 1): boolean => {
  const matches = file.statements.filter((node): node is ts.ImportDeclaration =>
    ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === moduleName);
  if (matches.length !== count) return false;
  return matches.every((node) => {
    const bindings = node.importClause?.namedBindings;
    return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some((element) =>
      element.name.text === imported && element.propertyName === undefined);
  });
};

const calls = (source: ts.SourceFile, name: string): number => {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) count++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
};

const check = (helper = read(helperPath), contact = read(contactPath)): boolean => {
  const helperFile = parse(helperPath, helper);
  const contactFile = parse(contactPath, contact);
  const helperExport = helperFile.statements.some((node) => ts.isVariableStatement(node) &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
    node.declarationList.declarations.some((decl) => ts.isIdentifier(decl.name) && decl.name.text === "renderEmailDocument"));
  const contactImports = contactFile.statements.filter((node): node is ts.ImportDeclaration =>
    ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "../render-email-shell");
  const contactElsewhere = contactFile.statements.some((node) => ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text !== "../render-email-shell" &&
    node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings) &&
    node.importClause.namedBindings.elements.some((element) => ["renderEmailDocument", "escapeHtml"].includes(element.name.text)));
  return helperExport && (helper.match(/<!DOCTYPE html>/gu)?.length ?? 0) === 1 &&
    calls(helperFile, "renderEmailDocument") === 1 &&
    contactImports.length === 1 && namedImport(contactFile, "../render-email-shell", "renderEmailDocument") &&
    namedImport(contactFile, "../render-email-shell", "escapeHtml") && !contactElsewhere &&
    calls(contactFile, "renderEmailDocument") === 1 &&
    !/<!DOCTYPE html>|\b(?:const|let|var|function|class)\s+(?:escapeHtml|renderEmailDocument)\b/u.test(contact) &&
    /<html lang="\$\{escapeHtml\(args\.locale\)\}">/u.test(helper) &&
    /<title>\$\{escapeHtml\(args\.title\)\}<\/title>/u.test(helper) &&
    !/@almirant\/i18n|emails\./u.test(helper);
};

const contactParams = {
  email: "user@example.com", reason: "support", message: "I need help with my account.",
  submissionId: "cs-123", ipAddress: "1.2.3.4", createdAt: new Date("2026-01-15T10:00:00Z").toISOString(),
};

describe("neutral email document boundary", () => {
  test("delegates shell and contact through one escaped document renderer", () => {
    expect(check()).toBe(true);
    expect(createHash("sha256").update(buildContactNotificationHtml(contactParams)).digest("hex"))
      .toBe("d85bf0ff5451aabff53aacb11fc54efb8d6464eadd65f5ac16d6f313b4cc5e81");
  });

  test("rejects fake bindings, duplicate documents, copied i18n, and unsafe title/locale", () => {
    const helper = read(helperPath);
    const contact = read(contactPath);
    expect(check(helper, append(contact, 'import { renderEmailDocument } from "../fake-renderer";'))).toBe(false);
    expect(check(helper, append(contact, 'import { renderEmailDocument as render } from "../render-email-shell";'))).toBe(false);
    expect(check(helper, append(contact, "const renderEmailDocument = () => '';"))).toBe(false);
    expect(check(helper, append(contact, "const html = '<!DOCTYPE html>';"))).toBe(false);
    expect(check(changed(helper, "export const renderEmailDocument", "const renderEmailDocument"), contact)).toBe(false);
    expect(check(changed(helper, "renderEmailDocument({", "renderDocument({"), contact)).toBe(false);
    expect(check(changed(helper, 'export const escapeHtml', 'import { t } from "@almirant/i18n"; export const escapeHtml'), contact)).toBe(false);
    expect(check(changed(helper, "escapeHtml(args.locale)", "args.locale"), contact)).toBe(false);
    expect(check(changed(helper, "escapeHtml(args.title)", "args.title"), contact)).toBe(false);
    expect(check(helper, append(contact, "const escapeHtml = (value: string) => value;"))).toBe(false);
  });
});
