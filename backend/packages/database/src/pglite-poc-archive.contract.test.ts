import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const databaseSourceRoot = import.meta.dir;
const databasePackageRoot = resolve(databaseSourceRoot, "..");
const repositoryRoot = resolve(databasePackageRoot, "../../..");
const retiredPocDirectory = resolve(databaseSourceRoot, "pglite-poc");
const retiredPocPath = resolve(retiredPocDirectory, "poc.ts");
const archivePath = resolve(
  repositoryRoot,
  "docs/internal/pglite-spike-findings.md",
);
const codemodPath = resolve(
  repositoryRoot,
  "scripts/codemods/rename-organization-to-workspace.sh",
);
const packageManifestPath = resolve(databasePackageRoot, "package.json");
const referenceUrls = [
  "https://pglite.dev/",
  "https://github.com/electric-sql/pglite",
  "https://orm.drizzle.team/docs/connect-pglite",
  "https://orm.drizzle.team/docs/get-started/pglite-new",
  "https://pglite.dev/docs/orm-support",
  "https://pglite.dev/benchmarks",
  "https://www.npmjs.com/package/@electric-sql/pglite",
] as const;

describe("PGlite POC archive contract", () => {
  test("keeps issue #126's executable POC retired and its findings archived", () => {
    expect(existsSync(retiredPocDirectory)).toBe(false);
    expect(existsSync(retiredPocPath)).toBe(false);
    expect(existsSync(archivePath)).toBe(true);

    const archive = readFileSync(archivePath, "utf8");
    expect(archive).toContain("Archived historical record");
    expect(archive).toContain("The executable POC was removed");
    expect(archive).toContain(
      "**Task**: A-338 - Spike PGlite: viabilidad y POC con Drizzle",
    );
    expect(archive).toContain("**Date**: 2026-02-27");
    expect(archive).toContain("The spike found that");
    expect(archive).toContain("The spike concluded that");
    expect(archive).toContain("The spike recommended");
    expect(archive).toContain("25/25 tests passed");
    expect(archive).toContain("~750ms");
    expect(archive).toContain("~870ms");
    expect(archive).toContain("~21ms (~0.2ms/row)");
    expect(archive).toContain("## 5. Limitations Observed by the Spike");
    expect(archive).toContain("**Single-threaded**");
    expect(archive).toContain("**No concurrent connections**");
    expect(archive).toContain("**No extensions ecosystem**");
    expect(archive).toContain("**Memory-bound**");
    expect(archive).toContain("**No LISTEN/NOTIFY**");
    expect(archive).toContain("**Spike verdict: HIGHLY RECOMMENDED**");
    expect(archive).toContain("**Spike verdict: NOT VIABLE**");
    expect(archive).toContain("## 8. References");
    expect(archive.match(/^\- \[[^\]]+\]\(https?:\/\/[^)]+\)$/gm)).toHaveLength(
      7,
    );
    for (const referenceUrl of referenceUrls) {
      expect(archive).toContain(`](${referenceUrl})`);
    }
    expect(archive).not.toContain("How to Run the POC");
    expect(archive).not.toContain("bun run src/pglite-poc/poc.ts");
    expect(archive).not.toContain("backend/packages/database/src/pglite-poc");
    expect(archive).not.toContain("you MUST use");
    expect(archive).not.toContain("Create a `createTestDatabase()` utility");
    expect(archive).not.toContain("Build a script");
    expect(archive).not.toContain("Consider an API endpoint");
    expect(archive).not.toContain("Evaluate PGlite in the browser");

    const codemod = readFileSync(codemodPath, "utf8");
    expect(codemod).not.toContain("pglite-poc");

    const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(manifest.devDependencies?.["@electric-sql/pglite"]).toBeTruthy();
  });
});
