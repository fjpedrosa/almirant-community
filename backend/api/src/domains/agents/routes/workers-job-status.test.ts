import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testWorkspace } from "../../../test/fixtures";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const state = {
  updateArgs: null as {
    id: string;
    status: string;
    data: Record<string, unknown> | undefined;
  } | null,
  claimUpdateArgs: null as {
    id: string;
    status: string;
    ownership: Record<string, unknown>;
    data: Record<string, unknown> | undefined;
    releaseConfig: Record<string, unknown> | undefined;
  } | null,
  claimUpdateSucceeds: true,
  claimUpdateOutcome: "updated" as "updated" | "idempotent-replay",
  legacyUpdateArgs: null as {
    id: string;
    status: string;
    ownership: Record<string, unknown>;
    data: Record<string, unknown> | undefined;
  } | null,
  legacyUpdateSucceeds: true,
};

const existingJob = {
  id: "job-1",
  status: "running" as "running" | "cancelled",
  workerId: "worker-1",
  workItemId: null,
  planningSessionId: null,
  jobType: "planning" as const,
  createdByUserId: null,
  workspaceId: testWorkspace.id,
  cumulativeDurationMs: 0,
  startedAt: new Date("2026-04-04T12:00:00.000Z"),
  updatedAt: new Date("2026-04-04T12:00:01.000Z"),
  result: null as Record<string, unknown> | null,
  config: {} as Record<string, unknown>,
  branchName: "almirant/job-existing",
  prUrl: "https://github.com/acme/repo/pull/7",
  prNumber: 7,
  commitSha: "a".repeat(40),
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key", workspaceId: testWorkspace.id }),
  getJobById: async (id: string) => {
    if (id !== existingJob.id) return null;
    return {
      job: existingJob,
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
      createdByUser: null,
    };
  },
  updateJobStatus: async (
    id: string,
    status: string,
    data?: Record<string, unknown>,
  ) => {
    state.updateArgs = { id, status, data };
    const updated = {
      ...existingJob,
      id,
      status,
      result: data?.result ?? null,
      completedAt: status === "completed" || status === "incomplete" ? new Date("2026-04-04T12:10:00.000Z") : null,
      failedAt: status === "failed" ? new Date("2026-04-04T12:10:00.000Z") : null,
    };
    return updated;
  },
  updateClaimedJobStatus: async (
    id: string,
    status: string,
    ownership: Record<string, unknown>,
    data?: Record<string, unknown>,
    releaseConfig?: Record<string, unknown>,
  ) => {
    state.claimUpdateArgs = { id, status, ownership, data, releaseConfig };
    if (!state.claimUpdateSucceeds) return null;
    const updated = {
      ...existingJob,
      id,
      status,
      result: data?.result ?? null,
      config: data?.config ?? existingJob.config,
      completedAt: status === "completed" || status === "incomplete" ? new Date("2026-04-04T12:10:00.000Z") : null,
      failedAt: status === "failed" ? new Date("2026-04-04T12:10:00.000Z") : null,
    };
    return state.claimUpdateOutcome === "idempotent-replay"
      ? { ...updated, claimStatusOutcome: "idempotent-replay" as const }
      : updated;
  },
  updateLegacyClaimedJobStatus: async (
    id: string,
    status: string,
    ownership: Record<string, unknown>,
    data?: Record<string, unknown>,
  ) => {
    state.legacyUpdateArgs = { id, status, ownership, data };
    if (
      !state.legacyUpdateSucceeds ||
      ownership.expectedStatus === "cancelled"
    ) {
      return null;
    }
    return {
      ...existingJob,
      id,
      status,
      result: data?.result ?? null,
      config: data?.config ?? existingJob.config,
      completedAt: status === "completed" || status === "incomplete" ? new Date("2026-04-04T12:10:00.000Z") : null,
      failedAt: status === "failed" ? new Date("2026-04-04T12:10:00.000Z") : null,
    };
  },
});

mock.module("@almirant/database", () => dbMocks);
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

