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
const manifestExtension = /\.jsonc?$/i;
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
  const eachInferName = (node: ts.Node, visit: (name: ts.Identifier) => void): void => {
    if (ts.isInferTypeNode(node)) visit(node.typeParameter.name);
    else if (ts.isConditionalTypeNode(node)) return;
    else ts.forEachChild(node, (child) => eachInferName(child, visit));
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
    if (ts.isMappedTypeNode(node)) {
      walk(node.typeParameter, scope);
      const mapped: Scope = { parent: scope, kind: "block", values: new Map(), types: new Map() };
      add(mapped, node.typeParameter.name, "type");
      if (node.nameType) walk(node.nameType, mapped);
      if (node.type) walk(node.type, mapped);
      return;
    }
    if (ts.isConditionalTypeNode(node)) {
      walk(node.checkType, scope);
      walk(node.extendsType, scope);
      const inferred: Scope = { parent: scope, kind: "block", values: new Map(), types: new Map() };
      eachInferName(node.extendsType, (name) => add(inferred, name, "type"));
      walk(node.trueType, inferred);
      walk(node.falseType, scope);
      return;
    }
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
    if (ts.isAwaitExpression(node)) {
      const expression = unwrap(node.expression);
      return ts.isCallExpression(expression) && expression.expression.kind === ts.SyntaxKind.ImportKeyword ? load(expression) : safe;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) return assignmentValue(node);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = valueOf(node.expression, allowBindings);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : constantName(node.argumentExpression);
      return member(base, name);
    }
    return safe;
  };
  const entity = (node: ts.EntityName, space: "value" | "type"): Binding =>
    ts.isIdentifier(node) ? lookup(node, node.text, space) : member(entity(node.left, space), node.right.text);
  const entityExpression = (node: ts.Expression, space: "value" | "type"): Binding => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return lookup(node, node.text, space);
    if (ts.isPropertyAccessExpression(node)) return member(entityExpression(node.expression, space), node.name.text);
    if (ts.isElementAccessExpression(node)) return member(entityExpression(node.expression, space), constantName(node.argumentExpression));
    return safe;
  };
  const nestedTypes = (node: ts.Node): Binding => {
    let value = safe;
    ts.forEachChild(node, (child) => {
      value = merge(value, ts.isTypeNode(child) ? typeOf(child) : nestedTypes(child));
    });
    return value;
  };
  function typeOf(node: ts.TypeNode): Binding {
    node = unwrap(node);
    if (ts.isTypeOperatorNode(node)) return node.operator === ts.SyntaxKind.KeyOfKeyword ? safe : typeOf(node.type);
    if (ts.isTypeReferenceNode(node)) return merge(entity(node.typeName, "type"), nestedTypes(node));
    if (ts.isTypeQueryNode(node))
      return merge(ts.isImportTypeNode(node.exprName) ? typeOf(node.exprName) : entity(node.exprName, "value"), nestedTypes(node));
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const identity = moduleSource(node.argument.literal as ts.Expression);
      const direct = !identity.owner || !node.qualifier ? (identity.owner ? ownerNamespace : safe) : entityFrom(node.qualifier, ownerNamespace);
      return merge(direct, nestedTypes(node));
    }
    return nestedTypes(node);
  }
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
  const heritageOf = (node: ts.HeritageClause, space: "value" | "type"): Binding => {
    let value = safe;
    for (const heritage of node.types) {
      value = merge(value, space === "value" ? valueOf(heritage.expression) : entityExpression(heritage.expression, "type"));
      for (const argument of heritage.typeArguments ?? []) value = merge(value, typeOf(argument));
    }
    return value;
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
    else if (ts.isInterfaceDeclaration(node)) {
      let value = safe;
      for (const heritage of node.heritageClauses ?? []) value = merge(value, heritageOf(heritage, "type"));
      for (const parameter of node.typeParameters ?? []) value = merge(value, nestedTypes(parameter));
      for (const member of node.members) value = merge(value, nestedTypes(member));
      set(node.name, node.name.text, value, "type");
    }
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
  const publicModuleDeclaration = (node: ts.ModuleDeclaration): boolean => {
    const exported = Boolean(node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword));
    if (ts.isSourceFile(node.parent)) return exported;
    if (ts.isModuleDeclaration(node.parent) && node.parent.body === node) return publicModuleDeclaration(node.parent);
    if (ts.isModuleBlock(node.parent) && ts.isModuleDeclaration(node.parent.parent))
      return exported && publicModuleDeclaration(node.parent.parent);
    return false;
  };
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
      typeOf(node);
      return;
    } else if (ts.isTypeQueryNode(node)) {
      typeOf(node);
      return;
    } else if (ts.isHeritageClause(node)) {
      const valueSpace =
        node.token === ts.SyntaxKind.ExtendsKeyword &&
        (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent));
      heritageOf(node, valueSpace ? "value" : "type");
      return;
    } else if (ts.isNamespaceExportDeclaration(node)) {
      const binding = find(node, node.name.text)?.value ?? find(node, node.name.text, "type")?.value ?? safe;
      publicExport(node.name.text, binding);
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
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      (ts.isModuleDeclaration(node)
        ? publicModuleDeclaration(node)
        : node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword))
    ) {
      const isDefault = Boolean(node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword));
      const typeSpace = ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node);
      const binding = typeSpace
        ? lookup(node, node.name.text, "type")
        : find(node, node.name.text)?.value ?? find(node, node.name.text, "type")?.value ?? safe;
      publicExport(isDefault ? "default" : node.name.text, binding);
    } else if (ts.isVariableStatement(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations)
        eachBindingName(declaration.name, (name) => publicExport(name.text, lookup(name, name.text)));
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

const deferredEnd = (source: string, start: number): number | undefined => {
  const opener = source[start] === "`" ? "`" : source[start + 1], arithmetic = opener === "(" && source[start + 2] === "(";
  const stack: Array<readonly [close: string, comments: boolean, joinsWord: boolean]> = opener === "`" ? [["`", false, true]] : arithmetic ? [[")", false, true], [")", false, false]] : [[opener === "(" ? ")" : "}", opener === "(", true]];
  let quote: "'" | '"' | undefined, word = false;
  for (let index = start + (opener === "`" ? 1 : arithmetic ? 3 : 2); index < source.length; index++) {
    const character = source[index]!;
    const [close, comments] = stack.at(-1)!;
    if (close === "`") {
      if (character === "\\") index++;
      else if (character === "`") word = stack.pop()![2];
    } else if (quote) {
      if (character === "\\" && quote === '"') index++;
      else if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"') { quote = character; word = true; }
    else if (character === "\\") { index++; word = true; }
    else if (comments && character === "#" && !word) while (index + 1 < source.length && source[index + 1] !== "\n" && source[index + 1] !== "\r") index++;
    else if (character === "`") { stack.push(["`", false, true]); word = false; }
    else if (character === "$" && (source[index + 1] === "(" || source[index + 1] === "{")) {
      const parameter = source[index + 1] === "{", nestedArithmetic = !parameter && source[index + 2] === "(";
      stack.push([parameter ? "}" : ")", !parameter && !nestedArithmetic, true]);
      if (nestedArithmetic) stack.push([")", false, false]);
      index += nestedArithmetic ? 2 : 1;
      word = false;
    } else if ((character === "(" && close === ")") || (character === "{" && close === "}")) { stack.push([close, comments, false]); word = false; }
    else if (character === close) word = stack.pop()![2];
    else word = !/\s|[;|&]/.test(character);
    if (!stack.length) return index;
  }
};

const stripHeredocs = (input: string): string | undefined => {
  const source = input.replaceAll("\r\n", "\n");
  const kept: string[] = [];
  const delimiters: Array<readonly [name: string, tabs: boolean]> = [];
  const delimiterPattern = /(?:\\.|'[^']*'|"(?:\\.|[^"\\])*"|[^\s\\'";|&()<>$`])+/y;
  let delimiterHead = 0, offset = 0;
  let body = false, word = false, deferred = -1;
  let quote: "'" | '"' | undefined;
  for (const line of source.split(/\r?\n/)) {
    const active = delimiters[delimiterHead];
    if (body && active) {
      if ((active[1] ? line.replace(/^\t+/, "") : line) === active[0]) delimiterHead++;
      kept.push("");
      body = delimiterHead < delimiters.length;
      offset += line.length + 1;
      continue;
    }
    kept.push(line);
    let continued = false;
    for (let index = 0; index < line.length; index++) {
      if (offset + index <= deferred) {
        index = Math.min(line.length - 1, deferred - offset);
        continue;
      }
      const character = line[index]!;
      if (quote) {
        if (character === "\\" && quote === '"') {
          continued = index + 1 === line.length;
          index++;
        }
        else if (character === quote) quote = undefined;
      } else if (character === "\\") {
        word = true;
        continued = index + 1 === line.length;
        index++;
      } else if (character === "'" || character === '"') {
        quote = character;
        word = true;
      } else if ((character === "$" && (line[index + 1] === "(" || line[index + 1] === "{")) || character === "`") {
        const end = deferredEnd(source, offset + index);
        if (end === undefined) return;
        word = true;
        deferred = end;
        index = Math.min(line.length - 1, end - offset);
      } else if (character === "#" && !word) break;
      else if (/\s|[;|&()]/.test(character)) word = false;
      else if (character === "<" && line[index + 1] === "<" && line[index + 2] !== "<") {
        let cursor = index + 2;
        const tabs = line[cursor] === "-";
        if (tabs) cursor++;
        while (/\s/.test(line[cursor] ?? "")) cursor++;
        delimiterPattern.lastIndex = cursor;
        const raw = delimiterPattern.exec(line)?.[0], boundary = line[delimiterPattern.lastIndex];
        if (raw === undefined || raw[0] === "#" || (boundary !== undefined && !/\s|[;|&()<>]/.test(boundary))) return;
        delimiters.push([raw.replace(/\\(.)|'([^']*)'|"((?:\\.|[^"\\])*)"/g, (_, escaped, single, double) => escaped ?? single ?? double?.replace(/\\([$"`\\])/g, "$1") ?? ""), tabs]);
        index = delimiterPattern.lastIndex - 1;
      } else word = true;
    }
    if (!quote && !continued && deferred <= offset + line.length) {
      body = delimiterHead < delimiters.length;
      word = false;
    }
    offset += line.length + 1;
  }
  return delimiterHead < delimiters.length ? undefined : kept.join("\n");
};

const shellWords = (input: string): readonly string[] | undefined => {
  const source = stripHeredocs(input);
  if (source === undefined) return;
  const words: string[] = [];
  let word = "", rawWord = "";
  let quote: "'" | '"' | undefined;
  let query: false | "query" | "fragment" | "blocked" = false;
  const flush = () => {
    if (word) words.push(word);
    if (rawWord && rawWord !== word) words.push(rawWord);
    word = rawWord = "";
    query = false;
  };
  const uri = /^(?:(?:[A-Za-z_]\w*|--?[\w-]+)=)?[a-z][a-z\d+.-]*:\/\//i;
  const queryPair = (start: number) => {
    let cursor = start + 1;
    while (/[A-Za-z0-9_.~%-]/.test(source[cursor] ?? "")) cursor++;
    return cursor > start + 1 && source[cursor] === "=";
  };
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    const dynamic = quote !== "'" && (character === "`" || (character === "$" && (source[index + 1] === "(" || source[index + 1] === "{")));
    if (dynamic) {
      const end = deferredEnd(source, index);
      if (end === undefined) return;
      word += character;
      rawWord += character;
      query = "blocked";
      index = end;
    } else if (quote) {
      if (character === quote) {
        quote = undefined;
        query = "blocked";
      }
      else if (character === "\\" && quote === '"') {
        const next = source[++index];
        if (next === undefined) return;
        if (next !== "\n") rawWord += `\\${next}`;
        if (next !== "\n" && /[$"\\]/.test(next)) word += next;
        else if (next !== "\n") word += `\\${next}`;
      } else {
        word += character;
        rawWord += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      query = "blocked";
    }
    else if (character === "\\") {
      const next = source[++index];
      if (next === undefined) return;
      if (next !== "\n") {
        word += next;
        rawWord += `\\${next}`;
        query = "blocked";
      }
    } else if (character === "&" && query === "query" && queryPair(index)) {
      word += character;
      rawWord += character;
    } else if (/\s|[;|&()]/.test(character)) flush();
    else if (character === "#" && !word) {
      while (index + 1 < source.length && source[index + 1] !== "\n" && source[index + 1] !== "\r") index++;
    } else {
      if (character === "#") query = "fragment";
      else if (character === "?" && query === false && uri.test(word)) query = "query";
      word += character;
      rawWord += character;
    }
  }
  if (quote) return;
  flush();
  return words;
};

const jsoncTriviaOnly = (source: string) => {
  let invalid = false;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source, () => { invalid = true; });
  for (let token = scanner.scan(); !invalid; token = scanner.scan()) {
    if (token === ts.SyntaxKind.EndOfFileToken) return true;
    if (token !== ts.SyntaxKind.WhitespaceTrivia && token !== ts.SyntaxKind.NewLineTrivia && token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) return false;
  }
  return false;
};

const scanManifest = (input: TrackedSource) => {
  const violations = new Set<string>();
  const report = (reason: string) => violations.add(`${input.path}: ${reason}`);
  const source = input.source.replace(/^\uFEFF/, "");
  const jsonc = normalize(input.path).toLowerCase().endsWith(".jsonc");
  let file: ts.JsonSourceFile;
  let diagnostics: readonly ts.Diagnostic[];
  try {
    if (!jsonc) JSON.parse(source);
    file = ts.parseJsonText(input.path, source);
    diagnostics = (file as unknown as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
    if (jsonc && !diagnostics.length && !file.statements.length && jsoncTriviaOnly(source)) return [];
    if (jsonc && ts.parseConfigFileTextToJson(input.path, `{"__manifest":\n${source}\n}`).error) throw new Error();
  } catch {
    return [`${input.path}: invalid manifest`];
  }
  const statement = file.statements[0];
  if (diagnostics.length || file.statements.length !== 1 || !statement || !ts.isExpressionStatement(statement)) return [`${input.path}: invalid manifest`];
  const root = statement.expression;
  if (!ts.isObjectLiteralExpression(root)) return [];
  const ownerPackage = (value: string) => /(?:^|\/)backend\/packages\/database(?:\/|$)/.test(normalize(value));
  const manifestPath = normalize(input.path);
  const ownerContext = ownerPackage(manifestPath) || !manifestPath.includes("/");
  const reference = (value: string, semantics: "module" | "local" = "module") => {
    const raw = value.trim();
    if (!raw || /\s|\\(?:[;|&()#=$]|\s)/.test(raw) || /^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return;
    const slashed = raw.replaceAll("\\", "/");
    const withoutSuffix = (slashed.startsWith("#") ? slashed.slice(1) : slashed).split(/[?#]/, 1)[0]!;
    const retired = withoutSuffix.split("/").some((segment) => {
      const name = segment.replace(codeExtension, "");
      return name === "currency-rate-repository" || retiredNames.has(name);
    });
    let target = withoutSuffix;
    const local = /^(?:\.{1,2}\/|\/|[A-Za-z]:\/|backend\/|src\/|repositories\/)/.test(target);
    const bareModule = semantics === "module" && target.includes("/") && !local && !target.startsWith("@");
    if (/^\.{1,2}\//.test(target)) target = posix.join(posix.dirname(normalize(input.path)), target);
    else if (local && !/^(?:[A-Za-z]:\/|\/|backend\/)/.test(target) && target.includes("/")) target = posix.join(posix.dirname(normalize(input.path)), target);
    const canonical = target === "@almirant/database" || target.startsWith("@almirant/database/");
    const otherPackage = /(?:^|\/)backend\/packages\/(?!database(?:\/|$))[^/]+(?:\/|$)/.test(normalize(target));
    const explicitExit = /^\.{1,2}\//.test(withoutSuffix) && ownerPackage(manifestPath) && !ownerPackage(target);
    const ambiguous = !target.startsWith("@") && !bareModule && !otherPackage && !explicitExit;
    const owner = canonical || ownerPackage(target) || (ambiguous && ownerContext);
    if (owner && retired) report("retired manifest reference");
  };
  const property = (node: ts.ObjectLiteralElementLike) => {
    if (!ts.isPropertyAssignment(node)) return;
    const name = ts.isStringLiteralLike(node.name) || ts.isIdentifier(node.name) ? node.name.text : undefined;
    return name === undefined ? undefined : { name, value: node.initializer };
  };
  type Mode = "root" | "discover" | "tree" | "selected" | "commands" | "scalar" | "array" | "mapping" | "pathmap" | "command" | "scripts" | "compiler";
  const pending: Array<readonly [ts.Expression, Mode]> = [];
  const visited = new WeakMap<ts.Node, Set<Mode>>();
  const push = (node: ts.Expression, mode: Mode) => {
    const modes = visited.get(node) ?? new Set<Mode>();
    if (modes.has(mode)) return;
    modes.add(mode);
    visited.set(node, modes);
    pending.push([node, mode]);
  };
  const scalars = new Set(["main", "module", "types", "typings"]);
  const trees = new Set(["exports", "imports"]);
  push(root, "root");
  while (pending.length) {
    const [current, mode] = pending.pop()!;
    if (["tree", "selected", "scalar", "mapping"].includes(mode) && ts.isStringLiteralLike(current)) reference(current.text, mode === "tree" || mode === "selected" ? "module" : "local");
    else if (mode === "command" && ts.isStringLiteralLike(current)) {
      const words = shellWords(current.text);
      if (!words) report("invalid manifest command");
      else
        for (const word of words) {
          const assignment = word.match(/^(?:[A-Za-z_]\w*|--?[\w-]+)=(.*)$/s);
          reference(assignment?.[1] ?? word);
        }
    } else if (ts.isArrayLiteralExpression(current)) {
      if (mode === "tree") for (const child of current.elements) push(child, "tree");
      else if (mode === "array") for (const child of current.elements) push(child, "scalar");
      else if (mode === "selected") for (const child of current.elements) push(child, "selected");
      else if (mode === "command") for (const child of current.elements) push(child, "command");
      else if (mode === "commands") for (const child of current.elements) push(child, "commands");
    } else if (ts.isObjectLiteralExpression(current) && !["scalar", "array", "command"].includes(mode))
      for (const element of current.properties) {
        const entry = property(element);
        if (!entry) continue;
        if (mode === "tree" || mode === "mapping" || mode === "pathmap") {
          reference(entry.name, mode === "tree" ? "module" : "local");
          push(entry.value, mode === "tree" && entry.name === "command" ? "command" : mode === "tree" ? "tree" : mode === "mapping" ? "scalar" : "array");
        } else if (mode === "selected" || mode === "commands") push(entry.value, entry.name === "command" ? "command" : "commands");
        else if (mode === "scripts") {
          reference(entry.name);
          push(entry.value, "command");
        } else if (mode === "compiler" && entry.name === "paths") push(entry.value, "pathmap");
        else if (mode === "root" && scalars.has(entry.name)) push(entry.value, "scalar");
        else if (mode === "root" && ["browser", "bin"].includes(entry.name)) push(entry.value, "mapping");
        else if (mode === "root" && entry.name === "files") push(entry.value, "array");
        else if (mode === "root" && trees.has(entry.name)) push(entry.value, "tree");
        else if (mode === "root" && entry.name === "scripts") push(entry.value, "scripts");
        else if (mode === "root" && entry.name === "compilerOptions") push(entry.value, "compiler");
        else if (["path", "entry"].includes(entry.name)) push(entry.value, "selected");
        else if (["paths", "entries"].includes(entry.name)) push(entry.value, "array");
        else if (entry.name === "command") push(entry.value, "command");
        else push(entry.value, "discover");
      }
  }
  return [...violations];
};

export const scanCurrencyRetirementOwnership = (files: readonly TrackedSource[]) =>
  [...new Set(files.flatMap((file) => {
    const path = normalize(file.path);
    if (codeExtension.test(path)) return scanModule(file);
    if (manifestExtension.test(path) && posix.basename(path).toLowerCase() !== "package-lock.json") return scanManifest(file);
    return [];
  }))].sort();
