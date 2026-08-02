import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";

const realDatabase = { ...(await import("@almirant/database")) };
const realConfig = { ...(await import("@almirant/config")) };
const realResolveAiKey = {
  ...(await import("../../ai/shared/services/resolve-ai-key")),
};

const state = {
  ensureInput: null as Record<string, unknown> | null,
  handoffInput: null as Record<string, unknown> | null,
  conflict: false,
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({
    id: "worker-key",
    workspaceId: "workspace-1",
    serviceAccountId: "runner-sa",
  }),
  getJobById: async () => ({
    job: {
      id: "job-1",
      workspaceId: "workspace-1",
      workerId: "worker-1",
      config: { claimAttemptId: "attempt-1" },
    },
    workItem: null,
    project: null,
    board: null,
    planningSession: null,
    createdByUser: null,
  }),
  ensureClaimSequenceReservation: async (input: Record<string, unknown>) => {
    state.ensureInput = input;
    if (state.conflict) throw new realDatabase.ClaimSequenceReceiptConflictError();
    return { reservedThrough: 8_192 };
  },
  prepareClaimSequenceHandoff: async (input: Record<string, unknown>) => {
    state.handoffInput = input;
    if (state.conflict) throw new realDatabase.ClaimSequenceReceiptConflictError();
    return {
      ready: false,
      insertedCount: { jobLogs: 3, sessionEvents: 2, nativeEvents: 1 },
      expectedCount: { jobLogs: 3, sessionEvents: 4, nativeEvents: 1 },
    };
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("@almirant/config", () => realConfig);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module(
  "../../integrations/github/services/github-service",
  () => createGithubServiceMock({ getInstallationAccessToken: async () => "token" }),
);
mock.module("../../ai/shared/services/resolve-ai-key", () => ({
  resolveAiKey: async () => null,
  refreshConnectionCredentialsIfNeeded: async () => ({ apiKey: "refreshed" }),
}));

const request = (path: string, body: unknown) =>
  new Request(`http://localhost/workers${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("worker claim sequence receipt control plane", () => {
  beforeEach(() => {
    state.ensureInput = null;
    state.handoffInput = null;
    state.conflict = false;
  });

  it("extends only the exact current claim channel reservation", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      request("/jobs/job-1/sequence-reservations/sessionEvents/ensure", {
        workerId: "worker-1",
        expectedClaimAttemptId: "attempt-1",
        requiredThrough: 4_097,
      }),
    );

    expect(response.status).toBe(200);
    expect(state.ensureInput).toEqual({
      jobId: "job-1",
      workerId: "worker-1",
      claimAttemptId: "attempt-1",
      channel: "sessionEvents",
      requiredThrough: 4_097,
    });
  });

  it("starts a durable handoff and exposes incomplete persistence coverage", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const emittedThrough = {
      protocolVersion: 2,
      jobLogs: 3,
      sessionEvents: 4,
      nativeEvents: 1,
    };
    const response = await app.handle(
      request("/jobs/job-1/sequence-handoff", {
        workerId: "worker-1",
        expectedClaimAttemptId: "attempt-1",
        emittedThrough,
      }),
    );
    const payload = (await response.json()) as {
      data: { ready: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.data.ready).toBe(false);
    expect(state.handoffInput).toEqual({
      jobId: "job-1",
      workerId: "worker-1",
      claimAttemptId: "attempt-1",
      emittedThrough,
    });
  });

  it("maps stale receipt conflicts to 409", async () => {
    state.conflict = true;
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      request("/jobs/job-1/sequence-reservations/jobLogs/ensure", {
        workerId: "worker-1",
        expectedClaimAttemptId: "attempt-stale",
        requiredThrough: 4_097,
      }),
    );

    expect(response.status).toBe(409);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("@almirant/config", () => realConfig);
  mock.module("../../ai/shared/services/resolve-ai-key", () => realResolveAiKey);
});
