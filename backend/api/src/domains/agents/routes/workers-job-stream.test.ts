import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createLoggerMock,
  createResponseMocks,
  createGithubServiceMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testWorkspace } from "../../../test/fixtures";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = {
  ...(await import("../../ai/shared/services/resolve-ai-key")),
};

const state = {
  broadcasts: [] as Array<{ orgId: string; message: Record<string, unknown> }>,
  createdInteractions: [] as Array<Record<string, unknown>>,
  statusUpdates: [] as Array<Record<string, unknown>>,
  job: {
    job: {
      id: "job-1",
      workItemId: null,
      planningSessionId: "planning-session-1",
      workspaceId: testWorkspace.id,
      workerId: null,
      config: {} as Record<string, unknown>,
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
      workerId: string | null;
      config: Record<string, unknown>;
    };
    workItem: null;
    project: null;
    board: null;
    planningSession: null;
  } | null,
};

const planningOrgLookupChain = {
  from: () => planningOrgLookupChain,
  innerJoin: () => planningOrgLookupChain,
  where: () => planningOrgLookupChain,
  limit: async () => [{ workspaceId: testWorkspace.id }],
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key" }),
  getJobById: async () => state.job,
  updateJobStatus: async (jobId: string, status: string) => {
    state.statusUpdates.push({ jobId, status, mode: "legacy" });
    return {
      id: jobId,
      status,
      workItemId: state.job?.job.workItemId ?? null,
      planningSessionId: state.job?.job.planningSessionId ?? null,
    };
  },
  updateClaimedJobStatus: async (
    jobId: string,
    status: string,
    ownership: Record<string, unknown>,
  ) => {
    state.statusUpdates.push({ jobId, status, ownership, mode: "fenced" });
    return {
      id: jobId,
      status,
      workItemId: state.job?.job.workItemId ?? null,
      planningSessionId: state.job?.job.planningSessionId ?? null,
    };
  },
  createFencedJobInteraction: async (input: Record<string, unknown>) => {
    state.createdInteractions.push(input);
    state.statusUpdates.push({
      jobId: input.agentJobId,
      status: "waiting_for_input",
      ownership: {
        workerId: input.workerId,
        claimAttemptId: input.claimAttemptId,
      },
      mode: "fenced",
    });
    return {
      outcome: "created",
      job: {
        ...state.job!.job,
        status: "waiting_for_input",
      },
      interaction: {
        id: "interaction-1",
        questionText: input.questionText,
        questionType: input.questionType,
        questionContext: input.questionContext ?? null,
        options: input.options ?? null,
        expiresAt: input.expiresAt instanceof Date
          ? input.expiresAt
          : new Date("2026-01-01T00:15:00.000Z"),
      },
    };
  },
  db: {
    select: () => planningOrgLookupChain,
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToWorkspace: (
      orgId: string,
      message: Record<string, unknown>,
    ) => {
      state.broadcasts.push({ orgId, message });
    },
    sendToUser: () => {},
  },
}));
mock.module("../../integrations/github/services/github-service", () =>
  createGithubServiceMock({
    getInstallationAccessToken: async () => "gh-token",
  }),
);
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
  new Request("http://localhost/workers/jobs/job-1/stream", {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

const makeInteractionRequest = (body: Record<string, unknown>): Request =>
  new Request("http://localhost/workers/jobs/job-1/interactions", {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      questionType: "free_text",
      questionText: "Need a decision",
      expiresAt: "2026-08-01T12:00:00.000Z",
      ...body,
    }),
  });

