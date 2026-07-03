import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Regression guard: the frontend talks to the backend over HTTP only.
 * It must NEVER import a database driver, ORM, or the shared database
 * package directly. If this test fails, the frontend has re-coupled to
 * the database — route that logic through the API instead.
 */

const SRC_DIR = resolve(import.meta.dir, "..");
const SELF = resolve(import.meta.path);

const SCAN_EXTENSIONS = [".ts", ".tsx"];

// Module specifiers that must never be imported/required from the frontend.
const FORBIDDEN_MODULES: readonly string[] = [
  "drizzle-orm",
  "postgres",
  "@almirant/database",
  "./db",
];

// Bare identifiers that signal a direct DB adapter/env coupling.
const FORBIDDEN_IDENTIFIERS: readonly string[] = [
  "drizzleAdapter",
  "DATABASE_URL",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches static imports, re-exports, `require(...)` and dynamic `import(...)`.
function moduleImportRegex(specifier: string): RegExp {
  const spec = escapeRegExp(specifier);
  return new RegExp(
    `(from|import|require)\\s*\\(?\\s*['"]${spec}['"]`,
  );
}

function identifierRegex(identifier: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`);
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (fullPath === SELF) continue; // never scan this guard itself
    if (SCAN_EXTENSIONS.some((ext) => fullPath.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("frontend has no direct database coupling", () => {
  const sourceFiles = collectSourceFiles(SRC_DIR);

  it("scans a non-empty set of frontend source files", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it("contains zero direct database imports or references", () => {
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const contents = readFileSync(file, "utf8");

      for (const specifier of FORBIDDEN_MODULES) {
        if (moduleImportRegex(specifier).test(contents)) {
          violations.push(`${file} → import "${specifier}"`);
        }
      }

      for (const identifier of FORBIDDEN_IDENTIFIERS) {
        if (identifierRegex(identifier).test(contents)) {
          violations.push(`${file} → identifier "${identifier}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
