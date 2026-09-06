import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { createDatabaseMocks, createLoggerMock, createResponseMocks, createWsMock, restoreRealModules, withTestOrg } from "../../../../test/mocks";
import { testWorkspace } from "../../../../test/fixtures";

const MARKER = "<<<ALMIRANT:NATIVE_PLAN_V1>>>";
const draft = {
  version: 1, kind: "plan", title: "Native plan", features: [],
  workUnits: [{
    kind: "work_unit", tempId: "wu-1", title: "Deliver", priority: "medium",
    work_unit_size: "S", acceptance: ["Delivered"], dependencies: [],
  }],
};
const log = {
  id: "log-1", seq: 1, level: "info", phase: "transcript", eventType: "raw_output",
  message: "visible output", contentType: "text", payload: {},
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
};
let flagEnabled = false;
let flagCalls = 0;
let readerCalls = 0;
let writerCalls = 0;
let latestLimit: number | undefined;
let createdJob: Record<string, unknown> | null = null;
const session = (id: string, status: "completed" | "active" = "completed") => ({
  id, workspaceId: testWorkspace.id, projectId: "project-1", boardId: "board-1",
  status, title: "Native planning", result: null,
  createdAt: new Date(),
});

mock.module("@almirant/database", () => createDatabaseMocks({
  getPlanningSessionById: async (id: string) => id === "foreign" ? { ...session(id), workspaceId: "other-workspace" } : session(id),
  resumePlanningSession: async (id: string) => session(id, "active"),
  getActiveSessionForUser: async () => null,
  getPendingInteractionForSession: async () => null,
  getLatestJobForPlanningSession: async (id: string) => ({
    id: `job-${id}`, provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8",
    config: id === "legacy" ? {} : { planningContract: "plan-v1", workspaceId: testWorkspace.id, requestedByUserId: "user-1", projectId: "project-1", boardId: "board-1" },
  }),
  getJobById: async () => ({ job: {} }),
  getEnrichedConversationHistory: async () => [],
  buildSessionRecoverySummary: async () => null,
  listAgentJobLogsByJobId: async (_id: string, options: { limit?: number }) => {
    latestLimit = options.limit;
    return { logs: [log], nextCursor: null };
  },
  getBoundedAssistantOutputByJobId: async (jobId: string) => {
    readerCalls += 1;
    return { text: jobId === "job-invalid" ? `${MARKER}\n{` : `${MARKER}\n${JSON.stringify(draft)}`, truncated: false };
  },
  createJob: async (input: Record<string, unknown>) => {
    writerCalls += 1;
    createdJob = input;
    return { id: "resume-job", status: "queued" };
  },
}));
mock.module("../../../../shared/services/posthog-service", () => ({
  isFeatureFlagEnabled: async () => { flagCalls += 1; return flagEnabled; },
}));
mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("../../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("@almirant/config", () => createLoggerMock());
mock.module("../../../integrations/discord/services/discord-thread", () => ({
  isDiscordBridgeConfigured: () => false, createDiscordThread: async () => null, renameDiscordThread: async () => {},
}));
mock.module("../../../ai/shared/services/model-factory", () => ({
  getDefaultModel: () => { throw new Error("unused"); }, resolveModelFromProviderKey: async () => null,
}));

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { planningSessionsRoutes } = await import("./planning-sessions.routes");
  return new Elysia().use(withTestOrg).use(planningSessionsRoutes);
};
const get = (id: string, query = "") => new Request(`http://localhost/planning-sessions/${id}/latest-output${query}`);

beforeEach(() => {
  flagEnabled = false; flagCalls = 0; readerCalls = 0; writerCalls = 0; latestLimit = undefined; createdJob = null;
});

describe("native latest planning output", () => {
  it("adds canonical evidence for a snapshot while the current flag is off", async () => {
    const response = await (await makeApp()).handle(get("native", "?limit=999999"));
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(body.data.nativePlanStatus).toBe("available");
    expect(body.data.nativePlan).toMatchObject({ target: { projectId: "project-1", boardId: "board-1" } });
    expect(JSON.parse(String(body.data.nativePlanContent))).toEqual(body.data.nativePlan);
    expect(body.data.nativePlanSha256).toMatch(/^[a-f0-9]{64}$/);
    expect([flagCalls, readerCalls, writerCalls, latestLimit]).toEqual([0, 1, 0, 5000]);
  });

  it("returns only bounded status for malformed snapshotted output", async () => {
    const body = (await (await (await makeApp()).handle(get("invalid"))).json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ nativePlanStatus: "invalid" });
    expect(body.data).not.toHaveProperty("nativePlan");
  });

  it("preserves the exact legacy response shape without native reads", async () => {
    const body = (await (await (await makeApp()).handle(get("legacy"))).json()) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual(["chunks", "hasMore", "jobId", "nextCursor", "sessionId", "text"]);
    expect([readerCalls, writerCalls]).toEqual([0, 0]);
  });

  it("does not expose another workspace's output", async () => {
    const response = await (await makeApp()).handle(get("foreign"));
    expect(response.status).toBe(404);
    expect([readerCalls, writerCalls]).toEqual([0, 0]);
  });

  it("snapshots trusted scope when an eligible session resumes", async () => {
    flagEnabled = true;
    const response = await (await makeApp()).handle(new Request("http://localhost/planning-sessions/resume/resume", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(createdJob?.config).toMatchObject({
      planningContract: "plan-v1", workspaceId: testWorkspace.id, projectId: "project-1", boardId: "board-1",
    });
    expect([flagCalls, writerCalls]).toEqual([1, 1]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
