import { describe, expect, it } from "bun:test";
import type {
  ClaimedJob,
  CreateWorkerJobPayload,
  DefinitionOfDoneReviewCandidate,
  ReleaseIntegrationQueueResult,
  ScheduledAgentConfig,
} from "@almirant/remote-agent";
import { RunnerOrchestrator } from "./orchestrator";

const createClaimedJob = (
  id: string,
  estimatedMemoryMb: number,
): ClaimedJob => ({
  id,
  workItemId: null,
  projectId: null,
  boardId: null,
  createdByUserId: null,
  workspaceId: "org-1",
  jobType: "implementation",
  provider: "zipu",
  priority: "medium",
  status: "running",
  retryCount: 0,
  maxRetries: 2,
  availableAt: null,
  config: {
    skillName: "runner-implement",
    resourceEstimate: {
      estimatedMemoryMb,
      source: "forecast",
      confidence: "low",
    },
  },
  promptTemplate: "runner-implement",
  skillName: "runner-implement",
});

const createScheduledBacklogConfig = (
  overrides: Partial<ScheduledAgentConfig> = {},
): ScheduledAgentConfig => ({
  id: "cfg-1",
  workspaceId: "org-1",
  projectId: null,
  projectName: null,
  name: "Nightly Backlog Implementation",
  prompt: null,
  jobType: "implementation",
  provider: "zipu",
  scheduleType: "time_window",
  scheduleConfig: { startHour: 22, endHour: 8, daysOfWeek: [1, 2, 3, 4, 5] },
  timezone: "Europe/Madrid",
  enabled: true,
  targetConfig: { backlogDrain: { enabled: true } },
  mcpServers: null,
  maxJobsPerRun: 10,
  lastRunAt: null,
  createdAt: "2026-04-26T21:00:00.000Z",
  updatedAt: "2026-04-26T21:00:00.000Z",
  codingAgent: "opencode",
  aiProvider: "zai",
  aiModel: "glm-5.1",
  reasoningLevel: "max",
  ...overrides,
});

const emptyBacklogSkipped = () => ({
  excluded: [],
  blocked: [],
  active: [],
  concurrency: [],
  recentlyModified: [],
  dodIncomplete: [],
  notDodRemediation: [],
  missingDodReport: [],
  humanReviewRequired: [],
});

