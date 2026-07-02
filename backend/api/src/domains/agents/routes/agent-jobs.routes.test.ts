import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";
import { testWorkItem, testUser } from "../../../test/fixtures";
import type { AgentJobConfig } from "@almirant/database";

const state = {
  createdJobInput: null as Record<string, unknown> | null,
  createdBatchJobInputs: null as Array<Record<string, unknown>> | null,
  listJobs: [] as Array<Record<string, unknown>>,
  jobDetailsById: {} as Record<string, Record<string, unknown>>,
  accessibleProjectIds: [testWorkItem.projectId] as string[],
  lastListFilters: null as Record<string, unknown> | null,
  clusterByJobId: new Map<string, { id: string; title: string } | null>(),
};

const dbMocks = createDatabaseMocks({
  getActiveJobForWorkItem: async () => null,
  getAccessibleProjectIds: async () => state.accessibleProjectIds,
  listAgentJobs: async (_pagination: unknown, filters?: Record<string, unknown>) => {
    state.lastListFilters = filters ?? null;
    const accessibleProjectIds = filters?.accessibleProjectIds as string[] | undefined;
    if (Array.isArray(accessibleProjectIds) && accessibleProjectIds.length === 0) {
      return { jobs: [], total: 0 };
    }
    return {
      jobs: state.listJobs,
      total: state.listJobs.length,
    };
  },
  getJobById: async (id: string) => state.jobDetailsById[id] ?? null,
  findClusterByAgentJobId: async (jobId: string) =>
    state.clusterByJobId.has(jobId) ? state.clusterByJobId.get(jobId) ?? null : null,
  getScheduledAgentConfigById: async (id: string, workspaceId: string) => {
    if (id !== "cfg-1" || workspaceId !== "org-test-1") return null;
    return {
      id,
      workspaceId,
      projectId: testWorkItem.projectId,
      name: "Autofix bug tickets",
      prompt: null,
      jobType: "scheduled",
      provider: "claude-code",
      description: null,
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-opus-4-6",
      reasoningLevel: null,
      scheduleType: "cron",
      scheduleConfig: { expression: "*/10 * * * *" },
      timezone: "Europe/Madrid",
      enabled: true,
      targetConfig: {},
      maxJobsPerRun: 1,
      pausedUntil: null,
      lastRunAt: null,
      createdAt: new Date("2026-04-12T08:00:00.000Z"),
      updatedAt: new Date("2026-04-12T08:00:00.000Z"),
    };
  },
  createJob: async (input: Record<string, unknown>) => {
    state.createdJobInput = input;
    return {
      id: "job-1",
      status: "queued",
      workItemId: testWorkItem.id,
      planningSessionId: null,
      provider: input.provider,
      jobType: input.jobType ?? "implementation",
      priority: input.priority ?? "medium",
      config: input.config ?? {},
      projectId: testWorkItem.projectId,
      boardId: testWorkItem.boardId,
    };
  },
  createBatchJobs: async (inputs: Array<Record<string, unknown>>) => {
    state.createdBatchJobInputs = inputs;
    return inputs.map((input, index) => ({
      id: `job-batch-${index + 1}`,
      status: "queued",
      ...input,
    }));
  },
  getAllWorkersMetricsHistory: async () => [],
  // Minimal drizzle chain used by POST /agent-jobs/batch to resolve work item rows.
  db: {
    select: () => ({
      from: () => ({
        where: async () => [
          {
            id: testWorkItem.id,
            projectId: testWorkItem.projectId,
            boardId: testWorkItem.boardId,
            taskId: testWorkItem.taskId,
          },
        ],
      }),
    }),
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../integrations/discord/services/discord-thread", () => ({
  isDiscordBridgeConfigured: () => false,
  createDiscordThread: async () => null,
  renameDiscordThread: async () => {},
}));
mock.module("../services/resource-forecast", () => ({
  buildDefaultJobResourceEstimate: ({ skillName, promptTemplate, jobType }: { skillName?: string | null; promptTemplate?: string | null; jobType?: string | null }) => ({
    estimatedMemoryMb: (promptTemplate ?? skillName ?? jobType) === "runner-implement" ? 3584 : 1536,
    source: "skill-default",
    confidence: "low",
    reason: "Default estimate calculated at enqueue time",
  }),
  buildWorkItemResourceForecast: async () => ({
    estimatedPeakMemoryMb: 3584,
    confidence: "low",
    bottleneckWave: 1,
    estimatedConcurrentTasks: 5,
  }),
  toJobResourceEstimate: (forecast: { estimatedPeakMemoryMb: number; confidence: "low" | "medium" | "high"; bottleneckWave?: number; estimatedConcurrentTasks: number }) => ({
    estimatedMemoryMb: forecast.estimatedPeakMemoryMb,
    source: "forecast",
    confidence: forecast.confidence,
    reason: `Peak wave ${forecast.bottleneckWave ?? "n/a"} with ${forecast.estimatedConcurrentTasks} concurrent task(s)`,
  }),
}));