const makeRequest = (body: unknown): Request =>
  new Request(`http://localhost/workers/jobs/${existingJob.id}/status`, {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

const makeStatusRequest = (): Request =>
  new Request(`http://localhost/workers/jobs/${existingJob.id}/status`, {
    headers: { authorization: "Bearer worker-secret" },
  });

describe("workersRoutes POST /workers/jobs/:jobId/status", () => {
  beforeEach(() => {
    state.updateArgs = null;
    state.claimUpdateArgs = null;
    state.claimUpdateSucceeds = true;
    state.claimUpdateOutcome = "updated";
    state.legacyUpdateArgs = null;
    state.legacyUpdateSucceeds = true;
    existingJob.status = "running";
    existingJob.updatedAt = new Date("2026-04-04T12:00:01.000Z");
    existingJob.config = {};
    existingJob.workspaceId = testWorkspace.id;
    existingJob.result = null;
  });

  it("routes an explicit stale release token through the fenced idempotency path", async () => {
    state.claimUpdateOutcome = "idempotent-replay";
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "queued",
        workerId: "worker-1",
        expectedClaimAttemptId: "attempt-released",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 10,
          sessionEvents: 20,
          nativeEvents: 30,
        },
      }),
    );
    const payload = await res.json() as {
      success: boolean;
      data: Record<string, unknown>;
    };

    expect(res.status).toBe(200);
    expect(state.updateArgs).toBeNull();
    expect(state.claimUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "queued",
      ownership: {
        workerId: "worker-1",
        claimAttemptId: "attempt-released",
      },
    });
    expect(payload.success).toBe(true);
    expect(payload.data.claimStatusOutcome).toBeUndefined();
  });

  it("routes an explicit terminal replay through the fenced idempotency path", async () => {
    state.claimUpdateOutcome = "idempotent-replay";
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "completed",
        workerId: "worker-1",
        expectedClaimAttemptId: "attempt-terminal",
        result: { summary: "already completed" },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.updateArgs).toBeNull();
    expect(state.claimUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "completed",
      ownership: {
        workerId: "worker-1",
        claimAttemptId: "attempt-terminal",
      },
    });
  });

  it("exposes a pending terminal intent as an effective worker cancellation", async () => {
    existingJob.config = {
      claimAttemptId: "attempt-current",
      pendingTerminalIntent: {
        status: "cancelled",
        requestedAt: "2026-07-13T10:05:00.000Z",
        result: { shutdownRequested: true },
      },
    };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeStatusRequest());
    const payload = await res.json() as {
      data: { status: string; shutdownRequested: boolean };
    };

    expect(res.status).toBe(200);
    expect(payload.data).toEqual({
      status: "cancelled",
      shutdownRequested: true,
    });
  });

  it("preserves a pending failed intent and its failure details for the worker", async () => {
    existingJob.config = {
      claimAttemptId: "attempt-current",
      pendingTerminalIntent: {
        status: "failed",
        requestedAt: "2026-07-13T10:05:00.000Z",
        errorType: "interaction-timeout",
        errorMessage: "Interaction timed out",
      },
    };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeStatusRequest());
    const payload = await res.json() as {
      data: {
        status: string;
        shutdownRequested: boolean;
        errorType?: string;
        errorMessage?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(payload.data).toEqual({
      status: "failed",
      shutdownRequested: false,
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out",
    });
  });

  it("rejects a stale claim-attempt release without mutating the newer claim", async () => {
    existingJob.config = { claimAttemptId: "attempt-b" };
    state.claimUpdateSucceeds = false;
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "queued",
        workerId: "worker-1",
        expectedClaimAttemptId: "attempt-a",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 99,
          sessionEvents: 99,
          nativeEvents: 99,
        },
      }),
    );

    expect(res.status).toBe(409);
    expect(state.updateArgs).toBeNull();
    expect(state.claimUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "queued",
      ownership: {
        workerId: "worker-1",
        claimAttemptId: "attempt-a",
      },
    });
  });

  it("uses claim ownership CAS for a current fenced release", async () => {
    existingJob.config = { claimAttemptId: "attempt-current" };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "paused",
        workerId: "worker-1",
        expectedClaimAttemptId: "attempt-current",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 0,
          sessionEvents: 0,
          nativeEvents: 0,
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.updateArgs).toBeNull();
    expect(state.claimUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "paused",
      ownership: {
        workerId: "worker-1",
        claimAttemptId: "attempt-current",
      },
      data: {
        workerId: null,
      },
      releaseConfig: {
        previousJobId: existingJob.id,
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 0,
          sessionEvents: 0,
          nativeEvents: 0,
        },
      },
    });
  });

  it("normalizes legacy string result payloads into an object summary", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "completed",
        result: "plain summary from bridge",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.legacyUpdateArgs).not.toBeNull();
    expect(state.legacyUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "completed",
      data: {
        result: { summary: "plain summary from bridge" },
      },
    });
  });

  it("returns conflict when cancellation wins between the legacy pre-read and CAS", async () => {
    state.legacyUpdateSucceeds = false;
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "completed",
        workerId: "worker-1",
        result: { summary: "late completion" },
      }),
    );

    expect(res.status).toBe(409);
    expect(state.updateArgs).toBeNull();
    expect(state.legacyUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "completed",
      ownership: {
        workerId: "worker-1",
        expectedStatus: "running",
        expectedUpdatedAt: new Date("2026-04-04T12:00:01.000Z"),
      },
    });
  });

  it("never lets a legacy failure overwrite a terminal cancellation", async () => {
    existingJob.status = "cancelled";
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "failed",
        workerId: "worker-1",
        errorMessage: "late worker failure",
      }),
    );

    expect(res.status).toBe(409);
    expect(state.updateArgs).toBeNull();
    expect(state.legacyUpdateArgs).toMatchObject({
      status: "failed",
      ownership: { expectedStatus: "cancelled" },
    });
  });

  it("accepts incomplete as a terminal non-failure status", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "incomplete",
        result: {
          summary: "PR pushed but two tasks were not reconciled",
          completionState: "incomplete",
          missingWorkItemIds: ["wi-1", "wi-2"],
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.legacyUpdateArgs).not.toBeNull();
    expect(state.legacyUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "incomplete",
      data: {
        result: {
          summary: "PR pushed but two tasks were not reconciled",
          completionState: "incomplete",
          missingWorkItemIds: ["wi-1", "wi-2"],
        },
      },
    });
    expect(state.legacyUpdateArgs?.data?.completedAt).toBeInstanceOf(Date);
    expect(state.legacyUpdateArgs?.data?.failedAt).toBeUndefined();
  });

  it("accepts the new finalizing status for post-session work", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "finalizing",
        result: { summary: "session ended, finalizing push" },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.legacyUpdateArgs).not.toBeNull();
    expect(state.legacyUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "finalizing",
      data: {
        result: { summary: "session ended, finalizing push" },
      },
    });
  });

  it("preserves a fenced continuation attestation when a running heartbeat omits result", async () => {
    const previousResult = existingJob.result;
    const continuationResult = {
      trustedDeliveryContinuation: {
        schemaVersion: "trusted-delivery-continuation@1",
        jobId: existingJob.id,
        pushedCommitSha: "b".repeat(40),
      },
    };
    existingJob.result = continuationResult;
    try {
      const { workersRoutes } = await import("./workers.routes");
      const app = new Elysia().use(workersRoutes);

      const res = await app.handle(makeRequest({ status: "running" }));

      expect(res.status).toBe(200);
      expect(state.legacyUpdateArgs?.data).toMatchObject({
        result: continuationResult,
      });
    } finally {
      existingJob.result = previousResult;
    }
  });

  it("preserves Git/PR artifacts when a terminal status patch omits them", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({ status: "completed", result: { summary: "done" } }),
    );

    expect(res.status).toBe(200);
    expect(state.legacyUpdateArgs?.data).toMatchObject({
      branchName: existingJob.branchName,
      prUrl: existingJob.prUrl,
      prNumber: existingJob.prNumber,
      commitSha: existingJob.commitSha,
    });
  });

  it("accepts paused as a non-terminal resource-releasing status", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "paused",
        availableAt: "2026-04-04T13:00:00.000Z",
        errorType: "weekly_quota_exceeded",
        errorMessage: "weekly token limit exceeded",
        result: { pausedForQuota: true },
        branchName: "feature/should-be-cleared",
        worktreePath: "/tmp/should-be-cleared",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.legacyUpdateArgs).not.toBeNull();
    expect(state.legacyUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "paused",
      data: {
        workerId: null,
        branchName: null,
        worktreePath: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorType: "weekly_quota_exceeded",
        errorMessage: "weekly token limit exceeded",
        result: { pausedForQuota: true },
        config: { previousJobId: existingJob.id },
      },
    });
    expect(state.legacyUpdateArgs?.data?.availableAt).toEqual(new Date("2026-04-04T13:00:00.000Z"));
    expect(state.legacyUpdateArgs?.data?.cumulativeDurationMs).toBeGreaterThan(0);
  });

  it("atomically fixes producer high-water marks before a queued job becomes claimable", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "queued",
        retryCount: 1,
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 41,
          sessionEvents: 73,
          nativeEvents: 19,
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.legacyUpdateArgs).toMatchObject({
      id: existingJob.id,
      status: "queued",
      data: {
        workerId: null,
        config: {
          sequenceHighWater: {
            protocolVersion: 2,
            jobLogs: 41,
            sessionEvents: 73,
            nativeEvents: 19,
          },
        },
      },
    });
  });

  it("rejects producer high-water marks that cannot fit the persisted sequence columns", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "queued",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 2_147_483_648,
          sessionEvents: 0,
          nativeEvents: 0,
        },
      }),
    );

    expect(res.status).toBe(422);
    expect(state.updateArgs).toBeNull();
  });

  it("never lets a stale release regress an already fenced producer high-water mark", async () => {
    existingJob.config = {
      sequenceHighWater: {
        protocolVersion: 2,
        jobLogs: 100,
        sessionEvents: 200,
        nativeEvents: 300,
      },
    };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "queued",
        sequenceHighWater: {
          protocolVersion: 2,
          jobLogs: 101,
          sessionEvents: 150,
          nativeEvents: 250,
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.legacyUpdateArgs?.data?.config).toMatchObject({
      sequenceHighWater: {
        protocolVersion: 2,
        jobLogs: 101,
        sessionEvents: 200,
        nativeEvents: 300,
      },
    });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
