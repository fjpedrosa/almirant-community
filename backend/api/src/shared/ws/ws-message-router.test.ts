import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { WsServerMessage } from "./ws-types";
import {
  createAiServiceMock,
  createDatabaseMocks,
  createLoggerMock,
  createWsMock,
  restoreRealModules,
} from "../../test/mocks";

const state = {
  session: {
    id: "session-1",
    projectId: "project-1",
    boardId: "board-1",
    status: "active",
  } as {
    id: string;
    projectId: string | null;
    boardId: string | null;
    status: string;
  } | null,
  createJobInput: null as Record<string, unknown> | null,
  activeJob: {
    id: "job-1",
    status: "waiting_for_input",
    workerId: "worker-1",
    workItemId: null,
    planningSessionId: "session-1",
  } as
    | {
        id: string;
        status: string;
        workerId: string | null;
        workItemId: string | null;
        planningSessionId: string | null;
      }
    | null,
  workerStatus: "online" as "online" | "offline",
  pendingInteraction: {
    id: "interaction-1",
    workItemId: null,
    questionType: "approval",
  } as { id: string; workItemId: string | null; questionType: string } | null,
  respondCalls: [] as Array<{
    interactionId: string;
    answer: string;
    userId: string;
    metadata: Record<string, unknown> | null;
  }>,
  persistedInputs: [] as Array<{
    jobId: string;
    orgId: string;
    message: string;
    metadata: Record<string, unknown> | null;
  }>,
  convertPrewarmCall: null as
    | {
        jobId: string;
        config: Record<string, unknown>;
        overrides: Record<string, unknown> | undefined;
      }
    | null,
  prewarmJob: null as Record<string, unknown> | null,
  updateStatusCalls: [] as Array<{ jobId: string; status: string }>,
  broadcastCalls: [] as Array<{ organizationId: string; message: Record<string, unknown> }>,
};

const dbMocks = createDatabaseMocks({
  saveGeneratedPrompt: async () => true,
  getPlanningSessionById: async () => state.session,
  addMessage: async () => ({}),
  getMessages: async () => [],
  createJob: async (input: Record<string, unknown>) => {
    state.createJobInput = input;
    return {
      id: "job-created-1",
      status: "queued",
      workItemId: null,
      planningSessionId: input.planningSessionId ?? null,
    };
  },
  getActiveJobForPlanningSession: async () => state.activeJob,
  getJobById: async (jobId: string) => ({
    job: {
      id: jobId,
      status: state.activeJob?.status ?? "waiting_for_input",
      workerId: state.activeJob?.workerId ?? null,
      workItemId: state.activeJob?.workItemId ?? null,
      planningSessionId: state.activeJob?.planningSessionId ?? null,
    },
    workItem: null,
    project: null,
    board: null,
    planningSession: null,
    createdByUser: null,
  }),
  getLatestJobForPlanningSession: async () => null,
  getConversationHistoryFromLogs: async () => [],
  getUserById: async () => ({
    id: "user-1",
    locale: "en",
  }),
  getWorkerById: async () => ({
    workerId: state.activeJob?.workerId ?? "worker-1",
    status: state.workerStatus,
  }),
  getPrewarmJobForSession: async () => state.prewarmJob,
  convertPrewarmToPlanning: async (
    jobId: string,
    config: Record<string, unknown>,
    overrides?: Record<string, unknown>,
  ) => {
    state.convertPrewarmCall = { jobId, config, overrides };
    return {
      id: jobId,
      status: "queued",
      workItemId: null,
      planningSessionId: "session-1",
    };
  },
  getInteractionById: async () => null,
  getPendingInteractionForJob: async () => state.pendingInteraction,
  respondToInteraction: async (
    interactionId: string,
    answer: string,
    userId: string,
    metadata?: Record<string, unknown> | null,
  ) => {
    state.respondCalls.push({
      interactionId,
      answer,
      userId,
      metadata: metadata ?? null,
    });
    if (!state.pendingInteraction) return null;
    return {
      id: interactionId,
      workItemId: state.pendingInteraction.workItemId,
    };
  },
  updateJobStatus: async (jobId: string, status: string) => {
    state.updateStatusCalls.push({ jobId, status });
    return {
      id: jobId,
      status,
      workItemId: null,
      planningSessionId: "session-1",
    };
  },
  cancelJob: async () => null,
  cancelInteractionsByJobId: async () => [],
  createSequentialAgentJobLog: async (
    entry: Record<string, unknown>,
  ) => {
    state.persistedInputs.push({
      jobId: String(entry.jobId),
      orgId: String(entry.orgId),
      message: String(entry.message),
      metadata:
        entry.payload && typeof entry.payload === "object"
          ? (entry.payload as Record<string, unknown>)
          : null,
    });
    return {
      id: "log-1",
      jobId: entry.jobId,
      seq: 1,
    };
  },
});
mock.module("@almirant/database", () => dbMocks);

