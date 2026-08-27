import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";

const realConfig = { ...(await import("@almirant/config")) };
const realDatabase = { ...(await import("@almirant/database")) };
const realResolveAiKey = {
  ...(await import("../../ai/shared/services/resolve-ai-key")),
};

const SCOPED_SERVICE_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const configEnv = {
  ...realConfig.env,
  WORKSPACE_SCOPED_RUNNER_SERVICE_ACCOUNT_IDS: [] as string[],
  WORKSPACE_SCOPED_INTEGRATION_SERVICE_ACCOUNT_IDS: [] as string[],
};

const state = {
  apiWorkspaceId: "workspace-1",
  jobConfig: { claimAttemptId: "attempt-1" } as Record<string, unknown>,
  legacyReceiptExists: false,
  inserted: [] as Array<Record<string, unknown>>,
  nativeInserted: [] as Array<Record<string, unknown>>,
  jobProvider: "codex",
  jobCodingAgent: "opencode",
  jobAiProvider: "zai",
  jobModel: "glm-4.7",
  jobReads: 0,
  sessionReads: 0,
  nativeReads: 0,
};

const receiptAuthorizes = (
  claimAttemptId: string,
  sequenceNum: number,
  channel: "sessionEvents" | "nativeEvents",
): boolean => {
  if (state.jobConfig.claimAttemptId === claimAttemptId) return true;
  if (claimAttemptId !== "attempt-released") return false;
  const highWater = state.jobConfig.sequenceHighWater as
    | Record<string, unknown>
    | undefined;
  return typeof highWater?.[channel] === "number" && sequenceNum <= highWater[channel];
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({
    id: "bridge-key",
    workspaceId: state.apiWorkspaceId,
    serviceAccountId: SCOPED_SERVICE_ACCOUNT_ID,
  }),
  getJobById: async (id: string) => {
    state.jobReads += 1;
    return id === "job-1"
      ? {
          job: {
            id,
            workspaceId: "workspace-1",
            workerId: "worker-1",
            planningSessionId: null,
            provider: state.jobProvider,
            codingAgent: state.jobCodingAgent,
            aiProvider: state.jobAiProvider,
            model: state.jobModel,
            config: state.jobConfig,
          },
          workItem: null,
          project: null,
          board: null,
          planningSession: null,
          createdByUser: null,
        }
      : null;
  },
  insertSessionEventsBatch: async (events: Array<Record<string, unknown>>) => {
    state.inserted.push(...events);
    return events.length;
  },
  insertAgentNativeEventsBatch: async (events: Array<Record<string, unknown>>) => {
    state.nativeInserted.push(...events);
    return events.length;
  },
  persistReceiptFreeLegacySessionEvents: async (
    events: Array<Record<string, unknown>>,
  ) => {
    if (state.legacyReceiptExists) {
      throw new realDatabase.ClaimSequenceReceiptConflictError();
    }
    state.inserted.push(...events);
    return events.length;
  },
  persistReceiptFreeLegacyNativeEvents: async (
    events: Array<Record<string, unknown>>,
  ) => {
    if (state.legacyReceiptExists) {
      throw new realDatabase.ClaimSequenceReceiptConflictError();
    }
    const fresh = events.filter((event) => !state.nativeInserted.some(
      (stored) => stored.agentJobId === event.agentJobId && stored.sequenceNum === event.sequenceNum,
    ));
    state.nativeInserted.push(...fresh);
    return fresh.length;
  },
  getSessionEventsByJobId: async () => {
    state.sessionReads += 1;
    return [{ id: "session-event-1", agentJobId: "job-1", sequenceNum: 1 }];
  },
  getAgentNativeEventsByJobId: async () => {
    state.nativeReads += 1;
    return [{ id: "native-event-1", agentJobId: "job-1", sequenceNum: 1 }];
  },
  persistFencedSessionEvents: async (
    values: Array<{ claimAttemptId: string; event: Record<string, unknown> }>,
  ) => {
    if (
      values.some(
        ({ claimAttemptId, event }) =>
          !receiptAuthorizes(claimAttemptId, event.sequenceNum as number, "sessionEvents"),
      )
    ) {
      throw new realDatabase.ClaimSequenceReceiptConflictError();
    }
    state.inserted.push(...values.map(({ event }) => event));
    return values.length;
  },
  persistFencedNativeEvents: async (
    values: Array<{ claimAttemptId: string; event: Record<string, unknown> }>,
  ) => {
    if (
      values.some(
        ({ claimAttemptId, event }) =>
          !receiptAuthorizes(claimAttemptId, event.sequenceNum as number, "nativeEvents"),
      )
    ) {
      throw new realDatabase.ClaimSequenceReceiptConflictError();
    }
    const fresh = values
      .map(({ event }) => event)
      .filter((event) => !state.nativeInserted.some(
        (stored) => stored.agentJobId === event.agentJobId && stored.sequenceNum === event.sequenceNum,
      ));
    state.nativeInserted.push(...fresh);
    return fresh.length;
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("@almirant/config", () => ({ ...realConfig, env: configEnv }));
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

const makeRequest = (events: unknown[]): Request =>
  new Request("http://localhost/workers/agent-jobs/job-1/session-events", {
    method: "POST",
    headers: {
      authorization: "Bearer bridge-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ events }),
  });

const durableEvent = (overrides: Record<string, unknown> = {}) => ({
  sequenceNum: 7,
  sequenceProtocolVersion: "durable.v2",
  claimAttemptId: "attempt-1",
  kind: "system.info",
  payload: { kind: "system.info", message: "hello" },
  ...overrides,
});

const makeNativeRequest = (events: unknown[]): Request =>
  new Request("http://localhost/workers/agent-jobs/job-1/native-events", {
    method: "POST",
    headers: {
      authorization: "Bearer bridge-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ events }),
  });

const makeRawNativeRequest = (body: string): Request =>
  new Request("http://localhost/workers/agent-jobs/job-1/native-events", {
    method: "POST",
    headers: {
      authorization: "Bearer bridge-secret",
      "content-type": "application/json",
    },
    body,
  });

const durableNativeEvent = (overrides: Record<string, unknown> = {}) => ({
  sequenceNum: 9,
  sequenceProtocolVersion: "durable.v2",
  claimAttemptId: "attempt-1",
  nativeEventType: "message.part.updated",
  sourceFormat: "opencode-sse",
  payload: { type: "message.part.updated" },
  ...overrides,
});

describe("workers durable session-event ingress", () => {
  beforeEach(() => {
    state.apiWorkspaceId = "workspace-1";
    state.jobConfig = { claimAttemptId: "attempt-1" };
    state.legacyReceiptExists = false;
    state.inserted = [];
    state.nativeInserted = [];
    state.jobProvider = "codex";
    state.jobCodingAgent = "opencode";
    state.jobAiProvider = "zai";
    state.jobModel = "glm-4.7";
    state.jobReads = 0;
    state.sessionReads = 0;
    state.nativeReads = 0;
    configEnv.WORKSPACE_SCOPED_RUNNER_SERVICE_ACCOUNT_IDS = [];
    configEnv.WORKSPACE_SCOPED_INTEGRATION_SERVICE_ACCOUNT_IDS = [];
  });

  it("persists the explicit durable marker for the current claim", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(makeRequest([durableEvent()]));

    expect(response.status).toBe(200);
    expect(state.inserted).toEqual([
      expect.objectContaining({
        agentJobId: "job-1",
        sequenceNum: 7,
        sequenceProtocolVersion: "durable.v2",
      }),
    ]);
  });

  it("rejects a stale claim token and writes nothing", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      makeRequest([durableEvent({ claimAttemptId: "attempt-old" })]),
    );

    expect(response.status).toBe(409);
    expect(state.inserted).toEqual([]);
  });

  it("preserves conflicting legacy rows when no claim nonce exists", async () => {
    state.jobConfig = {};
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      makeRequest([
        { sequenceNum: 11, kind: "agent.thinking", payload: { content: "a" } },
        { sequenceNum: 11, kind: "heartbeat", payload: { message: "b" } },
      ]),
    );

    expect(response.status).toBe(200);
    expect(state.inserted).toHaveLength(2);
    expect(state.inserted.every((event) => event.sequenceProtocolVersion == null)).toBe(true);
  });

  it("rejects legacy session and native writes after a durable receipt exists", async () => {
    state.jobConfig = {};
    state.legacyReceiptExists = true;
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const sessionResponse = await app.handle(
      makeRequest([{
        sequenceNum: 2,
        kind: "legacy.session",
        payload: { marker: "must-be-fenced" },
      }]),
    );
    const nativeResponse = await app.handle(
      makeNativeRequest([{
        sequenceNum: 2,
        nativeEventType: "legacy.native",
        sourceFormat: "legacy-test",
        payload: { marker: "must-be-fenced" },
      }]),
    );

    expect(sessionResponse.status).toBe(409);
    expect(nativeResponse.status).toBe(409);
    expect(state.inserted).toEqual([]);
    expect(state.nativeInserted).toEqual([]);
  });

  it("rejects fractional durable sequences at the schema boundary", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      makeRequest([durableEvent({ sequenceNum: 7.5 })]),
    );

    expect(response.status).toBe(422);
    expect(state.inserted).toEqual([]);
  });

  it("fences native-event ingress to the same durable claim", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const accepted = await app.handle(
      makeNativeRequest([durableNativeEvent()]),
    );
    const stale = await app.handle(
      makeNativeRequest([
        durableNativeEvent({ claimAttemptId: "attempt-stale" }),
      ]),
    );

    expect(accepted.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(state.nativeInserted).toHaveLength(1);
  });

  it("sanitizes nested native diagnostics before persistence without changing normal fields", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const fakeApiKey = "sk-FAKE_NATIVE_SECRET_PREFIX_123456_SUFFIX";
    const fakeBearer = "Bearer FAKE_BEARER_PREFIX_123456_SUFFIX";

    const event = durableNativeEvent({
      payload: {
        type: "message.part.updated",
        message: "Normal assistant text remains exact.",
        nested: {
          command: "printf FAKE_COMMAND_PREFIX_123456_SUFFIX",
          config: {
            endpoint: "https://user:pass@example.test/path?token=FAKE_URL_SUFFIX",
          },
          headers: { authorization: fakeBearer },
          urls: ["https://example.test/FAKE_URL_PREFIX/path"],
          env: { API_KEY: fakeApiKey },
          logs: ["FAKE_LOG_PREFIX_123456_SUFFIX"],
        },
        note: `credentials ${fakeApiKey} and ${fakeBearer}`,
      },
    });
    const response = await app.handle(makeNativeRequest([event]));
    const replay = await app.handle(makeNativeRequest([event]));

    expect(response.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(state.nativeInserted).toHaveLength(1);
    expect(state.nativeInserted[0]?.payload).toMatchObject({
      type: "message.part.updated",
      message: "Normal assistant text remains exact.",
    });
    const persisted = JSON.stringify(state.nativeInserted[0]);
    expect(persisted).not.toContain(fakeApiKey);
    expect(persisted).not.toContain(fakeBearer);
    expect(persisted).not.toContain("FAKE_NATIVE_SECRET_PREFIX");
    expect(persisted).not.toContain("123456_SUFFIX");
    expect(persisted).not.toContain("FAKE_COMMAND_PREFIX");
    expect(persisted).not.toContain("FAKE_URL_PREFIX");
    expect(persisted).not.toContain("FAKE_LOG_PREFIX");
    expect(persisted).not.toContain("user:pass");
  });

  it("returns safe typed 400s for bounded payload overflows before job or persistence reads", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index <= 8; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const cases: Array<[unknown, string]> = [
      [deep, "RUNTIME_DIAGNOSTIC_TOO_DEEP"],
      [
        Array.from({ length: 64 }, () =>
          Array.from({ length: 8 }, () => null)),
        "RUNTIME_DIAGNOSTIC_TOO_MANY_NODES",
      ],
      [Array.from({ length: 65 }, () => null), "RUNTIME_DIAGNOSTIC_ARRAY_TOO_LARGE"],
      ["x".repeat(8_193), "RUNTIME_DIAGNOSTIC_STRING_TOO_LARGE"],
      [
        Array.from({ length: 5 }, () => "é".repeat(4_000)),
        "RUNTIME_DIAGNOSTIC_ENCODED_TOO_LARGE",
      ],
    ];

    for (const [payload, code] of cases) {
      const response = await app.handle(makeNativeRequest([
        durableNativeEvent({ payload }),
      ]));
      const responseBody = await response.json();
      expect(response.status).toBe(400);
      expect(responseBody).toEqual({
        success: false,
        error: "Native event payload is invalid",
        code,
      });
    }
    expect(state.jobReads).toBe(0);
    expect(state.nativeInserted).toEqual([]);
  });

  it("rejects malformed JSON and oversized native batches before job persistence reads", async () => {
    const { AGENT_NATIVE_EVENT_LIMITS } = await import("@almirant/database");
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const malformed = await app.handle(makeRawNativeRequest('{"events":'));
    const oversized = await app.handle(makeNativeRequest(
      Array.from(
        { length: AGENT_NATIVE_EVENT_LIMITS.maxBatchSize + 1 },
        (_, index) => durableNativeEvent({ sequenceNum: index }),
      ),
    ));
    const oversizedBody = await oversized.json();

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(oversizedBody).toEqual({
      success: false,
      error: "Native event batch is too large",
      code: "NATIVE_EVENT_BATCH_TOO_LARGE",
    });
    expect(state.jobReads).toBe(0);
    expect(state.nativeInserted).toEqual([]);
  });

  it("bounds native metadata and rejects invalid enums before job reads", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const invalidOverrides: Record<string, unknown>[] = [
      { nativeEventType: "x".repeat(121) },
      { sourceFormat: "x".repeat(51) },
      { runtimeSessionId: "x".repeat(256) },
      { model: "x".repeat(257) },
      { provider: "zai" },
      { codingAgent: "unknown-agent" },
      { aiProvider: "unknown-ai-provider" },
    ];

    for (const overrides of invalidOverrides) {
      const response = await app.handle(makeNativeRequest([
        durableNativeEvent(overrides),
      ]));
      expect(response.status).toBe(422);
    }
    expect(state.jobReads).toBe(0);
    expect(state.nativeInserted).toEqual([]);
  });

  it("persists the exact Pi native selection tuple idempotently on redelivery", async () => {
    state.jobProvider = "zipu";
    state.jobCodingAgent = "pi";
    state.jobAiProvider = "zai";
    state.jobModel = "glm-5.3";
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const event = durableNativeEvent({
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
    });

    const first = await app.handle(makeNativeRequest([event]));
    const replay = await app.handle(makeNativeRequest([event]));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(state.nativeInserted).toEqual([
      expect.objectContaining({
        provider: "zipu",
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      }),
    ]);
  });

  it("rejects an AI-provider value in the infrastructure provider lane before persistence", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(makeNativeRequest([
      durableNativeEvent({ provider: "zai" }),
    ]));

    expect(response.status).toBe(422);
    expect(state.nativeInserted).toEqual([]);
  });

  it("preserves legacy native selection fallbacks when additive fields are omitted", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(makeNativeRequest([durableNativeEvent()]));

    expect(response.status).toBe(200);
    expect(state.nativeInserted).toEqual([
      expect.objectContaining({
        provider: "codex",
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-4.7",
      }),
    ]);
  });

  it("rejects non-canonical Pi native tuples", async () => {
    state.jobProvider = "zipu";
    state.jobCodingAgent = "pi";
    state.jobAiProvider = "zai";
    state.jobModel = "glm-5.3";
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(makeNativeRequest([
      durableNativeEvent({
        provider: "zipu",
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-other",
      }),
    ]));

    expect(response.status).toBe(400);
    expect(state.nativeInserted).toEqual([]);
  });

  it("rejects supplied runtime tuple fields that disagree with the job", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(makeNativeRequest([
      durableNativeEvent({
        provider: "codex",
        codingAgent: "codex",
        aiProvider: "zai",
        model: "glm-4.7",
      }),
    ]));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: "Native event runtime selection is inconsistent",
      code: "NATIVE_EVENT_RUNTIME_SELECTION_INVALID",
    });
    expect(state.nativeInserted).toEqual([]);
  });

  it("accepts late durable bridge delivery only within the released high-water floor", async () => {
    state.jobConfig = {
      claimAttemptId: "attempt-current",
      sequenceHighWater: {
        protocolVersion: 2,
        jobLogs: 8,
        sessionEvents: 10,
        nativeEvents: 12,
      },
    };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const lateCanonical = await app.handle(
      makeRequest([
        durableEvent({
          sequenceNum: 10,
          claimAttemptId: "attempt-released",
        }),
      ]),
    );
    const beyondCanonicalFloor = await app.handle(
      makeRequest([
        durableEvent({
          sequenceNum: 11,
          claimAttemptId: "attempt-released",
        }),
      ]),
    );
    const lateNative = await app.handle(
      makeNativeRequest([
        durableNativeEvent({
          sequenceNum: 12,
          claimAttemptId: "attempt-released",
        }),
      ]),
    );
    const beyondNativeFloor = await app.handle(
      makeNativeRequest([
        durableNativeEvent({
          sequenceNum: 13,
          claimAttemptId: "attempt-released",
        }),
      ]),
    );

    expect(lateCanonical.status).toBe(200);
    expect(beyondCanonicalFloor.status).toBe(409);
    expect(lateNative.status).toBe(200);
    expect(beyondNativeFloor.status).toBe(409);
    expect(state.inserted).toHaveLength(1);
    expect(state.nativeInserted).toHaveLength(1);
  });

  it("accepts already-fenced durable delivery while a released job is unclaimed", async () => {
    state.jobConfig = {
      sequenceHighWater: {
        protocolVersion: 2,
        jobLogs: 3,
        sessionEvents: 4,
        nativeEvents: 5,
      },
    };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      makeRequest([
        durableEvent({
          sequenceNum: 4,
          claimAttemptId: "attempt-released",
        }),
      ]),
    );

    expect(response.status).toBe(200);
    expect(state.inserted).toHaveLength(1);
  });

  it("rejects an arbitrary historical nonce even below the shared release floor", async () => {
    state.jobConfig = {
      claimAttemptId: "attempt-current",
      sequenceHighWater: {
        protocolVersion: 2,
        jobLogs: 50,
        sessionEvents: 50,
        nativeEvents: 50,
      },
    };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      makeRequest([
        durableEvent({
          sequenceNum: 1,
          claimAttemptId: "forged-historical-attempt",
        }),
      ]),
    );

    expect(response.status).toBe(409);
    expect(state.inserted).toEqual([]);
  });

  it("persists a valid producer-supplied occurredAt", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      makeRequest([
        durableEvent({ occurredAt: "2026-08-08T10:00:00.000Z" }),
      ]),
    );

    expect(response.status).toBe(200);
    expect(state.inserted).toEqual([
      expect.objectContaining({
        occurredAt: new Date("2026-08-08T10:00:00.000Z"),
      }),
    ]);
  });

  it("stores null when occurredAt is omitted instead of fabricating one", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(makeRequest([durableEvent()]));

    expect(response.status).toBe(200);
    expect(state.inserted).toEqual([
      expect.objectContaining({ occurredAt: null }),
    ]);
  });

  it("rejects a malformed occurredAt with the route's validation error shape", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const response = await app.handle(
      makeRequest([durableEvent({ occurredAt: "not-a-timestamp" })]),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: expect.any(String) });
    expect(state.inserted).toEqual([]);
  });

});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("@almirant/config", () => realConfig);
  mock.module("../../ai/shared/services/resolve-ai-key", () => realResolveAiKey);
});
