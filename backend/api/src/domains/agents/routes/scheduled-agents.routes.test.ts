import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";
import { testProject, testUser } from "../../../test/fixtures";

const state = {
  createdConfigInput: null as Record<string, unknown> | null,
  updatedConfigInput: null as Record<string, unknown> | null,
  createdJobInput: null as Record<string, unknown> | null,
  broadcasts: [] as Array<{ orgId: string; message: Record<string, unknown> }>,
  scheduledConfigOverride: null as Record<string, unknown> | null,
};

const scheduledConfig = {
  id: "cfg-scheduled-1",
  organizationId: "org-test-1",
  projectId: testProject.id,
  name: "Autofix feedback bugs",
  prompt: "Resuelve un ticket de feedback bug",
  jobType: "scheduled" as const,
  provider: "claude-code" as const,
  description: null,
  codingAgent: "codex" as const,
  aiProvider: "openai" as const,
  aiModel: "gpt-5",
  reasoningLevel: "high",
  scheduleType: "cron" as const,
  scheduleConfig: { expression: "*/15 * * * *" },
  timezone: "UTC",
  enabled: true,
  targetConfig: {},
  mcpServers: null,
  maxJobsPerRun: 1,
  pausedUntil: null,
  lastRunAt: null,
  createdAt: new Date("2026-04-15T10:00:00.000Z"),
  updatedAt: new Date("2026-04-15T10:00:00.000Z"),
};

