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
import { createPlanReviewCapabilityRef } from "@almirant/shared";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

type TestJob = {
  id: string;
  createdByUserId: string | null;
  workspaceId: string | null;
  status?: "running" | "queued";
  workerId?: string | null;
  provider?: string;
  codingAgent?: string;
  aiProvider?: string;
  model?: string;
  config?: Record<string, unknown>;
  resolvedRuntimeSelection?: (Record<string, unknown> & {
    codingAgent: string;
    aiProvider: string;
    authClass: string;
  }) | null;
};

type TestConnection = Record<string, unknown> & {
  id: string;
  config?: Record<string, unknown> | null;
};

const defaultJob = (): TestJob => ({
  id: "job-1",
  createdByUserId: "user-1",
  workspaceId: "org-1",
  status: "running",
  workerId: "runner-1",
  provider: "claude-code",
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-4-6",
  config: { claimAttemptId: "claim-1" },
  resolvedRuntimeSelection: null,
});

const state = {
  workerApiKey: {
    id: "worker-api-key",
    workspaceId: "org-1",
    serviceAccountId: "runner-service-account" as string | null,
  },
  claimActive: true,
  claimCalls: [] as Array<{ jobId: string; workerId: string; claimAttemptId: string }>,
  resolveAiKeyCalls: [] as Array<Record<string, unknown>>,
  resolveAiKeyResult: null as
    | { connection: TestConnection; credentials: Record<string, unknown> }
    | null,
  /** Result returned when resolveAiKey is called with forOrchestration: false (second attempt). */
  resolveAiKeyNonOrchResult: null as
    | { connection: TestConnection; credentials: Record<string, unknown> }
    | null,
  latestProviderCalls: [] as string[],
  latestRows: new Map<string, TestConnection>(),
  planReviewConnections: [] as Array<TestConnection>,
  metadataRows: new Map<string, TestConnection>(),
  metadataCalls: [] as Array<{
    id: string;
    scope: "organization" | "user";
    scopeId: string;
  }>,
  fullRows: new Map<string, TestConnection>(),
  fullRowCalls: [] as string[],
  refreshResults: new Map<string, Record<string, unknown>>(),
  refreshCalls: [] as string[],
  decryptCalls: [] as string[],
  lastUsedIds: [] as string[],
  job: {
    job: defaultJob(),
    workItem: null,
    project: null,
    board: null,
    planningSession: null,
  } as {
    job: TestJob;
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
  validateApiKey: async () => state.workerApiKey,
  upsertWorker: async () => ({}),
  updateHeartbeat: async () => ({}),
  claimJobs: async () => [],
  updateJobStatus: async () => ({}),
  getJobById: async () => state.job,
  withLiveAgentJobClaim: async (
    ownership: { jobId: string; workerId: string; claimAttemptId: string },
    operation: (job: Record<string, unknown>) => Promise<unknown>,
  ) => {
    state.claimCalls.push(ownership);
    const job = state.job?.job;
    if (
      !state.claimActive ||
      !job ||
      ownership.jobId !== job.id ||
      ownership.workerId !== job.workerId ||
      ownership.claimAttemptId !== job.config?.claimAttemptId ||
      job.status !== "running"
    ) {
      return null;
    }
    return operation({
      id: job.id,
      status: "running",
      workspaceId: job.workspaceId,
      workerId: ownership.workerId,
      config: job.config,
    });
  },
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
  listConnections: async () => state.planReviewConnections,
  getConnectionById: async (
    id: string,
    _encryptionKey?: string,
    scope?: { scope: string; scopeId: string },
  ) => {
    const connection = state.planReviewConnections.find((candidate) => candidate.id === id);
    if (!connection) return null;
    if (scope && (connection.scope !== scope.scope || connection.scopeId !== scope.scopeId)) return null;
    return connection;
  },
  getConnectionMetadataById: async (
    id: string,
    scopeFilter: { scope: "organization" | "user"; scopeId: string },
  ) => {
    state.metadataCalls.push({ id, ...scopeFilter });
    const metadata = state.metadataRows.get(id) ?? null;
    return metadata?.scope === scopeFilter.scope &&
      metadata.scopeId === scopeFilter.scopeId
      ? metadata
      : null;
  },
  getAiProviderKeyById: async (
    id: string,
    scopeFilter: { scope: "organization" | "user"; scopeId: string },
  ) => {
    state.fullRowCalls.push(id);
    const connection = state.fullRows.get(id) ?? null;
    return connection?.scope === scopeFilter.scope &&
      connection.scopeId === scopeFilter.scopeId
      ? connection
      : null;
  },
  suspendConnection: async () => {},
  updateConnectionLastUsedAt: async (id: string) => {
    state.lastUsedIds.push(id);
  },
  decryptCredentials: (row: { id: string }) => {
    state.decryptCalls.push(row.id);
    return { apiKey: `fallback-${row.id}` };
  },
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
    connection: Record<string, unknown>,
    _encryptionKey: string,
  ) => {
    const id = String(connection.id);
    state.refreshCalls.push(id);
    return state.refreshResults.get(id) ?? { apiKey: "refreshed-fallback-key" };
  },
}));

mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../integrations/github/services/github-service", () => createGithubServiceMock({
  getInstallationAccessToken: async () => "gh-token",
  fetchFromGithub: async () => ({}),
}));
const loggerCaptures: unknown[][] = [];
const baseLoggerMocks = createLoggerMock();
const loggerMocks = {
  ...baseLoggerMocks,
  logger: {
    info: (...args: unknown[]) => loggerCaptures.push(args),
    error: (...args: unknown[]) => loggerCaptures.push(args),
    warn: (...args: unknown[]) => loggerCaptures.push(args),
    debug: (...args: unknown[]) => loggerCaptures.push(args),
  },
};
mock.module("@almirant/config", () => ({
  ...loggerMocks,
  env: {
    ...loggerMocks.env,
    ENCRYPTION_KEY: "test-encryption-key",
    PI_CODING_AGENT_ADMISSION_ENABLED: "true",
    INTERNAL_SYSTEM_SERVICE_ACCOUNT_IDS: ["runner-service-account"],
  },
}));

const makeRequest = (
  path: string,
  claim: { workerId: string; claimAttemptId: string } | null = {
    workerId: "runner-1",
    claimAttemptId: "claim-1",
  },
): Request => {
  const url = new URL(`http://localhost${path}`);
  if (claim && url.pathname === "/workers/provider-keys") {
    if (!url.searchParams.has("workerId")) {
      url.searchParams.set("workerId", claim.workerId);
    }
    if (!url.searchParams.has("claimAttemptId")) {
      url.searchParams.set("claimAttemptId", claim.claimAttemptId);
    }
  }
  return new Request(url.toString(), {
    headers: {
      authorization: "Bearer worker-secret",
    },
  });
};

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

const expectRuntimeFailure = (
  payload: { runtimeFailure?: unknown },
  expected: {
    code: string;
    category: "auth" | "endpoint" | "policy";
    message: string;
  },
): void => {
  expect(payload.runtimeFailure).toEqual({
    schemaVersion: "runtime-failure-v1",
    code: expected.code,
    category: expected.category,
    retryable: false,
    message: expected.message,
  });
};

