import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };
const __real_config = { ...(await import("@almirant/config")) };

const configEnv = {
  ...__real_config.env,
  DURABLE_SEQUENCE_RECEIPTS_ENABLED: "false" as "true" | "false",
};

const state = {
  claimArgs: null as {
    workerId: string;
    count: number;
    acceptedCodingAgents?: string[];
    protocol?: { durableSequenceReceipts: boolean };
  } | null,
  heartbeatArgs: null as {
    workerId: string;
    data: Record<string, unknown>;
  } | null,
};

const claimedJob = {
  id: "job-1",
  workItemId: "wi-1",
  projectId: "proj-1",
  boardId: "board-1",
  status: "running",
  codingAgent: "claude-code",
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key" }),
  claimJobs: async (
    workerId: string,
    count: number,
    acceptedCodingAgents?: string[],
    protocol?: { durableSequenceReceipts: boolean },
  ) => {
    state.claimArgs = { workerId, count, acceptedCodingAgents, protocol };
    return [claimedJob];
  },
  updateHeartbeat: async (workerId: string, data: Record<string, unknown>) => {
    state.heartbeatArgs = { workerId, data };
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("@almirant/config", () => ({ ...__real_config, env: configEnv }));
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../ai/shared/services/resolve-ai-key", () => ({
  resolveAiKey: async () => null,
  refreshConnectionCredentialsIfNeeded: async (
    _connection: Record<string, unknown>,
    _encryptionKey: string,
    credentials?: Record<string, unknown>,
  ) => credentials ?? { apiKey: "refreshed-fallback-key" },
}));
mock.module("../../integrations/github/services/github-service", () => createGithubServiceMock({
  getInstallationAccessToken: async () => "gh-token",
  fetchFromGithub: async () => ({}),
}));

const makeClaimRequest = (body: unknown): Request =>
  new Request("http://localhost/workers/jobs/claim", {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("workersRoutes POST /workers/jobs/claim", () => {
  beforeEach(() => {
    state.claimArgs = null;
    state.heartbeatArgs = null;
    configEnv.DURABLE_SEQUENCE_RECEIPTS_ENABLED = "false";
  });

  it("claims jobs without acceptedCodingAgents (legacy behavior)", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-1",
        count: 3,
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: typeof claimedJob[];
    };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe("job-1");

    // claimJobs should be called without acceptedCodingAgents
    expect(state.claimArgs).not.toBeNull();
    expect(state.claimArgs!.workerId).toBe("worker-1");
    expect(state.claimArgs!.count).toBe(3);
    expect(state.claimArgs!.acceptedCodingAgents).toBeUndefined();
    expect(state.claimArgs!.protocol).toEqual({ durableSequenceReceipts: false });
  });

  it("keeps durable receipts disabled until the server rollout gate is enabled", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-modern",
        count: 1,
        capabilities: ["durable.v2.receipts"],
      }),
    );

    expect(res.status).toBe(200);
    expect(state.claimArgs?.protocol).toEqual({ durableSequenceReceipts: false });
  });

  it("negotiates durable.v2.receipts only when worker capability and server gate are both enabled", async () => {
    configEnv.DURABLE_SEQUENCE_RECEIPTS_ENABLED = "true";
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-modern",
        count: 1,
        capabilities: ["durable.v2.receipts"],
      }),
    );

    expect(res.status).toBe(200);
    expect(state.claimArgs?.protocol).toEqual({ durableSequenceReceipts: true });
  });

  it("forwards acceptedCodingAgents to claimJobs when provided", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-2",
        count: 5,
        acceptedCodingAgents: ["claude-code", "codex"],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: typeof claimedJob[];
    };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);

    // claimJobs should receive the acceptedCodingAgents array
    expect(state.claimArgs).not.toBeNull();
    expect(state.claimArgs!.workerId).toBe("worker-2");
    expect(state.claimArgs!.count).toBe(5);
    expect(state.claimArgs!.acceptedCodingAgents).toEqual(["claude-code", "codex"]);
  });

  it("forwards activeJobs to updateHeartbeat", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    await app.handle(
      makeClaimRequest({
        workerId: "worker-3",
        count: 1,
        activeJobs: 2,
      }),
    );

    expect(state.heartbeatArgs).not.toBeNull();
    expect(state.heartbeatArgs!.workerId).toBe("worker-3");
    expect(state.heartbeatArgs!.data).toEqual({ activeJobs: 2 });
  });

  it("accepts an empty acceptedCodingAgents array", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-4",
        count: 2,
        acceptedCodingAgents: [],
      }),
    );

    expect(res.status).toBe(200);
    expect(state.claimArgs).not.toBeNull();
    expect(state.claimArgs!.acceptedCodingAgents).toEqual([]);
  });

  it("accepts a single coding agent in acceptedCodingAgents", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-5",
        count: 1,
        acceptedCodingAgents: ["opencode"],
      }),
    );

    expect(res.status).toBe(200);
    expect(state.claimArgs).not.toBeNull();
    expect(state.claimArgs!.acceptedCodingAgents).toEqual(["opencode"]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("@almirant/config", () => __real_config);
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