describe("workersRoutes /jobs/:jobId/stream", () => {
  beforeEach(() => {
    state.broadcasts = [];
    state.createdInteractions = [];
    state.statusUpdates = [];
    state.job = {
      job: {
        id: "job-1",
        workItemId: null,
        planningSessionId: "planning-session-1",
        workspaceId: testWorkspace.id,
        workerId: null,
        config: {},
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
    };
  });

  it("broadcasts planning tool-call events for MCP tool_use envelopes", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const toolEnvelope = JSON.stringify({
      name: "mcp__almirant__create_feature",
      id: "tc-mcp-1",
      input: {
        title: "Feature from plan",
        parentId: "epic-1",
      },
    });

    const res = await app.handle(
      makeRequest({
        content: `${toolEnvelope}\n`,
        contentType: "tool_use",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.broadcasts).toHaveLength(1);
    expect(state.broadcasts[0]).toEqual({
      orgId: testWorkspace.id,
      message: {
        type: "planning:tool-call-start",
        payload: {
          sessionId: "planning-session-1",
          toolCallId: "tc-mcp-1",
          toolName: "mcp__almirant__create_feature",
          inputPreview: JSON.stringify({
            title: "Feature from plan",
            parentId: "epic-1",
          }),
        },
      },
    });
  });

  it("broadcasts subagent spawn events for Agent tool_use envelopes", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const toolEnvelope = JSON.stringify({
      name: "Agent",
      id: "subagent-1",
      input: {
        prompt: "Create the 4 tasks in parallel and then wire dependencies",
        subagent_type: "task-decomposition-expert",
        run_in_background: true,
      },
    });

    const res = await app.handle(
      makeRequest({
        content: `${toolEnvelope}\n`,
        contentType: "tool_use",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.broadcasts).toHaveLength(2);
    expect(state.broadcasts[0]).toEqual({
      orgId: testWorkspace.id,
      message: {
        type: "planning:tool-call-start",
        payload: {
          sessionId: "planning-session-1",
          toolCallId: "subagent-1",
          toolName: "Agent",
          inputPreview: JSON.stringify({
            prompt: "Create the 4 tasks in parallel and then wire dependencies",
            subagent_type: "task-decomposition-expert",
            run_in_background: true,
          }),
        },
      },
    });
    expect(state.broadcasts[1]).toEqual({
      orgId: testWorkspace.id,
      message: {
        type: "planning:subagent-spawn",
        payload: {
          sessionId: "planning-session-1",
          subagentId: "subagent-1",
          description:
            "Create the 4 tasks in parallel and then wire dependencies",
          isBackground: true,
          subagentType: "task-decomposition-expert",
        },
      },
    });
  });

  it("relays plain assistant output without creating interactions from transcript text", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        content: "I need more context from the user.\n",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.createdInteractions).toHaveLength(0);
    expect(state.broadcasts).toEqual([
      {
        orgId: testWorkspace.id,
        message: {
          type: "planning:text",
          payload: {
            sessionId: "planning-session-1",
            content: "I need more context from the user.\n",
          },
        },
      },
    ]);
  });

  it("rejects planning output from a stale claim generation", async () => {
    state.job!.job.workerId = "worker-current";
    state.job!.job.config = { claimAttemptId: "attempt-current" };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        content: "stale output\n",
        workerId: "worker-current",
        expectedClaimAttemptId: "attempt-stale",
      }),
    );

    expect(res.status).toBe(409);
    expect(state.broadcasts).toEqual([]);
  });

  it("fences interaction creation and its waiting status transition", async () => {
    state.job!.job.workerId = "worker-current";
    state.job!.job.config = { claimAttemptId: "attempt-current" };
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const stale = await app.handle(
      makeInteractionRequest({
        workerId: "worker-current",
        expectedClaimAttemptId: "attempt-stale",
      }),
    );
    const accepted = await app.handle(
      makeInteractionRequest({
        workerId: "worker-current",
        expectedClaimAttemptId: "attempt-current",
      }),
    );

    expect(stale.status).toBe(409);
    expect(accepted.status).toBe(201);
    expect(state.createdInteractions).toHaveLength(1);
    expect(state.statusUpdates).toEqual([
      {
        jobId: "job-1",
        status: "waiting_for_input",
        ownership: {
          workerId: "worker-current",
          claimAttemptId: "attempt-current",
        },
        mode: "fenced",
      },
    ]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
