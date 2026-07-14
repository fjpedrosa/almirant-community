import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";
import { testProject, testUser } from "../../../test/fixtures";

const __realInstanceConfigService = {
  ...(await import("../../instance/services/instance-config-service")),
};

const state = {
  createdConfigInput: null as Record<string, unknown> | null,
  updatedConfigInput: null as Record<string, unknown> | null,
  createdJobInput: null as Record<string, unknown> | null,
  broadcasts: [] as Array<{ orgId: string; message: Record<string, unknown> }>,
  scheduledConfigOverride: null as Record<string, unknown> | null,
  activeConnectionsOverride: null as Array<{ config: Record<string, unknown> }> | null,
  projectAiConfigOverride: null as { defaultProvider: string | null; agentDefaults: unknown } | null,
  projectAiConfigCalls: [] as string[],
  orgPrimaryRepositoryOverride: null as {
    id: string;
    url: string;
    projectId: string;
  } | null,
};

const scheduledConfig = {
  id: "cfg-scheduled-1",
  workspaceId: "org-test-1",
  projectId: testProject.id,
  name: "Autofix feedback bugs",
  prompt: "Resuelve un ticket de feedback bug",
  jobType: "scheduled" as const,
  provider: "codex" as const,
  description: null,
  codingAgent: "codex" as const,
  aiProvider: "openai" as const,
  aiModel: "gpt-5.6-sol",
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
      workspaceId: "org-test-1",
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
  getScheduledAgentConfigById: async (id: string, workspaceId: string) =>
    id === scheduledConfig.id && workspaceId === scheduledConfig.workspaceId
      ? (state.scheduledConfigOverride ?? scheduledConfig)
      : undefined,
  updateScheduledAgentConfig: async (
    _id: string,
    _workspaceId: string,
    input: Record<string, unknown>,
  ) => {
    state.updatedConfigInput = input;
    return { ...scheduledConfig, ...input };
  },
  getRepositories: async () => [],
  getOrgPrimaryRepository: async () => state.orgPrimaryRepositoryOverride,
  updateScheduledAgentConfigLastRunAt: async () => {},
  findActiveConnections: async () =>
    state.activeConnectionsOverride ?? [{ config: {} }],
  getProjectAiConfig: async (projectId: string) => {
    state.projectAiConfigCalls.push(projectId);
    return state.projectAiConfigOverride ?? {
      defaultProvider: null,
      agentDefaults: {},
    };
  },
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
    broadcastToWorkspace: (orgId: string, message: Record<string, unknown>) => {
      state.broadcasts.push({ orgId, message });
    },
    sendToUser: () => {},
  },
}));
mock.module("../../instance/services/instance-config-service", () => ({
  ...__realInstanceConfigService,
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
    state.activeConnectionsOverride = null;
    state.projectAiConfigOverride = null;
    state.projectAiConfigCalls = [];
    state.orgPrimaryRepositoryOverride = null;
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
      workspaceId: "org-test-1",
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

  it("rechaza combinaciones provider/codingAgent incompatibles al crear", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(makeRequest({
      name: "Codex sobre Coding Plan",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "codex",
      aiProvider: "zai",
      aiModel: "glm-5.2",
      scheduleType: "manual",
    }));

    expect(response.status).toBe(400);
    expect(state.createdConfigInput).toBeNull();
  });

  it("rechaza reasoning incompatible al crear", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(makeRequest({
      name: "GPT sin reasoning",
      jobType: "implementation",
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      reasoningLevel: "high",
      scheduleType: "manual",
    }));

    expect(response.status).toBe(400);
    expect(state.createdConfigInput).toBeNull();
  });

  it("rechaza un VLM heredado de cualquier conexión Z.AI Coding Plan", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.activeConnectionsOverride = [
      { config: { implementationModel: "glm-5.2" } },
      { config: { implementationModel: "glm-5v-turbo" } },
    ];

    const response = await app.handle(makeRequest({
      name: "Modelo heredado inseguro",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      scheduleType: "manual",
    }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/glm-5v-turbo.*not available through the Z\.AI Coding Plan/i);
    expect(state.createdConfigInput).toBeNull();
  });

  it("rechaza por REST un slug explícito que no existe en el entitlement", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(makeRequest({
      name: "Modelo inventado",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: "totally-not-a-model",
      scheduleType: "manual",
    }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/unknown|unsupported|not available/i);
    expect(state.createdConfigInput).toBeNull();
  });

  it("falla cerrado cuando no puede resolver un modelo explícito ni heredado", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.activeConnectionsOverride = [];

    const response = await app.handle(makeRequest({
      name: "Sin conexión efectiva",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      scheduleType: "manual",
    }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/could not resolve an effective model/i);
    expect(state.createdConfigInput).toBeNull();
  });

  it("valida project.agentDefaults con la misma precedencia que el backlog real", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.projectAiConfigOverride = {
      defaultProvider: "zipu",
      agentDefaults: {
        implementation: {
          codingAgent: "opencode",
          aiProvider: "zai",
          model: "glm-5v-turbo",
          reasoningLevel: "max",
        },
      },
    };

    const response = await app.handle(makeRequest({
      name: "Default de proyecto inseguro",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      scheduleType: "manual",
      targetConfig: {
        backlogDrain: {
          enabled: true,
          projects: [{ projectId: testProject.id, enabled: true }],
        },
      },
    }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/glm-5v-turbo.*not available through the Z\.AI Coding Plan/i);
    expect(state.createdConfigInput).toBeNull();
  });

  it("valida CREATE sin projectId contra el mismo proyecto primario que usará execute", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.orgPrimaryRepositoryOverride = {
      id: "repo-primary",
      url: "https://github.com/acme/primary.git",
      projectId: "project-primary",
    };
    state.activeConnectionsOverride = [{
      config: { implementationModel: "glm-5.2" },
    }];
    state.projectAiConfigOverride = {
      defaultProvider: "zipu",
      agentDefaults: {
        implementation: {
          codingAgent: "opencode",
          aiProvider: "zai",
          model: "glm-5.1",
          reasoningLevel: null,
        },
      },
    };

    const response = await app.handle(makeRequest({
      name: "Sin proyecto explícito",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      scheduleType: "manual",
      projectId: null,
    }));

    expect(response.status).toBe(201);
    expect(state.projectAiConfigCalls).toEqual(["project-primary"]);
    expect(state.createdConfigInput).toMatchObject({ projectId: null });
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
    state.activeConnectionsOverride = null;
    state.projectAiConfigOverride = null;
    state.projectAiConfigCalls = [];
    state.orgPrimaryRepositoryOverride = null;
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

  it("valida un cambio aislado de codingAgent", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(new Request(
      `http://localhost/scheduled-agents/${scheduledConfig.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codingAgent: "claude-code" }),
      },
    ));

    expect(response.status).toBe(400);
    expect(state.updatedConfigInput).toBeNull();
  });

  it("valida un cambio aislado de reasoningLevel", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);

    const response = await app.handle(new Request(
      `http://localhost/scheduled-agents/${scheduledConfig.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reasoningLevel: "max" }),
      },
    ));

    expect(response.status).toBe(400);
    expect(state.updatedConfigInput).toBeNull();
  });

  it("revalida PATCH projectId=null usando el proyecto primario efectivo", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.orgPrimaryRepositoryOverride = {
      id: "repo-primary",
      url: "https://github.com/acme/primary.git",
      projectId: "project-primary",
    };
    state.projectAiConfigOverride = {
      defaultProvider: "zipu",
      agentDefaults: {
        implementation: {
          codingAgent: "opencode",
          aiProvider: "zai",
          model: "glm-5v-turbo",
          reasoningLevel: "max",
        },
      },
    };
    state.scheduledConfigOverride = {
      ...scheduledConfig,
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
    };

    try {
      const response = await app.handle(new Request(
        `http://localhost/scheduled-agents/${scheduledConfig.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: null }),
        },
      ));

      expect(response.status).toBe(400);
      expect(state.projectAiConfigCalls).toEqual(["project-primary"]);
      expect(state.updatedConfigInput).toBeNull();
    } finally {
      state.scheduledConfigOverride = null;
    }
  });
});

describe("scheduledAgentsRoutes POST /scheduled-agents/:id/trigger", () => {
  beforeEach(() => {
    state.createdJobInput = null;
    state.broadcasts = [];
    state.scheduledConfigOverride = null;
    state.activeConnectionsOverride = null;
    state.projectAiConfigOverride = null;
    state.projectAiConfigCalls = [];
    state.orgPrimaryRepositoryOverride = null;
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
      workspaceId: scheduledConfig.workspaceId,
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
        orgId: scheduledConfig.workspaceId,
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

  it("ejecuta el modelo y reasoning heredados de la conexión sin sustituirlos por el default", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.activeConnectionsOverride = [{
      config: {
        implementationModel: "glm-5.1",
        implementationReasoningBudget: null,
      },
    }];
    state.scheduledConfigOverride = {
      ...scheduledConfig,
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
    };

    try {
      const response = await app.handle(
        new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(state.createdJobInput).toMatchObject({
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5.1",
      });
      expect((state.createdJobInput?.config as Record<string, unknown>)?.reasoningLevel).toBeUndefined();
    } finally {
      state.scheduledConfigOverride = null;
      state.activeConnectionsOverride = null;
    }
  });

  it("mantiene en execute el runtime validado en CREATE cuando no hay projectId explícito", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.orgPrimaryRepositoryOverride = {
      id: "repo-primary",
      url: "https://github.com/acme/primary.git",
      projectId: "project-primary",
    };
    state.activeConnectionsOverride = [{
      config: { implementationModel: "glm-5.2" },
    }];
    state.projectAiConfigOverride = {
      defaultProvider: "zipu",
      agentDefaults: {
        implementation: {
          codingAgent: "opencode",
          aiProvider: "zai",
          model: "glm-5.1",
          reasoningLevel: null,
        },
      },
    };
    state.scheduledConfigOverride = {
      ...scheduledConfig,
      projectId: null,
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
    };

    const response = await app.handle(
      new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(state.projectAiConfigCalls).toEqual(["project-primary"]);
    expect(state.createdJobInput).toMatchObject({
      projectId: "project-primary",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.1",
      config: expect.objectContaining({ projectId: "project-primary" }),
    });
  });

  it("mantiene la misma precedencia schedule > project > connection al ejecutar", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.activeConnectionsOverride = [{
      config: {
        implementationModel: "claude-opus-4-8",
        implementationReasoningBudget: "max",
      },
    }];
    state.projectAiConfigOverride = {
      defaultProvider: null,
      agentDefaults: {
        implementation: {
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-sonnet-5",
          reasoningLevel: "high",
        },
      },
    };
    state.scheduledConfigOverride = {
      ...scheduledConfig,
      jobType: "implementation",
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: null,
      reasoningLevel: null,
    };

    let response = await app.handle(
      new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(state.projectAiConfigCalls.length).toBeGreaterThan(0);
    expect(await response.clone().json()).toMatchObject({ success: true });
    expect(state.createdJobInput).toMatchObject({
      model: "claude-sonnet-5",
      config: expect.objectContaining({ reasoningLevel: "high" }),
    });

    state.createdJobInput = null;
    state.scheduledConfigOverride = {
      ...state.scheduledConfigOverride,
      aiModel: "claude-opus-4-8",
      reasoningLevel: "xhigh",
    };
    response = await app.handle(
      new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({ success: true });
    expect(state.createdJobInput).toMatchObject({
      model: "claude-opus-4-8",
      config: expect.objectContaining({ reasoningLevel: "xhigh" }),
    });
  });

  it("revalida cambios posteriores VLM, unknown y effort antes de encolar", async () => {
    const { scheduledAgentsRoutes } = await import("./scheduled-agents.routes");
    const app = new Elysia().use(withTestOrg).use(scheduledAgentsRoutes);
    state.scheduledConfigOverride = {
      ...scheduledConfig,
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
    };

    const cases = [
      {
        config: { implementationModel: "glm-5v-turbo" },
        error: /not available through the Z\.AI Coding Plan/i,
      },
      {
        config: { implementationModel: "totally-not-a-model" },
        error: /unknown|unsupported/i,
      },
      {
        config: {
          implementationModel: "glm-5.1",
          implementationReasoningBudget: "max",
        },
        error: /reasoningLevel 'max' is not supported/i,
      },
    ];

    for (const testCase of cases) {
      state.createdJobInput = null;
      state.activeConnectionsOverride = [{ config: testCase.config }];
      const response = await app.handle(
        new Request(`http://localhost/scheduled-agents/${scheduledConfig.id}/trigger`, {
          method: "POST",
        }),
      );
      const body = (await response.json()) as { success?: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(testCase.error);
      expect(state.createdJobInput).toBeNull();
    }
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module(
    "../../instance/services/instance-config-service",
    () => __realInstanceConfigService,
  );
});
