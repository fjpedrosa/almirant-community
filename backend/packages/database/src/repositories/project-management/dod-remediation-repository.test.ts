import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Capture the real client module BEFORE the mock is registered so afterAll
// can restore it: mock.restore() does NOT clear mock.module() registrations,
// and a leaked client mock poisons later suites in the same run (e.g. the
// DB-gated bug-fix-attempt-cancel-cascade tests) that import the real db.
const realClient = { ...(await import("../../client")) };

let getDodRemediationExpectedLeafTaskIdsUnder:
  typeof import("./dod-remediation-repository").getDodRemediationExpectedLeafTaskIdsUnder;
let capturedSql: SQL | undefined;
let executeRows: Array<{ id: string }> = [];

beforeAll(async () => {
  mock.module("../../client", () => ({
    db: {
      execute: async (query: SQL) => {
        capturedSql = query;
        return { rows: executeRows };
      },
    },
  }));

  ({ getDodRemediationExpectedLeafTaskIdsUnder } = await import("./dod-remediation-repository"));
});

beforeEach(() => {
  capturedSql = undefined;
  executeRows = [];
});

afterAll(() => {
  mock.module("../../client", () => realClient);
  mock.restore();
});

describe("DoD remediation completion expected task query", () => {
  test("maps SQL rows to expected leaf task IDs", async () => {
    executeRows = [{ id: "task-a" }, { id: "task-b" }];

    await expect(
      getDodRemediationExpectedLeafTaskIdsUnder("org-1", "root-1"),
    ).resolves.toEqual(["task-a", "task-b"]);
  });

  test("only expects Backlog DoD-incomplete leaves that are still auto-remediable", async () => {
    await getDodRemediationExpectedLeafTaskIdsUnder("org-1", "root-1");

    expect(capturedSql).toBeDefined();
    const query = new PgDialect().sqlToQuery(capturedSql!);

    expect(query.sql).toContain("bc.role = 'backlog'");
    expect(query.sql).toContain("d.type = 'task'");
    expect(query.sql).toContain("d.archived_at IS NULL");
    expect(query.sql).toContain("d.metadata ->> 'dod_incompleted' = 'true'");
    expect(query.sql).toContain("COALESCE(NULLIF(BTRIM(d.metadata ->> 'dod_report'), ''), '') <> ''");
    expect(query.sql).toContain("COALESCE(d.metadata ->> 'dod_human_action_required', 'false') <> 'true'");
    expect(query.sql).toContain("COALESCE(d.metadata ->> 'dod_human_review_required', 'false') <> 'true'");
    expect(query.sql).toContain("COALESCE(d.metadata ->> 'dod_auto_remediation_blocked', 'false') <> 'true'");
    expect(query.sql).toContain("COALESCE(d.metadata ->> 'dod_external_validation_required', 'false') <> 'true'");
  });
});
