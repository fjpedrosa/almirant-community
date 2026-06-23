import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";

const state = {
  job: {
    job: {
      id: "job-1",
      status: "running",
      organizationId: "org-test-1",
    },
    workItem: null,
    project: null,
    board: null,
    planningSession: null,
  } as {
    job: { id: string; status: string; organizationId: string };
    workItem: null;
    project: null;
    board: null;
    planningSession: null;
  } | null,
  capturedFilters: null as Record<string, unknown> | null,
};

const dbMocks = createDatabaseMocks({
  getJobById: async () => state.job,
  listAgentJobLogsByJobId: async (_jobId: string, filters: Record<string, unknown>) => {
    state.capturedFilters = filters;
    return {
      logs: [
        {
          id: "log-1",
          seq: 11,
          level: "info",
          phase: "claim",
          eventType: "job.claimed",
          message: "claimed",
        },
      ],
      nextCursor: 11,
    };
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());

const makeRequest = (path: string): Request =>
  new Request(`http://localhost${path}`, {
    method: "GET",
  });

describe("agentJobsRoutes /:id/logs", () => {
  beforeEach(() => {
    state.job = {
      job: {
        id: "job-1",
        status: "running",
        organizationId: "org-test-1",
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
    state.capturedFilters = null;
  });

  it("returns paginated logs with validated filters", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest(
        "/agent-jobs/job-1/logs?level=info&phase=claim&eventType=job.claimed&limit=20&cursor=10&from=2026-03-05T00:00:00.000Z&to=2026-03-05T02:00:00.000Z"
      )
    );
    const json = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string }>;
      meta: { nextCursor: number | null; hasMore: boolean; limit: number };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data[0]?.id).toBe("log-1");
    expect(json.meta.nextCursor).toBe(11);
    expect(json.meta.hasMore).toBe(true);
    expect(json.meta.limit).toBe(20);
    expect(state.capturedFilters).toMatchObject({
      level: "info",
      phase: "claim",
      eventType: "job.claimed",
      cursor: 10,
      limit: 20,
    });
  });

  it("returns 400 for invalid cursor", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest("/agent-jobs/job-1/logs?cursor=-1")
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 when job does not exist", async () => {
    state.job = null;
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(makeRequest("/agent-jobs/job-unknown/logs"));

    expect(res.status).toBe(404);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
