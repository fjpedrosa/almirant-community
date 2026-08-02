import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// Capture the real client module BEFORE the mock is registered so afterAll
// can restore it: mock.restore() does NOT clear mock.module() registrations,
// and a leaked client mock poisons later suites in the same run that import
// the real db (see api-key-repository.test.ts for the same pattern/rationale).
const realClient = { ...(await import("../../client")) };

let getWorkspaceOwnerUserId: typeof import("./user-repository").getWorkspaceOwnerUserId;
let capturedWhere: SQL | undefined;
let rowsToReturn: Array<{ userId: string }> = [];

beforeAll(async () => {
  mock.module("../../client", () => ({
    db: {
      select: () => ({
        from: () => ({
          where: (condition: SQL) => {
            capturedWhere = condition;
            return {
              orderBy: () => ({
                limit: async () => rowsToReturn,
              }),
            };
          },
        }),
      }),
    },
  }));

  ({ getWorkspaceOwnerUserId } = await import("./user-repository"));
});

afterAll(() => {
  mock.module("../../client", () => realClient);
  mock.restore();
});

describe("getWorkspaceOwnerUserId", () => {
  test("filters by workspace id and role = 'owner'", async () => {
    rowsToReturn = [{ userId: "owner-user-1" }];
    capturedWhere = undefined;

    await getWorkspaceOwnerUserId("workspace-1");

    expect(capturedWhere).toBeDefined();
    const query = new PgDialect().sqlToQuery(capturedWhere!);
    expect(query.sql).toContain('"member"."workspace_id" = $');
    expect(query.sql).toContain('"member"."role" = $');
    expect(query.params).toContain("workspace-1");
    expect(query.params).toContain("owner");
  });

  test("returns the userId of the resolved row", async () => {
    rowsToReturn = [{ userId: "owner-user-42" }];

    const result = await getWorkspaceOwnerUserId("workspace-1");

    expect(result).toBe("owner-user-42");
  });

  test("returns null when the workspace has no owner member", async () => {
    rowsToReturn = [];

    const result = await getWorkspaceOwnerUserId("workspace-1");

    expect(result).toBeNull();
  });
});