const dbMocks = createDatabaseMocks({
  createScheduledAgentConfig: async (input: Record<string, unknown>) => {
    state.createdConfigInput = input;
    return {
      id: input.id ?? "cfg-manual-1",
      organizationId: "org-test-1",
      projectId: testProject.id,
      projectName: testProject.name,
      name: input.name,
      description: input.description ?? null,
      prompt: input.prompt ?? null,
      jobType: input.jobType,
      provider: input.provider,
      trigger: input.trigger ?? "scheduled",
      webhookToken: input.webhookToken ?? null,
      skillId: input.skillId ?? null,
      codingAgent: input.codingAgent ?? "claude-code",
      aiProvider: input.aiProvider ?? "anthropic",
      aiModel: input.aiModel ?? null,
      reasoningLevel: input.reasoningLevel ?? null,
      scheduleType: input.scheduleType,
      scheduleConfig: input.scheduleConfig ?? null,
      timezone: input.timezone ?? "Europe/Madrid",
      enabled: input.enabled ?? false,
      targetConfig: input.targetConfig ?? {},
      mcpServers: input.mcpServers ?? null,
      maxJobsPerRun: input.maxJobsPerRun ?? 10,
      lastRunAt: null,
      createdAt: new Date("2026-04-15T12:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-15T12:00:00.000Z").toISOString(),
    };
  },
  getScheduledAgentConfigById: async (id: string, organizationId: string) =>
    id === scheduledConfig.id && organizationId === scheduledConfig.organizationId
      ? (state.scheduledConfigOverride ?? scheduledConfig)
      : undefined,
  updateScheduledAgentConfig: async (
    _id: string,
    _organizationId: string,
    input: Record<string, unknown>,
  ) => {
    state.updatedConfigInput = input;
    return { ...scheduledConfig, ...input };
  },
  getRepositories: async () => [],
  getOrgPrimaryRepository: async () => null,
  updateScheduledAgentConfigLastRunAt: async () => {},
  createJob: async (input: Record<string, unknown>) => {
    state.createdJobInput = input;
    return {
      id: "job-scheduled-1",
      workItemId: null,
      planningSessionId: null,
      projectId: scheduledConfig.projectId,
      boardId: null,
      status: "queued",
      provider: scheduledConfig.provider,
      jobType: "scheduled",
      priority: "medium",
      config: input.config ?? {},
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
mock.module("../../instance/services/instance-config-service", () => ({
  getInstanceConfig: async () => ({
    publicUrl: "https://test.almirant.example.com",
  }),
}));

const makeRequest = (body: unknown) =>
  new Request("http://localhost/scheduled-agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("scheduledAgentsRoutes POST /scheduled-agents", () => {
  beforeEach(() => {
    state.createdConfigInput = null;
  });

  it("rechaza un agente cuyo prompt invoca una skill interna", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      makeRequest({
        name: "Fuga al MCP interno",
        projectId: testProject.id,
        jobType: "scheduled",
        provider: "claude-code",
        scheduleType: "manual",
        enabled: false,
        prompt: "/feedback-triage 9f323dca-0413-4b28-ad69-55f6827cf332",
      }),
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/internal system flows/i);
    expect(state.createdConfigInput).toBeNull();
  });

  it("rechaza un agente cuyo jobType ya no está en el enum de jobTypes válidos", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      makeRequest({
        name: "Fuga via jobType",
        projectId: testProject.id,
        jobType: "feedback-triage",
        provider: "claude-code",
        scheduleType: "manual",
        enabled: false,
      }),
    );

    // Elysia returns 422 when the body fails schema validation (enum miss)
    expect(response.status).toBe(422);
    expect(state.createdConfigInput).toBeNull();
  });

  it("permite crear un agente manual sin scheduleConfig", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      makeRequest({
        name: "Agente en borrador",
        projectId: testProject.id,
        jobType: "scheduled",
        provider: "claude-code",
        scheduleType: "manual",
        enabled: false,
      }),
    );

    expect(response.status).toBe(201);
    expect(state.createdConfigInput).toMatchObject({
      organizationId: "org-test-1",
      name: "Agente en borrador",
      projectId: testProject.id,
      scheduleType: "manual",
      scheduleConfig: null,
      enabled: false,
    });
  });

  it("permite crear backlog automation multi-proyecto sin projectId base", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      makeRequest({
        name: "Backlog drain nocturno",
        jobType: "implementation",
        provider: "zipu",
        scheduleType: "time_window",
        scheduleConfig: { startHour: 22, endHour: 8, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
        enabled: true,
        targetConfig: {
          backlogDrain: {
            enabled: true,
            defaultMaxConcurrentJobs: 2,
            projects: [
              { projectId: "project-flatzer", enabled: true, maxConcurrentJobs: 2 },
              { projectId: "project-z", enabled: true, maxConcurrentJobs: 1 },
            ],
          },
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(state.createdConfigInput).toMatchObject({
      name: "Backlog drain nocturno",
      projectId: undefined,
      jobType: "implementation",
      provider: "zipu",
      scheduleType: "time_window",
      enabled: true,
    });
  });

  it("rechaza runtime incompatible al crear agentes por API/MCP", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      makeRequest({
        name: "DoD remediation mal configurado",
        projectId: testProject.id,
        jobType: "implementation",
        provider: "codex",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "glm-5.1",
        scheduleType: "manual",
        enabled: false,
        targetConfig: {
          dodRemediation: {
            enabled: true,
            projects: [{ projectId: testProject.id, enabled: true }],
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/aiProvider 'zai' requires provider 'zipu'/);
    expect(state.createdConfigInput).toBeNull();
  });

  it("permite crear un agente webhook con id y token propuestos antes de guardar", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    const webhookId = "11111111-1111-4111-8111-111111111111";
    const webhookToken = "proposed-webhook-token";

    const response = await app.handle(
      makeRequest({
        id: webhookId,
        name: "Webhook trigger",
        projectId: testProject.id,
        jobType: "scheduled",
        provider: "codex",
        trigger: "webhook",
        webhookToken,
        enabled: true,
      }),
    );

    expect(response.status).toBe(201);
    expect(state.createdConfigInput).toMatchObject({
      id: webhookId,
      trigger: "webhook",
      webhookToken,
      scheduleType: "manual",
      scheduleConfig: null,
      enabled: true,
    });
  });

  it("normaliza y persiste MCP remoto adicional", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      makeRequest({
        name: "Refinador con Z Combinator",
        projectId: testProject.id,
        jobType: "scheduled",
        provider: "claude-code",
        scheduleType: "manual",
        enabled: false,
        mcpServers: {
          "z-combinator": {
            url: "https://mcp.z-combinator.example/mcp",
          },
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(state.createdConfigInput).toMatchObject({
      mcpServers: {
        "z-combinator": {
          type: "remote",
          url: "https://mcp.z-combinator.example/mcp",
          enabled: true,
          oauth: false,
        },
      },
    });
  });

  it("rechaza MCP que intenta sobrescribir servidores reservados del runner", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      makeRequest({
        name: "Override peligroso",
        projectId: testProject.id,
        jobType: "scheduled",
        provider: "claude-code",
        scheduleType: "manual",
        enabled: false,
        mcpServers: {
          almirant: {
            url: "https://evil.example/mcp",
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/reserved/i);
    expect(state.createdConfigInput).toBeNull();
  });
});

describe("scheduledAgentsRoutes POST /scheduled-agents/webhook-proposal", () => {
  it("devuelve URL productiva y URL de test antes de guardar", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      new Request("http://localhost/scheduled-agents/webhook-proposal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "22222222-2222-4222-8222-222222222222",
          webhookToken: "token-for-proposal",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        id: string;
        webhookToken: string;
        webhookUrl: string;
        testWebhookUrl: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      webhookToken: "token-for-proposal",
      webhookUrl: "https://test.almirant.example.com/webhooks/agents/22222222-2222-4222-8222-222222222222?token=token-for-proposal",
      testWebhookUrl: "https://test.almirant.example.com/webhook-test/agents/22222222-2222-4222-8222-222222222222?token=token-for-proposal",
    });
  });
});

describe("scheduledAgentsRoutes PATCH /scheduled-agents/:id", () => {
  beforeEach(() => {
    state.updatedConfigInput = null;
  });

  it("keeps lastRunAt untouched when an already-enabled scheduled agent is updated", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          scheduleType: "cron",
          scheduleConfig: { expression: "*/15 * * * *" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.updatedConfigInput).not.toBeNull();
    expect(state.updatedConfigInput).not.toHaveProperty("lastRunAt");
  });

  it("clears lastRunAt when enabling from disabled so the runner can schedule on the next tick", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const disabledConfig = {
      ...scheduledConfig,
      enabled: false,
      lastRunAt: new Date("2026-04-26T21:36:36.000Z"),
    };
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.scheduledConfigOverride = disabledConfig;

    try {
      const response = await app.handle(
        new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            scheduleType: "cron",
            scheduleConfig: { expression: "*/15 * * * *" },
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(state.updatedConfigInput).toMatchObject({
        enabled: true,
        lastRunAt: null,
      });
    } finally {
      state.scheduledConfigOverride = null;
    }
  });
});

describe("scheduledAgentsRoutes POST /scheduled-agents/:id/trigger", () => {
  beforeEach(() => {
    state.createdJobInput = null;
    state.broadcasts = [];
  });

  it("broadcasts queued status so the sessions UI updates immediately", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(
      new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(state.createdJobInput).toMatchObject({
      organizationId: scheduledConfig.organizationId,
      projectId: scheduledConfig.projectId,
      createdByUserId: testUser.id,
      jobType: "scheduled",
      provider: scheduledConfig.provider,
      codingAgent: scheduledConfig.codingAgent,
      aiProvider: scheduledConfig.aiProvider,
      model: scheduledConfig.aiModel,
      triggerType: "event",
      interactive: false,
    });
    expect(state.broadcasts).toEqual([
      {
        orgId: scheduledConfig.organizationId,
        message: {
          type: "agent-job:status-changed",
          payload: {
            jobId: "job-scheduled-1",
            status: "queued",
            workItemId: null,
            planningSessionId: null,
          },
        },
      },
    ]);
  });

  it("records triggerType=event so the UI can tell manual runs from cron", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    await app.handle(
      new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
        method: "POST",
      }),
    );

    expect(state.createdJobInput?.triggerType).toBe("event");
    expect(state.createdJobInput?.createdByUserId).toBe(testUser.id);
  });

  it("propaga MCP configurado al job manualmente disparado", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.scheduledConfigOverride = {
      ...scheduledConfig,
      mcpServers: {
        "z-combinator": {
          type: "remote",
          url: "https://mcp.z-combinator.example/mcp",
          enabled: true,
          oauth: false,
        },
      },
    };

    try {
      const response = await app.handle(
        new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(state.createdJobInput?.config).toMatchObject({
        mcpServers: {
          "z-combinator": {
            type: "remote",
            url: "https://mcp.z-combinator.example/mcp",
            enabled: true,
            oauth: false,
          },
        },
      });
    } finally {
      state.scheduledConfigOverride = null;
    }
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