describe("workersRoutes /provider-keys", () => {
  beforeEach(() => {
    state.workerApiKey = {
      id: "worker-api-key",
      workspaceId: "org-1",
      serviceAccountId: "runner-service-account",
    };
    state.claimActive = true;
    state.claimCalls = [];
    state.resolveAiKeyCalls = [];
    state.resolveAiKeyResult = null;
    state.resolveAiKeyNonOrchResult = null;
    state.latestProviderCalls = [];
    state.latestRows = new Map();
    state.planReviewConnections = [];
    state.metadataRows = new Map();
    state.metadataCalls = [];
    state.fullRows = new Map();
    state.fullRowCalls = [];
    state.refreshResults = new Map();
    state.refreshCalls = [];
    state.decryptCalls = [];
    state.lastUsedIds = [];
    loggerCaptures.length = 0;
    state.job = {
      job: defaultJob(),
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
  });

  it.each([
    [
      "jobId",
      "/workers/provider-keys?providers=anthropic&workerId=runner-1&claimAttemptId=claim-1",
    ],
    [
      "workerId",
      "/workers/provider-keys?providers=anthropic&jobId=job-1&claimAttemptId=claim-1",
    ],
    [
      "claimAttemptId",
      "/workers/provider-keys?providers=anthropic&jobId=job-1&workerId=runner-1",
    ],
  ] as const)(
    "requires %s before claim or credential resolution",
    async (_field, path) => {
      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);
      const res = await app.handle(makeRequest(path, null));

      expect(res.status).toBe(422);
      expect(state.claimCalls).toEqual([]);
      expect(state.metadataCalls).toEqual([]);
      expect(state.resolveAiKeyCalls).toEqual([]);
      expect(state.refreshCalls).toEqual([]);
      expect(state.decryptCalls).toEqual([]);
      expect(state.lastUsedIds).toEqual([]);
    },
  );

  it("rejects ordinary user API keys", async () => {
    state.workerApiKey.serviceAccountId = null;

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=anthropic&jobId=job-1"),
    );

    expect(res.status).toBe(403);
    expect(state.resolveAiKeyCalls).toHaveLength(0);
  });

  it.each([
    ["stale claim", { workerId: "runner-1", claimAttemptId: "stale-claim" }],
    ["wrong worker", { workerId: "runner-other", claimAttemptId: "claim-1" }],
  ] as const)(
    "rejects a %s before provider metadata, decrypt, refresh, or mutation",
    async (_case, claim) => {
      state.resolveAiKeyResult = {
        connection: {
          id: "conn-must-not-resolve",
          config: { authMethod: "api_key" },
        },
        credentials: { apiKey: "must-not-export" },
      };

      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);
      const res = await app.handle(
        makeRequest(
          "/workers/provider-keys?providers=anthropic&jobId=job-1",
          claim,
        ),
      );
      const json = await res.json() as {
        code?: string;
        data?: Record<string, unknown>;
        runtimeFailure?: unknown;
      };

      expect(res.status).toBe(409);
      expect(json.code).toBe("WORKER_CLAIM_CONFLICT");
      expectRuntimeFailure(json, {
        code: "RUNTIME_POLICY_FAILURE",
        category: "policy",
        message: "Runtime policy rejected the operation.",
      });
      expect(JSON.stringify(json)).not.toContain("must-not-export");
      expect(json.data).toBeUndefined();
      expect(state.resolveAiKeyCalls).toEqual([]);
      expect(state.metadataCalls).toEqual([]);
      expect(state.decryptCalls).toEqual([]);
      expect(state.refreshCalls).toEqual([]);
      expect(state.lastUsedIds).toEqual([]);
    },
  );

  it("rejects a modern Pi provider mismatch before credential resolution", async () => {
    state.job!.job = {
      ...defaultJob(),
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      resolvedRuntimeSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        authClass: "api_key",
      },
    };
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-wrong-provider",
        config: { authMethod: "api_key" },
      },
      credentials: { apiKey: "must-not-export" },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=openai&jobId=job-1"),
    );
    const json = await res.json() as { code?: string; runtimeFailure?: unknown };

    expect(res.status).toBe(409);
    expect(json.code).toBe("JOB_PROVIDER_SELECTION_CONFLICT");
    expectRuntimeFailure(json, {
      code: "RUNTIME_POLICY_FAILURE",
      category: "policy",
      message: "Runtime policy rejected the operation.",
    });
    expect(JSON.stringify(json)).not.toContain("must-not-export");
    expect(state.resolveAiKeyCalls).toEqual([]);
    expect(state.metadataCalls).toEqual([]);
    expect(state.decryptCalls).toEqual([]);
    expect(state.refreshCalls).toEqual([]);
    expect(state.lastUsedIds).toEqual([]);
  });

  it("rejects an already-running Pi job when admission is disabled before claim, metadata, decrypt, refresh, export, or mutation", async () =>
    withPiAdmissionEnvironment("false", async () => {
      state.job!.job = {
        ...defaultJob(),
        provider: "zipu",
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        resolvedRuntimeSelection: {
          codingAgent: "pi",
          aiProvider: "zai",
          authClass: "api_key",
        },
      };
      state.resolveAiKeyResult = {
        connection: {
          id: "conn-must-not-resolve",
          config: { authMethod: "api_key" },
        },
        credentials: { apiKey: "must-not-export" },
      };

      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);
      const res = await app.handle(
        makeRequest("/workers/provider-keys?providers=zai&jobId=job-1"),
      );
      const json = await res.json() as {
        code?: string;
        data?: Record<string, unknown>;
        runtimeFailure?: unknown;
      };

      expect(res.status).toBe(409);
      expect(json.code).toBe("PI_ADMISSION_DISABLED");
      expectRuntimeFailure(json, {
        code: "RUNTIME_POLICY_FAILURE",
        category: "policy",
        message: "Runtime policy rejected the operation.",
      });
      expect(json.data).toBeUndefined();
      expect(JSON.stringify({ response: json, logs: loggerCaptures })).not.toContain(
        "must-not-export",
      );
      expect(state.claimCalls).toEqual([]);
      expect(state.metadataCalls).toEqual([]);
      expect(state.fullRowCalls).toEqual([]);
      expect(state.resolveAiKeyCalls).toEqual([]);
      expect(state.refreshCalls).toEqual([]);
      expect(state.decryptCalls).toEqual([]);
      expect(state.lastUsedIds).toEqual([]);
    }));

  it("keeps an already-running non-Pi job eligible for credential export when Pi admission is disabled", async () =>
    withPiAdmissionEnvironment("false", async () => {
      state.resolveAiKeyResult = {
        connection: {
          id: "conn-non-pi",
          config: { authMethod: "api_key" },
        },
        credentials: { apiKey: "non-pi-key" },
      };

      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);
      const res = await app.handle(
        makeRequest("/workers/provider-keys?providers=anthropic&jobId=job-1"),
      );
      const json = await res.json() as {
        data: { anthropicApiKey?: string };
      };

      expect(res.status).toBe(200);
      expect(json.data.anthropicApiKey).toBe("non-pi-key");
      expect(state.claimCalls).toHaveLength(1);
      expect(state.resolveAiKeyCalls).toHaveLength(1);
      expect(state.lastUsedIds).toEqual(["conn-non-pi"]);
    }));

  it("returns exact modern Pi Z.AI API-key credentials bound to the live claim", async () => {
    state.job!.job = {
      ...defaultJob(),
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      resolvedRuntimeSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        authClass: "api_key",
      },
    };
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-pi-zai",
        config: {
          authMethod: "api_key",
          baseUrl: "https://api.z.ai/api/coding/paas/v4",
          implementationModel: "glm-5.3",
        },
      },
      credentials: { apiKey: "pi-zai-key" },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=zai&jobId=job-1"),
    );
    const json = await res.json() as {
      data: {
        zaiApiKey?: string;
        openaiApiKey?: string;
        credentialBundles?: Array<Record<string, unknown>>;
      };
    };

    expect(res.status).toBe(200);
    expect(json.data.zaiApiKey).toBe("pi-zai-key");
    expect(json.data.openaiApiKey).toBe("pi-zai-key");
    expect(json.data.credentialBundles).toEqual([{
      provider: "zai",
      connectionId: "conn-pi-zai",
      authClass: "api_key",
      apiKey: "pi-zai-key",
      implementationModel: "glm-5.3",
    }]);
    expect(state.claimCalls).toEqual([{
      jobId: "job-1",
      workerId: "runner-1",
      claimAttemptId: "claim-1",
    }]);
    expect(state.resolveAiKeyCalls[0]).toMatchObject({
      provider: "zai",
      acceptedAuthClasses: ["api_key"],
    });
    expect(state.lastUsedIds).toEqual(["conn-pi-zai"]);
  });

  it("resolves provider key using policy context from jobId", async () => {
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-policy-1",
        config: {
          authMethod: "api_key",
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
        zaiApiKey?: string;
        planningModel?: string;
        implementationModel?: string;
        baseUrl?: string;
        credentialBundles?: Array<Record<string, unknown>>;
        _debug?: unknown;
      };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Keep the legacy OpenAI-compatible field for existing Zipu/OpenCode
    // runners, while exposing the provider-bound bundle Pi requires.
    expect(json.data.openaiApiKey).toBe("policy-key");
    expect(json.data.zaiApiKey).toBe("policy-key");
    expect(json.data.credentialBundles).toEqual([{
      provider: "zai",
      connectionId: "conn-policy-1",
      authClass: "api_key",
      apiKey: "policy-key",
      planningModel: "claude-plan-1",
      implementationModel: "claude-impl-1",
    }]);
    expect(json.data._debug).toMatchObject({
      zai: {
        connectionId: "conn-policy-1",
        provider: "zai",
        authMethod: "api_key",
        tokenExpiresAt: null,
      },
    });
    expect(JSON.stringify(json.data._debug)).not.toContain("tokenPrefix");
    expect(JSON.stringify(json.data._debug)).not.toContain("tokenSuffix");
    expect(JSON.stringify(json.data._debug)).not.toContain("tokenLength");
    expect(json.data.credentialBundles?.[0]).not.toHaveProperty("baseUrl");
    expect(JSON.stringify(json.data.credentialBundles)).not.toContain("tokenPrefix");
    expect(JSON.stringify(json.data.credentialBundles)).not.toContain("tokenSuffix");
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


  it("rejects a caller-pinned connection that is not persisted on the job", async () => {
    state.job!.job.config = {
      claimAttemptId: "claim-1",
      providerConnectionId: "conn-job-persisted",
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(makeRequest(
      "/workers/provider-keys?providers=anthropic&jobId=job-1&preferredConnectionId=conn-caller",
    ));
    const json = await res.json() as { code?: string };

    expect(res.status).toBe(409);
    expect(json.code).toBe("PREFERRED_CONNECTION_BINDING_CONFLICT");
    expect(state.metadataCalls).toEqual([]);
    expect(state.resolveAiKeyCalls).toEqual([]);
    expect(state.refreshCalls).toEqual([]);
    expect(state.decryptCalls).toEqual([]);
    expect(state.lastUsedIds).toEqual([]);
  });

  it("resolves a normal UI-created Coding Plan connection to the exact Pi bundle", async () => {
    state.job!.job = {
      ...defaultJob(),
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      config: {
        claimAttemptId: "claim-1",
        providerConnectionId: "conn-preferred",
      },
      resolvedRuntimeSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        authClass: "api_key",
      },
    };
    const preferred = {
      id: "conn-preferred",
      provider: "zai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      isActive: true,
      suspendedAt: null,
      config: {
        authMethod: "api_key",
        zaiPlan: "coding",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        implementationModel: "glm-5.3",
      },
    };
    state.metadataRows.set(preferred.id, preferred);
    state.fullRows.set(preferred.id, preferred);
    state.refreshResults.set(preferred.id, { apiKey: "preferred-zai-key" });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(makeRequest(
      "/workers/provider-keys?providers=zai&jobId=job-1&preferredConnectionId=conn-preferred",
    ));
    const json = await res.json() as {
      data: {
        zaiApiKey?: string;
        openaiApiKey?: string;
        baseUrl?: string;
        credentialBundles?: Array<Record<string, unknown>>;
      };
    };

    expect(res.status).toBe(200);
    expect(json.data.zaiApiKey).toBe("preferred-zai-key");
    expect(json.data.openaiApiKey).toBe("preferred-zai-key");
    expect(json.data.baseUrl).toBe("https://api.z.ai/api/coding/paas/v4");
    expect(json.data.credentialBundles).toEqual([{
      provider: "zai",
      connectionId: "conn-preferred",
      authClass: "api_key",
      apiKey: "preferred-zai-key",
      implementationModel: "glm-5.3",
    }]);
    expect(state.metadataCalls).toEqual([{
      id: "conn-preferred",
      scope: "organization",
      scopeId: "org-1",
    }]);
    expect(state.fullRowCalls).toEqual(["conn-preferred"]);
    expect(state.refreshCalls).toEqual(["conn-preferred"]);
    expect(state.resolveAiKeyCalls).toEqual([]);
    expect(state.lastUsedIds).toEqual(["conn-preferred"]);
  });

  it("admits a persisted preferred connection in the job creator context", async () => {
    state.job!.job = {
      ...defaultJob(),
      config: {
        claimAttemptId: "claim-1",
        providerConnectionId: "conn-user-preferred",
      },
    };
    const preferred = {
      id: "conn-user-preferred",
      provider: "anthropic",
      category: "ai",
      scope: "user",
      scopeId: "user-1",
      isActive: true,
      suspendedAt: null,
      config: { authMethod: "api_key" },
    };
    state.metadataRows.set(preferred.id, preferred);
    state.fullRows.set(preferred.id, preferred);
    state.refreshResults.set(preferred.id, { apiKey: "preferred-user-key" });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(makeRequest(
      "/workers/provider-keys?providers=anthropic&jobId=job-1&preferredConnectionId=conn-user-preferred",
    ));
    const json = await res.json() as { data: { anthropicApiKey?: string } };

    expect(res.status).toBe(200);
    expect(json.data.anthropicApiKey).toBe("preferred-user-key");
    expect(state.metadataCalls).toEqual([
      {
        id: "conn-user-preferred",
        scope: "organization",
        scopeId: "org-1",
      },
      {
        id: "conn-user-preferred",
        scope: "user",
        scopeId: "user-1",
      },
    ]);
    expect(state.refreshCalls).toEqual(["conn-user-preferred"]);
    expect(state.resolveAiKeyCalls).toEqual([]);
    expect(state.lastUsedIds).toEqual(["conn-user-preferred"]);
  });

  it.each([
    ["setup-token", "setup_token", "PI_AUTH_SETUP_TOKEN_UNSUPPORTED"],
    ["provider OAuth", "oauth", "PI_AUTH_PROVIDER_OAUTH_UNSUPPORTED"],
    ["subscription", "subscription", "PI_AUTH_SUBSCRIPTION_UNSUPPORTED"],
  ] as const)(
    "rejects unsupported preferred Pi %s auth before refresh, decrypt, or export",
    async (_label, authMethod, rejectionCode) => {
      const connectionId = `conn-${authMethod}`;
      state.job!.job = {
        ...defaultJob(),
        provider: "zipu",
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        config: {
          claimAttemptId: "claim-1",
          providerConnectionId: connectionId,
        },
        resolvedRuntimeSelection: {
          codingAgent: "pi",
          aiProvider: "zai",
          authClass: "api_key",
        },
      };
      state.metadataRows.set(connectionId, {
        id: connectionId,
        provider: "zai",
        category: "ai",
        scope: "organization",
        scopeId: "org-1",
        isActive: true,
        suspendedAt: null,
        config: { authMethod },
      });

      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);
      const res = await app.handle(makeRequest(
        `/workers/provider-keys?providers=zai&jobId=job-1&preferredConnectionId=${connectionId}`,
      ));
      const json = await res.json() as {
        code?: string;
        data?: Record<string, unknown>;
        runtimeFailure?: unknown;
      };

      expect(res.status).toBe(409);
      expect(json.code).toBe(rejectionCode);
      expectRuntimeFailure(json, {
        code: "RUNTIME_AUTH_FAILURE",
        category: "auth",
        message: "Runtime authentication failed.",
      });
      expect(JSON.stringify(json)).not.toContain("must-not-export");
      expect(json.data).toBeUndefined();
      expect(state.metadataCalls).toEqual([{
        id: connectionId,
        scope: "organization",
        scopeId: "org-1",
      }]);
      expect(state.refreshCalls).toEqual([]);
      expect(state.decryptCalls).toEqual([]);
      expect(state.lastUsedIds).toEqual([]);
    },
  );

  it("rejects a preferred Pi connection whose full auth becomes unknown before refresh or export", async () => {
    state.job!.job = {
      ...defaultJob(),
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      config: {
        claimAttemptId: "claim-1",
        providerConnectionId: "conn-auth-changed",
      },
      resolvedRuntimeSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        authClass: "api_key",
      },
    };
    const preferredMetadata = {
      id: "conn-auth-changed",
      provider: "zai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      isActive: true,
      suspendedAt: null,
      config: {
        authMethod: "api_key",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
      },
    };
    state.metadataRows.set(preferredMetadata.id, preferredMetadata);
    state.fullRows.set(preferredMetadata.id, {
      ...preferredMetadata,
      config: {
        authMethod: "unexpected",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
      },
    });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(makeRequest(
      "/workers/provider-keys?providers=zai&jobId=job-1&preferredConnectionId=conn-auth-changed",
    ));
    const json = await res.json() as {
      code?: string;
      data?: Record<string, unknown>;
      runtimeFailure?: unknown;
    };

    expect(res.status).toBe(409);
    expect(json.code).toBe("PI_AUTH_UNKNOWN_UNSUPPORTED");
    expectRuntimeFailure(json, {
      code: "RUNTIME_AUTH_FAILURE",
      category: "auth",
      message: "Runtime authentication failed.",
    });
    expect(json.data).toBeUndefined();
    expect(state.refreshCalls).toEqual([]);
    expect(state.decryptCalls).toEqual([]);
    expect(state.lastUsedIds).toEqual([]);
  });

  it.each(["unknown", "foreign", "wrong-provider"] as const)(
    "rejects a %s excluded connection before credential resolution",
    async (kind) => {
      if (kind !== "unknown") {
        state.metadataRows.set("conn-excluded", {
          id: "conn-excluded",
          provider: kind === "wrong-provider" ? "openai" : "anthropic",
          category: "ai",
          scope: "organization",
          scopeId: kind === "foreign" ? "org-foreign" : "org-1",
          isActive: true,
          suspendedAt: null,
          config: { authMethod: "api_key" },
        });
      }
      state.resolveAiKeyResult = {
        connection: {
          id: "conn-must-not-resolve",
          config: { authMethod: "api_key" },
        },
        credentials: { apiKey: "must-not-export" },
      };

      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);
      const res = await app.handle(makeRequest(
        "/workers/provider-keys?providers=anthropic&jobId=job-1&excludeConnectionIds=conn-excluded",
      ));
      const json = await res.json() as { code?: string };

      expect(res.status).toBe(409);
      expect(json.code).toBe("PROVIDER_EXCLUSION_INVALID");
      expect(state.metadataCalls).toEqual(
        kind === "wrong-provider"
          ? [{
              id: "conn-excluded",
              scope: "organization",
              scopeId: "org-1",
            }]
          : [
              {
                id: "conn-excluded",
                scope: "organization",
                scopeId: "org-1",
              },
              {
                id: "conn-excluded",
                scope: "user",
                scopeId: "user-1",
              },
            ],
      );
      expect(state.resolveAiKeyCalls).toEqual([]);
      expect(state.refreshCalls).toEqual([]);
      expect(state.decryptCalls).toEqual([]);
      expect(state.lastUsedIds).toEqual([]);
    },
  );

  it("rejects unsupported resolved Pi auth before flat fields or last-used mutation", async () => {
    state.job!.job = {
      ...defaultJob(),
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      resolvedRuntimeSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        authClass: "api_key",
      },
    };
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-resolved-oauth",
        config: { authMethod: "oauth" },
      },
      credentials: { apiKey: "must-not-export" },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=zai&jobId=job-1"),
    );
    const json = await res.json() as {
      code?: string;
      data?: Record<string, unknown>;
      runtimeFailure?: unknown;
    };

    expect(res.status).toBe(409);
    expect(json.code).toBe("PI_AUTH_PROVIDER_OAUTH_UNSUPPORTED");
    expectRuntimeFailure(json, {
      code: "RUNTIME_AUTH_FAILURE",
      category: "auth",
      message: "Runtime authentication failed.",
    });
    expect(JSON.stringify(json)).not.toContain("must-not-export");
    expect(json.data).toBeUndefined();
    expect(state.lastUsedIds).toEqual([]);
  });

  it.each([
    ["canonical Coding Plan URL", "https://api.z.ai/api/coding/paas/v4", true],
    ["one normalized trailing slash", "https://api.z.ai/api/coding/paas/v4/", true],
    ["missing endpoint", undefined, false],
    ["Z.AI origin", "https://api.z.ai", false],
    ["Z.AI v1", "https://api.z.ai/v1", false],
    ["standard plan", "https://api.z.ai/api/paas/v4", false],
    ["metadata IPv4", "https://169.254.169.254/latest/meta-data", false],
    ["IPv4 loopback", "https://127.0.0.1/v1", false],
    ["RFC1918 IPv4", "https://10.24.0.8/v1", false],
    ["IPv6 loopback", "https://[::1]/v1", false],
    ["IPv6 link-local", "https://[fe80::1]/v1", false],
    [
      "credential-bearing URL",
      "https://FAKE_URL_PREFIX:FAKE_URL_SUFFIX@api.z.ai/api/coding/paas/v4",
      false,
    ],
    [
      "query-bearing URL",
      "https://api.z.ai/api/coding/paas/v4?credential=FAKE_QUERY_SECRET",
      false,
    ],
    [
      "fragment-bearing URL",
      "https://api.z.ai/api/coding/paas/v4#FAKE_FRAGMENT_SECRET",
      false,
    ],
    ["explicit port", "https://api.z.ai:8443/api/coding/paas/v4", false],
    ["HTTP scheme", "http://api.z.ai/api/coding/paas/v4", false],
    ["extra path", "https://api.z.ai/api/coding/paas/v4/models", false],
    ["double trailing slash", "https://api.z.ai/api/coding/paas/v4//", false],
    [
      "custom origin suffix",
      "https://api.z.ai.attacker.invalid/api/coding/paas/v4",
      false,
    ],
    ["mixed-case host", "https://API.Z.AI/api/coding/paas/v4", false],
    ["alternate host", "https://z.ai/api/coding/paas/v4", false],
  ] as const)(
    "enforces the Pi Z.AI endpoint matrix: %s",
    async (_label, baseUrl, accepted) => {
      const connectionId = accepted
        ? "conn-trusted-zai-endpoint"
        : "FAKE_CONNECTION_PREFIX-endpoint-FAKE_CONNECTION_SUFFIX";
      const credential = accepted
        ? "trusted-zai-test-key"
        : "FAKE_CREDENTIAL_PREFIX-value-FAKE_CREDENTIAL_SUFFIX";
      const connection = {
        id: connectionId,
        provider: "zai",
        category: "ai",
        scope: "organization",
        scopeId: "org-1",
        isActive: true,
        suspendedAt: null,
        config: {
          authMethod: "api_key",
          ...(baseUrl ? { baseUrl } : {}),
        },
      };
      state.job!.job = {
        ...defaultJob(),
        provider: "zipu",
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        config: {
          claimAttemptId: "claim-1",
          providerConnectionId: connectionId,
        },
        resolvedRuntimeSelection: {
          codingAgent: "pi",
          aiProvider: "zai",
          authClass: "api_key",
        },
      };
      state.metadataRows.set(connectionId, connection);
      state.fullRows.set(connectionId, connection);
      state.refreshResults.set(connectionId, { apiKey: credential });

      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);
      const res = await app.handle(makeRequest(
        `/workers/provider-keys?providers=zai&jobId=job-1&preferredConnectionId=${connectionId}`,
      ));
      const json = await res.json() as {
        code?: string;
        error?: string;
        data?: { zaiApiKey?: string; baseUrl?: string };
        runtimeFailure?: unknown;
      };

      if (accepted) {
        expect(res.status).toBe(200);
        expect(json.data?.zaiApiKey).toBe(credential);
        expect(json.data?.baseUrl).toBe("https://api.z.ai/api/coding/paas/v4");
        expect(state.fullRowCalls).toEqual([connectionId]);
        expect(state.refreshCalls).toEqual([connectionId]);
        expect(state.lastUsedIds).toEqual([connectionId]);
        return;
      }

      expect(res.status).toBe(409);
      expect(json.code).toBe("ZAI_ENDPOINT_UNTRUSTED");
      expect(json.error).toBe("Provider endpoint is not trusted");
      expectRuntimeFailure(json, {
        code: "RUNTIME_ENDPOINT_FAILURE",
        category: "endpoint",
        message: "Runtime endpoint is unavailable.",
      });
      expect(json.data).toBeUndefined();
      expect(state.fullRowCalls).toEqual([]);
      expect(state.resolveAiKeyCalls).toEqual([]);
      expect(state.refreshCalls).toEqual([]);
      expect(state.decryptCalls).toEqual([]);
      expect(state.lastUsedIds).toEqual([]);

      const capturedBoundary = JSON.stringify({ response: json, logs: loggerCaptures });
      for (const forbidden of [
        ...(baseUrl ? [baseUrl] : []),
        "FAKE_URL_PREFIX",
        "FAKE_URL_SUFFIX",
        "FAKE_QUERY_SECRET",
        "FAKE_FRAGMENT_SECRET",
        "FAKE_CONNECTION_PREFIX",
        "FAKE_CONNECTION_SUFFIX",
        "FAKE_CREDENTIAL_PREFIX",
        "FAKE_CREDENTIAL_SUFFIX",
      ]) {
        expect(capturedBoundary).not.toContain(forbidden);
      }
    },
  );

  it("rejects full-row Pi endpoint drift before credential refresh or export", async () => {
    const connectionId = "conn-endpoint-drift";
    const metadata = {
      id: connectionId,
      provider: "zai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      isActive: true,
      suspendedAt: null,
      config: {
        authMethod: "api_key",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
      },
    };
    state.job!.job = {
      ...defaultJob(),
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      config: { claimAttemptId: "claim-1", providerConnectionId: connectionId },
      resolvedRuntimeSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        authClass: "api_key",
      },
    };
    state.metadataRows.set(connectionId, metadata);
    state.fullRows.set(connectionId, {
      ...metadata,
      config: { authMethod: "api_key", baseUrl: "https://api.z.ai/v1" },
    });
    state.refreshResults.set(connectionId, {
      apiKey: "FAKE_DRIFTED_CREDENTIAL_MUST_NOT_EXPORT",
    });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(makeRequest(
      `/workers/provider-keys?providers=zai&jobId=job-1&preferredConnectionId=${connectionId}`,
    ));
    const json = await res.json() as { code?: string; data?: unknown };

    expect(res.status).toBe(409);
    expect(json.code).toBe("ZAI_ENDPOINT_UNTRUSTED");
    expect(json.data).toBeUndefined();
    expect(state.fullRowCalls).toEqual([connectionId]);
    expect(state.refreshCalls).toEqual([]);
    expect(state.decryptCalls).toEqual([]);
    expect(state.lastUsedIds).toEqual([]);
    expect(JSON.stringify({ response: json, logs: loggerCaptures })).not.toContain(
      "FAKE_DRIFTED_CREDENTIAL_MUST_NOT_EXPORT",
    );
  });

  it("resolves xAI provider keys separately from OpenAI", async () => {
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-xai-1",
        config: {
          authMethod: "api_key",
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
        credentialBundles?: Array<Record<string, unknown>>;
        _debug?: unknown;
      };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.xaiApiKey).toBe("xai-policy-key");
    expect(json.data.openaiApiKey).toBeUndefined();
    expect(json.data.implementationModel).toBe("grok-4.20-reasoning");
    expect(json.data.baseUrl).toBe("https://api.x.ai/v1");
    expect(json.data.credentialBundles).toEqual([{
      provider: "xai",
      connectionId: "conn-xai-1",
      authClass: "api_key",
      apiKey: "xai-policy-key",
      implementationModel: "grok-4.20-reasoning",
    }]);
    expect(json.data._debug).toMatchObject({
      xai: {
        connectionId: "conn-xai-1",
        provider: "xai",
        authMethod: "api_key",
        tokenExpiresAt: null,
      },
    });
    expect(JSON.stringify(json.data._debug)).not.toContain("tokenPrefix");
    expect(JSON.stringify(json.data._debug)).not.toContain("tokenSuffix");
    expect(JSON.stringify(json.data._debug)).not.toContain("tokenLength");
    expect(state.resolveAiKeyCalls[0]).toMatchObject({
      provider: "xai",
      userId: "user-1",
      workspaceId: "org-1",
    });
  });

  it("resolves Google provider keys for the native OpenCode-compatible endpoint", async () => {
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-google-1",
        config: { planningModel: "gemini-3.1-pro-preview" },
      },
      credentials: { apiKey: "google-policy-key" },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=google&jobId=job-1"),
    );
    const json = (await res.json()) as {
      success: boolean;
      data: { openaiApiKey?: string; planningModel?: string };
    };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.openaiApiKey).toBe("google-policy-key");
    expect(json.data.planningModel).toBe("gemini-3.1-pro-preview");
    expect(state.resolveAiKeyCalls[0]).toMatchObject({
      provider: "google",
      userId: "user-1",
      workspaceId: "org-1",
    });
  });

  it("rejects a suspended Plan Review capability instead of returning its credentials", async () => {
    const connectionId = "conn-suspended-plan-review";
    state.planReviewConnections = [{
      id: connectionId,
      name: "Suspended connection",
      provider: "openai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      isActive: true,
      suspendedAt: new Date("2026-08-24T00:00:00.000Z"),
      credentials: { apiKey: "must-not-use" },
      config: {},
    }];
    state.job = {
      job: {
        ...defaultJob(),
        config: {
          claimAttemptId: "claim-1",
          planReview: { version: 2 },
        },
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
    const capabilityRef = createPlanReviewCapabilityRef({
      workspaceId: "org-1",
      userId: "user-1",
      connectionId,
      provider: "openai",
    });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest(`/workers/provider-keys?providers=openai&jobId=job-1&preferredConnectionId=${encodeURIComponent(capabilityRef)}`),
    );

    expect(res.status).toBe(403);
    expect(state.resolveAiKeyCalls).toHaveLength(0);
  });

  it("resolves an active Plan Review capability server-side without exposing its raw connection ID", async () => {
    const connectionId = "conn-active-plan-review";
    const connection = {
      id: connectionId,
      name: "Active connection",
      provider: "openai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      isActive: true,
      suspendedAt: null,
      credentials: { apiKey: "active-plan-review-key" },
      config: {},
    };
    state.planReviewConnections = [connection];
    state.metadataRows.set(connectionId, connection);
    state.job = {
      job: {
        ...defaultJob(),
        config: {
          claimAttemptId: "claim-1",
          planReview: { version: 2 },
        },
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
    const capabilityRef = createPlanReviewCapabilityRef({
      workspaceId: "org-1",
      userId: "user-1",
      connectionId,
      provider: "openai",
    });

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest(`/workers/provider-keys?providers=openai&jobId=job-1&preferredConnectionId=${encodeURIComponent(capabilityRef)}`),
    );
    const json = (await res.json()) as {
      data?: {
        openaiApiKey?: string;
        _debug?: Record<string, Record<string, unknown>>;
      };
    };

    expect(res.status).toBe(200);
    expect(json.data?.openaiApiKey).toBe("active-plan-review-key");
    expect(JSON.stringify(json)).not.toContain(connectionId);
    expect(json.data?._debug?.openai).toMatchObject({
      connectionId: "plan-review-capability",
      provider: "openai",
      authMethod: "api_key",
      tokenExpiresAt: null,
      scope: "organization",
    });
    expect(json.data?._debug?.openai).not.toHaveProperty("tokenPrefix");
    expect(json.data?._debug?.openai).not.toHaveProperty("tokenSuffix");
    expect(json.data?._debug?.openai).not.toHaveProperty("tokenLength");
    expect(state.resolveAiKeyCalls).toHaveLength(0);
  });

  it("returns a provider-bound Google API-key bundle without debug token fragments", async () => {
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-google-1",
        config: {
          authMethod: "api_key",
          implementationModel: "gemini-3.1-pro-preview",
        },
      },
      credentials: { apiKey: "google-policy-key" },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=google&jobId=job-1"),
    );
    const json = (await res.json()) as {
      success: boolean;
      data: Record<string, unknown> & {
        googleApiKey?: string;
        credentialBundles?: Array<Record<string, unknown>>;
      };
    };

    expect(res.status).toBe(200);
    expect(json.data.googleApiKey).toBe("google-policy-key");
    expect(json.data.credentialBundles).toEqual([{
      provider: "google",
      connectionId: "conn-google-1",
      authClass: "api_key",
      apiKey: "google-policy-key",
      implementationModel: "gemini-3.1-pro-preview",
    }]);
    expect(json.data._debug).toMatchObject({
      google: {
        connectionId: "conn-google-1",
        provider: "google",
        authMethod: "api_key",
        tokenExpiresAt: null,
      },
    });
    expect(JSON.stringify(json.data)).not.toContain("tokenPrefix");
    expect(JSON.stringify(json.data)).not.toContain("tokenSuffix");
    expect(JSON.stringify(json.data)).not.toContain("tokenLength");
  });

  it("preserves legacy Codex subscription compatibility after auth admission", async () => {
    state.resolveAiKeyResult = {
      connection: {
        id: "conn-codex-subscription",
        config: { authMethod: "subscription" },
      },
      credentials: {
        apiKey: "codex-access-token",
        authMethod: "subscription",
        refreshToken: "codex-refresh-token",
      },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const res = await app.handle(
      makeRequest("/workers/provider-keys?providers=openai&jobId=job-1"),
    );
    const json = await res.json() as {
      data: {
        openaiApiKey?: string;
        openaiAuthMethod?: string;
        openaiCredentialsJson?: string;
        credentialBundles?: Array<Record<string, unknown>>;
      };
    };

    expect(res.status).toBe(200);
    expect(json.data.openaiApiKey).toBe("codex-access-token");
    expect(json.data.openaiAuthMethod).toBe("subscription");
    expect(JSON.parse(json.data.openaiCredentialsJson!)).toEqual({
      apiKey: "codex-access-token",
      refreshToken: "codex-refresh-token",
    });
    expect(json.data.credentialBundles).toEqual([{
      provider: "openai",
      connectionId: "conn-codex-subscription",
      authClass: "subscription",
    }]);
    expect(state.lastUsedIds).toEqual(["conn-codex-subscription"]);
  });

  it("rejects jobs without persisted workspace context", async () => {
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
    expect(res.status).toBe(404);
    expect(state.latestProviderCalls).toHaveLength(0);
    expect(state.resolveAiKeyCalls).toHaveLength(0);
  });

  it("resolves workspace provider key when nightly job has org but no user", async () => {
    state.job = {
      job: {
        ...defaultJob(),
        id: "job-nightly",
        createdByUserId: null,
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
          authMethod: "api_key",
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
        config: {
          authMethod: "api_key",
          implementationModel: "claude-opus-4-6",
        },
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
