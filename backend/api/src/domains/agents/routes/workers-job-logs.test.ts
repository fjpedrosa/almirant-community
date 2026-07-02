import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createLoggerMock,
  createResponseMocks,
  createWsMock,
  createGithubServiceMock,
  restoreRealModules,
} from "../../../test/mocks";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const state = {
  capturedBatch: [] as Array<Record<string, unknown>>,
  capturedTranscriptFilters: null as Record<string, unknown> | null,
  job: {
    job: {
      id: "job-1",
      workItemId: "work-item-1",
      planningSessionId: null,
      workspaceId: "org-1",
    },
    workItem: null,
    project: null,
    board: null,
    planningSession: null,
  } as {
    job: {
      id: string;
      workItemId: string | null;
      planningSessionId: string | null;
      workspaceId: string | null;
    };
    workItem: null;
    project: null;
    board: null;
    planningSession: null;
  } | null,
};

const emptyChain = {
  from: () => emptyChain,
  innerJoin: () => emptyChain,
  where: () => emptyChain,
  limit: async () => [],
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key" }),
  getJobById: async () => state.job,
  createAgentJobLogBatch: async (logs: Array<Record<string, unknown>>) => {
    state.capturedBatch = logs;
    return logs.map((entry, idx) => ({
      id: `log-${idx + 1}`,
      ...entry,
      createdAt: new Date(),
    }));
  },
  getTranscriptByJobId: async (_jobId: string, filters: Record<string, unknown>) => {
    state.capturedTranscriptFilters = filters;
    return {
      logs: [
        {
          seq: 42,
          message: "## Summary\n- Done",
          contentType: "text",
          timestamp: new Date("2026-05-02T20:00:00.000Z"),
        },
      ],
      nextCursor: null,
    };
  },
  db: {
    select: () => emptyChain,
  },
});
mock.module("@almirant/database", () => dbMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../integrations/github/services/github-service", () => createGithubServiceMock({
  getInstallationAccessToken: async () => "gh-token",
}));
mock.module("../../ai/shared/services/resolve-ai-key", () => ({
  resolveAiKey: async () => null,
}));
const loggerMocks = createLoggerMock();
mock.module("@almirant/config", () => ({
  ...loggerMocks,
  env: {
    ...loggerMocks.env,
    ENCRYPTION_KEY: "test-encryption-key",
  },
}));

const makeRequest = (body: unknown): Request =>
  new Request("http://localhost/workers/jobs/job-1/logs", {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("workersRoutes /jobs/:jobId/logs", () => {
  beforeEach(() => {
    state.capturedBatch = [];
    state.capturedTranscriptFilters = null;
    state.job = {
      job: {
        id: "job-1",
        workItemId: "work-item-1",
        planningSessionId: null,
        workspaceId: "org-1",
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
  });

  it("persists sanitized log batches and reports duplicates", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        logs: [
          {
            seq: 10,
            level: "info",
            phase: "session_created",
            eventType: "session.created",
            message: "Authorization: Bearer abc token=xyz",
            payload: {
              apiKey: "super-secret",
              nested: {
                Authorization: "Bearer nested-secret",
                safe: "ok",
              },
            },
            timestamp: "2026-03-05T01:00:00.000Z",
          },
        ],
      })
    );

    const json = (await res.json()) as {
      success: boolean;
      data: { inserted: number; duplicates: number };
    };

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.inserted).toBe(1);
    expect(json.data.duplicates).toBe(0);
    expect(state.capturedBatch).toHaveLength(1);

    const first = state.capturedBatch[0]!;
    const payload = first.payload as Record<string, unknown>;
    const nested = payload.nested as Record<string, unknown>;

    expect(first.message).toContain("Authorization=[REDACTED]");
    expect(first.message).toContain("token=[REDACTED]");
    expect(payload.apiKey).toBe("[REDACTED]");
    expect(nested.Authorization).toBe("[REDACTED]");
    expect(nested.safe).toBe("ok");
  });

  it("returns 400 when a log timestamp is invalid", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        logs: [
          {
            seq: 1,
            phase: "claim",
            eventType: "job.claimed",
            message: "ok",
            payload: {},
            timestamp: "not-a-date",
          },
        ],
      })
    );

    expect(res.status).toBe(400);
    expect(state.capturedBatch).toHaveLength(0);
  });

  it("returns 400 when batch size exceeds max limit", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const oversizedBatch = Array.from({ length: 1001 }, (_, idx) => ({
      seq: idx,
      level: "info",
      phase: "session",
      eventType: "session.delta",
      message: `entry-${idx}`,
      payload: {},
      timestamp: "2026-03-05T01:00:00.000Z",
    }));

    const res = await app.handle(
      makeRequest({
        logs: oversizedBatch,
      })
    );

    expect(res.status).toBe(400);
    expect(state.capturedBatch).toHaveLength(0);
  });

  it("passes tail=true to transcript retrieval for completion recovery", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      new Request("http://localhost/workers/jobs/job-1/transcript?limit=1000&tail=true", {
        method: "GET",
        headers: {
          authorization: "Bearer worker-secret",
        },
      }),
    );
    const json = (await res.json()) as {
      success: boolean;
      data: { transcript: string };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.transcript).toBe("## Summary\n- Done");
    expect(state.capturedTranscriptFilters).toMatchObject({
      limit: 1000,
      tail: true,
    });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
