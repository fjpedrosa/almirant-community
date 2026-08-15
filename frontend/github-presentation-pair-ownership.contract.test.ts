import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const contract = "frontend/github-presentation-pair-ownership.contract.test.ts";
const boundary = "frontend/dead-frontend-boundary.contract.test.ts";
const typePath = "frontend/src/domains/github/domain/types.ts";

type Pair = {
  name: string;
  expectedPresent: boolean;
  wrapper: string;
  wrapperSymbol: string;
  wrapperProps: string;
  child: string;
  childSymbol: string;
  childProps: string;
};

const pairs: Pair[] = [
  {
    name: "pull requests",
    expectedPresent: true,
    wrapper: "frontend/src/domains/github/presentation/components/github-pr-list.tsx",
    wrapperSymbol: "GithubPrList",
    wrapperProps: "GithubPrListProps",
    child: "frontend/src/domains/github/presentation/components/github-pr-item.tsx",
    childSymbol: "GithubPrItem",
    childProps: "GithubPrItemProps",
  },
  {
    name: "actions",
    expectedPresent: true,
    wrapper: "frontend/src/domains/github/presentation/components/github-actions-list.tsx",
    wrapperSymbol: "GithubActionsList",
    wrapperProps: "GithubActionsListProps",
    child: "frontend/src/domains/github/presentation/components/github-action-item.tsx",
    childSymbol: "GithubActionItem",
    childProps: "GithubActionItemProps",
  },
  {
    name: "activity",
    expectedPresent: false,
    wrapper: "frontend/src/domains/github/presentation/components/github-activity-feed.tsx",
    wrapperSymbol: "GithubActivityFeed",
    wrapperProps: "GithubActivityFeedProps",
    child: "frontend/src/domains/github/presentation/components/github-activity-item.tsx",
    childSymbol: "GithubActivityItem",
    childProps: "GithubActivityItemProps",
  },
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
  .filter((path) => /^(?:frontend\/src|backend\/api\/src|services)\/.+\.(?:[cm]?[jt]sx?)$/u.test(path))
  .filter((path) => path !== contract && existsSync(resolve(root, path)));
const repoPaths = sourcePaths();
const append = (raw: string, value: string) => `${raw}\n${value}\n`;
type Overrides = Record<string, string | null>;
const relativePath = (path: string) => path.replace(/^frontend\//u, "");
const registerPaths = (raw: string, paths: string[]) => {
  const marker = "const retiredRelativePaths = [";
  const start = raw.indexOf(marker);
  const end = raw.indexOf("];", start);
  if (start < 0 || end < 0) throw new Error("Unable to locate retiredRelativePaths initializer");
  const entries = paths.map((path) => `  "${path}",`).join("\n");
  return `${raw.slice(0, end)}${entries}\n${raw.slice(end)}`;
};
const retiredFiles = (retired: Pair[]): Overrides =>
  Object.fromEntries(retired.flatMap(({ wrapper, child }) => [[wrapper, null], [child, null]]));
const retirementBoundary = (raw: string, retired: Pair[]) => registerPaths(raw,
  retired.flatMap(({ wrapper, child }) => [relativePath(wrapper), relativePath(child)]));
const withoutProps = (raw: string, retired: Pair[]) => retired.reduce((current, pair) =>
  current.replace(new RegExp(`export interface ${pair.wrapperProps} \\{[^}]*\\}\\n?`, "u"), "")
    .replace(new RegExp(`export interface ${pair.childProps} \\{[^}]*\\}\\n?`, "u"), ""), raw);
const readAt = (path: string, overrides: Overrides) => overrides[path] === undefined ? read(path) : overrides[path] ?? "";
const existsAt = (path: string, overrides: Overrides) => overrides[path] === undefined ? existsSync(resolve(root, path)) : overrides[path] !== null;
const parse = (path: string, raw: string) => {
  const source = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, scriptKind(path));
  const identifiers = new Set<string>();
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const value = literal(node.moduleSpecifier);
      if (value) specs.push(value);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const value = literal(node.moduleReference.expression);
      if (value) specs.push(value);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const value = literal(node.arguments[0]);
      if (value) specs.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { identifiers, specs };
};
const hasIdentifier = (identifiers: ReadonlySet<string>, symbol: string) => identifiers.has(symbol);
const hasImportTo = (path: string, raw: string, target: string) => parse(path, raw).specs.some((specifier) => resolveImport(path, specifier) === normalize(target));
const registeredPaths = (raw: string) => {
  const source = ts.createSourceFile(boundary, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let paths: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "retiredRelativePaths" &&
      node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      paths = node.initializer.elements.flatMap((element) => {
        const value = literal(element);
        return value === undefined ? [] : [value];
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return new Set(paths);
};
const registered = (path: string, paths: ReadonlySet<string>) => paths.has(relativePath(path));
const relevant = (pair: Pair) => new Set([pair.wrapperSymbol, pair.wrapperProps, pair.childSymbol, pair.childProps, posix.basename(pair.wrapper).replace(/\.tsx$/u, ""), posix.basename(pair.child).replace(/\.tsx$/u, "")]);
const scanSource = (path: string, raw: string, pair: Pair, retired: boolean) => {
  const tokens = relevant(pair);
  const relocated = path !== pair.wrapper && path !== pair.child && (posix.basename(path) === posix.basename(pair.wrapper) || posix.basename(path) === posix.basename(pair.child));
  if (relocated) return false;
  if (path === typePath) {
    if (!raw.trim()) return false;
    const { identifiers } = parse(path, raw);
    return !hasIdentifier(identifiers, pair.wrapperSymbol) && !hasIdentifier(identifiers, pair.childSymbol) &&
      (retired ? !hasIdentifier(identifiers, pair.wrapperProps) && !hasIdentifier(identifiers, pair.childProps) :
        hasIdentifier(identifiers, pair.wrapperProps) && hasIdentifier(identifiers, pair.childProps));
  }
  if (!raw || (![...tokens].some((token) => raw.includes(token)))) return true;
  const { identifiers, specs } = parse(path, raw);
  const owner = path === pair.wrapper || path === pair.child;
  if (!owner && path !== typePath && [...tokens].some((token) => identifiers.has(token))) return false;
  if (!owner && path !== typePath && specs.some((specifier) => {
    const target = resolveImport(path, specifier);
    return target === normalize(pair.wrapper) || target === normalize(pair.child);
  })) return false;
  if (path === pair.wrapper) {
    return identifiers.has(pair.wrapperSymbol) && identifiers.has(pair.wrapperProps) && identifiers.has(pair.childSymbol) &&
      hasImportTo(path, raw, typePath) && hasImportTo(path, raw, pair.child);
  }
  if (path === pair.child) {
    return identifiers.has(pair.childSymbol) && identifiers.has(pair.childProps) && hasImportTo(path, raw, typePath);
  }
  return true;
};
const audit = (overrides: Overrides = {}) => {
  const boundaryPaths = registeredPaths(readAt(boundary, overrides));
  for (const pair of pairs) {
    const wrapperExists = existsAt(pair.wrapper, overrides);
    const childExists = existsAt(pair.child, overrides);
    if (wrapperExists !== childExists) return false;
    const wrapperRegistered = registered(pair.wrapper, boundaryPaths);
    const childRegistered = registered(pair.child, boundaryPaths);
    if (wrapperRegistered !== childRegistered) return false;
    if (wrapperExists !== !wrapperRegistered) return false;
    if (wrapperExists && (!scanSource(pair.wrapper, readAt(pair.wrapper, overrides), pair, false) || !scanSource(pair.child, readAt(pair.child, overrides), pair, false))) return false;
  }
  for (const path of [...new Set([...repoPaths, ...Object.keys(overrides)])]) {
    if (path === contract || path === boundary || overrides[path] === null) continue;
    const raw = readAt(path, overrides);
    if (pairs.some((pair) => !scanSource(path, raw, pair, !existsAt(pair.wrapper, overrides)))) return false;
  }
  return true;
};

describe("GitHub presentation pair ownership", () => {
  test("keeps each wrapper and child as one complete privately-owned pair", () => {
    expect(audit()).toBe(true);
    expect(audit({ [typePath]: "" })).toBe(false);
    const boundaryPaths = registeredPaths(read(boundary));
    for (const pair of pairs) {
      const retired = !pair.expectedPresent;
      expect(existsAt(pair.wrapper, {})).toBe(!retired);
      expect(existsAt(pair.child, {})).toBe(!retired);
      expect(registered(pair.wrapper, boundaryPaths)).toBe(retired);
      expect(registered(pair.child, boundaryPaths)).toBe(retired);
      if (retired) {
        expect(audit({
          [boundary]: retirementBoundary(read(boundary), [pair]),
          [typePath]: `${read(typePath)}\nexport interface ${pair.childProps} {}\nexport interface ${pair.wrapperProps} {}`,
        })).toBe(false);
        continue;
      }
      expect(audit({ [pair.wrapper]: read(pair.wrapper).replaceAll(pair.wrapperProps, `${pair.wrapperProps}Renamed`) })).toBe(false);
      expect(audit({ [pair.child]: read(pair.child).replaceAll(pair.childProps, `${pair.childProps}Renamed`) })).toBe(false);
      expect(audit({ [pair.wrapper]: read(pair.wrapper).replaceAll(pair.wrapperSymbol, `${pair.wrapperSymbol}Renamed`) })).toBe(false);
      expect(audit({ [pair.child]: read(pair.child).replaceAll(pair.childSymbol, `${pair.childSymbol}Renamed`) })).toBe(false);
    }
  });

  test("accepts only a fully retired pair registered atomically in the dead boundary", () => {
    const pair = pairs[0]!;
    const activity = pairs[2]!;
    const relativeWrapper = relativePath(pair.wrapper);
    const relativeChild = relativePath(pair.child);
    const retiredTypes = withoutProps(read(typePath), pairs);
    const retiredActivityTypes = withoutProps(read(typePath), [activity]);
    expect(audit({ ...retiredFiles(pairs), [boundary]: retirementBoundary(read(boundary), pairs), [typePath]: retiredTypes })).toBe(true);
    const retiredBoundary = retirementBoundary(read(boundary), [pair]);
    expect(audit({ [pair.wrapper]: null, [pair.child]: null, [boundary]: retiredBoundary, [typePath]: withoutProps(read(typePath), [pair]) })).toBe(true);
    expect(audit({ [boundary]: retirementBoundary(read(boundary), [activity]), [typePath]: retiredActivityTypes })).toBe(true);
    expect(audit({
      [boundary]: retirementBoundary(read(boundary), [activity]),
      [typePath]: `${read(typePath)}\nexport interface ${activity.childProps} {}\nexport interface ${activity.wrapperProps} {}`,
    })).toBe(false);
    expect(audit({ [activity.wrapper]: "export const GithubActivityFeed = () => null;", [boundary]: retirementBoundary(read(boundary), [activity]), [typePath]: retiredActivityTypes })).toBe(false);
    expect(audit({ [pair.wrapper]: null })).toBe(false);
    expect(audit({ [pair.child]: null })).toBe(false);
    expect(audit({ [pair.wrapper]: null, [pair.child]: null, [boundary]: registerPaths(read(boundary), [relativeWrapper]), [typePath]: withoutProps(read(typePath), [pair]) })).toBe(false);
    expect(audit({ [pair.wrapper]: null, [pair.child]: null, [boundary]: registerPaths(read(boundary), [relativeChild]), [typePath]: withoutProps(read(typePath), [pair]) })).toBe(false);
    expect(audit({ [pair.wrapper]: "export const GithubPrList = () => null;", [pair.child]: null })).toBe(false);
    expect(audit({ ...retiredFiles(pairs), [boundary]: registerPaths(read(boundary), [relativeWrapper]), [typePath]: retiredTypes })).toBe(false);
    const commentOnlyBoundary = append(read(boundary), `// "${relativeWrapper}",\n// "${relativeChild}",`);
    expect(audit({ [pair.wrapper]: null, [pair.child]: null, [boundary]: commentOnlyBoundary, [typePath]: withoutProps(read(typePath), [pair]) })).toBe(false);
    const outsideArrayBoundary = append(read(boundary), `const strayWrapperPath = "${relativeWrapper}";\nconst strayChildPath = "${relativeChild}";`);
    expect(audit({ [pair.wrapper]: null, [pair.child]: null, [boundary]: outsideArrayBoundary, [typePath]: withoutProps(read(typePath), [pair]) })).toBe(false);
  });

  test("rejects external consumers, relocations, broken owners, and prose-only matches", () => {
    const pair = pairs[0]!;
    const importer = "frontend/src/domains/github/presentation/containers/github-settings-container.tsx";
    const valid = read(importer);
    const wrapper = read(pair.wrapper);
    const child = read(pair.child);
    const types = read(typePath);
    for (const current of pairs) {
      const currentWrapper = posix.basename(current.wrapper, ".tsx");
      const currentChild = posix.basename(current.child, ".tsx");
      expect(audit({ [importer]: append(valid, `import { ${current.wrapperSymbol} } from "../components/${currentWrapper}";`) })).toBe(false);
      expect(audit({ [importer]: append(valid, `const child = require("../components/${currentChild}");`) })).toBe(false);
    }
    expect(audit({ [importer]: append(valid, 'import { GithubPrList } from "../components/github-pr-list";') })).toBe(false);
    expect(audit({ [importer]: append(valid, 'export { GithubPrItem } from "../components/github-pr-item";') })).toBe(false);
    expect(audit({ [importer]: append(valid, 'export * from "../components/github-pr-list";') })).toBe(false);
    expect(audit({ [importer]: append(valid, 'import Pr = require("../components/github-pr-list");') })).toBe(false);
    expect(audit({ [importer]: append(valid, 'const item = require("../components/github-pr-item");') })).toBe(false);
    expect(audit({ [importer]: append(valid, 'const load = () => import(`../components/github-pr-item.tsx`);') })).toBe(false);
    expect(audit({ [importer]: append(valid, "const value = GithubPrList;") })).toBe(false);
    expect(audit({ [importer]: append(valid, "const props = GithubPrItemProps;") })).toBe(false);
    expect(audit({ [importer]: append(valid, "export const GithubPrList = null;") })).toBe(false);
    expect(audit({ [importer]: append(valid, "const prose = `GithubPrList GithubPrItemProps`; // github-pr-list") })).toBe(true);
    expect(audit({ [typePath]: types.replaceAll("GithubPrItemProps", "GithubPrItemProperties") })).toBe(false);
    expect(audit({ [typePath]: types.replaceAll("GithubPrListProps", "GithubPrListProperties") })).toBe(false);
    expect(audit({ ["frontend/src/domains/github/presentation/archive/github-pr-list.tsx"]: "export default () => null;" })).toBe(false);
    expect(audit({ ["frontend/src/domains/github/presentation/archive/github-pr-item.tsx"]: "export default () => null;" })).toBe(false);
    expect(audit({ ["frontend/src/domains/github/presentation/archive/github-pr-item.tsx"]: "export const GithubPrItem = () => null;" })).toBe(false);
    expect(audit({ [pair.wrapper]: wrapper.replace('import { GithubPrItem } from "./github-pr-item";\n', "") })).toBe(false);
    expect(audit({ [pair.wrapper]: wrapper.replaceAll("GithubPrItem", "GithubPrChild") })).toBe(false);
    expect(audit({ [pair.wrapper]: wrapper.replaceAll(pair.childSymbol, `${pair.childSymbol}Renamed`) })).toBe(false);
    expect(audit({ [pair.wrapper]: wrapper.replaceAll("GithubPrListProps", "GithubPrListProperties") })).toBe(false);
    expect(audit({ [pair.child]: child.replaceAll("GithubPrItemProps", "GithubPrItemProperties") })).toBe(false);
    expect(audit({ [pair.child]: child.replace('from "../../domain/types"', 'from "../../domain/other-types"') })).toBe(false);
    expect(audit({ [pair.wrapper]: wrapper.replace('from "../../domain/types"', 'from "../../domain/other-types"') })).toBe(false);
  });
});
