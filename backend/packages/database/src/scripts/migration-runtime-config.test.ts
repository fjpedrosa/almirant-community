import { describe, expect, test } from "bun:test";
import {
  resolveMigrationDatabaseUrl,
  resolveMigrationLockTimeoutMs,
} from "./migration-runtime-config";

describe("migration runtime configuration", () => {
  test("prefers the direct migration URL without changing the API URL", () => {
    const environment = {
      DATABASE_URL: "postgresql://transaction-pool/api",
      MIGRATION_DATABASE_URL: "postgresql://direct/migrations",
    };

    expect(resolveMigrationDatabaseUrl(environment)).toBe(
      "postgresql://direct/migrations",
    );
    expect(environment.DATABASE_URL).toBe("postgresql://transaction-pool/api");
  });

  test("falls back to DATABASE_URL", () => {
    expect(
      resolveMigrationDatabaseUrl({ DATABASE_URL: "postgresql://direct/api" }),
    ).toBe("postgresql://direct/api");
  });

  test("rejects missing database URLs", () => {
    expect(() => resolveMigrationDatabaseUrl({})).toThrow(
      "MIGRATION_DATABASE_URL or DATABASE_URL",
    );
  });

  test("uses a bounded default lock timeout and accepts an override", () => {
    expect(resolveMigrationLockTimeoutMs({})).toBe(60_000);
    expect(
      resolveMigrationLockTimeoutMs({ MIGRATION_LOCK_TIMEOUT_MS: "12500" }),
    ).toBe(12_500);
  });

  test("rejects invalid lock timeouts", () => {
    expect(() =>
      resolveMigrationLockTimeoutMs({ MIGRATION_LOCK_TIMEOUT_MS: "forever" }),
    ).toThrow("MIGRATION_LOCK_TIMEOUT_MS");
    expect(() =>
      resolveMigrationLockTimeoutMs({ MIGRATION_LOCK_TIMEOUT_MS: "0" }),
    ).toThrow("MIGRATION_LOCK_TIMEOUT_MS");
  });
});
