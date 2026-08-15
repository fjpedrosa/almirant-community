import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildInvitationEmailHtml } from "./templates/invitation";
import { escapedTitle, renderEmailDocumentWithPreescapedTitle } from "./render-email-document-with-preescaped-title";

const root = resolve(import.meta.dir, "../../../../../../");
const adapterPath = resolve(root, "backend/api/src/shared/services/email/render-email-document-with-preescaped-title.ts");
const invitationPath = resolve(root, "backend/api/src/shared/services/email/templates/invitation.ts");
const read = (path: string): string => readFileSync(path, "utf8");
const parse = (path: string, source: string): ts.SourceFile => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const changed = (source: string, needle: string, replacement: string): string => {
  const next = source.replace(needle, replacement);
  expect(next).not.toBe(source);
  return next;
};
const appended = (source: string, value: string): string => {
  const next = `${source}\n${value}`;
  expect(next).not.toBe(source);
  return next;
};
const canonicalImport = (file: ts.SourceFile, moduleName: string, names: string[]): boolean => {
  const imports = file.statements.filter((node): node is ts.ImportDeclaration => ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === moduleName);
  if (imports.length !== 1) return false;
  const bindings = imports[0]?.importClause?.namedBindings;
  return !!bindings && ts.isNamedImports(bindings) && bindings.elements.length === names.length &&
    names.every((name) => bindings.elements.some((element) => element.name.text === name && element.propertyName === undefined));
};
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
    if (found || ts.isImportDeclaration(node)) return;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      bindingContains(node.name, names)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return found;
};
const calls = (file: ts.SourceFile, name: string): number => {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) count++;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
};
const invitationReturn = (file: ts.SourceFile): ts.CallExpression | undefined => {
  const declaration = file.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find((node) => ts.isIdentifier(node.name) && node.name.text === "buildInvitationEmailHtml");
  const initializer = declaration?.initializer;
  const body = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && ts.isBlock(initializer.body)
    ? initializer.body : undefined;
  if (!body) return undefined;
  const returns = body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1 || !returns[0]?.expression || !ts.isCallExpression(returns[0].expression)) return undefined;
  return returns[0].expression;
};
const objectProperty = (call: ts.CallExpression, name: string): ts.Expression | undefined => {
  const object = call.arguments[0];
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  const property = object.properties.find((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) &&
    ts.isIdentifier(node.name) && node.name.text === name);
  return property?.initializer;
};
const taggedTitle = (call: ts.CallExpression): boolean => {
  const title = objectProperty(call, "title");
  if (!title || !ts.isTaggedTemplateExpression(title) || !ts.isIdentifier(title.tag) || title.tag.text !== "escapedTitle" ||
    !ts.isTemplateExpression(title.template)) return false;
  const span = title.template.templateSpans[0];
  return title.template.head.text === "You've been invited to " && title.template.templateSpans.length === 1 && !!span &&
    ts.isIdentifier(span.expression) && span.expression.text === "workspaceName" && span.literal.text === "";
};
const check = (adapter = read(adapterPath), invitation = read(invitationPath)): boolean => {
  const adapterFile = parse(adapterPath, adapter);
  const invitationFile = parse(invitationPath, invitation);
  const returned = invitationReturn(invitationFile);
  const adapterImport = canonicalImport(adapterFile, "./render-email-shell", ["escapeHtml", "renderEmailDocument"]);
  const adapterImportedElsewhere = adapterFile.statements.some((node) => ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text !== "./render-email-shell");
  const invitationImport = canonicalImport(invitationFile, "../render-email-document-with-preescaped-title", ["escapedTitle", "renderEmailDocumentWithPreescapedTitle"]);
  const adapterCall = adapterFile.statements.some((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && declaration.name.text === "renderEmailDocumentWithPreescapedTitle"));
  return adapterImport && !adapterImportedElsewhere && invitationImport && !!returned && ts.isIdentifier(returned.expression) &&
    returned.expression.text === "renderEmailDocumentWithPreescapedTitle" && taggedTitle(returned) && adapterCall &&
    calls(adapterFile, "renderEmailDocument") === 1 &&
    /const titleMarker = "__ALMIRANT_PREESCAPED_TITLE__"/u.test(adapter) &&
    /export type EscapedTitle\s*=\s*\{/u.test(adapter) && /export const escapedTitle\s*=\s*\(/u.test(adapter) &&
    /const escapedTitleBrand = Symbol\("EscapedTitle"\)/u.test(adapter) &&
    /\[escapedTitleBrand\]: true/u.test(adapter) && /escapeHtml\(values\[index\]!\)/u.test(adapter) &&
    /\.replace\(`<title>\$\{titleMarker\}<\/title>`,\s*\(\)\s*=>\s*`<title>\$\{args\.title\.value\}<\/title>`\)/u.test(adapter) &&
    !hasLocalBinding(adapterFile, ["escapeHtml", "renderEmailDocument"]) &&
    !hasLocalBinding(invitationFile, ["escapeHtml", "escapedTitle", "renderEmailDocumentWithPreescapedTitle"]) &&
    /role === "owner" \? "#7c3aed" : role === "admin" \? "#2563eb" : "#059669"/u.test(invitation) &&
    !/<!DOCTYPE html>|@almirant\/i18n|emails\./u.test(invitation) &&
    /body: `  <table/u.test(invitation) && /bodyStyle: "margin:0;padding:0;background-color:#f4f4f5/u.test(invitation);
};

const params = { acceptUrl: "https://app.example.com/accept-invitation/inv-abc-123", workspaceName: "Acme Workspace", inviterName: "Jane Admin", inviterEmail: "jane@example.com", role: "member" };

describe("invitation preescaped title document boundary", () => {
  test("uses the branded title seam and preserves all invitation parity", () => {
    expect(check()).toBe(true);
    expect(createHash("sha256").update(buildInvitationEmailHtml({ ...params, role: "owner" })).digest("hex"))
      .toBe("60034d9929a043c88a50b38722a45939713a3593f3ae61a871e2756037028c4e");
    expect(createHash("sha256").update(buildInvitationEmailHtml({ ...params, role: "admin" })).digest("hex"))
      .toBe("95c16ade92d73fdc98eaddd6cd06e0693c3043728565550ea0204f6a35e43a3c");
    expect(createHash("sha256").update(buildInvitationEmailHtml(params)).digest("hex"))
      .toBe("95379993b46dd5bd8734ffb08edd9f7b2d320a1a33cb67384a2be26023e0fa93");
    expect(buildInvitationEmailHtml({ ...params, workspaceName: "Workspace <Alpha>" }))
      .toContain("<title>You've been invited to Workspace &lt;Alpha&gt;</title>");
    const tokens = "$& $' $` $$";
    const literalStrings = [tokens] as unknown as TemplateStringsArray;
    expect(renderEmailDocumentWithPreescapedTitle({ locale: "en", title: escapedTitle(literalStrings), body: "" }))
      .toContain(`<title>${tokens}</title>`);
  });
  test("rejects aliases, shadows, copied documents, inactive calls, and unsafe title seams", () => {
    const adapter = read(adapterPath);
    const invitation = read(invitationPath);
    expect(check(adapter, appended(invitation, 'import { renderEmailDocumentWithPreescapedTitle as render } from "../render-email-document-with-preescaped-title";'))).toBe(false);
    expect(check(adapter, appended(invitation, "const renderEmailDocumentWithPreescapedTitle = () => '';"))).toBe(false);
    expect(check(adapter, appended(invitation, "const escapedTitle = String;"))).toBe(false);
    expect(check(appended(adapter, 'import { renderEmailDocument } from "./fake-renderer";'), invitation)).toBe(false);
    expect(check(appended(adapter, "const dead = () => renderEmailDocument({});"), invitation)).toBe(false);
    expect(check(appended(adapter, "const fake = ({ renderEmailDocument: local }: { renderEmailDocument: unknown }) => local;"), invitation)).toBe(false);
    expect(check(adapter, changed(invitation, "return renderEmailDocumentWithPreescapedTitle({", "renderEmailDocumentWithPreescapedTitle({}); return '';"))).toBe(false);
    expect(check(changed(adapter, "() => `<title>${args.title.value}</title>`", "`<title>${args.title.value}</title>`"), invitation)).toBe(false);
    expect(check(changed(adapter, "titleMarker = \"__ALMIRANT_PREESCAPED_TITLE__\"", "titleMarker = \"wrong\""), invitation)).toBe(false);
    expect(check(adapter, appended(invitation, "const nested = ({ escapedTitle }: { escapedTitle: unknown }) => escapedTitle;"))).toBe(false);
    expect(check(adapter, changed(invitation, "role === \"owner\"", "role === \"other\""))).toBe(false);
    expect(check(adapter, changed(invitation, "body: `  <table", "body: `\n  <table"))).toBe(false);
    expect(check(changed(adapter, "const escapedTitleBrand = Symbol(\"EscapedTitle\")", "const escapedTitleBrand = Symbol(\"Wrong\")"), invitation)).toBe(false);
    expect(check(changed(adapter, "escapeHtml(values[index]!)", "values[index]!"), invitation)).toBe(false);
    expect(check(adapter, changed(invitation, "title: escapedTitle`You've been invited to ${workspaceName}`", "title: escapedTitle`You've been invited to ${workspaceName + \"unsafe\"}`"))).toBe(false);
  });
});
