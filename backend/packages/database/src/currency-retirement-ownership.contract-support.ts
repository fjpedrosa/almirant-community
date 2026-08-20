import { posix } from "node:path";
import ts from "typescript";

export type TrackedSource = Readonly<{ path: string; source: string }>;
type Binding = Readonly<{ kind: "safe" | "literal" | "owner-value" | "owner-namespace"; text?: string }>;
type Scope = { parent?: Scope; kind: "module" | "block" | "function"; bindings: Map<string, Binding> };

const retiredNames = new Set(["getLatestExchangeRate", "upsertExchangeRates", "getExchangeRatesForDate"]);
const safe: Binding = { kind: "safe" };
const ownerValue: Binding = { kind: "owner-value" };
const ownerNamespace: Binding = { kind: "owner-namespace" };
const codeExtension = /(?:\.d\.(?:ts|mts|cts)|\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))$/i;
const normalize = (value: string) => posix.normalize(value.replaceAll("\\", "/").split(/[?#]/, 1)[0]!).replace(/^\.\//, "");
const withoutExtension = (value: string) => normalize(value).replace(codeExtension, "");
const isOwnerPath = (path: string) => /^backend\/packages\/database\/src(?:\/|$)/.test(withoutExtension(path));

const moduleIdentity = (specifier: string, fromPath: string) => {
  const raw = specifier.replaceAll("\\", "/").split(/[?#]/, 1)[0]!;
  const value = withoutExtension(raw);
  if (value === "@almirant/database" || value.startsWith("@almirant/database/")) {
    return { owner: true, retired: posix.basename(value) === "currency-rate-repository" };
  }
  if (value.startsWith("@")) return { owner: false, retired: false };
  const local = /^(?:\.{1,2}\/|\/|backend\/|src\/|repositories\/)/.test(raw);
  if (!local) return { owner: false, retired: false };
  let resolved = value;
  if (value.startsWith("src/") && isOwnerPath(fromPath)) resolved = `backend/packages/database/${value}`;
  else if (value.startsWith("repositories/") && isOwnerPath(fromPath)) resolved = `backend/packages/database/src/${value}`;
  else if (!value.startsWith("backend/") && !value.startsWith("/")) resolved = posix.join(posix.dirname(normalize(fromPath)), value);
  return { owner: isOwnerPath(resolved), retired: isOwnerPath(resolved) && posix.basename(resolved) === "currency-rate-repository" };
};

const eachBindingName = (name: ts.BindingName, visit: (identifier: ts.Identifier) => void): void => {
  if (ts.isIdentifier(name)) visit(name);
  else
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) eachBindingName(element.name, visit);
    }
};

const buildScopes = (file: ts.SourceFile) => {
  const scopes = new WeakMap<ts.Node, Scope>();
  const addBinding = (scope: Scope, name: ts.BindingName | ts.Identifier) =>
    eachBindingName(name as ts.BindingName, (identifier) => scope.bindings.set(identifier.text, safe));
  const nearestFunction = (scope: Scope) => {
    let target = scope;
    while (target.kind === "block" && target.parent) target = target.parent;
    return target;
  };
  const walk = (node: ts.Node, parentScope: Scope): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) addBinding(parentScope, node.name);
    let scope = parentScope;
    if (node !== file && ts.isFunctionLike(node)) {
      scope = { parent: parentScope, kind: "function", bindings: new Map() };
      if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) addBinding(scope, node.name);
      for (const parameter of node.parameters) addBinding(scope, parameter.name);
    } else if (node !== file && (ts.isClassExpression(node) || ts.isClassDeclaration(node))) {
      scope = { parent: parentScope, kind: "block", bindings: new Map() };
      if (node.name) addBinding(scope, node.name);
    } else if (
      node !== file &&
      (ts.isBlock(node) ||
        ts.isCatchClause(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isSwitchStatement(node))
    ) {
      scope = { parent: parentScope, kind: "block", bindings: new Map() };
      if (ts.isCatchClause(node) && node.variableDeclaration) addBinding(scope, node.variableDeclaration.name);
    }
    scopes.set(node, scope);
    if (ts.isVariableDeclaration(node)) {
      const list = node.parent;
      const target = ts.isVariableDeclarationList(list) && !(list.flags & ts.NodeFlags.BlockScoped) ? nearestFunction(scope) : scope;
      addBinding(target, node.name);
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      if (node.importClause.name) addBinding(scope, node.importClause.name);
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) addBinding(scope, bindings.name);
      else if (bindings) for (const element of bindings.elements) addBinding(scope, element.name);
    } else if (ts.isImportEqualsDeclaration(node)) addBinding(scope, node.name);
    ts.forEachChild(node, (child) => walk(child, scope));
  };
  walk(file, { kind: "module", bindings: new Map() });
  return scopes;
};

