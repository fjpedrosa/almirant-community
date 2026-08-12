import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageManifest = {
  scripts?: Record<string, string>;
  workspaces?: string[];
};

const repositoryRoot = resolve(import.meta.dir, "..");
const frontendRoot = import.meta.dir;
const rootManifestPath = resolve(repositoryRoot, "package.json");
const frontendManifestPath = resolve(frontendRoot, "package.json");
const backendManifestPath = resolve(repositoryRoot, "backend/package.json");
const vercelIgnorePath = resolve(repositoryRoot, "scripts/vercel-ignore.sh");
const rootEslintPath = resolve(repositoryRoot, "eslint.config.mjs");
const frontendEslintPath = resolve(frontendRoot, "eslint.config.mjs");

const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8")) as PackageManifest;
const frontendManifest = JSON.parse(readFileSync(frontendManifestPath, "utf8")) as PackageManifest;
const backendManifest = JSON.parse(readFileSync(backendManifestPath, "utf8")) as PackageManifest;

const orphanedRootScaffoldPaths = [
  "next.config.ts",
  "postcss.config.mjs",
  "components.json",
  "tsconfig.json",
  "public/file.svg",
  "public/globe.svg",
  "public/next.svg",
  "public/vercel.svg",
  "public/window.svg",
] as const;

const canonicalFrontendConfigPaths = [
  "next.config.ts",
  "postcss.config.mjs",
  "components.json",
  "tsconfig.json",
  "eslint.config.mjs",
] as const;

const delegatedFrontendScripts = {
  "dev:frontend": "cd frontend && bun run dev",
  "build:frontend": "cd frontend && bun run build",
  "test:frontend": "cd frontend && bun run test",
} as const;

function normalizeWorkspacePattern(pattern: string): string {
  return pattern.replace(/^(?:\.\/)+/u, "");
}

function workspacePatternMatchesFrontend(pattern: string): boolean {
  const glob = new Bun.Glob(normalizeWorkspacePattern(pattern.replace(/^!/u, "")));
  return ["frontend", "frontend/package.json"].some((target) => glob.match(target));
}

function assertFrontendOutsideRootWorkspaces(workspaces: string[]): void {
  let frontendIncluded = false;
  for (const workspace of workspaces) {
    if (workspacePatternMatchesFrontend(workspace)) {
      frontendIncluded = !workspace.startsWith("!");
    }
  }
  expect(frontendIncluded, "root Bun workspace patterns must not include frontend").toBe(false);
}

describe("root scaffold boundary", () => {
  test("removes every orphaned root Next scaffold path", () => {
    for (const relativePath of orphanedRootScaffoldPaths) {
      expect(existsSync(resolve(repositoryRoot, relativePath)), relativePath).toBe(false);
    }
  });

  test("keeps canonical frontend configs in the frontend boundary", () => {
    for (const relativePath of canonicalFrontendConfigPaths) {
      expect(existsSync(resolve(frontendRoot, relativePath)), `frontend/${relativePath}`).toBe(true);
    }
  });

  test("keeps root frontend scripts as explicit delegates", () => {
    for (const [scriptName, expectedCommand] of Object.entries(delegatedFrontendScripts)) {
      expect(rootManifest.scripts?.[scriptName]).toBe(expectedCommand);
    }
    expect(frontendManifest.scripts?.dev).toBe("next dev");
    expect(frontendManifest.scripts?.build).toBe("next build");
    expect(frontendManifest.scripts?.test).toBe("bun test");
  });

  test("keeps frontend outside root Bun workspaces", () => {
    assertFrontendOutsideRootWorkspaces(rootManifest.workspaces ?? []);
  });

  test("rejects workspace globs that would include the frontend boundary", () => {
    for (const pattern of ["*", "./*", "**", "**/frontend", "frontend", "frontend/*", "./frontend/*", "frontend/**", "**/frontend/**"]) {
      expect(() => assertFrontendOutsideRootWorkspaces([pattern]), pattern).toThrow();
    }
  });

  test("evaluates positive and negative workspace globs as an aggregate", () => {
    expect(() => assertFrontendOutsideRootWorkspaces(["*", "!frontend"])).not.toThrow();
    expect(() => assertFrontendOutsideRootWorkspaces(["backend/**", "!services/experimental/**"])).not.toThrow();
    expect(() => assertFrontendOutsideRootWorkspaces(["*", "!backend/**"])).toThrow();
  });

  test("keeps the live root ESLint config and backend root-lint coupling", () => {
    expect(existsSync(rootEslintPath)).toBe(true);
    expect(readFileSync(rootEslintPath, "utf8")).toBe(readFileSync(frontendEslintPath, "utf8"));
    expect(backendManifest.scripts?.lint).toBe("cd .. && bunx eslint backend/api/src --ext .ts");
  });

  test("keeps only the intended shared Vercel triggers", () => {
    const source = readFileSync(vercelIgnorePath, "utf8");
    const sharedPathsMatch = source.match(/^SHARED_PATHS="([^"]*)"$/m);
    expect(sharedPathsMatch).not.toBeNull();
    const sharedPaths = sharedPathsMatch?.[1]?.split(/\s+/u) ?? [];
    expect(sharedPaths).toEqual(["package.json", "bun.lock", ".github"]);
    expect(source).not.toContain("tsconfig.json");
  });
});
