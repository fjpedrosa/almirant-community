import { afterAll, beforeAll, describe, expect, test, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// Capture the real client module BEFORE the mock is registered so afterAll
// can restore it: mock.restore() does NOT clear mock.module() registrations,
// and a leaked client mock poisons later suites in the same run (e.g. the
// DB-gated bug-fix-attempt-cancel-cascade tests) that import the real db.
const realClient = { ...(await import("../../client")) };

let listApiKeys: typeof import("./api-key-repository").listApiKeys;
let capturedWhere: SQL | undefined;

beforeAll(async () => {
  mock.module("../../client", () => ({
    db: {
      select: () => ({
        from: () => ({
          where: (condition: SQL) => {
            capturedWhere = condition;
            return {
              orderBy: async () => [],
            };
          },
        }),
      }),
    },
  }));

  ({ listApiKeys } = await import("./api-key-repository"));
});

afterAll(() => {
  mock.module("../../client", () => realClient);
  mock.restore();
});

describe("api-key-repository", () => {
  test("listApiKeys filters out revoked keys", async () => {
    capturedWhere = undefined;

    await listApiKeys("org-1", "user-1");

    expect(capturedWhere).toBeDefined();
    const query = new PgDialect().sqlToQuery(capturedWhere!);
    expect(query.sql).toContain('"api_keys"."is_active" = $');
    expect(query.params).toContain(true);
  });
});