const scanModule = (input: TrackedSource) => {
  const violations: string[] = [];
  if (posix.basename(withoutExtension(input.path)) === "currency-rate-repository") violations.push(`${input.path}: retired path`);
  const file = ts.createSourceFile(input.path, input.source, ts.ScriptTarget.ESNext, true);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  const invalidJs =
    /\.(?:jsx?|mjs|cjs)$/i.test(normalize(input.path)) &&
    (ts.transpileModule(input.source, { fileName: input.path, reportDiagnostics: true }).diagnostics ?? []).some(
      ({ category }) => category === ts.DiagnosticCategory.Error,
    );
  if (diagnostics.length || invalidJs) return [...violations, `${input.path}: invalid code`];
  const scopes = buildScopes(file);
  const ownsFile = isOwnerPath(input.path);
  const report = (reason: string) => violations.push(`${input.path}: ${reason}`);
  const find = (node: ts.Node, name: string) => {
    let scope: Scope | undefined = scopes.get(node)!;
    while (scope) {
      if (scope.bindings.has(name)) return { scope, value: scope.bindings.get(name)! };
      scope = scope.parent;
    }
  };
  const lookup = (node: ts.Node, name: string) => find(node, name)?.value ?? safe;
  const set = (node: ts.Node, name: string, value: Binding) => {
    const binding = find(node, name);
    if (binding) binding.scope.bindings.set(name, value);
  };
  const constantName = (node: ts.Expression | ts.PropertyName | undefined): string | undefined => {
    if (!node) return;
    if (ts.isIdentifier(node)) {
      const value = lookup(node, node.text);
      return value.kind === "literal" ? value.text : undefined;
    }
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return constantName(node.expression);
  };
  const load = (node: ts.CallExpression): Binding => {
    const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const literalRequire = ts.isIdentifier(node.expression) && node.expression.text === "require" && !find(node.expression, "require");
    if ((!dynamicImport && !literalRequire) || !ts.isStringLiteralLike(node.arguments[0])) return safe;
    const identity = moduleIdentity(node.arguments[0].text, input.path);
    if (identity.retired) report("retired module");
    return identity.owner ? ownerNamespace : safe;
  };
  const valueOf = (node: ts.Expression | undefined, allowBindings = true): Binding => {
    if (!node) return safe;
    if (ts.isStringLiteralLike(node)) return { kind: "literal", text: node.text };
    if (ts.isIdentifier(node)) return allowBindings ? lookup(node, node.text) : safe;
    if (ts.isCallExpression(node)) return load(node);
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !node.questionDotToken) {
      const base = valueOf(node.expression, allowBindings);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : constantName(node.argumentExpression);
      if (base.kind === "owner-namespace") {
        if (name && retiredNames.has(name)) report("retired member");
        return name === "default" ? ownerNamespace : ownerValue;
      }
    }
    return safe;
  };
  const publicExport = (name: string, value: Binding) => {
    if (value.kind === "owner-namespace") report("owner namespace export");
    if (retiredNames.has(name) && (ownsFile || value.kind === "owner-value" || value.kind === "owner-namespace")) report("retired public export");
  };
  const moduleSource = (node: ts.Expression | undefined) => {
    if (!node || !ts.isStringLiteralLike(node)) return { owner: false, retired: false };
    const identity = moduleIdentity(node.text, input.path);
    if (identity.retired) report("retired module");
    return identity;
  };
  const isCjsRoot = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && node.text === "exports" && !find(node, "exports")) ||
    ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "module" &&
      !find(node.expression, "module") &&
      (ts.isPropertyAccessExpression(node) ? node.name.text : constantName(node.argumentExpression)) === "exports");
  const cjsName = (node: ts.Expression) => {
    if (isCjsRoot(node)) return "*";
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isCjsRoot(node.expression))
      return ts.isPropertyAccessExpression(node) ? node.name.text : constantName(node.argumentExpression);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const identity = moduleSource(node.moduleSpecifier);
      const clause = node.importClause;
      if (identity.owner && clause?.name) set(clause.name, clause.name.text, ownerNamespace);
      const bindings = clause?.namedBindings;
      if (identity.owner && bindings && ts.isNamespaceImport(bindings)) set(bindings.name, bindings.name.text, ownerNamespace);
      else if (identity.owner && bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (retiredNames.has(imported)) report("retired import");
          set(element.name, element.name.text, imported === "default" ? ownerNamespace : ownerValue);
        }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      const externalOwner = ts.isExternalModuleReference(reference) && moduleSource(reference.expression).owner;
      const internalOwner =
        ts.isQualifiedName(reference) && ts.isIdentifier(reference.left) && lookup(reference.left, reference.left.text).kind === "owner-namespace";
      const value = externalOwner ? ownerNamespace : internalOwner ? ownerValue : safe;
      if (value.kind !== "safe") set(node.name, node.name.text, value);
      if (node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) publicExport(node.name.text, value);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const identity = moduleSource(node.argument.literal as ts.Expression);
      const imported = node.qualifier?.getText(file).split(".")[0];
      if (identity.owner && imported && retiredNames.has(imported)) report("retired import type");
    } else if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      lookup(node.left, node.left.text).kind === "owner-namespace" &&
      retiredNames.has(node.right.text)
    ) {
      report("retired type member");
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const value = valueOf(node.initializer, false);
      const list = node.parent;
      if (value.kind !== "safe" && (!value.text || (ts.isVariableDeclarationList(list) && Boolean(list.flags & ts.NodeFlags.Const))))
        set(node.name, node.name.text, value);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.initializer) {
      set(node.name, node.name.text, valueOf(node.initializer, false));
    } else if (ts.isExportDeclaration(node)) {
      const identity = moduleSource(node.moduleSpecifier);
      if (!node.exportClause && identity.owner) report("owner star export");
      if (node.exportClause && ts.isNamespaceExport(node.exportClause) && identity.owner) report("owner namespace export");
      if (node.exportClause && ts.isNamedExports(node.exportClause))
        for (const element of node.exportClause.elements) {
          const original = (element.propertyName ?? element.name).text;
          const value = identity.owner ? (original === "default" ? ownerNamespace : ownerValue) : lookup(element, original);
          if (identity.owner && retiredNames.has(original)) report("retired reexport");
          publicExport(element.name.text, value);
        }
    } else if (ts.isExportAssignment(node)) {
      publicExport("default", valueOf(node.expression));
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const isDefault = node.modifiers.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword);
      publicExport(isDefault ? "default" : node.name.text, safe);
    } else if (ts.isVariableStatement(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) publicExport(declaration.name.text, valueOf(declaration.initializer, false));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = cjsName(node.left);
      if (name === "*") publicExport("default", valueOf(node.right));
      else if (name) publicExport(name, valueOf(node.right));
    } else if (ts.isCallExpression(node)) {
      load(node);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      valueOf(node);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of file.statements) if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) visit(statement);
  visit(file);
  return violations;
};

export const scanCurrencyRetirementOwnership = (files: readonly TrackedSource[]) =>
  [...new Set(files.flatMap((file) => (codeExtension.test(normalize(file.path)) ? scanModule(file) : [])))].sort();
