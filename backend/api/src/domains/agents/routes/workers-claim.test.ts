import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { runtimeCapabilityProjection } from "@almirant/shared";
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

const currentRuntimeCapabilityIdentity = {
  schemaVersion: runtimeCapabilityProjection.schemaVersion,
  version: runtimeCapabilityProjection.version,
  hash: runtimeCapabilityProjection.hash,
};
const configEnv = {
  ...__real_config.env,
  DURABLE_SEQUENCE_RECEIPTS_ENABLED: "false" as "true" | "false",
  PI_CODING_AGENT_ADMISSION_ENABLED: "true" as "true" | "false",
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

const withPiAdmissionEnvironment = async <T>(
  value: "true" | "false" | undefined,
  action: () => Promise<T>,
): Promise<T> => {
  const previous = process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  if (value === undefined) {
    delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  } else {
    process.env.PI_CODING_AGENT_ADMISSION_ENABLED = value;
  }
  try {
    return await action();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
    } else {
      process.env.PI_CODING_AGENT_ADMISSION_ENABLED = previous;
    }
  }
};

const expectPolicyRuntimeFailure = (payload: { runtimeFailure?: unknown }): void => {
  expect(payload.runtimeFailure).toEqual({
    schemaVersion: "runtime-failure-v1",
    code: "RUNTIME_POLICY_FAILURE",
    category: "policy",
    retryable: false,
    message: "Runtime policy rejected the operation.",
  });
};

