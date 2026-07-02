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
  resolveAiKeyCalls: [] as Array<Record<string, unknown>>,
  resolveAiKeyResult: null as
    | {
        connection: { id: string; config?: Record<string, unknown> | null };
        credentials: Record<string, unknown>;
      }
    | null,
  /** Result returned when resolveAiKey is called with forOrchestration: false (second attempt). */
  resolveAiKeyNonOrchResult: null as
    | {
        connection: { id: string; config?: Record<string, unknown> | null };
        credentials: Record<string, unknown>;
      }
    | null,
  latestProviderCalls: [] as string[],
  latestRows: new Map<string, { id: string; config?: Record<string, unknown> | null }>(),
  job: {
    job: {
      id: "job-1",
      createdByUserId: "user-1",
      workspaceId: "org-1",
    },
    workItem: null,
    project: null,
    board: null,
    planningSession: null,
  } as {
    job: { id: string; createdByUserId: string | null; workspaceId: string | null };
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
  validateApiKey: async () => ({ id: "worker-api-key", workspaceId: "org-1" }),
  upsertWorker: async () => ({}),
  updateHeartbeat: async () => ({}),
  claimJobs: async () => [],
  updateJobStatus: async () => ({}),
  getJobById: async () => state.job,
  getWorkItemById: async () => null,
  getDependencies: async () => [],
  getDependents: async () => [],
  findColumnByNameInBoard: async () => null,
  moveWorkItem: async () => true,
  setWorkItemAiProcessing: async () => true,
  getLatestActiveAiKeyByProvider: async (provider: string) => {
    state.latestProviderCalls.push(provider);
    return state.latestRows.get(provider) ?? null;
  },
  updateConnectionLastUsedAt: async () => {},
  decryptCredentials: (row: { id: string }) => ({ apiKey: `fallback-${row.id}` }),
  createInteraction: async () => ({}),
  getInteractionById: async () => null,
  cancelInteractionsByJobId: async () => true,
  checkQuotaAvailable: async () => ({ allowed: true }),
  getInstallationByRepoId: async () => null,
  addMessage: async () => ({}),
  db: {
    select: () => emptyChain,
  },
});
mock.module("@almirant/database", () => dbMocks);

mock.module("../../ai/shared/services/resolve-ai-key", () => ({
  resolveAiKey: async (params: Record<string, unknown>) => {
    state.resolveAiKeyCalls.push(params);
    // Return orchestration result for first call, non-orch result for retry
    if (params.forOrchestration) return state.resolveAiKeyResult;
    return state.resolveAiKeyNonOrchResult ?? state.resolveAiKeyResult;
  },
  refreshConnectionCredentialsIfNeeded: async (
    _connection: Record<string, unknown>,
    _encryptionKey: string,
    credentials?: Record<string, unknown>,
  ) => credentials ?? { apiKey: "refreshed-fallback-key" },
}));

mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../integrations/github/services/github-service", () => createGithubServiceMock({
  getInstallationAccessToken: async () => "gh-token",
  fetchFromGithub: async () => ({}),
}));
const loggerMocks = createLoggerMock();
mock.module("@almirant/config", () => ({
  ...loggerMocks,
  env: {
    ...loggerMocks.env,
    ENCRYPTION_KEY: "test-encryption-key",
  },
}));

const makeRequest = (path: string): Request =>
  new Request(`http://localhost${path}`, {
    headers: {
      authorization: "Bearer worker-secret",
    },
  });

