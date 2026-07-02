import { afterAll, describe, test, expect, mock, beforeEach } from "bun:test";
import { restoreRealModules } from "../../../../test/mocks";

// ── Mock repository functions (MUST be before dynamic imports) ──

type DatabaseModule = typeof import("@almirant/database");
type WorkItemEventRow = Awaited<
  ReturnType<DatabaseModule["getWorkItemEventsByWorkItemId"]>
>[number];
type JobRow = Awaited<ReturnType<DatabaseModule["getJobsByWorkItem"]>>[number];
type WorkerRow = NonNullable<Awaited<ReturnType<DatabaseModule["getWorkerById"]>>>;
type AiSessionSummary = Awaited<
  ReturnType<DatabaseModule["getAiSessionsSummaryByWorkItemId"]>
>;
type AiSessionRow = AiSessionSummary["sessions"][number];

const getActiveJobForWorkItemMock = mock(
  (() => Promise.resolve(null)) as DatabaseModule["getActiveJobForWorkItem"]
);
const getJobsByWorkItemMock = mock(
  (() => Promise.resolve([])) as DatabaseModule["getJobsByWorkItem"]
);
const getAiSessionsSummaryByWorkItemIdMock = mock(
  (() => Promise.resolve(makeAiSessionSummary())) as DatabaseModule["getAiSessionsSummaryByWorkItemId"]
);
const getWorkItemEventsByWorkItemIdMock = mock(
  (() => Promise.resolve([])) as DatabaseModule["getWorkItemEventsByWorkItemId"]
);
const getWorkerByIdMock = mock(
  (() => Promise.resolve(null)) as DatabaseModule["getWorkerById"]
);
const getUserByIdMock = mock((() => Promise.resolve(null)) as DatabaseModule["getUserById"]);

mock.module("@almirant/database", () => ({
  getActiveJobForWorkItem: getActiveJobForWorkItemMock,
  getJobsByWorkItem: getJobsByWorkItemMock,
  getAiSessionsSummaryByWorkItemId: getAiSessionsSummaryByWorkItemIdMock,
  getWorkItemEventsByWorkItemId: getWorkItemEventsByWorkItemIdMock,
  getWorkerById: getWorkerByIdMock,
  getUserById: getUserByIdMock,
}));

// ── Helpers ──

const ORG_ID = "org-test-001";
const WORK_ITEM_ID = "wi-test-001";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    workItemId: WORK_ITEM_ID,
    eventType: "moved",
    triggeredBy: "user",
    triggeredByUserId: "usr-1",
    triggeredByUserName: "Alice",
    triggeredByUserImage: "https://example.com/alice.png",
    metadata: {},
    createdAt: new Date("2026-03-10T12:00:00Z"),
    ...overrides,
  } as WorkItemEventRow;
}

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    createdAt: new Date("2026-03-10T10:00:00Z"),
    updatedAt: new Date("2026-03-10T10:00:00Z"),
    priority: "medium",
    workspaceId: ORG_ID,
    projectId: null,
    boardId: null,
    workItemId: WORK_ITEM_ID,
    jobType: "implementation",
    status: "running",
    provider: "claude-code",
    config: makeJobConfig(),
    workerId: null,
    branchName: null,
    startedAt: new Date("2026-03-10T11:00:00Z"),
    completedAt: null,
    durationMs: null,
    cumulativeDurationMs: 0,
    createdByUserId: "usr-1",
    planningSessionId: null,
    ...overrides,
  } as JobRow;
}

function makeWorker(overrides: Partial<WorkerRow> = {}): WorkerRow {
  return {
    id: "worker-row-1",
    createdAt: new Date("2026-03-10T10:00:00Z"),
    updatedAt: new Date("2026-03-10T10:00:00Z"),
    config: {} as WorkerRow["config"],
    workerId: "wrk-1",
    hostname: "worker-alpha",
    status: "online",
    currentIp: null,
    lastHeartbeatAt: new Date("2026-03-10T11:59:00Z"),
    ...overrides,
  } as WorkerRow;
}

function makeAiSession(overrides: Partial<AiSessionRow> = {}): AiSessionRow {
  return {
    id: "ses-1",
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  } as AiSessionRow;
}

function makeAiSessionSummary(
  overrides: Omit<Partial<AiSessionSummary>, "summary"> & {
    summary?: Partial<AiSessionSummary["summary"]>;
  } = {}
): AiSessionSummary {
  const { summary: summaryOverrides, ...rest } = overrides;

  return {
    sessions: [],
    summary: {
      sessionCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      totalEstimatedCost: "0.000000",
      ...summaryOverrides,
    },
    ...rest,
  };
}

