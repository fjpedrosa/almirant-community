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

// Rows the mocked claim query (3rd execute call) will return. Tests stage
// rows here to exercise claimJobs' post-claim processing (escape-valve WARN).
const claimResultRows: Array<Record<string, unknown>> = [];

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
  return [...claimResultRows];
});

const loggerWarn = mock((..._args: unknown[]) => undefined);

type SqlFragment = { strings: string[]; values: unknown[] };
type SqlJoin = { items: unknown[]; separator: unknown };

const isSqlFragment = (value: unknown): value is SqlFragment =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Partial<SqlFragment>).strings) &&
  Array.isArray((value as Partial<SqlFragment>).values);

const isSqlJoin = (value: unknown): value is SqlJoin =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Partial<SqlJoin>).items) &&
  "separator" in (value as object);

const renderFragmentPart = (value: unknown): string => {
  if (isSqlFragment(value)) return renderSql(value);
  if (isSqlJoin(value)) {
    const separatorText = renderFragmentPart(value.separator);
    return value.items.map((item) => renderFragmentPart(item)).join(separatorText);
  }
  return "?";
};

const renderSql = (fragment: SqlFragment): string =>
  fragment.strings.reduce((text, part, index) => {
    if (index === 0) return part;
    const value = fragment.values[index - 1];
    return `${text}${renderFragmentPart(value)}${part}`;
  }, "");

const collectFragmentValues = (value: unknown): unknown[] => {
  if (isSqlFragment(value)) return collectSqlValues(value);
  if (isSqlJoin(value)) return value.items.flatMap((item) => collectFragmentValues(item));
  return [value];
};

const collectSqlValues = (fragment: SqlFragment): unknown[] =>
  fragment.values.flatMap((value) => collectFragmentValues(value));

const transactionMock = mock(async (callback: (tx: { execute: typeof txExecute }) => Promise<unknown>) => {
  return callback({ execute: txExecute });
});

// createJob's duplicate-active-job unique-violation translation (below)
// inserts directly via `db.insert(...)`, not through a transaction, so it
// needs its own mock of that chain.
const insertState: {
  values: Record<string, unknown> | null;
  returningRows: Array<Record<string, unknown>>;
  throwError: Error | null;
} = {
  values: null,
  returningRows: [],
  throwError: null,
};
const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const insertMock = mock((table: unknown) => ({
  values: (values: Record<string, unknown>) => {
    insertState.values = values;
    insertCalls.push({ table, values });
    return {
      returning: async () => {
        if (insertState.throwError) throw insertState.throwError;
        return [...insertState.returningRows];
      },
    };
  },
}));

const updateState = {
  patch: null as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
};
const updateMock = mock(() => ({
  set: (patch: Record<string, unknown>) => {
    updateState.patch = patch;
    return {
      where: () => ({
        returning: async () => [...updateState.rows],
      }),
    };
  },
}));

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
    insert: insertMock,
    update: updateMock,
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
  deriveRuntimeCapabilityIntent: realShared.deriveRuntimeCapabilityIntent,
  getSkillMemoryMb: () => 0,
  LEGACY_CLAIMABLE_CODING_AGENTS: ["claude-code", "codex", "opencode"],
  resolveRequestedRuntimeSelection: realShared.resolveRequestedRuntimeSelection,
  RuntimeCapabilityIntentError: realShared.RuntimeCapabilityIntentError,
}));

