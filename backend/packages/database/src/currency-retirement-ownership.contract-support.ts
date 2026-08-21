import { posix } from "node:path";
import ts from "typescript";

export type TrackedSource = Readonly<{ path: string; source: string }>;
type Binding = Readonly<{ kind: "safe" | "literal" | "owner-value" | "owner-namespace"; text?: string; members?: readonly string[] }>;
type Scope = { parent?: Scope; kind: "module" | "block" | "function"; values: Map<string, Binding>; types: Map<string, Binding> };

const retiredNames = new Set(["getLatestExchangeRate", "upsertExchangeRates", "getExchangeRatesForDate"]);
const safe: Binding = { kind: "safe" };
const ownerNamespace: Binding = { kind: "owner-namespace" };
const ownerValue = (member?: string): Binding => ({ kind: "owner-value", members: member ? [member] : [] });
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
  const add = (scope: Scope, name: ts.BindingName | ts.Identifier, spaces: "value" | "type" | "both") =>
    eachBindingName(name as ts.BindingName, ({ text }) => {
      if (spaces !== "type") scope.values.set(text, safe);
      if (spaces !== "value") scope.types.set(text, safe);
    });
  const nearestFunction = (scope: Scope) => {
    let target = scope;
    while (target.kind === "block" && target.parent) target = target.parent;
    return target;
  };
  const walk = (node: ts.Node, parentScope: Scope): void => {
    if (ts.isFunctionDeclaration(node) && node.name) add(parentScope, node.name, "value");
    else if (ts.isClassDeclaration(node) && node.name) add(parentScope, node.name, "both");
    else if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) add(parentScope, node.name, "type");
    else if (ts.isEnumDeclaration(node)) add(parentScope, node.name, "both");
    else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) add(parentScope, node.name, "both");
    let scope = parentScope;
    if (node !== file && ts.isFunctionLike(node)) {
      scope = { parent: parentScope, kind: "function", values: new Map(), types: new Map() };
      if (ts.isFunctionExpression(node) && node.name) add(scope, node.name, "value");
      for (const parameter of node.parameters) add(scope, parameter.name, "value");
    } else if (node !== file && (ts.isClassExpression(node) || ts.isClassDeclaration(node))) {
      scope = { parent: parentScope, kind: "block", values: new Map(), types: new Map() };
      if (ts.isClassExpression(node) && node.name) add(scope, node.name, "both");
    } else if (node !== file && (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.typeParameters?.length) {
      scope = { parent: parentScope, kind: "block", values: new Map(), types: new Map() };
    } else if (
      node !== file &&
      (ts.isBlock(node) ||
        ts.isModuleBlock(node) ||
        ts.isCatchClause(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isSwitchStatement(node))
    ) {
      scope = { parent: parentScope, kind: "block", values: new Map(), types: new Map() };
      if (ts.isCatchClause(node) && node.variableDeclaration) add(scope, node.variableDeclaration.name, "value");
    }
    const typeParameters = (node as ts.Node & { readonly typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
    for (const parameter of typeParameters ?? []) add(scope, parameter.name, "type");
    scopes.set(node, scope);
    if (ts.isVariableDeclaration(node)) {
      const list = node.parent;
      const target = ts.isVariableDeclarationList(list) && !(list.flags & ts.NodeFlags.BlockScoped) ? nearestFunction(scope) : scope;
      add(target, node.name, "value");
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) add(scope, clause.name, clause.isTypeOnly ? "type" : "both");
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) add(scope, bindings.name, clause.isTypeOnly ? "type" : "both");
      else if (bindings)
        for (const element of bindings.elements) add(scope, element.name, clause.isTypeOnly || element.isTypeOnly ? "type" : "both");
    } else if (ts.isImportEqualsDeclaration(node)) add(scope, node.name, node.isTypeOnly ? "type" : "both");
    ts.forEachChild(node, (child) => walk(child, scope));
  };
  walk(file, { kind: "module", values: new Map(), types: new Map() });
  return scopes;
};