describe("workersRoutes POST /workers/jobs/claim", () => {
  beforeEach(() => {
    state.claimArgs = null;
    state.heartbeatArgs = null;
    configEnv.DURABLE_SEQUENCE_RECEIPTS_ENABLED = "false";
    configEnv.PI_CODING_AGENT_ADMISSION_ENABLED = "true";
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

    expect(state.claimArgs).not.toBeNull();
    expect(state.claimArgs!.workerId).toBe("worker-1");
    expect(state.claimArgs!.count).toBe(3);
    expect(state.claimArgs!.acceptedCodingAgents).toEqual([
      "claude-code",
      "codex",
      "opencode",
    ]);
    expect(state.claimArgs!.protocol).toEqual({ durableSequenceReceipts: false });
  });

  it.each([
    ["omitted", undefined],
    ["empty", []],
  ] as const)(
    "preserves the %s legacy claim set when Pi admission is disabled",
    async (_label, acceptedCodingAgents) =>
      withPiAdmissionEnvironment("false", async () => {
        const { workersRoutes } = await import("./workers.routes");
        const app = new Elysia().use(workersRoutes);
        const body: Record<string, unknown> = {
          workerId: "worker-legacy-disabled",
          count: 1,
        };
        if (acceptedCodingAgents !== undefined) {
          body.acceptedCodingAgents = acceptedCodingAgents;
        }

        const res = await app.handle(makeClaimRequest(body));

        expect(res.status).toBe(200);
        expect(state.claimArgs?.acceptedCodingAgents).toEqual([
          "claude-code",
          "codex",
          "opencode",
        ]);
      }),
  );

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

  it("accepts the runner's exact executor set and generated registry identity", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-2",
        count: 5,
        acceptedCodingAgents: ["claude-code", "codex", "opencode"],
        runtimeCapabilityIdentity: currentRuntimeCapabilityIdentity,
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: typeof claimedJob[];
    };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);

    expect(state.claimArgs).not.toBeNull();
    expect(state.claimArgs!.workerId).toBe("worker-2");
    expect(state.claimArgs!.count).toBe(5);
    expect(state.claimArgs!.acceptedCodingAgents).toEqual([
      "claude-code",
      "codex",
      "opencode",
    ]);
    expect(state.claimArgs!.acceptedCodingAgents).not.toContain("pi");
  });

  it("returns typed 409 before claiming when Pi identity is missing", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeClaimRequest({
        workerId: "worker-pi-missing-identity",
        count: 1,
        acceptedCodingAgents: ["pi"],
      }),
    );

    expect(res.status).toBe(409);
    const payload = await res.json() as {
      success: boolean;
      error: string;
      code?: string;
      runtimeFailure?: unknown;
    };
    expect(payload).toMatchObject({
      success: false,
      code: "RUNNER_RUNTIME_CAPABILITY_IDENTITY_REQUIRED",
      error: expect.stringContaining("RUNNER_RUNTIME_CAPABILITY_IDENTITY_REQUIRED"),
    });
    expectPolicyRuntimeFailure(payload);
    expect(state.claimArgs).toBeNull();
  });

  it("returns typed 409 before claiming for stale Pi version or hash identity", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    for (const runtimeCapabilityIdentity of [
      {
        ...currentRuntimeCapabilityIdentity,
        version: currentRuntimeCapabilityIdentity.version + 1,
      },
      {
        ...currentRuntimeCapabilityIdentity,
        hash: "sha256:stale",
      },
    ]) {
      state.claimArgs = null;
      const res = await app.handle(
        makeClaimRequest({
          workerId: "worker-pi-stale-identity",
          count: 1,
          acceptedCodingAgents: ["pi"],
          runtimeCapabilityIdentity,
        }),
      );

      expect(res.status).toBe(409);
      const payload = await res.json() as {
        success: boolean;
        error: string;
        code?: string;
        runtimeFailure?: unknown;
      };
      expect(payload).toMatchObject({
        success: false,
        code: "RUNNER_RUNTIME_CAPABILITY_IDENTITY_MISMATCH",
        error: expect.stringContaining("RUNNER_RUNTIME_CAPABILITY_IDENTITY_MISMATCH"),
      });
      expectPolicyRuntimeFailure(payload);
      expect(state.claimArgs).toBeNull();
    }
  });

  it.each([
    ["default", undefined],
    ["explicitly enabled", "true"],
  ] as const)(
    "admits Pi when producer admission is %s and the runner advertises current identity",
    async (_label, admissionValue) =>
      withPiAdmissionEnvironment(admissionValue, async () => {
        const { workersRoutes } = await import("./workers.routes");
        const app = new Elysia().use(workersRoutes);

        const res = await app.handle(
          makeClaimRequest({
            workerId: "worker-pi-current",
            count: 1,
            acceptedCodingAgents: ["pi"],
            runtimeCapabilityIdentity: currentRuntimeCapabilityIdentity,
          }),
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ success: true });
        expect(state.claimArgs?.acceptedCodingAgents).toEqual(["pi"]);
      }),
  );

  it("returns no jobs and skips the repository claim for a Pi-only runner when admission is disabled", async () =>
    withPiAdmissionEnvironment("false", async () => {
      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);

      const res = await app.handle(
        makeClaimRequest({
          workerId: "worker-pi-disabled",
          count: 1,
          acceptedCodingAgents: ["pi"],
          runtimeCapabilityIdentity: currentRuntimeCapabilityIdentity,
        }),
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true, data: [] });
      expect(state.claimArgs).toBeNull();
    }));

  it("removes Pi from a mixed accepted set while still claiming allowed jobs", async () =>
    withPiAdmissionEnvironment("false", async () => {
      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);

      const res = await app.handle(
        makeClaimRequest({
          workerId: "worker-mixed-disabled",
          count: 2,
          acceptedCodingAgents: ["pi", "claude-code"],
          runtimeCapabilityIdentity: currentRuntimeCapabilityIdentity,
        }),
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        success: true,
        data: [{ id: "job-1", codingAgent: "claude-code" }],
      });
      expect(state.claimArgs?.acceptedCodingAgents).toEqual(["claude-code"]);
    }));

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

  it("maps an empty acceptedCodingAgents array to the exact legacy set", async () => {
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
    expect(state.claimArgs!.acceptedCodingAgents).toEqual([
      "claude-code",
      "codex",
      "opencode",
    ]);
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
