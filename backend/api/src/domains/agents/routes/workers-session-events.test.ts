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
const realResolveAiKey = {
  ...(await import("../../ai/shared/services/resolve-ai-key")),
};

const state = {
  jobConfig: { claimAttemptId: "attempt-1" } as Record<string, unknown>,
  legacyReceiptExists: false,
  inserted: [] as Array<Record<string, unknown>>,
  nativeInserted: [] as Array<Record<string, unknown>>,
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
  validateApiKey: async () => ({ id: "bridge-key", workspaceId: "workspace-1" }),
  getJobById: async (id: string) =>
    id === "job-1"
      ? {
          job: {
            id,
            workspaceId: "workspace-1",
            workerId: "worker-1",
            planningSessionId: null,
            config: state.jobConfig,
          },
          workItem: null,
          project: null,
          board: null,
          planningSession: null,
          createdByUser: null,
        }
      : null,
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
    state.nativeInserted.push(...events);
    return events.length;
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
    state.nativeInserted.push(...values.map(({ event }) => event));
    return values.length;
  },
});

mock.module("@almirant/database", () => dbMocks);
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
    state.jobConfig = { claimAttemptId: "attempt-1" };
    state.legacyReceiptExists = false;
    state.inserted = [];
    state.nativeInserted = [];
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
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => realResolveAiKey);
});