mock.module("@almirant/config", () => ({
  logger: {
    debug: mock(() => undefined),
    info: mock(() => undefined),
    warn: loggerWarn,
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
    claimResultRows.length = 0;
    txExecute.mockClear();
    transactionMock.mockClear();
    loggerWarn.mockClear();
    updateState.patch = null;
    updateState.rows = [];
    updateMock.mockClear();
  });

  test("uses workspace_settings when computing workspace concurrency limits", async () => {
    const { claimJobs } = await import("./agent-job-repository");

    await claimJobs("worker-1", 1);

    expect(executeCalls).toHaveLength(3);
    const claimQuery = executeCalls[2] as { strings: string[] };
    const sqlText = claimQuery.strings.join("?");

    // Built dynamically so the rename codemod cannot rewrite the legacy name.
    const legacyTable = ["organization", "settings"].join("_");

    expect(sqlText).toContain("workspace_settings");
    expect(sqlText).not.toContain(legacyTable);
  });

  test("uses the exact legacy coding-agent gate when no effective set is supplied", async () => {
    const { claimJobs } = await import("./agent-job-repository");

    await claimJobs("worker-legacy", 1);

    const claimQuery = executeCalls[2] as SqlFragment;
    expect(renderSql(claimQuery)).toContain(
      "AND aj.coding_agent::text = ANY(ARRAY[?, ?, ?]::text[])",
    );
    expect(
      collectSqlValues(claimQuery).filter((value) =>
        ["claude-code", "codex", "opencode"].includes(String(value)),
      ),
    ).toEqual(["claude-code", "codex", "opencode"]);
  });

  test("uses only the supplied effective coding-agent set with text comparison", async () => {
    const { claimJobs } = await import("./agent-job-repository");

    await claimJobs("worker-codex", 1, ["codex"]);

    const claimQuery = executeCalls[2] as SqlFragment;
    const sqlText = renderSql(claimQuery);
    expect(sqlText).toContain(
      "AND aj.coding_agent::text = ANY(ARRAY[?]::text[])",
    );
    expect(
      collectSqlValues(claimQuery).filter((value) =>
        ["claude-code", "codex", "opencode", "pi"].includes(String(value)),
      ),
    ).toEqual(["codex"]);
    expect(sqlText).not.toContain("::coding_agent[]");
  });

  test("fails closed for an explicitly empty effective coding-agent set", async () => {
    const { claimJobs } = await import("./agent-job-repository");

    await claimJobs("worker-disabled", 1, []);

    const claimQuery = executeCalls[2] as SqlFragment;
    const sqlText = renderSql(claimQuery);
    expect(sqlText).toContain("AND FALSE");
    expect(sqlText).not.toContain("coding_agent::text = ANY");
  });

  test("persists runtime evidence and the exact model without rewriting", async () => {
    const { updateJobStatus } = await import("./agent-job-repository");
    const runtimeEvidence = {
      schemaVersion: "runtime-evidence-v1",
      observed: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
      infrastructureProvider: "zipu",
      usage: {
        status: "reported",
        source: "terminal_aggregate",
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        cost: { totalUsd: 0.0123 },
      },
    } as const;

    await updateJobStatus("job-runtime-evidence", "completed", {
      model: "glm-5.3",
      runtimeEvidence,
    });

    expect(updateState.patch?.model).toBe("glm-5.3");
    expect(updateState.patch?.runtimeEvidence).toBe(runtimeEvidence);
  });
});

