import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const state = {
  expiredInteractions: [] as Array<{
    id: string;
    agentJobId: string;
    workItemId: string | null;
    questionText: string;
    timeoutAction: string | null;
    defaultAnswer: string | null;
  }>,
  currentJob: {
    job: {
      id: "job-1",
      organizationId: "org-1",
      workItemId: null,
      planningSessionId: "planning-1",
      status: "waiting_for_input",
      startedAt: new Date("2026-04-14T18:00:00.000Z"),
      completedAt: null,
    },
  } as {
    job: {
      id: string;
      organizationId: string | null;
      workItemId: string | null;
      planningSessionId: string | null;
      status: string;
      startedAt: Date | null;
      completedAt: Date | null;
    };
  },
  updateCalls: [] as Array<{ jobId: string; status: string; data?: Record<string, unknown> }>,
  cancelledJobs: [] as string[],
  broadcasts: [] as Array<{ orgId: string; message: Record<string, unknown> }>,
};

mock.module("@almirant/database", () => ({
  expireInteractions: async () => state.expiredInteractions,
  updateJobStatus: async (
    jobId: string,
    status: string,
    data?: Record<string, unknown>,
  ) => {
    state.updateCalls.push({ jobId, status, data });
    state.currentJob = {
      job: {
        ...state.currentJob.job,
        id: jobId,
        status,
        completedAt:
          status === "completed" || status === "cancelled"
            ? new Date("2026-04-14T18:30:00.000Z")
            : null,
      },
    };
    return {
      id: jobId,
      status,
      workItemId: state.currentJob.job.workItemId,
    };
  },
  getJobById: async () => state.currentJob,
  cancelInteractionsByJobId: async (jobId: string) => {
    state.cancelledJobs.push(jobId);
  },
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
  },
  workItems: {},
  projects: {},
  eq: (..._args: unknown[]) => ({}),
}));

mock.module("../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToOrganization: (orgId: string, message: Record<string, unknown>) => {
      state.broadcasts.push({ orgId, message });
    },
  },
}));

mock.module("@almirant/config", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

describe("interaction-timeout-sweeper", () => {
  beforeEach(() => {
    state.expiredInteractions = [];
    state.currentJob = {
      job: {
        id: "job-1",
        organizationId: "org-1",
        workItemId: null,
        planningSessionId: "planning-1",
        status: "waiting_for_input",
        startedAt: new Date("2026-04-14T18:00:00.000Z"),
        completedAt: null,
      },
    };
    state.updateCalls = [];
    state.cancelledJobs = [];
    state.broadcasts = [];
  });

  it("no reanuda jobs de planning esperando respuesta cuando expira la interaccion", async () => {
    state.expiredInteractions = [
      {
        id: "interaction-1",
        agentJobId: "job-1",
        workItemId: null,
        questionText: "[INTERRUPT] User requested pause",
        timeoutAction: "use_default",
        defaultAnswer: "Continue as before",
      },
    ];

    const { runInteractionTimeoutOnce } = await import("./interaction-timeout-sweeper");
    await runInteractionTimeoutOnce();

    expect(state.updateCalls).toHaveLength(0);
    expect(state.broadcasts).toHaveLength(1);
    expect(state.broadcasts[0]).toMatchObject({
      orgId: "org-1",
      message: {
        type: "worker-interaction:expired",
        payload: {
          interactionId: "interaction-1",
          jobId: "job-1",
        },
      },
    });
  });

  it("sigue reanudando jobs no planning cuando timeoutAction es use_default", async () => {
    state.currentJob = {
      job: {
        id: "job-2",
        organizationId: "org-2",
        workItemId: "work-item-1",
        planningSessionId: null,
        status: "waiting_for_input",
        startedAt: new Date("2026-04-14T18:00:00.000Z"),
        completedAt: null,
      },
    };
    state.expiredInteractions = [
      {
        id: "interaction-2",
        agentJobId: "job-2",
        workItemId: "work-item-1",
        questionText: "Need approval",
        timeoutAction: "use_default",
        defaultAnswer: "Ship it",
      },
    ];

    const { runInteractionTimeoutOnce } = await import("./interaction-timeout-sweeper");
    await runInteractionTimeoutOnce();

    expect(state.updateCalls).toEqual([
      {
        jobId: "job-2",
        status: "running",
        data: undefined,
      },
    ]);
    expect(state.broadcasts.at(-1)).toMatchObject({
      orgId: "org-2",
      message: {
        type: "agent-job:status-changed",
        payload: {
          jobId: "job-2",
          status: "running",
          workItemId: "work-item-1",
        },
      },
    });
  });
});

afterAll(() => {
  mock.restore();
});
