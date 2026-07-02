import { describe, expect, test } from "bun:test";

/**
 * Boot contract for the observability services.
 *
 * The API crashed at startup with a SyntaxError because health-checker.ts and
 * health-check-sweeper.ts imported `insertHealthChecks` / `cleanOldHealthRecords`
 * from `@almirant/database`, but those exports were missing from the package.
 * These tests fail if the exports disappear again.
 *
 * Note: like every test in this package, running this file requires
 * DATABASE_URL in the environment — the bunfig test preload pulls in
 * `@almirant/config`, whose env validation runs before any test code.
 * No database connection is actually opened by these tests.
 */
describe("observability services import contract", () => {
  test("@almirant/database exports insertHealthChecks and cleanOldHealthRecords", async () => {
    const database = await import("@almirant/database");

    expect(typeof database.insertHealthChecks).toBe("function");
    expect(typeof database.cleanOldHealthRecords).toBe("function");
  });

  test("health-checker module loads and exposes runHealthChecks", async () => {
    const healthChecker = await import("./health-checker");

    expect(typeof healthChecker.runHealthChecks).toBe("function");
  });

  test("health-check-sweeper module loads and exposes its service functions", async () => {
    const sweeper = await import("./health-check-sweeper");

    expect(typeof sweeper.startHealthCheckSweeper).toBe("function");
    expect(typeof sweeper.runHealthCheckSweeperOnce).toBe("function");
  });
});