describe("claimJobs effort-estimate gating (A-1945)", () => {
  beforeEach(() => {
    executeCalls.length = 0;
    claimResultRows.length = 0;
    txExecute.mockClear();
    transactionMock.mockClear();
    loggerWarn.mockClear();
  });

  const getClaimSqlText = async (): Promise<string> => {
    const { claimJobs } = await import("./agent-job-repository");
    await claimJobs("worker-1", 1);
    const claimQuery = executeCalls[2] as { strings: string[] };
    return claimQuery.strings.join("?");
  };

  test("picked CTE LEFT JOINs work_item_effort_estimates", async () => {
    const sqlText = await getClaimSqlText();
    expect(sqlText).toContain("LEFT JOIN work_item_effort_estimates e");
    expect(sqlText).toContain("e.work_item_id = aj.work_item_id");
  });

  test("gates runner-implement/runner-document on estimate presence with a 10-minute escape", async () => {
    const sqlText = await getClaimSqlText();
    expect(sqlText).toContain("aj.skill_name NOT IN ('runner-implement', 'runner-document')");
    expect(sqlText).toContain("aj.prompt_template NOT IN ('runner-implement', 'runner-document')");
    expect(sqlText).toContain("e.id IS NOT NULL");
    expect(sqlText).toContain("aj.created_at < NOW() - INTERVAL '10 minutes'");
  });

  // CRITICAL 1: skill_name / prompt_template are NULL for prompt-only (scheduled)
  // jobs. In SQL `NULL NOT IN (...)` evaluates to NULL, not TRUE, so an
  // un-guarded `skill_name NOT IN (...) AND prompt_template NOT IN (...)` drops
  // the entire OR-chain to NULL and silently EXCLUDES the row from being claimed
  // until the 10-minute escape kicks in. The gate must NULL-guard both columns
  // exactly like the sibling workspace_id guard three lines above.
  test("NULL-guards skill_name and prompt_template so prompt-only jobs are not gated out", async () => {
    const sqlText = await getClaimSqlText();
    expect(sqlText).toContain(
      "aj.skill_name IS NULL OR aj.skill_name NOT IN ('runner-implement', 'runner-document')",
    );
    expect(sqlText).toContain(
      "aj.prompt_template IS NULL OR aj.prompt_template NOT IN ('runner-implement', 'runner-document')",
    );
  });

  // CRITICAL 2: when the estimator is disabled (no active effort_estimator_config,
  // e.g. kill-switch / degraded estimator) no estimate rows are ever written, so
  // gating would make every runner-implement/runner-document job wait out the
  // 10-minute escape — strictly worse than not gating. The gate must be skipped
  // entirely when no active config exists.
  test("skips the estimate gate entirely when no active effort_estimator_config exists", async () => {
    const sqlText = await getClaimSqlText();
    expect(sqlText).toContain("NOT EXISTS");
    expect(sqlText).toContain("effort_estimator_configs");
    expect(sqlText).toContain("is_active = true");
  });

  test("locks only agent_jobs rows (FOR UPDATE OF aj SKIP LOCKED)", async () => {
    const sqlText = await getClaimSqlText();
    expect(sqlText).toContain("FOR UPDATE OF aj SKIP LOCKED");
    expect(sqlText).not.toContain("FOR UPDATE SKIP LOCKED");
  });

  test("RETURNING surfaces estimatedMemoryMb, estimatedSubagents and childCount", async () => {
    const sqlText = await getClaimSqlText();
    expect(sqlText).toContain('p.estimated_memory_mb AS "estimatedMemoryMb"');
    expect(sqlText).toContain('p.estimated_subagents AS "estimatedSubagents"');
    expect(sqlText).toContain('AS "childCount"');
    expect(sqlText).toContain("wi.parent_id = aj.work_item_id");
  });

  test("emits a WARN when a gated job is claimed via the 10-minute escape (no estimate)", async () => {
    claimResultRows.push({
      id: "job-escape",
      workItemId: "wi-1",
      skillName: "runner-implement",
      promptTemplate: "runner-implement",
      estimatedMemoryMb: null,
      estimatedSubagents: null,
      childCount: 0,
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
    });

    const { claimJobs } = await import("./agent-job-repository");
    const rows = await claimJobs("worker-1", 1);

    expect(rows).toHaveLength(1);
    expect(loggerWarn.mock.calls.length).toBeGreaterThanOrEqual(1);
    const warnedWithEscape = loggerWarn.mock.calls.some((call) =>
      String(call[1] ?? "").includes("10-minute estimate escape")
    );
    expect(warnedWithEscape).toBe(true);
  });

  test("does NOT warn when the claimed gated job carries an estimate", async () => {
    claimResultRows.push({
      id: "job-estimated",
      workItemId: "wi-2",
      skillName: "runner-implement",
      promptTemplate: "runner-implement",
      estimatedMemoryMb: 4096,
      estimatedSubagents: 3,
      childCount: 2,
      createdAt: new Date(),
    });

    const { claimJobs } = await import("./agent-job-repository");
    const rows = await claimJobs("worker-1", 1);

    expect(rows).toHaveLength(1);
    const warnedWithEscape = loggerWarn.mock.calls.some((call) =>
      String(call[1] ?? "").includes("10-minute estimate escape")
    );
    expect(warnedWithEscape).toBe(false);
  });

  test("does NOT warn for non-gated skills without estimate", async () => {
    claimResultRows.push({
      id: "job-other",
      workItemId: "wi-3",
      skillName: "feedback-bug-triage",
      promptTemplate: "feedback-bug-triage",
      estimatedMemoryMb: null,
      estimatedSubagents: null,
      childCount: 0,
      createdAt: new Date(),
    });

    const { claimJobs } = await import("./agent-job-repository");
    const rows = await claimJobs("worker-1", 1);

    expect(rows).toHaveLength(1);
    const warnedWithEscape = loggerWarn.mock.calls.some((call) =>
      String(call[1] ?? "").includes("10-minute estimate escape")
    );
    expect(warnedWithEscape).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createJob — duplicate-active-job unique-violation translation.
//
// `agent_jobs_work_item_job_type_active_uidx` (migration 0222, parity with
// cloud 0236) guards against two dispatch authorities racing to create an
// active job for the same (work_item_id, job_type) pair. `createJob` must
// translate the resulting postgres 23505 into `DuplicateActiveJobError` so
// callers (the scheduled-agent-dispatcher tick, workers.routes.ts) can treat
// it as a skipped candidate instead of an unexpected failure — see
// scheduled-agent-authoritative-dispatch-migration-0222.test.ts for the
// index/migration itself.
// ---------------------------------------------------------------------------
describe("createJob duplicate-active-job handling", () => {
  beforeEach(() => {
    insertState.values = null;
    insertState.returningRows = [{ id: "created-job-1", status: "queued" }];
    insertState.throwError = null;
    insertCalls.length = 0;
    insertMock.mockClear();
  });

  test("translates the agent_jobs_work_item_job_type_active_uidx violation into DuplicateActiveJobError", async () => {
    const { createJob, DuplicateActiveJobError } = await import("./agent-job-repository");

    const conflict = Object.assign(
      new Error("duplicate key value violates unique constraint \"agent_jobs_work_item_job_type_active_uidx\""),
      { code: "23505", constraint_name: "agent_jobs_work_item_job_type_active_uidx" },
    );
    insertState.throwError = conflict;

    const attempt = createJob({
      workItemId: "wi-1",
      jobType: "implementation",
      provider: "claude-code",
      config: { repoPath: ".", baseBranch: "main" },
    });

    await expect(attempt).rejects.toBeInstanceOf(DuplicateActiveJobError);
  });

  test("also classifies the violation when the driver wraps it one level in `cause`", async () => {
    const { createJob, DuplicateActiveJobError } = await import("./agent-job-repository");

    const wrapped = Object.assign(new Error("insert failed"), {
      cause: { code: "23505", constraint_name: "agent_jobs_work_item_job_type_active_uidx" },
    });
    insertState.throwError = wrapped as Error;

    await expect(
      createJob({
        workItemId: "wi-2",
        jobType: "review",
        provider: "claude-code",
        config: { repoPath: ".", baseBranch: "main" },
      }),
    ).rejects.toBeInstanceOf(DuplicateActiveJobError);
  });

  test("rethrows unrelated unique violations unchanged", async () => {
    const { createJob, DuplicateActiveJobError } = await import("./agent-job-repository");

    const unrelated = Object.assign(new Error("duplicate key value violates unique constraint \"some_other_idx\""), {
      code: "23505",
      constraint_name: "some_other_idx",
    });
    insertState.throwError = unrelated;

    const attempt = createJob({
      workItemId: "wi-3",
      jobType: "implementation",
      provider: "claude-code",
      config: { repoPath: ".", baseBranch: "main" },
    });

    await expect(attempt).rejects.toThrow("some_other_idx");
    await expect(
      createJob({
        workItemId: "wi-3",
        jobType: "implementation",
        provider: "claude-code",
        config: { repoPath: ".", baseBranch: "main" },
      }),
    ).rejects.not.toBeInstanceOf(DuplicateActiveJobError);
  });

  test("creates the job normally when there is no conflict", async () => {
    const { createJob } = await import("./agent-job-repository");

    const job = await createJob({
      workItemId: "wi-4",
      jobType: "implementation",
      provider: "claude-code",
      config: { repoPath: ".", baseBranch: "main" },
    });

    expect(job).toMatchObject({ id: "created-job-1", status: "queued" });
    expect(insertState.values).toMatchObject({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
      resolvedRuntimeSelection: {
        schemaVersion: "resolved-runtime-selection-v1",
        provider: "claude-code",
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-8",
        authClass: "api_key",
        capabilities: [],
      },
    });
  });

  test("admits only the exact capability-neutral Pi tuple", async () => {
    const { createJob } = await import("./agent-job-repository");

    await expect(createJob({
      workItemId: "wi-pi-exact",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      config: { repoPath: ".", baseBranch: "main" },
    })).resolves.toMatchObject({ id: "created-job-1", status: "queued" });

    expect(insertState.values).toMatchObject({
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      resolvedRuntimeSelection: {
        authClass: "api_key",
        capabilities: [],
      },
    });
  });

  test("rejects restricted Pi intent before insertion", async () => {
    const { createJob } = await import("./agent-job-repository");

    await expect(createJob({
      workItemId: "wi-pi-browser",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      config: { repoPath: ".", baseBranch: "main", needsBrowser: true },
    })).rejects.toThrow("PI_CAPABILITY_BROWSER_DISABLED");

    expect(insertCalls).toHaveLength(0);
    expect(insertState.values).toBeNull();
  });
});
