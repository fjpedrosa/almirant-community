import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
} from "../../../test/mocks";
import { testProject } from "../../../test/fixtures";

const state = {
  createdJobInput: null as Record<string, unknown> | null,
  broadcasts: [] as Array<{ orgId: string; message: Record<string, unknown> }>,
  lastRunAtUpdates: [] as string[],
};

const webhookAgent = {
  id: "agent-webhook-1",
  organizationId: "org-test-1",
  projectId: testProject.id,
  name: "Webhook fixer",
  prompt: "Fix any bugs you find in the repo.",
  jobType: "scheduled" as const,
  provider: "claude-code" as const,
  description: null,
  codingAgent: "claude-code" as const,
  aiProvider: "anthropic" as const,
  aiModel: "claude-sonnet-4-5",
  reasoningLevel: null,
  trigger: "webhook" as const,
  webhookToken: "valid-token-xyz",
  skillId: null,
  scheduleType: "manual" as const,
  scheduleConfig: null,
  timezone: "Europe/Madrid",
  enabled: false,
  targetConfig: {},
  maxJobsPerRun: 1,
  pausedUntil: null,
  lastRunAt: null,
  createdAt: new Date("2026-04-15T10:00:00.000Z"),
  updatedAt: new Date("2026-04-15T10:00:00.000Z"),
  skillName: null,
};

const dbMocks = createDatabaseMocks({
  getScheduledAgentConfigByIdAndToken: async (id: string, token: string) =>
    id === webhookAgent.id && token === webhookAgent.webhookToken ? webhookAgent : undefined,
  getRepositories: async () => [],
  getOrgPrimaryRepository: async () => null,
  updateScheduledAgentConfigLastRunAt: async (id: string) => {
    state.lastRunAtUpdates.push(id);
  },
  createJob: async (input: Record<string, unknown>) => {
    state.createdJobInput = input;
    return {
      id: "job-from-webhook-1",
      workItemId: null,
      planningSessionId: null,
      projectId: webhookAgent.projectId,
      boardId: null,
      status: "queued",
      provider: webhookAgent.provider,
      jobType: "scheduled",
      priority: "medium",
      config: input.config ?? {},
      prompt: input.prompt ?? null,
    };
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToOrganization: (orgId: string, message: Record<string, unknown>) => {
      state.broadcasts.push({ orgId, message });
    },
    sendToUser: () => {},
  },
}));

const buildApp = async () => {
  const { agentWebhooksRoutes } = await import("./agent-webhooks.routes");
  return new Elysia().use(agentWebhooksRoutes);
};

const buildPostRequest = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("agentWebhooksRoutes", () => {
  beforeEach(() => {
    state.createdJobInput = null;
    state.broadcasts = [];
    state.lastRunAtUpdates = [];
  });

  it("GET sin token devuelve 422 (validación de query)", async () => {
    const app = await buildApp();
    const response = await app.handle(
      new Request(`http://localhost/webhooks/agents/${webhookAgent.id}`),
    );
    expect(response.status).toBe(422);
    expect(state.createdJobInput).toBeNull();
  });

  it("GET con token inválido devuelve 401", async () => {
    const app = await buildApp();
    const response = await app.handle(
      new Request(`http://localhost/webhooks/agents/${webhookAgent.id}?token=wrong`),
    );
    expect(response.status).toBe(401);
    expect(state.createdJobInput).toBeNull();
  });

  it("POST al webhook de test responde sin encolar aunque el agente todavía no exista", async () => {
    const app = await buildApp();
    const response = await app.handle(
      buildPostRequest(
        "/webhook-test/agents/proposed-agent-id?token=proposed-token",
        {},
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { received: boolean; mode: string; saved: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      received: true,
      mode: "test",
      saved: false,
    });
    expect(state.createdJobInput).toBeNull();
  });

  it("GET con token válido encola un job con el system prompt del agente", async () => {
    const app = await buildApp();
    const response = await app.handle(
      new Request(
        `http://localhost/webhooks/agents/${webhookAgent.id}?token=${webhookAgent.webhookToken}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(state.createdJobInput).not.toBeNull();
    const job = state.createdJobInput as Record<string, unknown>;
    expect(job.prompt).toBe(webhookAgent.prompt);
    expect((job.config as Record<string, unknown>).source).toBe("webhook");
    expect(state.lastRunAtUpdates).toEqual([webhookAgent.id]);
    expect(state.broadcasts.length).toBe(1);
  });

  it("POST con prompt concatena al system prompt como user input", async () => {
    const app = await buildApp();
    const response = await app.handle(
      buildPostRequest(
        `/webhooks/agents/${webhookAgent.id}?token=${webhookAgent.webhookToken}`,
        { prompt: "Specifically check authentication.ts" },
      ),
    );
    expect(response.status).toBe(200);
    const job = state.createdJobInput as Record<string, unknown>;
    expect(job.prompt).toContain(webhookAgent.prompt);
    expect(job.prompt).toContain("# User input");
    expect(job.prompt).toContain("Specifically check authentication.ts");
  });

  it("POST sin body usa solo el system prompt", async () => {
    const app = await buildApp();
    const response = await app.handle(
      buildPostRequest(
        `/webhooks/agents/${webhookAgent.id}?token=${webhookAgent.webhookToken}`,
        {},
      ),
    );
    expect(response.status).toBe(200);
    const job = state.createdJobInput as Record<string, unknown>;
    expect(job.prompt).toBe(webhookAgent.prompt);
  });
});
