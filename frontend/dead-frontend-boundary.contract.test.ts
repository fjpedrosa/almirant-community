import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const frontendRoot = import.meta.dir;
const repositoryRoot = resolve(frontendRoot, "..");
const retiredRelativePaths = [
  "src/components/ui/touch-actions.tsx",
  "src/components/ui/image-lightbox.tsx",
  "src/components/ui/info-tooltip.tsx",
  "src/domains/shared/presentation/components/lightbox-image.tsx",
  "src/components/ui/info-tooltip.test.tsx",
  "src/domains/shared/presentation/utils/index.ts",
  "src/domains/shared/application/hooks/index.ts",
  "src/domains/planning/index.ts",
  "src/domains/seeds/index.ts",
  "src/domains/goals/presentation/components/milestone-card.tsx",
  "src/domains/goals/presentation/components/milestone-detail-view.tsx",
  "src/domains/goals/presentation/components/milestone-metrics.tsx",
  "src/domains/goals/presentation/components/milestone-progress-bar.tsx",
  "src/domains/goals/presentation/components/milestone-checklist.tsx",
  "src/domains/goals/application/hooks/use-goals-page.ts",
  "src/domains/goals/application/hooks/use-milestone-form.ts",
  "src/domains/goals/application/hooks/use-milestones.ts",
  "src/domains/goals/presentation/components/milestone-form-dialog.tsx",
  "src/domains/github/presentation/components/github-repo-link.tsx",
  "src/domains/github/presentation/containers/github-tab-container.tsx",
  "src/domains/github/presentation/components/github-empty-state.tsx",
  "src/domains/github/presentation/components/github-commit-timeline.tsx",
  "src/domains/github/presentation/components/github-sync-button.tsx",
  "src/domains/github/presentation/components/github-contributors-grid.tsx",
  "src/domains/github/presentation/components/github-activity-feed.tsx",
  "src/domains/github/presentation/components/github-activity-item.tsx",
  "src/domains/github/presentation/components/github-actions-list.tsx",
  "src/domains/github/presentation/components/github-action-item.tsx",
  "src/domains/github/presentation/components/github-pr-list.tsx",
  "src/domains/github/presentation/components/github-pr-item.tsx",
  "src/domains/ai-planning/application/hooks/use-typewriter.ts",
  "src/domains/ai-planning/presentation/components/streaming-activity-indicator.tsx",
  "src/domains/settings/application/hooks/use-usage-tier.ts",
  "src/domains/settings/presentation/components/usage-tier-cta.tsx",
];
const retiredFiles = retiredRelativePaths.map((path) => resolve(frontendRoot, path));
const sentinelFiles = [
  "src/app/(app-shell)/layout.tsx",
  "src/app/(app-shell)/(dashboard)/layout.tsx",
].map((path) => resolve(frontendRoot, path));
const retiredImportTargets = [
  "planning", "seeds", "shared/presentation/utils", "shared/application/hooks",
  "shared/presentation/components/lightbox-image", "components/ui/touch-actions",
  "components/ui/image-lightbox", "components/ui/info-tooltip",
  "ai-planning/application/hooks/use-typewriter",
  "ai-planning/presentation/components/streaming-activity-indicator",
  "settings/application/hooks/use-usage-tier",
  "settings/presentation/components/usage-tier-cta",
];
const retiredIdentifiers = new Set(["TouchActions", "ImageLightbox", "InfoTooltip", "LightboxImage"]);
const retiredTypeIdentifiers = new Set(["Tier", "TierConfig", "TIER_CONFIGS", "UsageTierInfo", "UsageTierCtaProps"]);
const retiredDependencies = ["isomorphic-dompurify", "prism-react-renderer", "uuid", "@types/dompurify", "@types/uuid"];
const ownerPath = resolve(frontendRoot, "src/domains/settings/domain/types.ts");
const usagePagePath = resolve(frontendRoot, "src/app/(app-shell)/(dashboard)/settings/usage/page.tsx");
const usageContainerPath = resolve(frontendRoot, "src/domains/settings/presentation/containers/usage-dashboard-container.tsx");
const canonicalUsagePage = `import { UsageDashboardContainer } from "@/domains/settings/presentation/containers/usage-dashboard-container";\n\nexport default function UsagePage() {\n  return <UsageDashboardContainer />;\n}`;
const canonicalPath = (value: string) => value.replace(/\\/gu, "/").replace(/[?#].*$/u, "").replace(/\.(?:tsx?|jsx?)$/u, "").replace(/\/index$/u, "");
const targetPath = (target: string) => canonicalPath(resolve(frontendRoot, "src", target.startsWith("components/") ? target : `domains/${target}`));

function literalSpecifier(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return literalSpecifier(node.expression);
  if (ts.isLiteralTypeNode(node)) return literalSpecifier(node.literal);
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const part = literalSpecifier(span.expression);
      if (part === undefined) return undefined;
      value += part + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalSpecifier(node.left);
    const right = literalSpecifier(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function matchesRetiredSpecifier(specifier: string, importerPath: string): boolean {
  const clean = specifier.replace(/[?#].*$/u, "");
  if (clean !== specifier) return matchesRetiredSpecifier(clean, importerPath);
  if (retiredDependencies.some((dependency) => specifier === dependency || specifier.startsWith(`${dependency}/`))) return true;
  const candidate = specifier.startsWith("@/")
    ? canonicalPath(resolve(frontendRoot, "src", specifier.slice(2)))
    : /^(?:\.\/|\.\.\/)/u.test(specifier)
      ? canonicalPath(resolve(importerPath, "..", specifier))
      : /^(?:domains|components)\//u.test(specifier)
        ? canonicalPath(resolve(frontendRoot, "src", specifier))
        : undefined;
  if (candidate) return retiredImportTargets.some((target) => targetPath(target) === candidate);
  const normalized = specifier.replace(/^(?:@\/|(?:\.\.\/)+|\.\/)/u, "").replace(/\.(?:tsx?|jsx?)$/u, "").replace(/\/index$/u, "");
  return retiredImportTargets.some((target) => normalized === target || (target.startsWith("components/ui/") && normalized === target.slice(target.lastIndexOf("/") + 1)));
}

function safeDynamicImport(node: ts.Expression): boolean {
  if (!ts.isTemplateExpression(node) || node.templateSpans.length !== 1) return false;
  const prefix = node.head.text; const suffix = node.templateSpans[0].literal.text;
  return ((prefix === "../../messages/" && suffix === ".json") || (prefix === "./auth-client.ts?cb=" && suffix === "") || (prefix === "./server-session.ts?cb=" && suffix === "")) && !retiredImportTargets.some((target) => prefix.includes(target));
}

const textOf = (node: ts.Node | undefined) => node && (ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined); const bindingNames = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((element) => "name" in element && element.name ? bindingNames(element.name) : []);
function ownerHasRetiredBoundary(file: ts.SourceFile): boolean {
  return file.statements.some((statement) => {
    if (ts.isExportDeclaration(statement)) { const clause = statement.exportClause; if (!clause || ts.isNamespaceExport(clause)) return true; if (ts.isNamedExports(clause) && clause.elements.some((element) => retiredTypeIdentifiers.has(element.name.text) || retiredTypeIdentifiers.has(textOf(element.propertyName) ?? ""))) return true; }
    const names = ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap((declaration) => bindingNames(declaration.name)) : ts.isImportDeclaration(statement) ? [statement.importClause?.name?.text, ...(statement.importClause?.namedBindings ? ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements.flatMap((element) => [element.name.text, textOf(element.propertyName)]) : [statement.importClause.namedBindings.name.text] : [])].filter((name): name is string => Boolean(name)) : (() => { const name = (statement as unknown as ts.Declaration & { name?: ts.DeclarationName }).name; return name && ts.isIdentifier(name) ? [name.text] : []; })();
    return names.some((name) => retiredTypeIdentifiers.has(name));
  });
}

function hasRetiredReference(source: string, importerPath = resolve(frontendRoot, "src/fixture.ts")): boolean {
  const kind = importerPath.endsWith(".tsx") ? ts.ScriptKind.TSX : importerPath.endsWith(".jsx") ? ts.ScriptKind.JSX : importerPath.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(importerPath, source, ts.ScriptTarget.Latest, true, kind);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) throw new Error(`${importerPath}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, "\n")}`);
  if (canonicalPath(importerPath) === canonicalPath(ownerPath) && ownerHasRetiredBoundary(file)) return true;
  let found = false;
  const visit = (node: ts.Node): void => {
    let specifier: string | undefined;
    if (ts.isIdentifier(node) && retiredIdentifiers.has(node.text)) found = true;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier && literalSpecifier(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node)) specifier = literalSpecifier(node.argument);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifier = literalSpecifier(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && node.arguments.length && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = literalSpecifier(node.arguments[0]);
    if (ts.isCallExpression(node) && node.arguments.length && node.expression.kind === ts.SyntaxKind.ImportKeyword && literalSpecifier(node.arguments[0]) === undefined && !safeDynamicImport(node.arguments[0])) found = true;
    if (specifier && matchesRetiredSpecifier(specifier, importerPath)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function trackedFrontendSources(): string[] {
  const result = Bun.spawnSync({ cmd: ["git", "ls-files", "--", "frontend"], cwd: repositoryRoot });
  if (result.exitCode !== 0) throw new Error("Unable to enumerate tracked frontend sources");
  const tracked = new TextDecoder().decode(result.stdout).split("\n").filter(Boolean);
  if (tracked.length === 0) throw new Error("Tracked frontend source enumeration was empty");
  const retired = new Set(retiredRelativePaths.map((path) => `frontend/${path}`));
  const sources = tracked
    .filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(path) && !retired.has(path) && !/generated|\.lock$/u.test(path))
    .filter((path) => !path.endsWith("dead-frontend-boundary.contract.test.ts"))
    .map((path) => resolve(repositoryRoot, path));
  if (sources.length === 0) throw new Error("Tracked frontend source set was empty after exclusions");
  return sources;
}

describe("dead frontend boundary", () => {
  it("retires unused direct dependency declarations without dropping live integrations", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(frontendRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declaredDependencies = retiredDependencies.filter(
      (dependency) =>
        dependency in (packageJson.dependencies ?? {}) ||
        dependency in (packageJson.devDependencies ?? {}),
    );

    expect(declaredDependencies).toEqual([]);
    expect(packageJson.dependencies?.["@next/third-parties"]).toBeDefined();
    expect(packageJson.dependencies?.["rehype-sanitize"]).toBeDefined();
  });

  it("retires every exact orphan path", () => {
    expect(retiredFiles.filter((filePath) => existsSync(filePath))).toEqual([]);
    expect(sentinelFiles.every((filePath) => existsSync(filePath))).toBe(true);
    expect(existsSync(usageContainerPath)).toBe(true);
    expect(readFileSync(usagePagePath, "utf8").replace(/\r\n/gu, "\n").trim()).toBe(canonicalUsagePage);
  });

  it("has no tracked imports or symbols referencing retired slices", () => {
    const references = trackedFrontendSources().filter((filePath) => hasRetiredReference(readFileSync(filePath, "utf8"), filePath));
    expect(references).toEqual([]);
  });

  it("normalizes retired import spellings without matching descendants", () => {
    const retired = [
      'import x from "@/domains/planning/index"',
      'import "./domains/shared/application/hooks/index"',
      'await import("./components/ui/info-tooltip")',
      'import x from "./domains/ai-planning/application/hooks/use-typewriter"',
      'export { default } from "@/domains/ai-planning/presentation/components/streaming-activity-indicator.tsx"',
      'import direct from "domains/ai-planning/application/hooks/use-typewriter.ts"',
      'import required = require("./domains/ai-planning/application/hooks/use-typewriter")',
      'await import("./domains/ai-planning/presentation/components/streaming-activity-indicator/index")',
      'await import(`./domains/ai-planning/application/hooks/` + "use-typewriter")',
      'await import(`./domains/ai-planning/application/hooks/use-typewriter`)',
      'const url = "https://example.test//"; import x from "./domains/ai-planning/application/hooks/use-typewriter"',
      'await import(`./domains/ai-planning/presentation/components/streaming-${"activity-indicator"}`)',
      'await import(("./domains/ai-planning/application/hooks/" + ("use-typewriter")))',
      'await import("./domains/ai-planning/presentation/components/streaming-activity-indicator", { with: { type: "js" } })',
      'type X = import("./domains/ai-planning/application/hooks/use-typewriter").default',
      'import "uuid"',
      'await import("uuid/subpath")',
      'await import("./domains/ai-planning/application/hooks/use-typewriter" as const); await import(<const>"./domains/ai-planning/application/hooks/use-typewriter"); await import("./domains/ai-planning/application/hooks/use-typewriter" satisfies string); await import("./domains/ai-planning/application/hooks/use-typewriter"!); require("./domains/ai-planning/application/hooks/use-typewriter" as const)',
      'await import(`@/domains/settings/${name}`)',
    ];
    const safe = [
      'import "@/domains/planning/domain/types"',
      'import "@/domains/shared/application/hooks/use-typewriter"',
      'import "@/domains/shared/presentation/components/streaming-blocks/streaming-activity-indicator"',
      'import "@/domains/ai-planning/application/hooks/use-typewriter-extra"',
      '// import "@/domains/ai-planning/application/hooks/use-typewriter"',
      'const text = `import "@/domains/ai-planning/application/hooks/use-typewriter"`',
      'const label = "InfoTooltip"',
      'import "uuid-extra"',
      '// import "uuid/subpath"; const text = "uuid"',
      'await import(`../../messages/${locale}.json`)',
      'await import(`./auth-client.ts?cb=${seq}`)',
      'await import(`./server-session.ts?cb=${seq}`); import { UsageTierCta as SafeCta } from "./safe"; function UsageTierCta() {}',
    ];
    expect(retired.every((source) => hasRetiredReference(source))).toBe(true);
    expect(safe.every((source) => !hasRetiredReference(source))).toBe(true);
    expect(["interface Tier {}", "import Tier from './safe'", "import type Tier from './safe'", "import type { Tier as Safe } from './safe'"].every((source) => hasRetiredReference(source, ownerPath))).toBe(true);
    expect(hasRetiredReference("export { Safe as Tier }", ownerPath)).toBe(true);
    expect(hasRetiredReference("export { Tier as Safe }", ownerPath)).toBe(true);
    expect(hasRetiredReference("export * from './safe'", ownerPath)).toBe(true);
    expect(["interface Tier {}", "import Tier from './safe'", "import type Tier from './safe'", "import type { Tier as Safe } from './safe'"].every((source) => !hasRetiredReference(source, resolve(frontendRoot, "src/other.ts")))).toBe(true);
    expect(() => hasRetiredReference('import x from "./domains/ai-planning/application/hooks/use-typewriter"; !!!')).toThrow(/fixture\.ts:/u);
  });
});