const aiServiceMocks = createAiServiceMock();
mock.module("../../domains/ai/shared/services/ai-service", () => ({
  ...aiServiceMocks,
  formatText: async () => "formatted",
  isAiConfigured: () => true,
}));

mock.module("@almirant/config", () => createLoggerMock());

const wsMocks = createWsMock();
mock.module("./ws-connection-manager", () => ({
  wsConnectionManager: {
    ...wsMocks.wsConnectionManager,
    broadcastToOrganization: (organizationId: string, message: Record<string, unknown>) => {
      state.broadcastCalls.push({ organizationId, message });
    },
  },
}));

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("ws-message-router planning flow", () => {
  beforeEach(() => {
    state.session = {
      id: "session-1",
      projectId: "project-1",
      boardId: "board-1",
      status: "active",
    };
    state.createJobInput = null;
    state.persistedInputs = [];
    state.convertPrewarmCall = null;
    state.prewarmJob = null;
    state.activeJob = {
      id: "job-1",
      status: "waiting_for_input",
      workerId: "worker-1",
      workItemId: null,
      planningSessionId: "session-1",
    };
    state.workerStatus = "online";
    state.pendingInteraction = {
      id: "interaction-1",
      workItemId: null,
      questionType: "approval",
    };
    state.respondCalls = [];
    state.updateStatusCalls = [];
    state.broadcastCalls = [];
  });

  it("creates planning jobs with ideate skill metadata on planning:start", async () => {
    const { routeMessage } = await import("./ws-message-router");

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:start",
        payload: {
          sessionId: "session-1",
          userMessage: "Planifica esta feature",
          seedIds: ["seed-1"],
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.createJobInput).not.toBeNull();
    expect(state.createJobInput?.jobType).toBe("planning");
    expect(state.createJobInput?.planningSessionId).toBe("session-1");
    expect(state.createJobInput?.promptTemplate).toBe("ideate");
    expect(state.createJobInput?.triggerType).toBe("event");
    expect(state.createJobInput?.interactive).toBe(true);
    expect(state.createJobInput?.config).toMatchObject({
      skillName: "ideate",
      sessionMode: "planning",
      source: "websocket",
      locale: "en",
      requestedByUserId: "user-1",
      planningSessionId: "session-1",
      workspaceIntent: "read-only",
      postSessionPushPolicy: "never",
    });
    expect(state.persistedInputs).toContainEqual({
      jobId: "job-created-1",
      orgId: "org-1",
      message: "Planifica esta feature",
      metadata: {},
    });

    expect(
      sentMessages.some((m) => m.type === "planning:step"),
    ).toBe(true);
  });

  it("usa refine cuando el prompt de planning referencia una epica existente", async () => {
    const { routeMessage } = await import("./ws-message-router");

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:start",
        payload: {
          sessionId: "session-1",
          userMessage: "Tengo una duda sobre la implementacion de la epica A-E-52 y sus dependencias",
          seedIds: [],
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.createJobInput).not.toBeNull();
    expect(state.createJobInput?.promptTemplate).toBe("refine");
    expect(state.createJobInput?.skillName).toBe("refine");
    expect(state.createJobInput?.config).toMatchObject({
      skillName: "refine",
      userMessage: "Tengo una duda sobre la implementacion de la epica A-E-52 y sus dependencias",
    });
    expect(
      sentMessages.some((m) => m.type === "planning:step"),
    ).toBe(true);
  });

  it("forwards planning:prompt to the matching pending interaction when questionId is provided", async () => {
    const { routeMessage } = await import("./ws-message-router");

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:prompt",
        payload: {
          sessionId: "session-1",
          prompt: "Incluye riesgos y dependencias",
          questionId: "interaction-1",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.respondCalls).toHaveLength(1);
    expect(state.persistedInputs).toContainEqual({
      jobId: "job-1",
      orgId: "org-1",
      message: "Incluye riesgos y dependencias",
      metadata: { source: "planning:prompt" },
    });
    expect(state.respondCalls[0]).toEqual({
      interactionId: "interaction-1",
      answer: "Incluye riesgos y dependencias",
      userId: "user-1",
      metadata: { source: "planning:prompt" },
    });
    expect(state.updateStatusCalls).toContainEqual({
      jobId: "job-1",
      status: "running",
    });
    expect(
      sentMessages.some((m) => m.type === "planning:error"),
    ).toBe(false);
  });

  it("acepta questionId sintéticos del bridge web para aprobaciones pendientes", async () => {
    const { routeMessage } = await import("./ws-message-router");

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:prompt",
        payload: {
          sessionId: "session-1",
          prompt: "Sí, sigue con ese enfoque",
          questionId: "question-5",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.respondCalls).toHaveLength(1);
    expect(state.respondCalls[0]).toEqual({
      interactionId: "interaction-1",
      answer: "Sí, sigue con ese enfoque",
      userId: "user-1",
      metadata: { source: "planning:prompt" },
    });
    expect(state.updateStatusCalls).toContainEqual({
      jobId: "job-1",
      status: "running",
    });
    expect(
      sentMessages.some((m) => m.type === "planning:error"),
    ).toBe(false);
  });

  it("does not treat a generic prompt as an approval response", async () => {
    const { routeMessage } = await import("./ws-message-router");

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:prompt",
        payload: {
          sessionId: "session-1",
          prompt: "Sigue con el siguiente paso",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.respondCalls).toHaveLength(0);
    expect(state.persistedInputs).toHaveLength(0);
    expect(state.updateStatusCalls).toHaveLength(0);
    expect(sentMessages).toContainEqual({
      type: "planning:error",
      payload: {
        sessionId: "session-1",
        message: "Hay una aprobación pendiente. Respóndela explícitamente antes de enviar otro mensaje.",
        code: "PROMPT_PENDING_APPROVAL",
      },
    });
  });

  it("still allows free_text follow-ups without questionId", async () => {
    const { routeMessage } = await import("./ws-message-router");

    state.pendingInteraction = {
      id: "interaction-1",
      workItemId: null,
      questionType: "free_text",
    };

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:prompt",
        payload: {
          sessionId: "session-1",
          prompt: "Quiero priorizar por impacto y esfuerzo",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.respondCalls).toHaveLength(1);
    expect(state.respondCalls[0]).toEqual({
      interactionId: "interaction-1",
      answer: "Quiero priorizar por impacto y esfuerzo",
      userId: "user-1",
      metadata: { source: "planning:prompt" },
    });
    expect(
      sentMessages.some((m) => m.type === "planning:error"),
    ).toBe(false);
  });

  it("reencola la sesión si la respuesta llega y el worker ya no está disponible", async () => {
    const { routeMessage } = await import("./ws-message-router");

    state.pendingInteraction = {
      id: "interaction-1",
      workItemId: null,
      questionType: "free_text",
    };
    state.workerStatus = "offline";

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:prompt",
        payload: {
          sessionId: "session-1",
          prompt: "Sigue con el siguiente paso",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.respondCalls).toHaveLength(1);
    expect(state.updateStatusCalls).toContainEqual({
      jobId: "job-1",
      status: "queued",
    });
    expect(
      sentMessages.some((m) => m.type === "planning:error"),
    ).toBe(false);
  });

  it("converts prewarm jobs into interactive planning jobs", async () => {
    const { routeMessage } = await import("./ws-message-router");

    state.prewarmJob = {
      id: "prewarm-1",
      config: {
        repoPath: ".",
        baseBranch: "main",
        planningSessionId: "session-1",
        requestedByUserId: "user-1",
        isPrewarm: true,
      },
    };

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:start",
        payload: {
          sessionId: "session-1",
          userMessage: "Planifica con este seed",
          seedIds: ["seed-1"],
          provider: "codex",
          codingAgent: "codex",
          model: "gpt-5.4",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.convertPrewarmCall).not.toBeNull();
    expect(state.convertPrewarmCall).toMatchObject({
      jobId: "prewarm-1",
      config: {
        skillName: "ideate",
        sessionMode: "planning",
        source: "websocket",
        locale: "en",
        seedIds: ["seed-1"],
        userMessage: "Planifica con este seed",
        isPrewarm: false,
        workspaceIntent: "read-only",
        postSessionPushPolicy: "never",
      },
      overrides: {
        provider: "codex",
        codingAgent: "codex",
        model: "gpt-5.4",
        aiProvider: "openai",
        skillName: "ideate",
        promptTemplate: "ideate",
        triggerType: "event",
        interactive: true,
      },
    });
    expect(state.persistedInputs).toContainEqual({
      jobId: "prewarm-1",
      orgId: "org-1",
      message: "Planifica con este seed",
      metadata: {},
    });
    expect(
      sentMessages.some((m) => m.type === "planning:prompt-ack"),
    ).toBe(true);
  });

  it("restarts planning with a new job when no active job exists", async () => {
    const { routeMessage } = await import("./ws-message-router");

    state.activeJob = null;

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:prompt",
        payload: {
          sessionId: "session-1",
          prompt: "Continua el ideate con criterios de priorizacion",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.createJobInput).not.toBeNull();
    expect(state.createJobInput?.jobType).toBe("planning");
    expect(state.createJobInput?.planningSessionId).toBe("session-1");
    expect(state.createJobInput?.interactive).toBe(true);
    expect(state.createJobInput?.config).toMatchObject({
      skillName: "ideate",
      planningSessionId: "session-1",
      locale: "en",
      userMessage: "Continua el ideate con criterios de priorizacion",
      workspaceIntent: "read-only",
      postSessionPushPolicy: "never",
    });
    expect(state.persistedInputs).toContainEqual({
      jobId: "job-created-1",
      orgId: "org-1",
      message: "Continua el ideate con criterios de priorizacion",
      metadata: { source: "planning:prompt" },
    });
    expect(
      sentMessages.some((m) => m.type === "planning:step"),
    ).toBe(true);
    expect(
      sentMessages.some((m) => m.type === "planning:error"),
    ).toBe(false);
  });

  it("creates prewarm jobs as read-only sessions with push disabled", async () => {
    const { routeMessage } = await import("./ws-message-router");

    state.activeJob = null;
    state.prewarmJob = null;

    const sentMessages: WsServerMessage[] = [];
    routeMessage(
      "user-1",
      "org-1",
      {
        type: "planning:prewarm",
        payload: {
          sessionId: "session-1",
        },
      },
      (msg) => sentMessages.push(msg),
    );

    await flushMicrotasks();

    expect(state.createJobInput).not.toBeNull();
    expect(state.createJobInput?.jobType).toBe("prewarm");
    expect(state.createJobInput?.skillName).toBe("ideate");
    expect(state.createJobInput?.promptTemplate).toBe("ideate");
    expect(state.createJobInput?.triggerType).toBe("event");
    expect(state.createJobInput?.interactive).toBe(false);
    expect(state.createJobInput?.config).toMatchObject({
      planningSessionId: "session-1",
      isPrewarm: true,
      workspaceIntent: "read-only",
      postSessionPushPolicy: "never",
    });
    expect(
      sentMessages.some((m) => m.type === "planning:prewarm-ready"),
    ).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
