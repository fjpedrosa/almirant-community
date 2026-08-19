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
];
const retiredIdentifiers = new Set(["TouchActions", "ImageLightbox", "InfoTooltip", "LightboxImage"]);
const canonicalPath = (value: string) => value.replace(/\\/gu, "/").replace(/\.(?:tsx?|jsx?)$/u, "").replace(/\/index$/u, "");
const targetPath = (target: string) => canonicalPath(resolve(frontendRoot, "src", target.startsWith("components/") ? target : `domains/${target}`));

function literalSpecifier(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literalSpecifier(node.expression);
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

function hasRetiredReference(source: string, importerPath = resolve(frontendRoot, "src/fixture.ts")): boolean {
  const kind = importerPath.endsWith(".tsx") ? ts.ScriptKind.TSX : importerPath.endsWith(".jsx") ? ts.ScriptKind.JSX : importerPath.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(importerPath, source, ts.ScriptTarget.Latest, true, kind);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) throw new Error(`${importerPath}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, "\n")}`);
  let found = false;
  const visit = (node: ts.Node): void => {
    let specifier: string | undefined;
    if (ts.isIdentifier(node) && retiredIdentifiers.has(node.text)) found = true;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier && literalSpecifier(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node)) specifier = literalSpecifier(node.argument);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifier = literalSpecifier(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && node.arguments.length && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = literalSpecifier(node.arguments[0]);
    if (specifier && matchesRetiredSpecifier(specifier, importerPath)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function trackedFrontendSources(): string[] {
  const result = Bun.spawnSync({ cmd: ["git", "ls-files", "--", "frontend/src"], cwd: repositoryRoot });
  if (result.exitCode !== 0) throw new Error("Unable to enumerate tracked frontend sources");
  const tracked = new TextDecoder().decode(result.stdout).split("\n").filter(Boolean);
  if (tracked.length === 0) throw new Error("Tracked frontend source enumeration was empty");
  const retired = new Set(retiredRelativePaths.map((path) => `frontend/${path}`));
  const sources = tracked
    .filter((path) => /\.(?:ts|tsx|js|jsx)$/u.test(path) && !retired.has(path) && !/generated|\.lock$/u.test(path))
    .filter((path) => !path.endsWith("dead-frontend-boundary.contract.test.ts"))
    .map((path) => resolve(repositoryRoot, path));
  if (sources.length === 0) throw new Error("Tracked frontend source set was empty after exclusions");
  return sources;
}

describe("dead frontend boundary", () => {
  it("retires every exact orphan path", () => {
    expect(retiredFiles.filter((filePath) => existsSync(filePath))).toEqual([]);
    expect(sentinelFiles.every((filePath) => existsSync(filePath))).toBe(true);
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
    ];
    const safe = [
      'import "@/domains/planning/domain/types"',
      'import "@/domains/shared/application/hooks/use-typewriter"',
      'import "@/domains/shared/presentation/components/streaming-blocks/streaming-activity-indicator"',
      'import "@/domains/ai-planning/application/hooks/use-typewriter-extra"',
      '// import "@/domains/ai-planning/application/hooks/use-typewriter"',
      'const text = `import "@/domains/ai-planning/application/hooks/use-typewriter"`',
      'const label = "InfoTooltip"',
    ];
    expect(retired.every((source) => hasRetiredReference(source))).toBe(true);
    expect(safe.every((source) => !hasRetiredReference(source))).toBe(true);
    expect(() => hasRetiredReference('import x from "./domains/ai-planning/application/hooks/use-typewriter"; !!!')).toThrow(/fixture\.ts:/u);
  });
});
