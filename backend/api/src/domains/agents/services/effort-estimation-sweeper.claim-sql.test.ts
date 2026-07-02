import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Capture the real modules BEFORE registering mocks so we can restore them in
// afterAll — mock.restore() does NOT clear mock.module() registrations and the
// mocks would otherwise leak into subsequent test files.
const realConfig = { ...(await import("@almirant/config")) };
const realDatabase = { ...(await import("@almirant/database")) };
const realPosthog = {
  ...(await import("../../../shared/services/posthog-service")),
};
const realEstimator = { ...(await import("./effort-estimator")) };

// Captures every sql template claimBatch hands to tx.execute so we can assert
// on the generated SQL text without touching a real database.
const executeCalls: Array<{ strings: string[]; values: unknown[] }> = [];

const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => ({
  strings: Array.from(strings),
  values,
});

const txExecute = async (query: unknown) => {
  executeCalls.push(query as { strings: string[]; values: unknown[] });
  return [];
};

mock.module("@almirant/config", () => ({
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
}));

mock.module("@almirant/database", () => ({
  db: {
    transaction: async (fn: (tx: { execute: typeof txExecute }) => unknown) =>
      fn({ execute: txExecute }),
  },
  sql: sqlTag,
  eq: (...args: unknown[]) => ({ args }),
  projects: {},
  workItems: {},
  effortEstimationRequests: {},
  computeWorkItemContentHash: () => "hash-stub",
}));

mock.module("../../../shared/services/posthog-service", () => ({
  isFeatureFlagEnabled: async () => true,
}));

mock.module("./effort-estimator", () => ({
  runEffortEstimation: async () => ({}),
  getCachedActiveConfig: async () => ({}),
  invalidateConfigCache: () => {},
}));

afterAll(() => {
  mock.module("@almirant/config", () => realConfig);
  mock.module("@almirant/database", () => realDatabase);
  mock.module("../../../shared/services/posthog-service", () => realPosthog);
  mock.module("./effort-estimator", () => realEstimator);
});

describe("effort-estimation-sweeper claimBatch SQL", () => {
  beforeEach(() => {
    executeCalls.length = 0;
  });

  const getClaimBatchSql = async (): Promise<string> => {
    const { __internals } = await import("./effort-estimation-sweeper");
    await __internals.claimBatch(5, 15 * 60 * 1000);
    const query = executeCalls[0];
    return query.strings.join("?");
  };

  test("selects pending rows", async () => {
    const sqlText = await getClaimBatchSql();
    expect(sqlText).toContain("status = 'pending'");
  });

  // IMPORTANT 3: a crashed sweeper / hung LLM leaves the row stuck in
  // 'processing' forever, and the partial unique index (work_item_id) WHERE
  // status IN ('pending','processing') then makes enqueue a permanent no-op for
  // that work item. claimBatch must reclaim 'processing' rows whose last attempt
  // is older than the configured timeout.
  test("also reclaims stale 'processing' rows past the reclaim timeout", async () => {
    const sqlText = await getClaimBatchSql();
    expect(sqlText).toContain("status = 'processing'");
    expect(sqlText).toContain("last_attempt_at");
    expect(sqlText).toContain("make_interval");
  });
});
