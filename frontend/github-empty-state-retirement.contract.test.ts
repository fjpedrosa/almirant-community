import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const retired = "frontend/src/domains/github/presentation/components/github-empty-state.tsx";
const typePath = "frontend/src/domains/github/domain/types.ts";
const contract = "frontend/github-empty-state-retirement.contract.test.ts";
const forbidden = new Set(["GithubEmptyState", "GithubEmptyStateProps"]);
const retiredToken = "github-empty-state";
const retiredBasename = posix.basename(retired);
const sentinels: Array<[string, string[]]> = [
  ["frontend/src/domains/github/application/hooks/use-github-tab.ts", ["useGithubTab"]],
  ["frontend/src/domains/github/application/hooks/use-github-prs.ts", ["useGithubPrs"]],
  ["frontend/src/domains/github/application/hooks/use-github-commits.ts", ["useGithubCommits"]],
  ["frontend/src/domains/github/application/hooks/use-github-actions.ts", ["useGithubActions"]],
  ["frontend/src/domains/github/application/hooks/use-github-contributors.ts", ["useGithubContributors"]],
  ["frontend/src/domains/github/application/hooks/use-github-activity.ts", ["useGithubActivity"]],
  ["frontend/src/domains/github/application/hooks/use-github-sync.ts", ["useGithubSync"]],
  ["frontend/src/domains/github/application/hooks/use-github-status.ts", ["useGithubStatus"]],
  ["frontend/src/domains/github/presentation/components/github-pr-list.tsx", ["GithubPrList"]],
  ["frontend/src/domains/github/presentation/components/github-actions-list.tsx", ["GithubActionsList"]],
  ["frontend/src/domains/github/presentation/components/github-contributors-grid.tsx", ["GithubContributorsGrid"]],
  ["frontend/src/domains/github/presentation/components/github-activity-feed.tsx", ["GithubActivityFeed"]],
  ["frontend/src/domains/github/presentation/components/github-sync-button.tsx", ["GithubSyncButton"]],
  ["frontend/src/domains/github/presentation/containers/github-settings-container.tsx", ["GithubSettingsContainer"]],
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
  .filter((path) => path !== retired && path !== contract && existsSync(resolve(root, path)));
const scanOne = (path: string, raw: string, allowRetiredType = false) => {
  const relocatedPath = path !== retired && posix.basename(path) === retiredBasename;
  if (!relocatedPath && !raw.includes(retiredToken) && ![...forbidden].some((token) => raw.includes(token))) return true;
  const source = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, scriptKind(path));
  const specs: string[] = [];
  let executableIssue = relocatedPath;
  const visit = (node: ts.Node): void => {
    if (allowRetiredType && path === typePath && ts.isInterfaceDeclaration(node) && node.name.text === "GithubEmptyStateProps") return;
    if (ts.isIdentifier(node) && forbidden.has(node.text)) executableIssue = true;
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
  return !executableIssue && !specs.some((specifier) => resolveImport(path, specifier) === normalize(retired));
};
const repoPaths = sourcePaths();
const baseline = new Map(repoPaths.map((path) => [path, scanOne(path, read(path), path === typePath)]));
const scan = (overrides: Record<string, string | undefined> = {}) => [...new Set([...repoPaths, ...Object.keys(overrides)])]
  .filter((path) => path !== contract)
  .every((path) => overrides[path] !== undefined ? scanOne(path, overrides[path]!, path === typePath) : (baseline.get(path) ?? scanOne(path, read(path), path === typePath)));
const retiredPresent = (overrides: Record<string, string | undefined> = {}) => existsSync(resolve(root, retired)) || overrides[retired] !== undefined;
const append = (raw: string, value: string) => { const next = `${raw}\n${value}\n`; expect(next).not.toBe(raw); return next; };

describe("GitHub empty state retirement boundary", () => {
  test("retires only the orphaned empty state and preserves the residual GitHub graph", () => {
    expect(retiredPresent()).toBe(false);
    expect(scan()).toBe(true);
    expect(read(typePath).includes("GithubEmptyStateProps")).toBe(false);
    expect(read(typePath).includes("GithubSettingsContainerProps")).toBe(true);
    expect(read(typePath).includes("GithubTabStatus")).toBe(true);
    for (const [path, needles] of sentinels) expect(needles.every((needle) => read(path).includes(needle))).toBe(true);
  });

  test("fails closed for relocated imports, symbols, and templates while ignoring prose", () => {
    const importer = "frontend/src/domains/github/presentation/containers/github-settings-container.tsx";
    const valid = read(importer);
    const relocated = "frontend/src/domains/github/presentation/archive/github-empty-state.tsx";
    const mutations = [
      { [relocated]: "export const GithubEmptyState = () => null;" },
      { [importer]: append(valid, 'import { GithubEmptyState } from "../components/github-empty-state";') },
      { [importer]: append(valid, 'import type { GithubEmptyStateProps } from "../../domain/types";') },
      { [importer]: append(valid, 'import {\n  GithubEmptyState,\n} from "../components/github-empty-state.tsx";') },
      { [importer]: append(valid, 'export { GithubEmptyState } from "../components/github-empty-state";') },
      { [importer]: append(valid, 'const load = () => import(`../components/github-empty-state.tsx`);') },
      { [importer]: append(valid, 'const load = require("../components/github-empty-state");') },
      { [importer]: append(valid, 'import Tab = require("../components/github-empty-state");') },
      { [relocated]: "export default () => null;" },
      { [importer]: append(valid, "const prose = `GithubEmptyState is retired`; // github-empty-state") },
      { [typePath]: append(read(typePath), "export const restoredTabProps: GithubEmptyStateProps | null = null;") },
      { [retired]: "export default () => null;" },
    ];
    for (const mutation of mutations.slice(0, 8)) expect(scan(mutation)).toBe(false);
    expect(scan(mutations[8]!)).toBe(false);
    expect(scan(mutations[9]!)).toBe(true);
    expect(scan(mutations[10]!)).toBe(false);
    expect(retiredPresent(mutations[11]!)).toBe(true);
  });
});