const makeRequest = (path: string, body: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const withTestOrgRole = (role: string) => (app: Elysia) =>
  app.derive(() => ({
    user: testUser,
    activeWorkspace: {
      id: "org-test-1",
      name: "Test Workspace",
      slug: "test-org",
    },
    memberRole: role,
  }));

describe("agentJobsRoutes POST /agent-jobs", () => {
  beforeEach(() => {
    state.createdJobInput = null;
    state.createdBatchJobInputs = null;
    state.listJobs = [];
    state.jobDetailsById = {};
    state.accessibleProjectIds = [testWorkItem.projectId];
    state.lastListFilters = null;
    state.clusterByJobId = new Map();
  });

  it("resolves the claude-code default model from the shared runtime when no model is provided", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest("/agent-jobs", {
        workItemId: testWorkItem.id,
        provider: "claude-code",
        jobType: "validation",
        config: { repoPath: ".", baseBranch: "main" },
      })
    );

    expect(res.status).toBe(201);
    expect(state.createdJobInput?.model).toBe("claude-opus-4-8");
  });

  it("resolves provider-specific default models instead of an Anthropic hardcode", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest("/agent-jobs", {
        workItemId: testWorkItem.id,
        provider: "codex",
        jobType: "validation",
        config: { repoPath: ".", baseBranch: "main" },
      })
    );

    expect(res.status).toBe(201);
    expect(state.createdJobInput?.model).toBe("gpt-5.5");
  });

  it("resolves the default model from the shared runtime for batch jobs without an explicit model", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest("/agent-jobs/batch", {
        workItemIds: [testWorkItem.id],
        provider: "claude-code",
        jobType: "implementation",
      })
    );

    expect(res.status).toBe(201);
    expect(state.createdBatchJobInputs).toHaveLength(1);
    expect(state.createdBatchJobInputs?.[0]?.model).toBe("claude-opus-4-8");
  });

  it("falls back to the shared runtime default model when retrying a job without a stored model", async () => {
    state.jobDetailsById["job-retry-1"] = {
      job: {
        id: "job-retry-1",
        workItemId: testWorkItem.id,
        projectId: testWorkItem.projectId,
        boardId: testWorkItem.boardId,
        planningSessionId: null,
        createdByUserId: testUser.id,
        organizationId: "org-test-1",
        jobType: "bug-fix",
        status: "failed",
        provider: "claude-code",
        priority: "medium",
        config: {},
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: null,
        skillName: "bug-fix",
        prompt: null,
        promptTemplate: "bug-fix",
        triggerType: "event",
        interactive: false,
      },
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
      feedbackItem: null,
      createdByUser: null,
    };

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request("http://localhost/agent-jobs/job-retry-1/retry", { method: "POST" }),
    );

    expect(res.status).toBe(201);
    expect(state.createdJobInput?.model).toBe("claude-opus-4-8");
  });

  it("rejects user-created jobs targeting an internal-only skill", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest("/agent-jobs", {
        workItemId: testWorkItem.id,
        provider: "claude-code",
        jobType: "implementation",
        config: { skillName: "feedback-triage" },
      })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/internal system flows/i);
    expect(state.createdJobInput).toBeNull();
  });

  it("rejects user-created batch jobs targeting an internal-only skill", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest("/agent-jobs/batch", {
        workItemIds: [testWorkItem.id],
        provider: "claude-code",
        jobType: "implementation",
        config: { skillName: "feedback-bug-fix" },
      })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/internal system flows/i);
  });

  it("accepts validation jobs with provider and config source", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      makeRequest("/agent-jobs", {
        workItemId: testWorkItem.id,
        provider: "codex",
        jobType: "validation",
        config: {
          repoPath: ".",
          baseBranch: "main",
          skillName: "validate",
          source: "nightly-scheduler",
        },
      })
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; jobType: string; provider: string };
    };

    expect(body.success).toBe(true);
    expect(body.data.id).toBe("job-1");
    expect(state.createdJobInput).toMatchObject({
      workItemId: testWorkItem.id,
      provider: "codex",
      jobType: "validation",
      projectId: testWorkItem.projectId,
      boardId: testWorkItem.boardId,
      workspaceId: "org-test-1",
      createdByUserId: testUser.id,
      priority: "medium",
      config: {
        repoPath: ".",
        baseBranch: "main",
        taskId: testWorkItem.taskId,
        workItemTitle: testWorkItem.title,
        skillName: "validate",
        resourceEstimate: {
          estimatedMemoryMb: 1536,
          source: "skill-default",
          confidence: "low",
          reason: "Default estimate calculated at enqueue time",
        },
        source: "api",
        requestedByUserId: testUser.id,
      },
    });
  });

  it("hydrates scheduled execution names from scheduled config when old jobs only store scheduledConfigId", async () => {
    const scheduledConfig: AgentJobConfig = {
      repoPath: ".",
      baseBranch: "main",
      scheduledConfigId: "cfg-1",
      source: "scheduled-config",
    };

    state.listJobs = [
      {
        id: "job-scheduled-1",
        workItemId: null,
        projectId: testWorkItem.projectId,
        boardId: null,
        planningSessionId: null,
        createdByUserId: testUser.id,
        workspaceId: "org-test-1",
        jobType: "scheduled",
        status: "completed",
        provider: "claude-code",
        priority: "medium",
        config: scheduledConfig,
        result: { summary: "Completed nightly run" },
        workerId: null,
        branchName: null,
        worktreePath: null,
        retryCount: 0,
        maxRetries: 2,
        availableAt: null,
        sessionId: "sess-1",
        startedAt: new Date("2026-04-12T08:00:00.000Z"),
        completedAt: new Date("2026-04-12T08:05:00.000Z"),
        failedAt: null,
        errorMessage: null,
        errorType: null,
        prUrl: null,
        prNumber: null,
        commitSha: null,
        cost: null,
        tokensUsed: null,
        durationMs: 300000,
        cumulativeDurationMs: 300000,
        createdAt: new Date("2026-04-12T08:00:00.000Z"),
        updatedAt: new Date("2026-04-12T08:05:00.000Z"),
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-6",
        skillName: "auto-debug-failed",
        prompt: null,
        promptTemplate: "auto-debug-failed",
        triggerType: "scheduled",
        interactive: false,
      },
    ];

    state.jobDetailsById["job-scheduled-1"] = {
      job: state.listJobs[0],
      workItem: null,
      project: {
        id: testWorkItem.projectId,
        name: "Test Project",
      },
      board: null,
      planningSession: null,
      createdByUser: {
        id: testUser.id,
        name: testUser.name,
        image: testUser.image,
      },
    };

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const listRes = await app.handle(
      new Request("http://localhost/agent-jobs?includeRelations=true", {
        method: "GET",
      }),
    );

    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      success: boolean;
      data: Array<{ config?: AgentJobConfig }>;
    };
    expect(listBody.data[0]?.config?.scheduledConfigName).toBe("Autofix bug tickets");

    const detailRes = await app.handle(
      new Request("http://localhost/agent-jobs/job-scheduled-1", {
        method: "GET",
      }),
    );

    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as {
      success: boolean;
      data: { job: { config?: AgentJobConfig } };
    };
    expect(detailBody.data.job.config?.scheduledConfigName).toBe("Autofix bug tickets");
  });

  it("lists planning jobs by planningSessionId even when accessibleProjectIds is empty", async () => {
    state.accessibleProjectIds = [];
    state.listJobs = [
      {
        id: "job-planning-1",
        workItemId: null,
        projectId: testWorkItem.projectId,
        boardId: testWorkItem.boardId,
        planningSessionId: "planning-session-1",
        createdByUserId: testUser.id,
        workspaceId: "org-test-1",
        jobType: "planning",
        status: "waiting_for_input",
        provider: "claude-code",
        priority: "medium",
        config: {
          planningSessionId: "planning-session-1",
          userMessage: "Dame 5 mejoras de UX",
        },
        result: null,
        workerId: "runner-local-dev",
        branchName: null,
        worktreePath: null,
        retryCount: 0,
        maxRetries: 2,
        availableAt: null,
        sessionId: null,
        startedAt: new Date("2026-04-15T13:44:19.923Z"),
        completedAt: null,
        failedAt: null,
        errorMessage: null,
        errorType: null,
        prUrl: null,
        prNumber: null,
        commitSha: null,
        cost: null,
        tokensUsed: null,
        durationMs: null,
        cumulativeDurationMs: 0,
        createdAt: new Date("2026-04-15T13:44:18.618Z"),
        updatedAt: new Date("2026-04-15T13:47:58.597Z"),
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-6",
        skillName: "ideate",
        prompt: null,
        promptTemplate: "ideate",
        triggerType: "event",
        interactive: true,
      },
    ];

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request("http://localhost/agent-jobs?planningSessionId=planning-session-1", {
        method: "GET",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; planningSessionId: string | null }>;
    };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "job-planning-1",
      planningSessionId: "planning-session-1",
    });
    expect(state.lastListFilters?.planningSessionId).toBe("planning-session-1");
    expect(state.lastListFilters?.accessibleProjectIds).toBeUndefined();
  });

  it("does not restrict workspace owners to project_members rows in session lists", async () => {
    state.accessibleProjectIds = [];
    state.listJobs = [
      {
        id: "job-owner-visible-1",
        workItemId: testWorkItem.id,
        projectId: testWorkItem.projectId,
        boardId: testWorkItem.boardId,
        planningSessionId: null,
        createdByUserId: testUser.id,
        workspaceId: "org-test-1",
        jobType: "implementation",
        status: "queued",
        provider: "zipu",
        priority: "medium",
        config: {},
        result: null,
        workerId: null,
        branchName: null,
        worktreePath: null,
        retryCount: 0,
        maxRetries: 2,
        availableAt: null,
        sessionId: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
        errorType: null,
        prUrl: null,
        prNumber: null,
        commitSha: null,
        cost: null,
        tokensUsed: null,
        durationMs: null,
        cumulativeDurationMs: 0,
        createdAt: new Date("2026-04-26T18:59:44.149Z"),
        updatedAt: new Date("2026-04-26T18:59:44.149Z"),
        codingAgent: "claude-code",
        aiProvider: "zai",
        model: "glm-5.1",
        skillName: "runner-implement",
        prompt: null,
        promptTemplate: "runner-implement",
        triggerType: "event",
        interactive: false,
      },
    ];

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request("http://localhost/agent-jobs", {
        method: "GET",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string }>;
    };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe("job-owner-visible-1");
    expect(state.lastListFilters?.accessibleProjectIds).toBeUndefined();
  });

  it("keeps accessibleProjectIds filtering for non-owner session lists", async () => {
    state.accessibleProjectIds = [];

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrgRole("member")).use(agentJobsRoutes);

    const res = await app.handle(
      new Request("http://localhost/agent-jobs", {
        method: "GET",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<unknown>;
    };

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(state.lastListFilters?.accessibleProjectIds).toEqual([]);
  });

  it("forwards session list filters to the agent jobs repository", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(
        `http://localhost/agent-jobs?status=paused&projectId=${testWorkItem.projectId}&jobType=scheduled&taskId=A-123&page=2&limit=10`,
        { method: "GET" },
      ),
    );

    expect(res.status).toBe(200);
    expect(state.lastListFilters).toMatchObject({
      workspaceId: "org-test-1",
      status: "paused",
      projectId: testWorkItem.projectId,
      jobType: "scheduled",
      taskId: "A-123",
    });
  });

  it("forwards comma-separated multiselect session filters as arrays", async () => {
    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(
        `http://localhost/agent-jobs?status=queued,running&projectId=${testWorkItem.projectId},project-2&jobType=implementation,scheduled`,
        { method: "GET" },
      ),
    );

    expect(res.status).toBe(200);
    expect(state.lastListFilters).toMatchObject({
      workspaceId: "org-test-1",
      status: ["queued", "running"],
      projectId: [testWorkItem.projectId, "project-2"],
      jobType: ["implementation", "scheduled"],
    });
  });
});

