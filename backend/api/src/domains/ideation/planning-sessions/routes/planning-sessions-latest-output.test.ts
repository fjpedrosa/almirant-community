import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  createLoggerMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import { testWorkspace } from "../../../../test/fixtures";

const SESSION_WITH_JOBS = "ps-with-jobs";
const SESSION_NO_JOBS = "ps-no-jobs";
const LATEST_JOB_ID = "job-latest";

const testLogs = [
  {
    id: "log-1",
    seq: 1,
    level: "info",
    phase: "transcript",
    eventType: "raw_output",
    message: "Hello",
    contentType: "user_input",
    payload: {},
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "log-2",
    seq: 2,
    level: "info",
    phase: "transcript",
    eventType: "raw_output",
    message: " world",
    contentType: "text",
    payload: {},
    timestamp: new Date("2026-01-01T00:00:01.000Z"),
  },
];

// The route reuses the existing jobs->output chain (getLatestJobForPlanningSession
// + listAgentJobLogsByJobId) but resolves it in a single request.
mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getPlanningSessionById: async (id: string) => {
      if (id === SESSION_WITH_JOBS || id === SESSION_NO_JOBS) {
        return {
          id,
          workspaceId: testWorkspace.id,
          title: "Session",
          status: "completed",
        };
      }
      return null;
    },
    getLatestJobForPlanningSession: async (sessionId: string) =>
      sessionId === SESSION_WITH_JOBS
        ? {
            id: LATEST_JOB_ID,
            codingAgent: "claude-code",
            aiProvider: "anthropic",
            model: "claude-opus-4-8",
            provider: "claude-code",
          }
        : null,
    listAgentJobLogsByJobId: async (jobId: string) =>
      jobId === LATEST_JOB_ID
        ? { logs: testLogs, nextCursor: null }
        : { logs: [], nextCursor: null },
  }),
);
mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("../../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("@almirant/config", () => createLoggerMock());
mock.module("../../../integrations/discord/services/discord-thread", () => ({
  isDiscordBridgeConfigured: () => false,
  createDiscordThread: async () => null,
  renameDiscordThread: async () => {},
}));
mock.module("../../../ai/shared/services/model-factory", () => ({
  getDefaultModel: () => {
    throw new Error("no default model configured in tests");
  },
  resolveModelFromProviderKey: async () => null,
}));

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { planningSessionsRoutes } = await import("./planning-sessions.routes");
  return new Elysia().use(withTestOrg).use(planningSessionsRoutes);
};

const req = (path: string) => new Request(`http://localhost${path}`);

describe("GET /planning-sessions/:id/latest-output", () => {
  it("returns the output chunks of the latest job in a single call", async () => {
    const app = await makeApp();
    const res = await app.handle(
      req(`/planning-sessions/${SESSION_WITH_JOBS}/latest-output`),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        jobId: string | null;
        sessionId: string;
        chunks: Array<{ message: string; contentType: string; phase: string }>;
        text: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.jobId).toBe(LATEST_JOB_ID);
    expect(body.data.sessionId).toBe(SESSION_WITH_JOBS);
    expect(body.data.chunks).toHaveLength(2);
    expect(body.data.chunks[0]!.message).toBe("Hello");
    expect(body.data.chunks[0]!.contentType).toBe("user_input");
    expect(body.data.chunks[1]!.message).toBe(" world");
    expect(body.data.text).toBe("Hello\n world");
  });

  it("returns an empty payload when the session has no jobs yet", async () => {
    const app = await makeApp();
    const res = await app.handle(
      req(`/planning-sessions/${SESSION_NO_JOBS}/latest-output`),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { jobId: string | null; chunks: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.jobId).toBeNull();
    expect(body.data.chunks).toEqual([]);
  });

  it("returns 404 for a session that does not exist", async () => {
    const app = await makeApp();
    const res = await app.handle(
      req("/planning-sessions/nonexistent/latest-output"),
    );
    expect(res.status).toBe(404);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
