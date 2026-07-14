import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UNIT_TEST_DATABASE_URL,
  resolveBackendTestDatabaseEnv,
} from "./backend-test-database-env";

describe("backend pre-push database environment", () => {
  test("uses a non-routable unit-test URL and disables DB suites by default", () => {
    expect(
      resolveBackendTestDatabaseEnv({
        DATABASE_URL: "postgres://production.example/almirant",
      }),
    ).toEqual({
      DATABASE_URL: UNIT_TEST_DATABASE_URL,
      ALMIRANT_RUN_DB_TESTS: "false",
    });
  });

  test("enables DB suites only for the dedicated TEST_DATABASE_URL", () => {
    const testDatabaseUrl = "postgres://ci:ci@localhost:5432/almirant_test";

    expect(
      resolveBackendTestDatabaseEnv({
        DATABASE_URL: "postgres://production.example/almirant",
        TEST_DATABASE_URL: testDatabaseUrl,
      }),
    ).toEqual({
      DATABASE_URL: testDatabaseUrl,
      ALMIRANT_RUN_DB_TESTS: "true",
    });
  });

  test("rejects a dedicated URL that is not PostgreSQL", () => {
    expect(() =>
      resolveBackendTestDatabaseEnv({
        TEST_DATABASE_URL: "https://database.example/almirant_test",
      }),
    ).toThrow("TEST_DATABASE_URL must use postgres:// or postgresql://");
  });

  test("wires lefthook through the portable backend test runner", () => {
    const repositoryRoot = resolve(import.meta.dir, "../../../..");
    const lefthook = readFileSync(resolve(repositoryRoot, "lefthook.yml"), "utf8");
    const runner = readFileSync(
      resolve(repositoryRoot, "scripts/run-backend-pre-push-tests.ts"),
      "utf8",
    );

    expect(lefthook).toContain("bun run scripts/run-backend-pre-push-tests.ts");
    expect(runner).toContain("resolveBackendTestDatabaseEnv");
  });
});
