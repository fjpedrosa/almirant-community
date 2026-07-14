import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  createGithubServiceMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testWorkspace, testWorkItem } from "../../../test/fixtures";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const state = {
  createdJobInput: null as Record<string, unknown> | null,
  forecastCalls: [] as Array<{ workspaceId: string; workItemId: string }>,
  scheduledConfig: null as Record<string, unknown> | null,
  backlogCandidates: [] as Array<Record<string, unknown>>,
  dodRemediationCandidates: [] as Array<Record<string, unknown>>,
  scheduledConfigLookups: [] as Array<{ id: string; workspaceId: string }>,
};

const orgLookupChain = {
  from: () => orgLookupChain,
  innerJoin: () => orgLookupChain,
  where: () => orgLookupChain,
  limit: async () => [{ workspaceId: testWorkspace.id }],
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key" }),
  getActiveJobForWorkItem: async () => null,
  getScheduledAgentConfigById: async (id: string, workspaceId: string) => {
    state.scheduledConfigLookups.push({ id, workspaceId });
    return state.scheduledConfig?.id === id && state.scheduledConfig.workspaceId === workspaceId
      ? state.scheduledConfig
      : undefined;
  },
  getBacklogDrainCandidatesForScheduledConfig: async () => ({
    candidates: state.backlogCandidates,
    skipped: {},
  }),
  getDodRemediationCandidatesForScheduledConfig: async () => ({
    candidates: state.dodRemediationCandidates,
    skipped: {},
  }),
  createJob: async (input: Record<string, unknown>) => {
    state.createdJobInput = input;
    return {
      id: "job-1",
      status: "queued",
      workItemId: testWorkItem.id,
      planningSessionId: null,
      provider: input.provider,
      jobType: input.jobType ?? "validation",
      priority: input.priority ?? "medium",
      config: input.config ?? {},
      projectId: testWorkItem.projectId,
      boardId: testWorkItem.boardId,
    };
  },
  db: {
    select: () => orgLookupChain,
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../services/resource-forecast", () => ({
  buildDefaultJobResourceEstimate: ({ skillName, promptTemplate, jobType }: { skillName?: string | null; promptTemplate?: string | null; jobType?: string | null }) => ({
    estimatedMemoryMb: (promptTemplate ?? skillName ?? jobType) === "runner-implement" ? 3584 : 1536,
    source: "skill-default",
    confidence: "low",
    reason: "Default estimate calculated at enqueue time",
  }),
  buildWorkItemResourceForecast: async (workspaceId: string, workItemId: string) => {
    state.forecastCalls.push({ workspaceId, workItemId });
    return {
      estimatedPeakMemoryMb: 3584,
      confidence: "low",
      bottleneckWave: 1,
      estimatedConcurrentTasks: 5,
    };
  },
  toJobResourceEstimate: (forecast: {
    estimatedPeakMemoryMb: number;
    confidence: "low" | "medium" | "high";
    bottleneckWave?: number;
    estimatedConcurrentTasks: number;
  }) => ({
    estimatedMemoryMb: forecast.estimatedPeakMemoryMb,
    source: "forecast",
    confidence: forecast.confidence,
    reason: `Peak wave ${forecast.bottleneckWave ?? "n/a"} with ${forecast.estimatedConcurrentTasks} concurrent task(s)`,
  }),
}));
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
  new Request("http://localhost/workers/jobs", {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("workersRoutes POST /workers/jobs", () => {
  beforeEach(() => {
    state.createdJobInput = null;
    state.forecastCalls = [];
    state.scheduledConfig = null;
    state.backlogCandidates = [];
    state.dodRemediationCandidates = [];
    state.scheduledConfigLookups = [];
  });

  it("creates validation jobs for nightly scheduler with provider defaults", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        workItemId: testWorkItem.id,
        provider: "codex",
        jobType: "validation",
        config: {
          projectId: testWorkItem.projectId,
          skillName: "validate",
          source: "nightly-scheduler",
        },
      })
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; provider: string; jobType: string };
    };

    expect(body.success).toBe(true);
    expect(body.data.id).toBe("job-1");
    expect(state.createdJobInput).toMatchObject({
      projectId: testWorkItem.projectId,
      boardId: testWorkItem.boardId,
      workItemId: testWorkItem.id,
      workspaceId: testWorkspace.id,
      provider: "codex",
      jobType: "validation",
      priority: "medium",
      config: {
        repoPath: ".",
        baseBranch: "main",
        projectId: testWorkItem.projectId,
        skillName: "validate",
        source: "nightly-scheduler",
        resourceEstimate: {
          estimatedMemoryMb: 1536,
          source: "skill-default",
          confidence: "low",
          reason: "Default estimate calculated at enqueue time",
        },
      },
    });
  });

  it("preserva jobs manuales de implementación sin semántica scheduled", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        workItemId: testWorkItem.id,
        provider: "zipu",
        jobType: "implementation",
        config: {
          projectId: testWorkItem.projectId,
          skillName: "implement",
          source: "worker",
        },
      })
    );

    expect(res.status).toBe(201);
    expect(state.forecastCalls).toEqual([
      {
        workspaceId: testWorkspace.id,
        workItemId: testWorkItem.id,
      },
    ]);
    expect(state.createdJobInput).toMatchObject({
      jobType: "implementation",
      config: {
        source: "worker",
        skillName: "implement",
        resourceEstimate: {
          estimatedMemoryMb: 3584,
          source: "forecast",
          confidence: "low",
          reason: "Peak wave 1 with 5 concurrent task(s)",
        },
      },
    });
  });

  it("falla cerrado si un payload con semántica backlog/DoD omite scheduledConfigId", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    const maliciousMcp = {
      attacker: {
        type: "remote" as const,
        url: "https://attacker.example.test/mcp",
        enabled: true,
        oauth: false as const,
      },
    };
    const protectedPayloads = [
      {
        label: "source backlog",
        config: { source: "backlog-drain", skillName: "implement" },
      },
      {
        label: "source DoD",
        config: { source: "dod-remediation", skillName: "implement" },
      },
      {
        label: "skill backlog interna",
        config: { source: "worker", skillName: "runner-implement" },
      },
      {
        label: "skill DoD interna",
        config: { source: "worker", skillName: "runner-fix-dod" },
      },
    ] as const;

    for (const testCase of protectedPayloads) {
      state.createdJobInput = null;
      const res = await app.handle(makeRequest({
        workItemId: testWorkItem.id,
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5v-turbo",
        jobType: "implementation",
        config: {
          projectId: testWorkItem.projectId,
          ...testCase.config,
          mcpServers: maliciousMcp,
        },
      }));

      expect(res.status, testCase.label).toBe(400);
      expect(await res.json(), testCase.label).toMatchObject({
        success: false,
        error: expect.stringMatching(/scheduledConfigId.*required/i),
      });
      expect(state.createdJobInput, testCase.label).toBeNull();
    }
    expect(state.scheduledConfigLookups).toEqual([]);
  });

  it("no permite convertir backlog/DoD en un job standalone para evitar la revalidación de candidato", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest({
      workspaceId: testWorkspace.id,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5v-turbo",
      jobType: "implementation",
      config: {
        scheduledConfigId: "scheduled-backlog-standalone",
        scheduledConfigName: "Backlog falso",
        source: "backlog-drain",
        skillName: "runner-implement",
        mcpServers: {
          attacker: {
            type: "remote",
            url: "https://attacker.example.test/mcp",
            enabled: true,
            oauth: false,
          },
        },
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/workItemId.*required/i),
    });
    expect(state.createdJobInput).toBeNull();
    expect(state.scheduledConfigLookups).toEqual([]);
  });

  it("preserva el job standalone scheduled legítimo sin semántica backlog/DoD", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest({
      workspaceId: testWorkspace.id,
      provider: "claude-code",
      jobType: "scheduled",
      prompt: "Genera el informe semanal",
      config: {
        scheduledConfigId: "scheduled-report-1",
        scheduledConfigName: "Informe semanal",
        source: "scheduled-config",
      },
    }));

    expect(res.status).toBe(201);
    expect(state.createdJobInput).toMatchObject({
      workspaceId: testWorkspace.id,
      jobType: "scheduled",
      provider: "claude-code",
      config: {
        scheduledConfigId: "scheduled-report-1",
        scheduledConfigName: "Informe semanal",
        source: "scheduled-config",
      },
    });
  });

  it("rechaza un runtime adulterado al encolar un candidato de backlog y revalida la config server-side", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    state.scheduledConfig = {
      id: "scheduled-backlog-1",
      workspaceId: testWorkspace.id,
      projectId: null,
      name: "Backlog seguro",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
      targetConfig: { backlogDrain: { enabled: true } },
      mcpServers: null,
    };
    state.backlogCandidates = [{
      id: testWorkItem.id,
      projectId: testWorkItem.projectId,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
      skillName: "runner-implement",
    }];

    const res = await app.handle(makeRequest({
      workItemId: testWorkItem.id,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5v-turbo",
      jobType: "implementation",
      config: {
        projectId: testWorkItem.projectId,
        scheduledConfigId: "scheduled-backlog-1",
        scheduledConfigName: "Backlog seguro",
        skillName: "runner-implement",
        source: "backlog-drain",
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/payload.*model.*does not match/i),
    });
    expect(state.scheduledConfigLookups).toEqual([{
      id: "scheduled-backlog-1",
      workspaceId: testWorkspace.id,
    }]);
    expect(state.createdJobInput).toBeNull();
  });

  it("rechaza marcadores backlog/DoD inconsistentes aunque scheduledConfigId sea válido", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    state.scheduledConfig = {
      id: "scheduled-backlog-consistent",
      workspaceId: testWorkspace.id,
      projectId: null,
      name: "Backlog autoritativo",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
      targetConfig: { backlogDrain: { enabled: true } },
      mcpServers: null,
    };
    state.backlogCandidates = [{
      id: testWorkItem.id,
      projectId: testWorkItem.projectId,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
      skillName: "runner-implement",
    }];

    for (const config of [
      { source: "dod-remediation", skillName: "runner-implement" },
      { source: "backlog-drain", skillName: "runner-fix-dod" },
    ]) {
      state.createdJobInput = null;
      const res = await app.handle(makeRequest({
        workItemId: testWorkItem.id,
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5.2",
        jobType: "implementation",
        config: {
          projectId: testWorkItem.projectId,
          scheduledConfigId: "scheduled-backlog-consistent",
          scheduledConfigName: "Backlog autoritativo",
          ...config,
        },
      }));

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        success: false,
        error: expect.stringMatching(/does not match/i),
      });
      expect(state.createdJobInput).toBeNull();
    }
  });

  it("rechaza un VLM que aparece al revalidar la conexión de DoD inmediatamente antes de createJob", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    state.scheduledConfig = {
      id: "scheduled-dod-1",
      workspaceId: testWorkspace.id,
      projectId: null,
      name: "DoD seguro",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
      targetConfig: { dodRemediation: { enabled: true } },
      mcpServers: null,
    };
    state.dodRemediationCandidates = [{
      id: testWorkItem.id,
      projectId: testWorkItem.projectId,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5v-turbo",
      reasoningLevel: null,
      skillName: "runner-fix-dod",
      dodReport: "Falla el criterio 2",
      dodReviewedAt: "2026-07-14T08:00:00.000Z",
    }];

    const res = await app.handle(makeRequest({
      workItemId: testWorkItem.id,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5v-turbo",
      jobType: "implementation",
      config: {
        projectId: testWorkItem.projectId,
        scheduledConfigId: "scheduled-dod-1",
        scheduledConfigName: "DoD seguro",
        skillName: "runner-fix-dod",
        source: "dod-remediation",
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/glm-5v-turbo.*not available through the Z\.AI Coding Plan/i),
    });
    expect(state.createdJobInput).toBeNull();
  });

  it("crea backlog con el runtime y MCP revalidados por el servidor", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    state.scheduledConfig = {
      id: "scheduled-backlog-valid",
      workspaceId: testWorkspace.id,
      projectId: null,
      name: "Backlog vigente",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
      targetConfig: { backlogDrain: { enabled: true } },
      mcpServers: {
        proof: {
          type: "remote",
          url: "https://mcp.example.test",
          enabled: true,
          oauth: false,
        },
      },
    };
    state.backlogCandidates = [{
      id: testWorkItem.id,
      projectId: testWorkItem.projectId,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
      skillName: "runner-implement",
    }];

    const res = await app.handle(makeRequest({
      workItemId: testWorkItem.id,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      jobType: "implementation",
      config: {
        projectId: testWorkItem.projectId,
        scheduledConfigId: "scheduled-backlog-valid",
        scheduledConfigName: "Backlog vigente",
        skillName: "runner-implement",
        source: "backlog-drain",
      },
    }));

    expect(res.status).toBe(201);
    expect(state.createdJobInput).toMatchObject({
      projectId: testWorkItem.projectId,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      config: {
        scheduledConfigId: "scheduled-backlog-valid",
        scheduledConfigName: "Backlog vigente",
        source: "backlog-drain",
        skillName: "runner-implement",
        mcpServers: {
          proof: {
            type: "remote",
            url: "https://mcp.example.test",
            enabled: true,
            oauth: false,
          },
        },
      },
    });
  });

  it("rechaza un candidato si la automatización se deshabilitó antes de createJob", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);
    state.scheduledConfig = {
      id: "scheduled-backlog-disabled",
      workspaceId: testWorkspace.id,
      projectId: null,
      name: "Backlog deshabilitado",
      enabled: false,
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      aiModel: null,
      reasoningLevel: null,
      targetConfig: { backlogDrain: { enabled: true } },
      mcpServers: null,
    };
    state.backlogCandidates = [{
      id: testWorkItem.id,
      projectId: testWorkItem.projectId,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
      skillName: "runner-implement",
    }];

    const res = await app.handle(makeRequest({
      workItemId: testWorkItem.id,
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      jobType: "implementation",
      config: {
        projectId: testWorkItem.projectId,
        scheduledConfigId: "scheduled-backlog-disabled",
        scheduledConfigName: "Backlog deshabilitado",
        skillName: "runner-implement",
        source: "backlog-drain",
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/no longer enabled/i),
    });
    expect(state.createdJobInput).toBeNull();
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
