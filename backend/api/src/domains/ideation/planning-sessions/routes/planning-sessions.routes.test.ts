import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  createLoggerMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import { testWorkspace, testUser } from "../../../../test/fixtures";

// -------------------------------------------------------
// Fixtures
// -------------------------------------------------------

const testPlanningSession = {
  id: "ps-test-1",
  workspaceId: testWorkspace.id,
  projectId: "proj-test-1",
  boardId: "board-test-1",
  title: "Test planning session",
  status: "active",
  config: null,
  result: null,
  createdByUserId: testUser.id,
  totalInputTokens: null,
  totalOutputTokens: null,
  estimatedCost: null,
  durationMs: null,
  completedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  createdByUserName: testUser.name,
  createdByUserImage: null,
  projectName: "Test Project",
  boardName: "Test Board",
  messageCount: 0,
  seedCount: 0,
  workItemCount: 0,
};

const testSessionEvents = [
  {
    id: "event-test-1",
    agentJobId: "job-test-1",
    planningSessionId: testPlanningSession.id,
    sequenceNum: 1,
    kind: "agent.text",
    payload: { content: "hello world" },
    provider: "codex",
    createdAt: new Date("2026-01-01"),
  },
];

let currentPendingInteraction: {
  id: string;
  agentJobId: string;
  workItemId: string | null;
  questionType: string;
  questionText: string;
  questionContext: Record<string, unknown> | null;
  options: string[] | null;
  expiresAt: Date;
  timeoutAction: string | null;
} | null = null;

// -------------------------------------------------------
// Module mocks - MUST be at top level before any dynamic imports
// -------------------------------------------------------

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getPlanningSessions: async () => ({
      items: [testPlanningSession],
      total: 1,
    }),
    getPlanningSessionById: async (id: string) =>
      id === testPlanningSession.id ? testPlanningSession : null,
    createPlanningSession: async (
      _orgId: string,
      input: Record<string, unknown>
    ) => ({
      ...testPlanningSession,
      id: "ps-new-1",
      title: (input.title as string) ?? testPlanningSession.title,
    }),
    updatePlanningSession: async (id: string, input: Record<string, unknown>) =>
      id === testPlanningSession.id
        ? { ...testPlanningSession, ...input }
        : null,
    getActiveSessionForUser: async () => null,
    getRepositories: async () => [{ id: "repo-1", name: "test-repo" }],
    getSessionEventsBySessionId: async (sessionId: string) =>
      sessionId === testPlanningSession.id ? testSessionEvents : [],
    getMessages: async () => [],
    addMessage: async () => ({
      id: "msg-1",
      sessionId: testPlanningSession.id,
      role: "user",
      content: "Hello",
      messageType: null,
      inputTokens: null,
      outputTokens: null,
      metadata: {},
      createdAt: new Date("2026-01-01"),
    }),
    getPendingInteractionForSession: async (sessionId: string) =>
      sessionId === testPlanningSession.id ? currentPendingInteraction : null,
  })
);
mock.module("../shared/services/response", () => createResponseMocks());
mock.module("../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("@almirant/config", () => createLoggerMock());
mock.module("../../../integrations/discord/services/discord-thread", () => ({
  isDiscordBridgeConfigured: () => false,
  createDiscordThread: async () => null,
  renameDiscordThread: async () => {},
}));

// -------------------------------------------------------
// Test helpers
// -------------------------------------------------------

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { planningSessionsRoutes } = await import("./planning-sessions.routes");
  return new Elysia().use(withTestOrg).use(planningSessionsRoutes);
};

const req = (path: string, init?: RequestInit) =>
  new Request(`http://localhost${path}`, init);

const json = (data: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("planning-sessions.routes", () => {
  describe("GET /planning-sessions", () => {
    it("returns a list of planning sessions", async () => {
      const app = await makeApp();
      const res = await app.handle(req("/planning-sessions"));

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: typeof testPlanningSession[];
        meta: { total: number };
      };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      const firstSession = body.data[0]!;
      expect(firstSession.id).toBe(testPlanningSession.id);
      expect(firstSession.title).toBe(testPlanningSession.title);
      expect(body.meta.total).toBe(1);
    });
  });

  describe("GET /planning-sessions/:id", () => {
    it("returns the session when found", async () => {
      const app = await makeApp();
      const res = await app.handle(req(`/planning-sessions/${testPlanningSession.id}`));

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: typeof testPlanningSession;
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testPlanningSession.id);
    });

    it("includes pending interaction options for active sessions", async () => {
      currentPendingInteraction = {
        id: "interaction-test-1",
        agentJobId: "job-test-1",
        workItemId: null,
        questionType: "approval",
        questionText: "¿Qué propuesta quieres aprobar?",
        questionContext: { source: "agent_question" },
        options: ["Propuesta A", "Propuesta B"],
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
        timeoutAction: null,
      };

      const app = await makeApp();
      const res = await app.handle(req(`/planning-sessions/${testPlanningSession.id}`));

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: typeof testPlanningSession & {
          pendingInteraction?: {
            id: string;
            questionType: string;
            questionText: string;
            questionContext: Record<string, unknown> | null;
            options: string[] | null;
            expiresAt: string;
            timeoutAction: string | null;
          } | null;
        };
      };

      expect(body.success).toBe(true);
      expect(body.data.pendingInteraction).toEqual({
        id: "interaction-test-1",
        questionType: "approval",
        questionText: "¿Qué propuesta quieres aprobar?",
        questionContext: { source: "agent_question" },
        options: ["Propuesta A", "Propuesta B"],
        expiresAt: "2026-01-02T00:00:00.000Z",
        timeoutAction: null,
      });

      currentPendingInteraction = null;
    });

    it("returns 404 when session is not found", async () => {
      const app = await makeApp();
      const res = await app.handle(req("/planning-sessions/nonexistent-id"));

      expect(res.status).toBe(404);
    });
  });

  describe("GET /planning-sessions/:id/session-events", () => {
    it("returns canonical session events for the planning session", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/planning-sessions/${testPlanningSession.id}/session-events`)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: typeof testSessionEvents;
      };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.planningSessionId).toBe(testPlanningSession.id);
      expect(body.data[0]?.kind).toBe("agent.text");
    });
  });

  describe("POST /planning-sessions", () => {
    it("creates a new session and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          "/planning-sessions",
          json({ title: "New session", projectId: "proj-test-1" })
        )
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        success: boolean;
        data: { id: string; title: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("New session");
    });
  });

  describe("PATCH /planning-sessions/:id", () => {
    it("updates the session title", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/planning-sessions/${testPlanningSession.id}`,
          json({ title: "Updated title" }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { title: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Updated title");
    });

    it("returns 404 when session is not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req("/planning-sessions/nonexistent-id", json({ title: "X" }, "PATCH"))
      );

      expect(res.status).toBe(404);
    });
  });

});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