describe("workersRoutes /provider-keys", () => {
  beforeEach(() => {
    state.resolveAiKeyCalls = [];
    state.resolveAiKeyResult = null;
    state.resolveAiKeyNonOrchResult = null;
    state.latestProviderCalls = [];
    state.latestRows = new Map();
    state.job = {
      job: {
        id: "job-1",
        createdByUserId: "user-1",
        workspaceId: "org-1",
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
  });

  it("resolves provider key using policy context from jobId", async () => {
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-policy-1",
        config: {
          planningModel: "claude-plan-1",
          implementationModel: "claude-impl-1",
          baseUrl: "https://api.z.ai/v1",
        },
      },
      credentials: {
        apiKey: "policy-key",
      },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=openai-compatible&jobId=job-1")
    );
    const json = (await res.json()) as {
      success: boolean;
      data: {
        openaiApiKey?: string;
        planningModel?: string;
        implementationModel?: string;
        baseUrl?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.openaiApiKey).toBe("policy-key");
    expect(json.data.planningModel).toBe("claude-plan-1");
    expect(json.data.implementationModel).toBe("claude-impl-1");
    expect(json.data.baseUrl).toBe("https://api.z.ai/v1");
    expect(state.resolveAiKeyCalls).toHaveLength(1);
    expect(state.resolveAiKeyCalls[0]).toMatchObject({
      provider: "zai",
      userId: "user-1",
      workspaceId: "org-1",
    });
    expect(state.latestProviderCalls).toHaveLength(0);
  });


  it("resolves xAI provider keys separately from OpenAI", async () => {
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-xai-1",
        config: {
          implementationModel: "grok-4.20-reasoning",
          baseUrl: "https://api.x.ai/v1",
        },
      },
      credentials: {
        apiKey: "xai-policy-key",
      },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=xai&jobId=job-1")
    );
    const json = (await res.json()) as {
      success: boolean;
      data: {
        xaiApiKey?: string;
        openaiApiKey?: string;
        implementationModel?: string;
        baseUrl?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.xaiApiKey).toBe("xai-policy-key");
    expect(json.data.openaiApiKey).toBeUndefined();
    expect(json.data.implementationModel).toBe("grok-4.20-reasoning");
    expect(json.data.baseUrl).toBe("https://api.x.ai/v1");
    expect(state.resolveAiKeyCalls[0]).toMatchObject({
      provider: "xai",
      userId: "user-1",
      workspaceId: "org-1",
    });
  });

  it("uses API key org when job lacks org context (no global fallback)", async () => {
    state.job = {
      job: {
        id: "job-legacy",
        createdByUserId: null,
        workspaceId: null,
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
    // resolveAiKey returns null → no connection for the API key's org
    state.resolveAiKeyResult = null;
    // Global fallback has a row available — should NOT be used
    state.latestRows.set("openai", {
      id: "conn-fallback-1",
      config: {
        planningModel: "o3",
        implementationModel: "o3",
      },
    });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=openai&jobId=job-legacy")
    );
    const json = (await res.json()) as {
      success: boolean;
      data: { openaiApiKey?: string };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // No key returned — API key's org is used, not global fallback
    expect(json.data.openaiApiKey).toBeUndefined();
    // Global lookup must never have been called
    expect(state.latestProviderCalls).toHaveLength(0);
    // resolveAiKey was called with the API key's org, not null
    expect(state.resolveAiKeyCalls).toContainEqual(
      expect.objectContaining({ workspaceId: "org-1" }),
    );
  });

  it("resolves workspace provider key when nightly job has org but no user", async () => {
    state.job = {
      job: {
        id: "job-nightly",
        createdByUserId: null,
        workspaceId: "org-1",
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-org-1",
        config: {
          validationModel: "o3",
        },
      },
      credentials: {
        apiKey: "org-policy-key",
      },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=openai&jobId=job-nightly")
    );
    const json = (await res.json()) as {
      success: boolean;
      data: {
        openaiApiKey?: string;
        validationModel?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.openaiApiKey).toBe("org-policy-key");
    expect(json.data.validationModel).toBe("o3");
    expect(state.resolveAiKeyCalls).toContainEqual(
      expect.objectContaining({
        provider: "openai",
        userId: null,
        workspaceId: "org-1",
        encryptionKey: "test-encryption-key",
      }),
    );
    expect(state.latestProviderCalls).toHaveLength(0);
  });

  it("retries with forOrchestration=false when orchestration-enabled connections are empty", async () => {
    // First call (forOrchestration: true) returns null
    state.resolveAiKeyResult = null;
    // Second call (forOrchestration: false) finds a non-orchestration connection
    state.resolveAiKeyNonOrchResult = {
      connection: {
        id: "conn-non-orch",
        config: { implementationModel: "claude-opus-4-6" },
      },
      credentials: { apiKey: "non-orch-key" },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=anthropic&jobId=job-1")
    );
    const json = (await res.json()) as {
      success: boolean;
      data: { anthropicApiKey?: string };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.anthropicApiKey).toBe("non-orch-key");
    // Should have called resolveAiKey twice: once with forOrchestration=true, once with false
    expect(state.resolveAiKeyCalls).toHaveLength(2);
    expect(state.resolveAiKeyCalls[0]).toMatchObject({ forOrchestration: true });
    expect(state.resolveAiKeyCalls[1]).toMatchObject({ forOrchestration: false });
    // Must NOT fall back to global lookup
    expect(state.latestProviderCalls).toHaveLength(0);
  });

  it("never uses cross-org fallback when workspaceId is present", async () => {
    // Both orchestration and non-orchestration return null for this org
    state.resolveAiKeyResult = null;
    state.resolveAiKeyNonOrchResult = null;
    // Global fallback has a row available — should NOT be used
    state.latestRows.set("anthropic", {
      id: "conn-other-org",
      config: {},
    });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=anthropic&jobId=job-1")
    );
    const json = (await res.json()) as {
      success: boolean;
      data: { anthropicApiKey?: string };
    };

    expect(res.status).toBe(200);
    // No anthropic key should be returned — the provider was skipped
    expect(json.data.anthropicApiKey).toBeUndefined();
    // Global lookup must never have been called
    expect(state.latestProviderCalls).toHaveLength(0);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