const scanModule = (input: TrackedSource) => {
  const violations = new Set<string>();
  if (posix.basename(withoutExtension(input.path)) === "currency-rate-repository") violations.add(`${input.path}: retired path`);
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
  const report = (reason: string) => violations.add(`${input.path}: ${reason}`);
  const find = (node: ts.Node, name: string, space: "value" | "type" = "value") => {
    let scope: Scope | undefined = scopes.get(node)!;
    while (scope) {
      const bindings = space === "value" ? scope.values : scope.types;
      if (bindings.has(name)) return { bindings, value: bindings.get(name)! };
      scope = scope.parent;
    }
  };
  const lookup = (node: ts.Node, name: string, space: "value" | "type" = "value") => find(node, name, space)?.value ?? safe;
  const merge = (left: Binding, right: Binding): Binding => {
    if (!right.kind.startsWith("owner-")) return left.kind === "safe" ? right : left;
    if (!left.kind.startsWith("owner-")) return right;
    const members = [...new Set([...(left.members ?? []), ...(right.members ?? [])])];
    return { kind: left.kind === "owner-namespace" || right.kind === "owner-namespace" ? "owner-namespace" : "owner-value", members };
  };
  let mutations = 0;
  const set = (node: ts.Node, name: string, value: Binding, space: "value" | "type" = "value") => {
    const binding = find(node, name, space);
    if (!binding) return false;
    const next = merge(binding.value, value);
    if (JSON.stringify(next) === JSON.stringify(binding.value)) return false;
    binding.bindings.set(name, next);
    mutations++;
    return true;
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
  const unwrap = <T extends ts.Node>(node: T): T => {
    let current: ts.Node = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isParenthesizedTypeNode(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    )
      current = ts.isParenthesizedTypeNode(current) ? current.type : current.expression;
    return current as T;
  };
  const member = (base: Binding, name: string | undefined): Binding => {
    if (base.kind !== "owner-namespace" || !name) return safe;
    if (retiredNames.has(name)) report("retired member");
    return name === "default" ? base : ownerValue(name);
  };
  const valueOf = (node: ts.Expression | undefined, allowBindings = true): Binding => {
    if (!node) return safe;
    node = unwrap(node);
    if (ts.isStringLiteralLike(node)) return { kind: "literal", text: node.text };
    if (ts.isIdentifier(node)) return allowBindings ? lookup(node, node.text) : safe;
    if (ts.isCallExpression(node)) return load(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) return assignmentValue(node);
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !node.questionDotToken) {
      const base = valueOf(node.expression, allowBindings);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : constantName(node.argumentExpression);
      return member(base, name);
    }
    return safe;
  };
  const entity = (node: ts.EntityName, space: "value" | "type"): Binding =>
    ts.isIdentifier(node) ? lookup(node, node.text, space) : member(entity(node.left, space), node.right.text);
  const typeOf = (node: ts.TypeNode): Binding => {
    node = unwrap(node);
    if (ts.isTypeOperatorNode(node)) return node.operator === ts.SyntaxKind.KeyOfKeyword ? safe : typeOf(node.type);
    if (ts.isArrayTypeNode(node)) return typeOf(node.elementType);
    if (ts.isTypeReferenceNode(node)) return entity(node.typeName, "type");
    if (ts.isTypeQueryNode(node)) return entity(node.exprName, "value");
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const identity = moduleSource(node.argument.literal as ts.Expression);
      if (!identity.owner || !node.qualifier) return identity.owner ? ownerNamespace : safe;
      return entityFrom(node.qualifier, ownerNamespace);
    }
    return safe;
  };
  const entityFrom = (node: ts.EntityName, base: Binding): Binding => {
    const names: string[] = [];
    let current = node;
    while (ts.isQualifiedName(current)) {
      names.unshift(current.right.text);
      current = current.left;
    }
    names.unshift(current.text);
    return names.reduce(member, base);
  };
  const bindName = (name: ts.BindingName, value: Binding, node: ts.Node): void => {
    if (ts.isIdentifier(name)) set(node, name.text, value);
    else if (ts.isObjectBindingPattern(name))
      for (const element of name.elements) {
        const key = element.propertyName
          ? ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : constantName(element.propertyName)
          : ts.isIdentifier(element.name)
            ? element.name.text
            : undefined;
        bindName(element.name, element.dotDotDotToken ? safe : member(value, key), element);
      }
  };
  function assignmentValue(expression: ts.BinaryExpression, forced?: Binding): Binding {
    const targets: ts.Expression[] = [];
    let tail: ts.Expression = expression;
    while (ts.isBinaryExpression(tail) && tail.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      targets.push(unwrap(tail.left));
      tail = unwrap(tail.right);
    }
    const retiredTarget = ownsFile && targets.find((target) => ts.isIdentifier(target) && retiredNames.has(target.text));
    const fingerprint =
      forced ?? (retiredTarget && (ts.isArrowFunction(tail) || ts.isFunctionExpression(tail) || ts.isClassExpression(tail))
        ? ownerValue((retiredTarget as ts.Identifier).text)
        : valueOf(tail));
    for (const target of targets) {
      if (ts.isIdentifier(target)) set(target, target.text, fingerprint);
      else if (ts.isObjectLiteralExpression(target))
        for (const property of target.properties)
          if (ts.isShorthandPropertyAssignment(property))
            set(property.name, property.name.text, member(fingerprint, property.name.text));
          else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer))
            set(
              property.initializer,
              property.initializer.text,
              member(fingerprint, ts.isIdentifier(property.name) ? property.name.text : constantName(property.name)),
            );
      const exported = cjsName(target);
      if (exported === "*") publicExport("default", fingerprint);
      else if (exported) publicExport(exported, fingerprint);
    }
    return fingerprint;
  }
  const publicExport = (name: string, value: Binding) => {
    if (value.kind === "owner-namespace") report("owner namespace export");
    if (
      (value.members ?? []).some((memberName) => retiredNames.has(memberName)) ||
      (retiredNames.has(name) && (ownsFile || value.kind.startsWith("owner-")))
    )
      report("retired public export");
  };
  const moduleSource = (node: ts.Expression | undefined) => {
    if (!node || !ts.isStringLiteralLike(node)) return { owner: false, retired: false };
    const identity = moduleIdentity(node.text, input.path);
    if (identity.retired) report("retired module");
    return identity;
  };
  const isCjsRoot = (node: ts.Expression): boolean => {
    node = unwrap(node);
    return (
    (ts.isIdentifier(node) && node.text === "exports" && !find(node, "exports")) ||
    ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "module" &&
      !find(node.expression, "module") &&
      (ts.isPropertyAccessExpression(node) ? node.name.text : constantName(node.argumentExpression)) === "exports")
    );
  };
  const cjsName = (node: ts.Expression) => {
    node = unwrap(node);
    if (isCjsRoot(node) && !ts.isIdentifier(node)) return "*";
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isCjsRoot(node.expression))
      return ts.isPropertyAccessExpression(node) ? node.name.text : constantName(node.argumentExpression);
  };
  const propagate = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const identity = moduleSource(node.moduleSpecifier);
      const clause = node.importClause;
      if (identity.owner && clause) {
        const seed = (name: ts.Identifier, value: Binding, typeOnly: boolean) => {
          set(name, name.text, value, "type");
          if (!typeOnly) set(name, name.text, value);
        };
        if (clause.name) seed(clause.name, ownerNamespace, clause.isTypeOnly);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) seed(bindings.name, ownerNamespace, clause.isTypeOnly);
        else if (bindings)
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            seed(element.name, member(ownerNamespace, imported), clause.isTypeOnly || element.isTypeOnly);
          }
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      const value = ts.isExternalModuleReference(reference)
        ? moduleSource(reference.expression).owner
          ? ownerNamespace
          : safe
        : entity(reference, node.isTypeOnly ? "type" : "value");
      set(node.name, node.name.text, value, "type");
      if (!node.isTypeOnly) set(node.name, node.name.text, value);
    } else if (ts.isTypeAliasDeclaration(node)) set(node.name, node.name.text, typeOf(node.type), "type");
    else if (ts.isVariableDeclaration(node)) {
      let value = valueOf(node.initializer);
      const initializer = node.initializer ? unwrap(node.initializer) : undefined;
      let final = initializer;
      while (final && ts.isBinaryExpression(final) && final.operatorToken.kind === ts.SyntaxKind.EqualsToken) final = unwrap(final.right);
      if (
        ownsFile &&
        ts.isIdentifier(node.name) &&
        retiredNames.has(node.name.text) &&
        final &&
        (ts.isArrowFunction(final) || ts.isFunctionExpression(final) || ts.isClassExpression(final))
      ) {
        const fingerprint = ownerValue(node.name.text);
        value = merge(value, fingerprint);
        if (initializer && ts.isBinaryExpression(initializer) && initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken)
          assignmentValue(initializer, fingerprint);
      }
      const list = node.parent;
      if (value.kind !== "literal" || (ts.isVariableDeclarationList(list) && Boolean(list.flags & ts.NodeFlags.Const)))
        bindName(node.name, value, node);
    } else if (
      ownsFile &&
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      retiredNames.has(node.name.text)
    ) {
      const fingerprint = ownerValue(node.name.text);
      set(node.name, node.name.text, fingerprint);
      if (ts.isClassDeclaration(node)) set(node.name, node.name.text, fingerprint, "type");
    } else if (ts.isParameter(node) && node.initializer) bindName(node.name, valueOf(node.initializer), node);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) assignmentValue(node);
    ts.forEachChild(node, propagate);
  };
  let propagationBudget = 8;
  const countNode = (node: ts.Node): void => {
    propagationBudget++;
    ts.forEachChild(node, countNode);
  };
  countNode(file);
  for (let pass = 0; pass <= propagationBudget; pass++) {
    const before = mutations;
    propagate(file);
    if (mutations === before) break;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) return;
    if (ts.isImportDeclaration(node)) {
      const identity = moduleSource(node.moduleSpecifier);
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (identity.owner && bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (retiredNames.has(imported)) report("retired import");
        }
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword))
        publicExport(node.name.text, lookup(node, node.name.text, node.isTypeOnly ? "type" : "value"));
    } else if (ts.isImportTypeNode(node)) {
      typeOf(node);
      return;
    } else if (ts.isTypeReferenceNode(node)) {
      entity(node.typeName, "type");
      return;
    } else if (ts.isTypeQueryNode(node)) {
      entity(node.exprName, "value");
      return;
    } else if (ts.isExportDeclaration(node)) {
      const identity = moduleSource(node.moduleSpecifier);
      if (!node.exportClause && identity.owner) report("owner star export");
      if (node.exportClause && ts.isNamespaceExport(node.exportClause) && identity.owner) report("owner namespace export");
      if (node.exportClause && ts.isNamedExports(node.exportClause))
        for (const element of node.exportClause.elements) {
          const original = (element.propertyName ?? element.name).text;
          const typeOnly = node.isTypeOnly || element.isTypeOnly;
          const value = identity.owner
            ? member(ownerNamespace, original)
            : typeOnly
              ? lookup(element, original, "type")
              : find(element, original)?.value ?? find(element, original, "type")?.value ?? safe;
          if (identity.owner && retiredNames.has(original)) report("retired reexport");
          publicExport(element.name.text, value);
        }
    } else if (ts.isExportAssignment(node)) {
      publicExport("default", valueOf(node.expression));
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) &&
      node.name &&
      node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const isDefault = node.modifiers.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword);
      publicExport(isDefault ? "default" : node.name.text, lookup(node, node.name.text, ts.isTypeAliasDeclaration(node) ? "type" : "value"));
    } else if (ts.isVariableStatement(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) publicExport(declaration.name.text, valueOf(declaration.initializer));
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
  visit(file);
  return [...violations];
};

export const scanCurrencyRetirementOwnership = (files: readonly TrackedSource[]) =>
  [...new Set(files.flatMap((file) => (codeExtension.test(normalize(file.path)) ? scanModule(file) : [])))].sort();
