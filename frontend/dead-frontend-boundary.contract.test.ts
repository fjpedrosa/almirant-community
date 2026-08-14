import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
];
const retiredSymbols = /components\/ui\/(?:touch-actions|image-lightbox|info-tooltip)|(?:\bTouchActions\b|\bImageLightbox\b|\bInfoTooltip\b)|domains\/shared\/presentation\/components\/lightbox-image|\bLightboxImage\b|domains\/shared\/(?:presentation\/utils|application\/hooks)["']/u;
const staticImportSpecifierPattern = /(?:^|\n)\s*import[^\n;]*?\bfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/gmu;
const dynamicImportSpecifierPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

function hasRetiredReference(source: string): boolean {
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
  const symbols = clean.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/gu, "");
  if (retiredSymbols.test(symbols)) return true;
  const specifiers = [
    ...clean.matchAll(staticImportSpecifierPattern),
    ...clean.matchAll(dynamicImportSpecifierPattern),
  ].map(([, first, second]) => first ?? second);
  return specifiers.some((specifier) => {
    const normalized = specifier!.replace(/^(?:@\/|(?:\.\.\/)+|\.\/)/u, "").replace(/\/index$/u, "");
    return retiredImportTargets.some((target) => normalized === target || normalized.endsWith(`/${target}`) || (target.startsWith("components/ui/") && normalized === target.slice(target.lastIndexOf("/") + 1)));
  });
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
    const references = trackedFrontendSources().filter((filePath) => hasRetiredReference(readFileSync(filePath, "utf8")));
    expect(references).toEqual([]);
  });

  it("normalizes retired import spellings without matching descendants", () => {
    const retired = ['import x from "@/domains/planning/index"', 'import "../shared/application/hooks/index"', 'await import("./info-tooltip")'];
    const safe = ['import "@/domains/planning/domain/types"', '// import "@/domains/planning/index"', 'const text = `import "@/domains/planning/index"`', 'const label = "InfoTooltip"'];
    expect(retired.every(hasRetiredReference)).toBe(true);
    expect(safe.every((source) => !hasRetiredReference(source))).toBe(true);
  });
});