function makeJobConfig(
  overrides: Partial<JobRow["config"]> = {}
): JobRow["config"] {
  return {
    repoPath: ".",
    baseBranch: "main",
    ...overrides,
  };
}

function resetAllMocks() {
  getActiveJobForWorkItemMock.mockReset();
  getJobsByWorkItemMock.mockReset();
  getAiSessionsSummaryByWorkItemIdMock.mockReset();
  getWorkItemEventsByWorkItemIdMock.mockReset();
  getWorkerByIdMock.mockReset();
  getUserByIdMock.mockReset();

  // Re-set defaults after reset
  getActiveJobForWorkItemMock.mockImplementation(() => Promise.resolve(null));
  getJobsByWorkItemMock.mockImplementation(() => Promise.resolve([]));
  getAiSessionsSummaryByWorkItemIdMock.mockImplementation(() => Promise.resolve(makeAiSessionSummary()));
  getWorkItemEventsByWorkItemIdMock.mockImplementation(() =>
    Promise.resolve([])
  );
  getWorkerByIdMock.mockImplementation(() => Promise.resolve(null));
  getUserByIdMock.mockImplementation(() => Promise.resolve(null));
}

// ── Tests ──

describe("getWorkItemProvenance", () => {
  let getWorkItemProvenance: typeof import("./work-item-provenance-service").getWorkItemProvenance;

  beforeEach(async () => {
    resetAllMocks();
    // Dynamic import to ensure mocks are wired
    const mod = await import("./work-item-provenance-service");
    getWorkItemProvenance = mod.getWorkItemProvenance;
  });

  // ── 1. Empty provenance ──

  test("returns empty provenance when no events, jobs, or sessions exist", async () => {
    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.lastOrigin).toBeNull();
    expect(result.activeRun).toBeNull();
    expect(result.recentJobs).toEqual([]);
    expect(result.sessionSummary).toEqual({
      totalSessions: 0,
      totalTokens: 0,
      totalEstimatedCost: "0.000000",
      totalDurationMs: 0,
    });
    expect(result.links).toEqual({
      activeJobId: null,
      latestSessionId: null,
      planningSessionId: null,
    });
  });

  // ── 2. Last origin from event with web source ──

  test("populates lastOrigin from most recent event with web source metadata", async () => {
    getWorkItemEventsByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve([
        makeEvent({
          triggeredBy: "user",
          metadata: { source: "web", processType: "manual" },
        }),
      ])
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.lastOrigin).not.toBeNull();
    expect(result.lastOrigin!.source).toBe("web");
    expect(result.lastOrigin!.triggeredBy).toBe("user");
    expect(result.lastOrigin!.userId).toBe("usr-1");
    expect(result.lastOrigin!.userName).toBe("Alice");
    expect(result.lastOrigin!.processType).toBe("manual");
    expect(result.lastOrigin!.timestamp).toBe("2026-03-10T12:00:00.000Z");
  });

  // ── 3. Last origin from MCP event ──

  test("populates lastOrigin from MCP-triggered event", async () => {
    getWorkItemEventsByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve([
        makeEvent({
          triggeredBy: "mcp",
          triggeredByUserId: null,
          triggeredByUserName: null,
          triggeredByUserImage: null,
          metadata: { source: "mcp" },
        }),
      ])
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.lastOrigin!.source).toBe("mcp");
    expect(result.lastOrigin!.triggeredBy).toBe("mcp");
    expect(result.lastOrigin!.userId).toBeNull();
    expect(result.lastOrigin!.userName).toBeNull();
  });

  // ── 4. Last origin from worker event ──

  test("populates lastOrigin from worker-triggered event", async () => {
    getWorkItemEventsByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve([
        makeEvent({
          triggeredBy: "worker",
          metadata: { source: "worker", processType: "bug-fix", workerId: "wrk-1" },
        }),
      ])
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.lastOrigin!.source).toBe("worker");
    expect(result.lastOrigin!.triggeredBy).toBe("worker");
    expect(result.lastOrigin!.processType).toBe("bug-fix");
  });

  // ── 5. Active run detection ──

  test("populates activeRun when an active job exists", async () => {
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(makeJob({ status: "running" }))
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.activeRun).not.toBeNull();
    expect(result.activeRun!.jobId).toBe("job-1");
    expect(result.activeRun!.jobType).toBe("implementation");
    expect(result.activeRun!.status).toBe("running");
    expect(result.activeRun!.provider).toBe("claude-code");
    expect(result.activeRun!.worker).toBeNull();
    expect(result.links.activeJobId).toBe("job-1");
  });

  // ── 6. Active run with worker details ──

  test("fetches worker details when active job has workerId", async () => {
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(makeJob({ workerId: "wrk-1" }))
    );
    getWorkerByIdMock.mockImplementation(() =>
      Promise.resolve(makeWorker())
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.activeRun!.worker).not.toBeNull();
    expect(result.activeRun!.worker!.workerId).toBe("wrk-1");
    expect(result.activeRun!.worker!.hostname).toBe("worker-alpha");
    expect(result.activeRun!.worker!.status).toBe("online");
    expect(result.activeRun!.worker!.lastHeartbeatAt).toBe("2026-03-10T11:59:00.000Z");
    expect(getWorkerByIdMock).toHaveBeenCalledWith("wrk-1");
  });

  // ── 7. Active run with skillName from config ──

  test("extracts skillName from job config", async () => {
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(makeJob({ config: makeJobConfig({ skillName: "implement" }) }))
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.activeRun!.skillName).toBe("implement");
  });

  // ── 8. Does not fetch worker when workerId is null ──

  test("does not call getWorkerById when active job has no workerId", async () => {
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(makeJob({ workerId: null }))
    );

    await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(getWorkerByIdMock).not.toHaveBeenCalled();
  });

  // ── 9. Recent jobs limited to 5 ──

  test("returns only the last 5 jobs in recentJobs", async () => {
    const jobs = Array.from({ length: 8 }, (_, i) =>
      makeJob({
        id: `job-${i + 1}`,
        status: i === 0 ? "running" : "completed",
        completedAt: i > 0 ? new Date(`2026-03-0${i}T12:00:00Z`) : null,
        durationMs: i > 0 ? 60000 * i : null,
      })
    );
    getJobsByWorkItemMock.mockImplementation(() => Promise.resolve(jobs));

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.recentJobs).toHaveLength(5);
    expect(result.recentJobs[0]!.jobId).toBe("job-1");
    expect(result.recentJobs[4]!.jobId).toBe("job-5");
  });

  // ── 10. Session summary aggregation ──

  test("maps session summary from repository data", async () => {
    getAiSessionsSummaryByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve(
        makeAiSessionSummary({
          sessions: [
            makeAiSession({ id: "ses-1", inputTokens: 1000, outputTokens: 500 }),
            makeAiSession({ id: "ses-2", inputTokens: 2000, outputTokens: 1000 }),
          ],
          summary: {
            sessionCount: 2,
            totalInputTokens: 3000,
            totalOutputTokens: 1500,
            totalTokens: 4500,
            totalDurationMs: 120000,
            totalEstimatedCost: "0.045000",
          },
        })
      )
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.sessionSummary.totalSessions).toBe(2);
    expect(result.sessionSummary.totalTokens).toBe(4500);
    expect(result.sessionSummary.totalEstimatedCost).toBe("0.045000");
    expect(result.sessionSummary.totalDurationMs).toBe(120000);
  });

  // ── 11. Latest session ID from sessions list ──

  test("sets latestSessionId from first session in list", async () => {
    getAiSessionsSummaryByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve(
        makeAiSessionSummary({
          sessions: [
            makeAiSession({ id: "ses-latest" }),
            makeAiSession({ id: "ses-older" }),
          ],
          summary: {
            sessionCount: 2,
          },
        })
      )
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.links.latestSessionId).toBe("ses-latest");
  });

  // ── 12. Planning session ID from active job ──

  test("resolves planningSessionId from active job", async () => {
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(makeJob({ planningSessionId: "plan-active" }))
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.links.planningSessionId).toBe("plan-active");
  });

  // ── 13. Planning session ID fallback to recent job ──

  test("falls back to planningSessionId from recent jobs when active job has none", async () => {
    getJobsByWorkItemMock.mockImplementation(() =>
      Promise.resolve([
        makeJob({ id: "job-1", planningSessionId: null }),
        makeJob({ id: "job-2", planningSessionId: "plan-from-job-2" }),
        makeJob({ id: "job-3", planningSessionId: "plan-from-job-3" }),
      ])
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.links.planningSessionId).toBe("plan-from-job-2");
  });

  // ── 14. Partial/historical data - event with empty metadata ──

  test("handles events with empty or null metadata gracefully", async () => {
    getWorkItemEventsByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve([
        makeEvent({
          metadata: {},
          triggeredByUserId: null,
          triggeredByUserName: null,
          triggeredByUserImage: null,
        }),
      ])
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.lastOrigin).not.toBeNull();
    expect(result.lastOrigin!.source).toBeNull();
    expect(result.lastOrigin!.processType).toBeNull();
    expect(result.lastOrigin!.skillName).toBeNull();
    expect(result.lastOrigin!.userId).toBeNull();
  });

  test("handles events with null metadata gracefully", async () => {
    getWorkItemEventsByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve([
        makeEvent({ metadata: null }),
      ])
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.lastOrigin).not.toBeNull();
    expect(result.lastOrigin!.source).toBeNull();
    expect(result.lastOrigin!.processType).toBeNull();
  });

  // ── 15. Worker not found despite workerId ──

  test("sets worker to null when getWorkerById returns null", async () => {
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(makeJob({ workerId: "wrk-missing" }))
    );
    getWorkerByIdMock.mockImplementation(() => Promise.resolve(null));

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.activeRun!.worker).toBeNull();
  });

  // ── 16. Job with null config ──

  test("returns null skillName when job config is null", async () => {
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(makeJob({ config: null as never }))
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(result.activeRun!.skillName).toBeNull();
  });

  // ── 17. Full combined scenario ──

  test("returns fully populated provenance with all data sources", async () => {
    getWorkItemEventsByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve([
        makeEvent({
          triggeredBy: "worker",
          metadata: { source: "worker", processType: "implementation", skillName: "implement" },
        }),
      ])
    );
    getActiveJobForWorkItemMock.mockImplementation(() =>
      Promise.resolve(
        makeJob({
          workerId: "wrk-1",
          config: makeJobConfig({ skillName: "implement" }),
          planningSessionId: "plan-1",
        })
      )
    );
    getWorkerByIdMock.mockImplementation(() => Promise.resolve(makeWorker()));
    getJobsByWorkItemMock.mockImplementation(() =>
      Promise.resolve([
        makeJob({ id: "job-1", status: "running" }),
        makeJob({ id: "job-2", status: "completed", completedAt: new Date(), durationMs: 30000 }),
      ])
    );
    getAiSessionsSummaryByWorkItemIdMock.mockImplementation(() =>
      Promise.resolve(
        makeAiSessionSummary({
          sessions: [makeAiSession({ id: "ses-1" })],
          summary: {
            sessionCount: 1,
            totalInputTokens: 500,
            totalOutputTokens: 200,
            totalTokens: 700,
            totalDurationMs: 5000,
            totalEstimatedCost: "0.010000",
          },
        })
      )
    );

    const result = await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    // lastOrigin
    expect(result.lastOrigin!.source).toBe("worker");
    expect(result.lastOrigin!.processType).toBe("implementation");
    expect(result.lastOrigin!.skillName).toBe("implement");

    // activeRun
    expect(result.activeRun!.jobId).toBe("job-1");
    expect(result.activeRun!.worker!.workerId).toBe("wrk-1");
    expect(result.activeRun!.skillName).toBe("implement");

    // recentJobs
    expect(result.recentJobs).toHaveLength(2);

    // sessionSummary
    expect(result.sessionSummary.totalSessions).toBe(1);
    expect(result.sessionSummary.totalTokens).toBe(700);

    // links
    expect(result.links.activeJobId).toBe("job-1");
    expect(result.links.latestSessionId).toBe("ses-1");
    expect(result.links.planningSessionId).toBe("plan-1");
  });

  // ── 18. Parallel data fetching ──

  test("calls all repository functions with correct work item ID", async () => {
    await getWorkItemProvenance(ORG_ID, WORK_ITEM_ID);

    expect(getActiveJobForWorkItemMock).toHaveBeenCalledWith(WORK_ITEM_ID);
    expect(getJobsByWorkItemMock).toHaveBeenCalledWith(WORK_ITEM_ID);
    expect(getAiSessionsSummaryByWorkItemIdMock).toHaveBeenCalledWith(ORG_ID, WORK_ITEM_ID);
    expect(getWorkItemEventsByWorkItemIdMock).toHaveBeenCalledWith(WORK_ITEM_ID, { limit: 20 });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
