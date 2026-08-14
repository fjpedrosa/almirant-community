import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const retired = "frontend/src/domains/github/presentation/components/github-repo-link.tsx";
const typePath = "frontend/src/domains/github/domain/types.ts";
const contract = "frontend/github-repo-link-retirement.contract.test.ts";
const forbidden = new Set(["GithubRepoLink", "GithubRepoLinkProps"]);
const sentinels: Array<[string, string[]]> = [
  ["frontend/src/domains/settings/presentation/containers/provider-settings/code-providers-settings-container.tsx", ["GithubSettingsContainer"]],
  ["frontend/src/domains/projects/presentation/components/project-card.tsx", ["GithubSummaryBadges"]],
  ["frontend/src/domains/github/presentation/components/github-commit-item.tsx", ["GithubCommitItem"]],
  ["frontend/src/domains/github/application/hooks/use-github-status.ts", ["useGithubStatus"]],
  ["frontend/src/domains/github/application/hooks/use-create-github-repo.ts", ["useCreateGithubRepo"]],
];
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const sourcePaths = () => execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n").filter((path) => /^(?:frontend\/|backend\/|services\/).+\.(?:[cm]?[jt]sx?)$/u.test(path) && path !== retired && path !== contract && existsSync(resolve(root, path)));
const normalize = (path: string) => path.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\/index$/u, "");
const resolveImport = (importer: string, spec: string) => {
  if (spec.startsWith("@/")) return normalize(posix.normalize(`frontend/src/${spec.slice(2)}`));
  if (spec.startsWith(".")) return normalize(posix.normalize(posix.join(dirname(importer), spec)));
  return null;
};
const literalText = (node: ts.Node | undefined) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const scriptKind = (path: string) => path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
const scanOne = (path: string, raw: string, allowRetiredType = false) => {
  const source = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, scriptKind(path));
  const specs: string[] = [];
  let executableIssue = false;
  const add = (node: ts.Node | undefined) => { const value = literalText(node); if (value) specs.push(value); };
  const visit = (node: ts.Node): void => {
    if (allowRetiredType && path === typePath && ts.isInterfaceDeclaration(node) && node.name.text === "GithubRepoLinkProps") return;
    if (ts.isIdentifier(node) && forbidden.has(node.text)) executableIssue = true;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return !executableIssue && !specs.some((spec) => resolveImport(path, spec) === normalize(retired));
};
const repoPaths = sourcePaths();
const baseline = new Map(repoPaths.map((path) => [path, scanOne(path, read(path), path === typePath)]));
const scan = (overrides: Record<string, string | undefined> = {}) => [...new Set([...repoPaths, ...Object.keys(overrides)])]
  .filter((path) => path !== retired && path !== contract)
  .every((path) => overrides[path] !== undefined ? scanOne(path, overrides[path]!) : (baseline.get(path) ?? scanOne(path, read(path))));
const retiredPresent = (overrides: Record<string, string | undefined> = {}) => existsSync(resolve(root, retired)) || overrides[retired] !== undefined;
const append = (raw: string, value: string) => { const next = `${raw}\n${value}\n`; expect(next).not.toBe(raw); return next; };

describe("GitHub repository link retirement boundary", () => {
  test("retires only the orphaned link and preserves GitHub seams", () => {
    expect(retiredPresent()).toBe(false);
    expect(scan()).toBe(true);
    expect(read(typePath).includes("GithubRepoLinkProps")).toBe(false);
    for (const [path, needles] of sentinels) expect(needles.every((needle) => read(path).includes(needle))).toBe(true);
  });

  test("fails closed for relocated imports, symbols, and templates while ignoring prose", () => {
    const importer = "frontend/src/domains/github/presentation/containers/github-settings-container.tsx";
    const valid = read(importer);
    const mutations = [
      { ["frontend/src/domains/github/presentation/archive/github-repo-link.tsx"]: "export const GithubRepoLink = () => null;" },
      { [importer]: append(valid, 'import { GithubRepoLink } from "../components/github-repo-link";') },
      { [importer]: append(valid, 'import type { GithubRepoLinkProps } from "@/domains/github/domain/types";') },
      { [importer]: append(valid, 'import {\n  GithubRepoLink,\n} from "../components/github-repo-link.tsx";') },
      { [importer]: append(valid, 'export { GithubRepoLink } from "../components/github/presentation/components/github-repo-link";') },
      { [importer]: append(valid, 'const load = () => import(`../components/github-repo-link.tsx`);') },
      { [importer]: append(valid, 'const load = require("../components/github-repo-link");') },
      { [importer]: append(valid, 'import Card = require("../components/github-repo-link");') },
      { [importer]: append(valid, 'const copy = `${GithubRepoLinkProps}`;') },
      { [importer]: append(valid, "const prose = `GithubRepoLink is retired`; // GithubRepoLinkProps") },
      { [retired]: "" },
    ];
    expect(scan(mutations[0]!)).toBe(false);
    expect(scan(mutations[1]!)).toBe(false);
    expect(scan(mutations[2]!)).toBe(false);
    expect(scan(mutations[3]!)).toBe(false);
    expect(scan(mutations[4]!)).toBe(false);
    expect(scan(mutations[5]!)).toBe(false);
    expect(scan(mutations[6]!)).toBe(false);
    expect(scan(mutations[7]!)).toBe(false);
    expect(scan(mutations[8]!)).toBe(false);
    expect(scan(mutations[9]!)).toBe(true);
    expect(retiredPresent(mutations[10]!)).toBe(true);
  });
});