describe("agentJobsRoutes GET /agent-jobs/:id requestedByUser resolution", () => {
  const jobId = "job-bot-attributed-1";
  const otherUser = {
    id: "user-test-other",
    name: "Other User",
    image: "https://example.com/avatar.png",
  };

  const seedBotJobDetail = (requestedByUser: { id: string; name: string; image: string | null } | null) => {
    state.jobDetailsById[jobId] = {
      job: {
        id: jobId,
        workItemId: null,
        projectId: testWorkItem.projectId,
        boardId: null,
        planningSessionId: null,
        createdByUserId: "auto-fix-bot",
        workspaceId: "org-test-1",
        jobType: "bug-fix",
        status: "queued",
        provider: "claude-code",
        priority: "medium",
        config: { requestedByUserId: requestedByUser?.id ?? "user-does-not-exist" },
        result: null,
        workerId: null,
        branchName: null,
        worktreePath: null,
        retryCount: 0,
        maxRetries: 2,
        availableAt: null,
        sessionId: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
        errorType: null,
        prUrl: null,
        prNumber: null,
        commitSha: null,
        cost: null,
        tokensUsed: null,
        durationMs: null,
        cumulativeDurationMs: 0,
        createdAt: new Date("2026-04-17T10:00:00.000Z"),
        updatedAt: new Date("2026-04-17T10:00:00.000Z"),
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-6",
        skillName: "bug-fix",
        prompt: null,
        promptTemplate: "bug-fix",
        triggerType: "event",
        interactive: false,
      },
      workItem: null,
      project: { id: testWorkItem.projectId, name: "Test Project" },
      board: null,
      planningSession: null,
      feedbackItem: null,
      // Bot identity — `auto-fix-bot` is not a real user row, so the JOIN
      // resolves to null in production. Mirror that here.
      createdByUser: null,
      requestedByUser,
    };
  };

  beforeEach(() => {
    state.createdJobInput = null;
    state.listJobs = [];
    state.jobDetailsById = {};
    state.accessibleProjectIds = [testWorkItem.projectId];
    state.lastListFilters = null;
    state.clusterByJobId = new Map();
  });

  it("exposes requestedByUserName/Image on GET /:id when config.requestedByUserId resolves", async () => {
    seedBotJobDetail(otherUser);

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(`http://localhost/agent-jobs/${jobId}`, { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        job: {
          requestedByUserName: string | null;
          requestedByUserImage: string | null;
          createdByUserName: string | null;
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.job.requestedByUserName).toBe(otherUser.name);
    expect(body.data.job.requestedByUserImage).toBe(otherUser.image);
    // Sanity: createdByUser is the bot, so its display fields fall back to null.
    expect(body.data.job.createdByUserName).toBeNull();
  });

  it("returns null requestedByUserName/Image on GET /:id when requester does not resolve", async () => {
    seedBotJobDetail(null);

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(`http://localhost/agent-jobs/${jobId}`, { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        job: {
          requestedByUserName: string | null;
          requestedByUserImage: string | null;
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.job.requestedByUserName).toBeNull();
    expect(body.data.job.requestedByUserImage).toBeNull();
  });

  it("exposes requestedByUserName/Image on GET /?includeRelations=true", async () => {
    seedBotJobDetail(otherUser);
    state.listJobs = [state.jobDetailsById[jobId]!.job as Record<string, unknown>];

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request("http://localhost/agent-jobs?includeRelations=true", {
        method: "GET",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{
        id: string;
        requestedByUserName: string | null;
        requestedByUserImage: string | null;
      }>;
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.requestedByUserName).toBe(otherUser.name);
    expect(body.data[0]?.requestedByUserImage).toBe(otherUser.image);
  });
});

describe("agentJobsRoutes GET /agent-jobs/:id cluster resolution", () => {
  const jobId = "job-cluster-detail-1";

  const seedJobDetail = () => {
    state.jobDetailsById[jobId] = {
      job: {
        id: jobId,
        workItemId: null,
        projectId: testWorkItem.projectId,
        boardId: null,
        planningSessionId: null,
        createdByUserId: testUser.id,
        workspaceId: "org-test-1",
        jobType: "bug-fix",
        status: "completed",
        provider: "claude-code",
        priority: "medium",
        config: {},
        result: null,
        workerId: null,
        branchName: null,
        worktreePath: null,
        retryCount: 0,
        maxRetries: 2,
        availableAt: null,
        sessionId: null,
        startedAt: new Date("2026-04-16T10:00:00.000Z"),
        completedAt: new Date("2026-04-16T10:05:00.000Z"),
        failedAt: null,
        errorMessage: null,
        errorType: null,
        prUrl: null,
        prNumber: null,
        commitSha: null,
        cost: null,
        tokensUsed: null,
        durationMs: 300000,
        cumulativeDurationMs: 300000,
        createdAt: new Date("2026-04-16T10:00:00.000Z"),
        updatedAt: new Date("2026-04-16T10:05:00.000Z"),
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-6",
        skillName: "bug-fix",
        prompt: null,
        promptTemplate: "bug-fix",
        triggerType: "event",
        interactive: false,
      },
      workItem: null,
      project: {
        id: testWorkItem.projectId,
        name: "Test Project",
      },
      board: null,
      planningSession: null,
      feedbackItem: null,
      createdByUser: {
        id: testUser.id,
        name: testUser.name,
        image: testUser.image,
      },
    };
  };

  beforeEach(() => {
    state.createdJobInput = null;
    state.listJobs = [];
    state.jobDetailsById = {};
    state.accessibleProjectIds = [testWorkItem.projectId];
    state.lastListFilters = null;
    state.clusterByJobId = new Map();
  });

  it("returns cluster info when job has bug_fix_attempt with cluster", async () => {
    seedJobDetail();
    state.clusterByJobId.set(jobId, { id: "cluster-1", title: "Cluster Foo" });

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(`http://localhost/agent-jobs/${jobId}`, { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { cluster: { id: string; title: string } | null };
    };
    expect(body.success).toBe(true);
    expect(body.data.cluster).toEqual({ id: "cluster-1", title: "Cluster Foo" });
  });

  it("returns null cluster when bug_fix_attempt has no cluster_id (legacy)", async () => {
    seedJobDetail();
    // Simulate: repo found an attempt but it had no cluster_id.
    state.clusterByJobId.set(jobId, null);

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(`http://localhost/agent-jobs/${jobId}`, { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { cluster: { id: string; title: string } | null };
    };
    expect(body.success).toBe(true);
    expect(body.data.cluster).toBeNull();
  });

  it("returns null cluster when job has no bug_fix_attempt", async () => {
    seedJobDetail();
    // No entry in clusterByJobId → mock returns null (repo would return null too).

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(`http://localhost/agent-jobs/${jobId}`, { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { cluster: { id: string; title: string } | null };
    };
    expect(body.success).toBe(true);
    expect(body.data.cluster).toBeNull();
  });

  it("returns cluster from most recent attempt when multiple exist", async () => {
    seedJobDetail();
    // Repo-level ordering (ORDER BY createdAt DESC LIMIT 1) is covered by
    // bug-fix-attempt-repository tests. Here we simulate the contract: when
    // several attempts exist for the same job, the repo resolves to the most
    // recent one. We overwrite the map to represent "a newer attempt arrived"
    // and assert the adapter propagates the latest value.
    state.clusterByJobId.set(jobId, { id: "cluster-old", title: "Older Cluster" });
    state.clusterByJobId.set(jobId, { id: "cluster-new", title: "Newest Cluster" });

    const { agentJobsRoutes } = await import("./agent-jobs.routes");
    const app = new Elysia().use(withTestOrg).use(agentJobsRoutes);

    const res = await app.handle(
      new Request(`http://localhost/agent-jobs/${jobId}`, { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { cluster: { id: string; title: string } | null };
    };
    expect(body.success).toBe(true);
    expect(body.data.cluster).toEqual({ id: "cluster-new", title: "Newest Cluster" });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
