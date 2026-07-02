import { afterAll, beforeAll, beforeEach, describe, expect, test, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { NewHealthCheckRecord } from "../../schema/health";

type HealthRepository = typeof import("./health-repository");

let insertHealthChecks: HealthRepository["insertHealthChecks"];
let cleanOldHealthRecords: HealthRepository["cleanOldHealthRecords"];

let realClient: typeof import("../../client");

let insertCallCount = 0;
let insertedValues: NewHealthCheckRecord[] | undefined;
let capturedDeleteWhere: SQL | undefined;
let deleteReturningRows: { id: string }[] = [];

beforeAll(async () => {
  // Capture the real module BEFORE mocking so it can be re-registered in
  // afterAll (mock.restore() does not clear mock.module registrations).
  realClient = await import("../../client");

  mock.module("../../client", () => ({
    db: {
      insert: () => ({
        values: (values: NewHealthCheckRecord[]) => {
          insertCallCount += 1;
          insertedValues = values;
          return {
            returning: async () =>
              values.map((value, index) => ({ id: `row-${index}`, ...value })),
          };
        },
      }),
      delete: () => ({
        where: (condition: SQL) => {
          capturedDeleteWhere = condition;
          return {
            returning: async () => deleteReturningRows,
          };
        },
      }),
    },
  }));

  ({ insertHealthChecks, cleanOldHealthRecords } = await import("./health-repository"));
});

afterAll(() => {
  mock.module("../../client", () => realClient);
});

beforeEach(() => {
  insertCallCount = 0;
  insertedValues = undefined;
  capturedDeleteWhere = undefined;
  deleteReturningRows = [];
});

describe("health-repository", () => {
  describe("insertHealthChecks", () => {
    test("returns empty array without touching the database when given no checks", async () => {
      const result = await insertHealthChecks([]);

      expect(result).toEqual([]);
      expect(insertCallCount).toBe(0);
    });

    test("inserts the given checks and returns the persisted rows", async () => {
      const now = new Date();
      const checks: NewHealthCheckRecord[] = [
        {
          serviceName: "api",
          status: "healthy",
          latencyMs: 3,
          message: null,
          checkedAt: now,
        },
        {
          serviceName: "database",
          status: "degraded",
          latencyMs: 2500,
          message: "slow",
          checkedAt: now,
        },
      ];

      const result = await insertHealthChecks(checks);

      expect(insertCallCount).toBe(1);
      expect(insertedValues).toEqual(checks);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ serviceName: "api", status: "healthy" });
      expect(result[1]).toMatchObject({ serviceName: "database", status: "degraded" });
    });
  });

  describe("cleanOldHealthRecords", () => {
    test("deletes records older than the given retention window and returns the count", async () => {
      deleteReturningRows = [{ id: "a" }, { id: "b" }, { id: "c" }];

      const deleted = await cleanOldHealthRecords(24);

      expect(deleted).toBe(3);
      expect(capturedDeleteWhere).toBeDefined();
      const query = new PgDialect().sqlToQuery(capturedDeleteWhere!);
      expect(query.sql).toContain('"health_check_records"."checked_at"');
      expect(query.sql).toContain("INTERVAL '24 hours'");
    });

    test("defaults to a 168 hour (7 day) retention window", async () => {
      deleteReturningRows = [];

      const deleted = await cleanOldHealthRecords();

      expect(deleted).toBe(0);
      expect(capturedDeleteWhere).toBeDefined();
      const query = new PgDialect().sqlToQuery(capturedDeleteWhere!);
      expect(query.sql).toContain("INTERVAL '168 hours'");
    });
  });
});
