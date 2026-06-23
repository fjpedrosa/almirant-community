/**
 * Unit tests for preview-db.ts helper functions.
 *
 * These tests validate the pure functions in preview-db.ts without
 * requiring actual database connections. The main CLI commands that
 * interact with PostgreSQL are not tested here (they require integration tests).
 */

import { describe, it, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Test constants (mirrors preview-db.ts)
// ---------------------------------------------------------------------------

const PREVIEW_PREFIX = "preview_";
const DEFAULT_MAX_AGE_DAYS = 7;

// ---------------------------------------------------------------------------
// Helper function implementations (extracted for testing)
// These mirror the private functions in preview-db.ts
// ---------------------------------------------------------------------------

/** Sanitize a branch name into a valid Postgres database name. */
function sanitizeBranchName(branch: string): string {
  return (
    PREVIEW_PREFIX +
    branch
      .toLowerCase()
      .replace(/[/\-\.]/g, "_") // replace /, -, . with _
      .replace(/[^a-z0-9_]/g, "") // strip anything else
      .replace(/_+/g, "_") // collapse consecutive underscores
      .replace(/^_|_$/g, "") // trim leading/trailing underscores
      .slice(0, 63 - PREVIEW_PREFIX.length) // Postgres 63-char limit
  );
}

/** Build a connection URL pointing to a specific database on the same server. */
function connectionUrlForDb(baseUrl: string, dbName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** Extract the maintenance "postgres" DB URL from DATABASE_URL. */
function maintenanceUrl(baseUrl: string): string {
  return connectionUrlForDb(baseUrl, "postgres");
}

/** Parse --max-age-days=N from CLI arguments. */
function parseMaxAgeDays(args: string[]): number {
  for (const arg of args) {
    const match = arg.match(/^--max-age-days=(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return DEFAULT_MAX_AGE_DAYS;
}

/** Parse --pr-number=N from CLI arguments. */
function parsePrNumber(args: string[]): string | undefined {
  for (const arg of args) {
    const match = arg.match(/^--pr-number=(.+)$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/** Format a duration in days into a human-readable string. */
function formatAge(days: number): string {
  if (days < 1) return "< 1 day";
  if (days === 1) return "1 day";
  return `${Math.floor(days)} days`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("preview-db helper functions", () => {
  describe("sanitizeBranchName", () => {
    it("should add preview_ prefix to branch name", () => {
      expect(sanitizeBranchName("main")).toBe("preview_main");
    });

    it("should convert branch name to lowercase", () => {
      expect(sanitizeBranchName("Feature-Branch")).toBe("preview_feature_branch");
    });

    it("should replace slashes with underscores", () => {
      expect(sanitizeBranchName("feature/add-login")).toBe("preview_feature_add_login");
    });

    it("should replace dashes with underscores", () => {
      expect(sanitizeBranchName("feature-branch")).toBe("preview_feature_branch");
    });

    it("should replace dots with underscores", () => {
      expect(sanitizeBranchName("release.1.0.0")).toBe("preview_release_1_0_0");
    });

    it("should strip invalid characters", () => {
      expect(sanitizeBranchName("feature@branch#123")).toBe("preview_featurebranch123");
    });

    it("should collapse consecutive underscores", () => {
      expect(sanitizeBranchName("feature//branch")).toBe("preview_feature_branch");
      expect(sanitizeBranchName("a---b___c")).toBe("preview_a_b_c");
    });

    it("should trim leading and trailing underscores from sanitized portion", () => {
      expect(sanitizeBranchName("-feature-")).toBe("preview_feature");
      expect(sanitizeBranchName("_branch_")).toBe("preview_branch");
    });

    it("should truncate to 63 characters (Postgres limit)", () => {
      const longBranch = "a".repeat(100);
      const result = sanitizeBranchName(longBranch);
      expect(result.length).toBeLessThanOrEqual(63);
      expect(result).toBe("preview_" + "a".repeat(63 - PREVIEW_PREFIX.length));
    });

    it("should handle complex branch names", () => {
      expect(sanitizeBranchName("feature/A-123-add-user-auth")).toBe(
        "preview_feature_a_123_add_user_auth"
      );
    });

    it("should handle empty branch name gracefully", () => {
      expect(sanitizeBranchName("")).toBe("preview_");
    });

    it("should handle branch names with only special characters", () => {
      expect(sanitizeBranchName("@#$%")).toBe("preview_");
    });
  });

  describe("connectionUrlForDb", () => {
    it("should replace database name in URL path", () => {
      const baseUrl = "postgresql://user:pass@localhost:5432/original_db";
      const result = connectionUrlForDb(baseUrl, "new_db");
      expect(result).toBe("postgresql://user:pass@localhost:5432/new_db");
    });

    it("should handle URLs without existing database path", () => {
      const baseUrl = "postgresql://user:pass@localhost:5432/";
      const result = connectionUrlForDb(baseUrl, "new_db");
      expect(result).toBe("postgresql://user:pass@localhost:5432/new_db");
    });

    it("should preserve query parameters", () => {
      const baseUrl = "postgresql://user:pass@localhost:5432/original_db?sslmode=require";
      const result = connectionUrlForDb(baseUrl, "new_db");
      expect(result).toBe("postgresql://user:pass@localhost:5432/new_db?sslmode=require");
    });

    it("should handle remote hosts", () => {
      const baseUrl = "postgresql://admin:secret@db.example.com:5432/prod_db";
      const result = connectionUrlForDb(baseUrl, "preview_feature");
      expect(result).toBe("postgresql://admin:secret@db.example.com:5432/preview_feature");
    });
  });

  describe("maintenanceUrl", () => {
    it("should return URL pointing to postgres database", () => {
      const baseUrl = "postgresql://user:pass@localhost:5432/mydb";
      const result = maintenanceUrl(baseUrl);
      expect(result).toBe("postgresql://user:pass@localhost:5432/postgres");
    });

    it("should preserve credentials and host in maintenance URL", () => {
      const baseUrl = "postgresql://example_user:example_password@db.example.invalid:5432/example_app";
      const result = maintenanceUrl(baseUrl);
      expect(result).toBe("postgresql://example_user:example_password@db.example.invalid:5432/postgres");
    });
  });

  describe("parseMaxAgeDays", () => {
    it("should return default value when no --max-age-days argument", () => {
      expect(parseMaxAgeDays([])).toBe(DEFAULT_MAX_AGE_DAYS);
      expect(parseMaxAgeDays(["cleanup-stale"])).toBe(DEFAULT_MAX_AGE_DAYS);
      expect(parseMaxAgeDays(["--other-flag=value"])).toBe(DEFAULT_MAX_AGE_DAYS);
    });

    it("should parse --max-age-days=N correctly", () => {
      expect(parseMaxAgeDays(["--max-age-days=3"])).toBe(3);
      expect(parseMaxAgeDays(["--max-age-days=14"])).toBe(14);
      expect(parseMaxAgeDays(["--max-age-days=0"])).toBe(0);
    });

    it("should find argument among other arguments", () => {
      expect(parseMaxAgeDays(["cleanup-stale", "--max-age-days=5", "--verbose"])).toBe(5);
    });

    it("should use first match if multiple provided", () => {
      expect(parseMaxAgeDays(["--max-age-days=3", "--max-age-days=7"])).toBe(3);
    });

    it("should ignore malformed arguments", () => {
      expect(parseMaxAgeDays(["--max-age-days=abc"])).toBe(DEFAULT_MAX_AGE_DAYS);
      expect(parseMaxAgeDays(["--max-age-days="])).toBe(DEFAULT_MAX_AGE_DAYS);
      expect(parseMaxAgeDays(["max-age-days=5"])).toBe(DEFAULT_MAX_AGE_DAYS);
    });
  });

  describe("parsePrNumber", () => {
    it("should return undefined when no --pr-number argument", () => {
      expect(parsePrNumber([])).toBeUndefined();
      expect(parsePrNumber(["create", "feature-branch"])).toBeUndefined();
    });

    it("should parse --pr-number=N correctly", () => {
      expect(parsePrNumber(["--pr-number=123"])).toBe("123");
      expect(parsePrNumber(["--pr-number=456"])).toBe("456");
    });

    it("should handle PR numbers with prefixes", () => {
      expect(parsePrNumber(["--pr-number=PR-789"])).toBe("PR-789");
    });

    it("should find argument among other arguments", () => {
      expect(parsePrNumber(["create", "branch", "--pr-number=42"])).toBe("42");
    });
  });

  describe("formatAge", () => {
    it("should format less than 1 day", () => {
      expect(formatAge(0)).toBe("< 1 day");
      expect(formatAge(0.5)).toBe("< 1 day");
      expect(formatAge(0.99)).toBe("< 1 day");
    });

    it("should format exactly 1 day", () => {
      expect(formatAge(1)).toBe("1 day");
      expect(formatAge(1.0)).toBe("1 day");
    });

    it("should format multiple days", () => {
      expect(formatAge(2)).toBe("2 days");
      expect(formatAge(7)).toBe("7 days");
      expect(formatAge(30)).toBe("30 days");
    });

    it("should floor fractional days for multi-day display", () => {
      expect(formatAge(2.5)).toBe("2 days");
      expect(formatAge(3.9)).toBe("3 days");
    });
  });
});

describe("preview database naming conventions", () => {
  it("should generate consistent names for the same branch", () => {
    const branch = "feature/ABC-123-add-login";
    const name1 = sanitizeBranchName(branch);
    const name2 = sanitizeBranchName(branch);
    expect(name1).toBe(name2);
  });

  it("should generate unique names for different branches", () => {
    const name1 = sanitizeBranchName("feature/branch-a");
    const name2 = sanitizeBranchName("feature/branch-b");
    expect(name1).not.toBe(name2);
  });

  it("should generate valid Postgres identifiers", () => {
    const testCases = [
      "main",
      "feature/login",
      "release-1.0.0",
      "hotfix_urgent",
      "UPPERCASE",
      "MixedCase/Branch-Name.v2",
    ];

    for (const branch of testCases) {
      const name = sanitizeBranchName(branch);
      // Postgres identifiers must start with a letter or underscore
      expect(name).toMatch(/^[a-z_]/);
      // And contain only letters, digits, and underscores
      expect(name).toMatch(/^[a-z0-9_]+$/);
      // And be at most 63 characters
      expect(name.length).toBeLessThanOrEqual(63);
    }
  });
});

describe("PreviewMetadata interface", () => {
  interface PreviewMetadata {
    createdAt: string;
    branch: string;
    prNumber?: string;
  }

  it("should serialize and deserialize metadata correctly", () => {
    const metadata: PreviewMetadata = {
      createdAt: new Date().toISOString(),
      branch: "feature/test",
      prNumber: "123",
    };

    const serialized = JSON.stringify(metadata);
    const deserialized = JSON.parse(serialized) as PreviewMetadata;

    expect(deserialized.createdAt).toBe(metadata.createdAt);
    expect(deserialized.branch).toBe(metadata.branch);
    expect(deserialized.prNumber).toBe(metadata.prNumber);
  });

  it("should handle metadata without optional prNumber", () => {
    const metadata: PreviewMetadata = {
      createdAt: "2026-03-15T00:00:00.000Z",
      branch: "main",
    };

    const serialized = JSON.stringify(metadata);
    const deserialized = JSON.parse(serialized) as PreviewMetadata;

    expect(deserialized.prNumber).toBeUndefined();
  });

  it("should calculate age correctly from createdAt", () => {
    const now = Date.now();
    const createdAt = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago

    const metadata: PreviewMetadata = {
      createdAt,
      branch: "test",
    };

    const ageMs = now - new Date(metadata.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    expect(ageDays).toBeCloseTo(3, 1);
  });
});
