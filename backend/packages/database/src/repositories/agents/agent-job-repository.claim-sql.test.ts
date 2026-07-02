import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Capture the real modules BEFORE registering mocks so we can restore them in
// afterAll — mock.restore() does NOT clear mock.module() registrations and the
// mocks would otherwise leak into subsequent test files.
// Spread each namespace into a plain object: ESM namespaces are live views
// that would reflect the mock after mock.module() replaces the module.
const realDrizzleOrm = { ...(await import("drizzle-orm")) };
const realPgCore = { ...(await import("drizzle-orm/pg-core")) };
const realConfig = { ...(await import("@almirant/config")) };
const realShared = { ...(await import("@almirant/shared")) };
const realClient = { ...(await import("../../client")) };
const realSchema = { ...(await import("../../schema")) };
const realSystemSettings = { ...(await import("../../schema/system-settings")) };
const realJobTemplateResolution = { ...(await import("./job-template-resolution")) };
const realAdminSettings = { ...(await import("../admin/admin-settings.repository")) };

const executeCalls: Array<{ strings: string[]; values: unknown[] } | unknown> = [];

const txExecute = mock(async (query: unknown) => {
  executeCalls.push(query);

  // 1) Worker row lock query
  if (executeCalls.length === 1) {
    return [];
  }

  // 2) Capacity query => leave room so claimJobs reaches the picked CTE
  if (executeCalls.length === 2) {
    return [{ maxConcurrent: 2, runningCount: 0 }];
  }

  // 3) Claim query
  return [];
});

const transactionMock = mock(async (callback: (tx: { execute: typeof txExecute }) => Promise<unknown>) => {
  return callback({ execute: txExecute });
});

const sqlTag = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }),
  {
    join: (items: unknown[], separator: unknown) => ({ items, separator }),
  },
);

mock.module("../../client", () => ({
  db: {
    transaction: transactionMock,
  },
}));

mock.module("../../schema", () => ({
  agentJobs: {},
  workItems: {},
  projects: {},
  boards: {},
  planningSessions: {},
  user: {},
  workerRegistrations: {},
  workspaceSettings: {},
  workspace: {},
  feedbackItems: {},
}));

mock.module("../../schema/system-settings", () => ({
  INTERNAL_SKILL_KEYS: [],
}));

mock.module("./job-template-resolution", () => ({
  resolvePersistedJobTemplateFields: mock(async () => null),
}));

mock.module("../admin/admin-settings.repository", () => ({
  getSystemSettings: mock(async () => ({ agentRouting: {} })),
}));

mock.module("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ args }),
  asc: (...args: unknown[]) => ({ args }),
  desc: (...args: unknown[]) => ({ args }),
  eq: (...args: unknown[]) => ({ args }),
  gte: (...args: unknown[]) => ({ args }),
  ilike: (...args: unknown[]) => ({ args }),
  inArray: (...args: unknown[]) => ({ args }),
  isNull: (...args: unknown[]) => ({ args }),
  isNotNull: (...args: unknown[]) => ({ args }),
  lte: (...args: unknown[]) => ({ args }),
  or: (...args: unknown[]) => ({ args }),
  sql: sqlTag,
  notInArray: (...args: unknown[]) => ({ args }),
  count: (...args: unknown[]) => ({ args }),
}));

mock.module("drizzle-orm/pg-core", () => ({
  alias: (table: unknown) => table,
}));

mock.module("@almirant/shared", () => ({
  getSkillMemoryMb: () => 0,
}));

mock.module("@almirant/config", () => ({
  logger: {
    debug: mock(() => undefined),
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
  },
  getCurrentTraceId: () => "test-trace-id",
}));

afterAll(() => {
  mock.module("drizzle-orm", () => realDrizzleOrm);
  mock.module("drizzle-orm/pg-core", () => realPgCore);
  mock.module("@almirant/config", () => realConfig);
  mock.module("@almirant/shared", () => realShared);
  mock.module("../../client", () => realClient);
  mock.module("../../schema", () => realSchema);
  mock.module("../../schema/system-settings", () => realSystemSettings);
  mock.module("./job-template-resolution", () => realJobTemplateResolution);
  mock.module("../admin/admin-settings.repository", () => realAdminSettings);
});

describe("claimJobs SQL regression", () => {
  beforeEach(() => {
    executeCalls.length = 0;
    txExecute.mockClear();
    transactionMock.mockClear();
  });

  test("uses workspace_settings when computing workspace concurrency limits", async () => {
    const { claimJobs } = await import("./agent-job-repository");

    await claimJobs("worker-1", 1);

    expect(executeCalls).toHaveLength(3);
    const claimQuery = executeCalls[2] as { strings: string[] };
    const sqlText = claimQuery.strings.join("?");

    expect(sqlText).toContain("workspace_settings");
    expect(sqlText).not.toContain("organization_settings");
  });
});