describe("RunnerOrchestrator scheduled backlog drain", () => {
  it("creates backlog-drain implementation jobs with runner-implement", async () => {
    const createdJobs: CreateWorkerJobPayload[] = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          getBacklogDrainCandidates: async () => ({
            candidates: [
              {
                id: "work-item-1",
                taskId: "F-F-1",
                title: "Rename Churroclaw to Flatzer",
                type: "feature",
                parentId: null,
                projectId: "project-1",
                boardId: "board-1",
                provider: "zipu",
                codingAgent: "opencode",
                aiProvider: "zai",
                model: "glm-5.1",
                reasoningLevel: "max",
              },
            ],
            skipped: emptyBacklogSkipped(),
          }),
          createJob: async (payload: CreateWorkerJobPayload) => {
            createdJobs.push(payload);
            return { id: "job-1", status: "queued", config: payload.config ?? null } as never;
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeBacklogDrainConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeBacklogDrainConfig(createScheduledBacklogConfig());

    expect(createdJobs).toHaveLength(1);
    expect(createdJobs[0]).toMatchObject({
      jobType: "implementation",
      config: {
        source: "backlog-drain",
        skillName: "runner-implement",
      },
    });
  });

  it("creates DoD remediation implementation jobs with runner-fix-dod", async () => {
    const createdJobs: CreateWorkerJobPayload[] = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          getDodRemediationCandidates: async () => ({
            candidates: [
              {
                id: "work-item-1",
                taskId: "ZC-155",
                title: "Remove legacy routes",
                type: "task",
                parentId: null,
                projectId: "project-1",
                boardId: "board-1",
                provider: "zipu",
                codingAgent: "opencode",
                aiProvider: "zai",
                model: "glm-5.1",
                reasoningLevel: "max",
                skillName: "runner-fix-dod",
                dodReport: "Legacy routes still render UI.",
                dodReviewedAt: "2026-05-02T18:00:00.000Z",
              },
            ],
            skipped: emptyBacklogSkipped(),
          }),
          createJob: async (payload: CreateWorkerJobPayload) => {
            createdJobs.push(payload);
            return { id: "job-1", status: "queued", config: payload.config ?? null } as never;
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeDodRemediationConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeDodRemediationConfig(createScheduledBacklogConfig({
      targetConfig: { dodRemediation: { enabled: true } },
    }));

    expect(createdJobs).toHaveLength(1);
    expect(createdJobs[0]).toMatchObject({
      jobType: "implementation",
      config: {
        source: "dod-remediation",
        skillName: "runner-fix-dod",
        dodReport: "Legacy routes still render UI.",
        dodReviewedAt: "2026-05-02T18:00:00.000Z",
      },
    });
  });

  it("propagates custom MCP servers from scheduled config to created backlog jobs", async () => {
    const createdJobs: CreateWorkerJobPayload[] = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          getBacklogDrainCandidates: async () => ({
            candidates: [
              {
                id: "work-item-1",
                taskId: "F-F-1",
                title: "Refine partner info",
                type: "feature",
                parentId: null,
                projectId: "project-1",
                boardId: "board-1",
                provider: "zipu",
                codingAgent: "opencode",
                aiProvider: "zai",
                model: "glm-5.1",
                reasoningLevel: "max",
              },
            ],
            skipped: emptyBacklogSkipped(),
          }),
          createJob: async (payload: CreateWorkerJobPayload) => {
            createdJobs.push(payload);
            return { id: "job-1", status: "queued", config: payload.config ?? null } as never;
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeBacklogDrainConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeBacklogDrainConfig(createScheduledBacklogConfig({
      mcpServers: {
        "z-combinator": {
          type: "remote",
          url: "https://mcp.z-combinator.example/mcp",
          enabled: true,
          oauth: false,
        },
      },
    }));

    expect(createdJobs[0]?.config).toMatchObject({
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

  it("keeps backlog-drain active during the time-window cooldown so it can refill slots", () => {
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {} as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    const now = new Date("2026-04-27T22:02:00.000+02:00");
    const config = createScheduledBacklogConfig({
      lastRunAt: new Date(now.getTime() - 60_000).toISOString(),
      scheduleConfig: { startHour: 22, endHour: 8, daysOfWeek: [1] },
      timezone: "Europe/Madrid",
    });

    expect((orchestrator as unknown as {
      isTimeWindowActive: (config: ScheduledAgentConfig, now: Date) => boolean;
    }).isTimeWindowActive(config, now)).toBe(true);
  });

  it("still applies the time-window cooldown to non-backlog scheduled jobs", () => {
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {} as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    const now = new Date("2026-04-27T22:02:00.000+02:00");
    const config = createScheduledBacklogConfig({
      targetConfig: {},
      lastRunAt: new Date(now.getTime() - 60_000).toISOString(),
      scheduleConfig: { startHour: 22, endHour: 8, daysOfWeek: [1] },
      timezone: "Europe/Madrid",
    });

    expect((orchestrator as unknown as {
      isTimeWindowActive: (config: ScheduledAgentConfig, now: Date) => boolean;
    }).isTimeWindowActive(config, now)).toBe(false);
  });
});

describe("RunnerOrchestrator scheduled Definition of Done review", () => {
  it("creates read-only dod-review jobs after the configured stabilization delay", async () => {
    const createdJobs: CreateWorkerJobPayload[] = [];
    const dodCandidateCalls: Array<{
      limit?: number;
      maxActiveJobs?: number;
      minAgeMinutes?: number;
      projectId?: string;
      workspaceId?: string;
    }> = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          getDodReviewCandidates: async (params?: {
            workspaceId?: string;
            projectId?: string;
            limit?: number;
            maxActiveJobs?: number;
            minAgeMinutes?: number;
          }): Promise<DefinitionOfDoneReviewCandidate[]> => {
            dodCandidateCalls.push(params ?? {});
            return [
              {
                id: "work-item-review-1",
                taskId: "A-T-1",
                title: "Review DoD",
                description: null,
                type: "task",
                priority: "medium",
                parentId: null,
                boardId: "board-1",
                projectId: "project-1",
                workspaceId: "org-1",
                columnName: "To Review",
                definitionOfDone: "- Works",
                dodReport: null,
                dodReviewedAt: null,
                updatedAt: "2026-05-02T10:00:00.000Z",
              },
            ];
          },
          createJob: async (payload: CreateWorkerJobPayload) => {
            createdJobs.push(payload);
            return { id: "job-1", status: "queued", config: payload.config ?? null } as never;
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeScheduledConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeScheduledConfig(createScheduledBacklogConfig({
      id: "cfg-dod",
      name: "Nightly Definition of Done Review",
      projectId: "project-1",
      jobType: "review",
      targetConfig: { dodReview: { enabled: true, minAgeMinutes: 15 } },
      maxJobsPerRun: 2,
    }));

    expect(dodCandidateCalls).toEqual([
      {
        projectId: "project-1",
        workspaceId: "org-1",
        limit: 1,
        maxActiveJobs: 1,
        minAgeMinutes: 15,
      },
    ]);
    expect(createdJobs).toHaveLength(1);
    expect(createdJobs[0]).toMatchObject({
      workItemId: "work-item-review-1",
      jobType: "review",
      config: {
        source: "dod-review",
        skillName: "dod-review",
        workspaceIntent: "read-only",
        postSessionPushPolicy: "never",
      },
    });
  });

  it("queries Definition of Done review candidates across configured project scopes", async () => {
    const createdJobs: CreateWorkerJobPayload[] = [];
    const dodCandidateCalls: Array<{
      limit?: number;
      maxActiveJobs?: number;
      minAgeMinutes?: number;
      projectId?: string;
      workspaceId?: string;
    }> = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          getDodReviewCandidates: async (params?: {
            workspaceId?: string;
            projectId?: string;
            limit?: number;
            maxActiveJobs?: number;
            minAgeMinutes?: number;
          }): Promise<DefinitionOfDoneReviewCandidate[]> => {
            dodCandidateCalls.push(params ?? {});
            if (!params?.projectId) return [];
            return [
              {
                id: `work-item-${params.projectId}`,
                taskId: `A-${params.projectId}`,
                title: `Review ${params.projectId}`,
                description: null,
                type: "task",
                priority: "medium",
                parentId: null,
                boardId: "board-1",
                projectId: params.projectId,
                workspaceId: "org-1",
                columnName: "To Review",
                definitionOfDone: "- Works",
                dodReport: null,
                dodReviewedAt: null,
                updatedAt: "2026-05-02T10:00:00.000Z",
              },
            ];
          },
          createJob: async (payload: CreateWorkerJobPayload) => {
            createdJobs.push(payload);
            return { id: `job-${createdJobs.length}`, status: "queued", config: payload.config ?? null } as never;
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeScheduledConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeScheduledConfig(createScheduledBacklogConfig({
      id: "cfg-dod-multi",
      name: "Definition of Done Review",
      projectId: null,
      jobType: "review",
      targetConfig: {
        projectIds: ["project-1", "project-2"],
        dodReview: { enabled: true, minAgeMinutes: 15 },
      },
      maxJobsPerRun: 2,
    }));

    expect(dodCandidateCalls).toEqual([
      {
        projectId: "project-1",
        workspaceId: "org-1",
        limit: 1,
        maxActiveJobs: 1,
        minAgeMinutes: 15,
      },
      {
        projectId: "project-2",
        workspaceId: "org-1",
        limit: 1,
        maxActiveJobs: 1,
        minAgeMinutes: 15,
      },
    ]);
    expect(createdJobs.map((job) => job.workItemId)).toEqual([
      "work-item-project-1",
      "work-item-project-2",
    ]);
  });

  it("caps Definition of Done review candidate requests by per-project open ticket limits", async () => {
    const dodCandidateCalls: Array<{
      limit?: number;
      maxActiveJobs?: number;
      minAgeMinutes?: number;
      projectId?: string;
      workspaceId?: string;
    }> = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          getDodReviewCandidates: async (params?: {
            workspaceId?: string;
            projectId?: string;
            limit?: number;
            maxActiveJobs?: number;
            minAgeMinutes?: number;
          }): Promise<DefinitionOfDoneReviewCandidate[]> => {
            dodCandidateCalls.push(params ?? {});
            return [];
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeScheduledConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeScheduledConfig(createScheduledBacklogConfig({
      id: "cfg-dod-limits",
      name: "Definition of Done Review",
      projectId: null,
      jobType: "review",
      targetConfig: {
        dodReview: {
          enabled: true,
          minAgeMinutes: 15,
          defaultMaxConcurrentJobs: 2,
          projects: [
            { projectId: "project-1", enabled: true, maxConcurrentJobs: 1 },
            { projectId: "project-2", enabled: true },
          ],
        },
      },
      maxJobsPerRun: 10,
    }));

    expect(dodCandidateCalls).toEqual([
      {
        projectId: "project-1",
        workspaceId: "org-1",
        limit: 1,
        maxActiveJobs: 1,
        minAgeMinutes: 15,
      },
      {
        projectId: "project-2",
        workspaceId: "org-1",
        limit: 2,
        maxActiveJobs: 2,
        minAgeMinutes: 15,
      },
    ]);
  });
});

describe("RunnerOrchestrator scheduled release integration", () => {
  it("delegates validating work item batching to the release integration worker endpoint", async () => {
    const queueCalls: Array<{
      projectId?: string;
      workspaceId?: string;
      limit?: number;
      maxActiveItems?: number;
      minAgeMinutes?: number;
    }> = [];
    let lastRunUpdated = false;
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          queueReleaseIntegration: async (params?: {
            workspaceId?: string;
            projectId?: string;
            limit?: number;
            maxActiveItems?: number;
            minAgeMinutes?: number;
          }): Promise<ReleaseIntegrationQueueResult> => {
            queueCalls.push(params ?? {});
            return {
              batches: [
                {
                  batchId: "batch-1",
                  repositoryId: "repo-1",
                  projectId: "project-1",
                  created: true,
                  enqueuedItemCount: 1,
                },
              ],
              skipped: {
                noCandidates: 0,
                activeRunningBatches: 0,
                activeProjectLimit: 0,
                duplicateItems: 0,
                missingPullRequest: 0,
                unresolvedRepository: 0,
              },
            };
          },
          updateScheduledConfigLastRunAt: async () => {
            lastRunUpdated = true;
            return {};
          },
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeScheduledConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeScheduledConfig(createScheduledBacklogConfig({
      id: "cfg-release",
      name: "Release Integration",
      projectId: "project-1",
      jobType: "integration",
      targetConfig: { releaseIntegration: { enabled: true } },
      maxJobsPerRun: 20,
    }));

    expect(queueCalls).toEqual([
      {
        projectId: "project-1",
        workspaceId: "org-1",
        limit: 1,
        maxActiveItems: 1,
        minAgeMinutes: 15,
      },
    ]);
    expect(lastRunUpdated).toBe(true);
  });

  it("queues release integration per configured project scope", async () => {
    const queueCalls: Array<{
      projectId?: string;
      workspaceId?: string;
      limit?: number;
      maxActiveItems?: number;
      minAgeMinutes?: number;
    }> = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          queueReleaseIntegration: async (params?: {
            workspaceId?: string;
            projectId?: string;
            limit?: number;
            maxActiveItems?: number;
            minAgeMinutes?: number;
          }): Promise<ReleaseIntegrationQueueResult> => {
            queueCalls.push(params ?? {});
            return {
              batches: [
                {
                  batchId: `batch-${params?.projectId}`,
                  repositoryId: "repo-1",
                  projectId: params?.projectId ?? "project-all",
                  created: true,
                  enqueuedItemCount: 1,
                },
              ],
              skipped: {
                noCandidates: 0,
                activeRunningBatches: 0,
                activeProjectLimit: 0,
                duplicateItems: 0,
                missingPullRequest: 0,
                unresolvedRepository: 0,
              },
            };
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeScheduledConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeScheduledConfig(createScheduledBacklogConfig({
      id: "cfg-release-multi",
      name: "Release Integration",
      projectId: null,
      jobType: "integration",
      targetConfig: {
        projectIds: ["project-1", "project-2"],
        releaseIntegration: { enabled: true },
      },
      maxJobsPerRun: 2,
    }));

    expect(queueCalls).toEqual([
      {
        projectId: "project-1",
        workspaceId: "org-1",
        limit: 1,
        maxActiveItems: 1,
        minAgeMinutes: 15,
      },
      {
        projectId: "project-2",
        workspaceId: "org-1",
        limit: 1,
        maxActiveItems: 1,
        minAgeMinutes: 15,
      },
    ]);
  });

  it("caps release integration queueing by per-project open ticket limits", async () => {
    const queueCalls: Array<{
      projectId?: string;
      workspaceId?: string;
      limit?: number;
      maxActiveItems?: number;
      minAgeMinutes?: number;
    }> = [];
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          queueReleaseIntegration: async (params?: {
            workspaceId?: string;
            projectId?: string;
            limit?: number;
            maxActiveItems?: number;
            minAgeMinutes?: number;
          }): Promise<ReleaseIntegrationQueueResult> => {
            queueCalls.push(params ?? {});
            return {
              batches: [],
              skipped: {
                noCandidates: 0,
                activeRunningBatches: 0,
                activeProjectLimit: 0,
                duplicateItems: 0,
                missingPullRequest: 0,
                unresolvedRepository: 0,
              },
            };
          },
          updateScheduledConfigLastRunAt: async () => ({}),
        } as never,
        containerManager: {} as never,
        jobExecutor: {} as never,
      },
    );

    await (orchestrator as unknown as {
      executeScheduledConfig: (config: ScheduledAgentConfig) => Promise<void>;
    }).executeScheduledConfig(createScheduledBacklogConfig({
      id: "cfg-release-limits",
      name: "Release Integration",
      projectId: null,
      jobType: "integration",
      targetConfig: {
        releaseIntegration: {
          enabled: true,
          minAgeMinutes: 0,
          defaultMaxConcurrentJobs: 3,
          projects: [
            { projectId: "project-1", enabled: true, maxConcurrentJobs: 1 },
            { projectId: "project-2", enabled: true },
          ],
        },
      },
      maxJobsPerRun: 10,
    }));

    expect(queueCalls).toEqual([
      {
        projectId: "project-1",
        workspaceId: "org-1",
        limit: 1,
        maxActiveItems: 1,
        minAgeMinutes: 0,
      },
      {
        projectId: "project-2",
        workspaceId: "org-1",
        limit: 3,
        maxActiveItems: 3,
        minAgeMinutes: 0,
      },
    ]);
  });
});

describe("RunnerOrchestrator container health", () => {
  it("degrades the worker and stops claiming when orphan cleanup finds zombies", async () => {
    let claimCalls = 0;
    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 4,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          claimJobs: async () => {
            claimCalls += 1;
            return [];
          },
        } as never,
        containerManager: {
          cleanupOrphanedContainers: async () => ({
            removed: 0,
            failed: 1,
            zombieSuspected: 1,
            issues: [
              {
                containerId: "container-zombie",
                jobId: "job-zombie",
                action: "remove",
                message: "PID is zombie and can not be killed",
                zombieSuspected: true,
              },
            ],
          }),
          detectManagedContainerAnomalies: async () => [],
        } as never,
        jobExecutor: {} as never,
      },
    );

    (orchestrator as unknown as { running: boolean }).running = true;
    await (orchestrator as unknown as { cleanupOrphans: () => Promise<void> }).cleanupOrphans();
    await (orchestrator as unknown as { claimAndRun: () => Promise<void> }).claimAndRun();

    expect(claimCalls).toBe(0);
    expect(orchestrator.getSnapshot()).toMatchObject({
      isDraining: true,
      availableSlots: 0,
    });
  });
});

describe("RunnerOrchestrator RAM budget claiming", () => {
  it("does not head-of-line block when an older claimed job exceeds available RAM", async () => {
    const claimPayloads: Array<{ count: number; activeJobs?: number }> = [];
    const releasedJobIds: string[] = [];
    const executedJobIds: string[] = [];
    const tooLargeJob = createClaimedJob("job-too-large", 9000);
    const fittingJob = createClaimedJob("job-fits", 2560);
    const claimedBatches: ClaimedJob[][] = [
      [tooLargeJob, fittingJob],
      [],
    ];

    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 5,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: true,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          claimJobs: async (payload: { count: number; activeJobs?: number }) => {
            claimPayloads.push(payload);
            return claimedBatches.shift() ?? [];
          },
          updateJobStatus: async (jobId: string, payload: { status: string }) => {
            if (payload.status === "queued") {
              releasedJobIds.push(jobId);
            }
          },
        } as never,
        containerManager: {} as never,
        jobExecutor: {
          execute: async (job: ClaimedJob) => {
            executedJobIds.push(job.id);
          },
        } as never,
      },
    );

    (orchestrator as unknown as { running: boolean }).running = true;
    (orchestrator as unknown as {
      getMemorySnapshot: () => {
        totalMb: number;
        systemAvailableMb: number;
        reservedMb: number;
        budgetMb: number;
        committedMb: number;
        availableForRunnersMb: number;
        pressurePercent: number;
        source: "os";
      };
    }).getMemorySnapshot = () => ({
      totalMb: 12_000,
      systemAvailableMb: 10_000,
      reservedMb: 2_000,
      budgetMb: 10_000,
      committedMb: 0,
      availableForRunnersMb: 8_000,
      pressurePercent: 16.67,
      source: "os",
    });

    await (orchestrator as unknown as { claimAndRun: () => Promise<void> }).claimAndRun();

    expect(claimPayloads[0]?.count).toBeGreaterThan(1);
    expect(releasedJobIds).toContain("job-too-large");
    expect(executedJobIds).toContain("job-fits");
  });

  it("pauses a claimed job before starting a container when provider quota is exhausted", async () => {
    const statusUpdates: Array<{ jobId: string; payload: Record<string, unknown> }> = [];
    let executeCalls = 0;
    const quotaBlockedJob: ClaimedJob = {
      ...createClaimedJob("job-quota", 512),
      aiProvider: "openai",
      workspaceId: "org-1",
    };

    const orchestrator = new RunnerOrchestrator(
      {
        workerId: "worker-1",
        hostname: "runner.local",
        maxConcurrent: 1,
        heartbeatIntervalMs: 10_000,
        claimIntervalMs: 10_000,
        nightlyCheckIntervalMs: 60_000,
        ramBudgetEnabled: false,
        apiUrl: "https://api.local",
        apiKey: "test-key",
      },
      {
        workerClient: {
          checkQuota: async (provider: string, workspaceId?: string) => {
            expect(provider).toBe("openai");
            expect(workspaceId).toBe("org-1");
            return {
              allowed: false,
              reason: "weekly token limit exceeded",
              resetAt: "2026-05-04T00:00:00.000Z",
              blockingQuotaType: "weekly",
            };
          },
          updateJobStatus: async (jobId: string, payload: Record<string, unknown>) => {
            statusUpdates.push({ jobId, payload });
          },
        } as never,
        containerManager: {} as never,
        jobExecutor: {
          execute: async () => {
            executeCalls += 1;
          },
        } as never,
      },
    );

    await (orchestrator as unknown as { executeJob: (job: ClaimedJob) => Promise<void> }).executeJob(quotaBlockedJob);

    expect(executeCalls).toBe(0);
    expect(statusUpdates).toHaveLength(1);
    expect(statusUpdates[0]).toEqual({
      jobId: "job-quota",
      payload: {
        status: "paused",
        errorMessage: "weekly token limit exceeded",
        errorType: "weekly_quota_exceeded",
        availableAt: "2026-05-04T00:00:00.000Z",
        result: {
          pausedForQuota: true,
          source: "pre_session_quota_check",
          aiProvider: "openai",
          resetAt: "2026-05-04T00:00:00.000Z",
        },
      },
    });
  });
});
