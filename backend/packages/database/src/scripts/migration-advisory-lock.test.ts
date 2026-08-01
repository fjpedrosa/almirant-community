import { describe, expect, test } from "bun:test";
import {
  MIGRATION_ADVISORY_LOCK_NAME,
  withMigrationAdvisoryLock,
} from "./migration-advisory-lock";

describe("withMigrationAdvisoryLock", () => {
  test("polls until it acquires the schema migration lock", async () => {
    const events: string[] = [];
    const acquisitionResults = [false, false, true];
    let now = 0;

    const result = await withMigrationAdvisoryLock(
      async (statement, parameters) => {
        events.push(`${statement}:${parameters.join(",")}`);
        if (statement.includes("pg_try_advisory_lock")) {
          return [{ acquired: acquisitionResults.shift() }];
        }
        return [{ released: true }];
      },
      async () => {
        events.push("migrate");
        return "complete";
      },
      {
        timeoutMs: 1_000,
        pollIntervalMs: 100,
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      },
    );

    expect(result).toBe("complete");
    expect(events).toEqual([
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired:" +
        MIGRATION_ADVISORY_LOCK_NAME,
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired:" +
        MIGRATION_ADVISORY_LOCK_NAME,
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired:" +
        MIGRATION_ADVISORY_LOCK_NAME,
      "migrate",
      "SELECT pg_advisory_unlock(hashtext($1)) AS released:" +
        MIGRATION_ADVISORY_LOCK_NAME,
    ]);
  });

  test("times out instead of waiting forever for the lock", async () => {
    let now = 0;
    let migrationStarted = false;

    await expect(
      withMigrationAdvisoryLock(
        async () => [{ acquired: false }],
        async () => {
          migrationStarted = true;
        },
        {
          timeoutMs: 200,
          pollIntervalMs: 100,
          now: () => now,
          sleep: async (milliseconds) => {
            now += milliseconds;
          },
        },
      ),
    ).rejects.toThrow("Timed out after 200ms");

    expect(migrationStarted).toBe(false);
  });

  test("does not hide the migration error when unlock fails", async () => {
    const unlockErrors: Error[] = [];

    await expect(
      withMigrationAdvisoryLock(
        async (statement) => {
          if (statement.includes("pg_try_advisory_lock")) {
            return [{ acquired: true }];
          }
          throw new Error("unlock connection failed");
        },
        async () => {
          throw new Error("migration failed");
        },
        {
          timeoutMs: 1_000,
          onUnlockError: (error) => unlockErrors.push(error),
        },
      ),
    ).rejects.toThrow("migration failed");

    expect(unlockErrors.map((error) => error.message)).toEqual([
      "unlock connection failed",
    ]);
  });

  test("fails when PostgreSQL reports that the held lock was not released", async () => {
    await expect(
      withMigrationAdvisoryLock(
        async (statement) =>
          statement.includes("pg_try_advisory_lock")
            ? [{ acquired: true }]
            : [{ released: false }],
        async () => "complete",
        { timeoutMs: 1_000 },
      ),
    ).rejects.toThrow("did not release");
  });

  test("releases a successfully acquired lock after migration", async () => {
    const events: string[] = [];

    await withMigrationAdvisoryLock(
      async (statement) => {
        events.push(statement);
        return statement.includes("pg_try_advisory_lock")
          ? [{ acquired: true }]
          : [{ released: true }];
      },
      async () => {
        events.push("migrate");
      },
      { timeoutMs: 1_000 },
    );

    expect(events).toEqual([
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      "migrate",
      "SELECT pg_advisory_unlock(hashtext($1)) AS released",
    ]);
  });
});
