import { afterAll, beforeAll, describe, expect, test, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

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
