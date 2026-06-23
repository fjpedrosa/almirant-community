/**
 * E2E Smoke Test for Runner Orchestrator Flow
 *
 * Tests the real orchestrator loop (claim -> execute -> report) with mocked
 * external dependencies (Docker containers, Discord, Worker API).
 *
 * Run: cd services/runner && bun test test/e2e-smoke.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { RunnerOrchestrator, createRunnerOrchestrator } from "../src/orchestration/orchestrator";
import type { ContainerManager } from "../src/workspace/container-manager";
import type { JobExecutor } from "../src/job-executor";
import type { AlmirantWorkerClient, ClaimedJob } from "@almirant/remote-agent";
import type { JobExecutionResult } from "../src/shared/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_WORKER_ID = "test-worker-001";
const TEST_HOSTNAME = "test-host";

const createMockJob = (overrides?: Partial<ClaimedJob>): ClaimedJob => ({
  id: `job-${Math.random().toString(36).slice(2, 8)}`,
  workItemId: "work-item-001",
  projectId: "project-001",
  boardId: "board-001",
  createdByUserId: "user-001",
  organizationId: "org-001",
  jobType: "implementation",
  provider: "codex",
  priority: "medium",
  status: "running",
  retryCount: 0,
  maxRetries: 3,
  availableAt: null,
  config: { repoPath: ".", baseBranch: "main" },
  ...overrides,
});

type HeartbeatCall = {
  workerId: string;
  hostname: string;
  activeJobsCount: number;
  maxConcurrentAgents: number;
};

type ClaimCall = {
  workerId: string;
  count: number;
  activeJobs: number;
};

type StatusCall = {
  jobId: string;
  status: string;
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockWorkerClient = () => {
  const heartbeatCalls: HeartbeatCall[] = [];
  const claimCalls: ClaimCall[] = [];
  const statusCalls: StatusCall[] = [];
  let jobsToReturn: ClaimedJob[] = [];

  const client: AlmirantWorkerClient = {
    heartbeat: async (payload) => {
      heartbeatCalls.push(payload as HeartbeatCall);
      return {};
    },
    claimJobs: async (payload) => {
      claimCalls.push(payload as ClaimCall);
      const jobs = jobsToReturn;
      jobsToReturn = [];
      return jobs;
    },
    updateJobStatus: async (jobId, payload) => {
      statusCalls.push({ jobId, status: payload.status });
      return {};
    },
    getProviderKeys: async () => ({}),
    getGithubToken: async () => ({
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    checkQuota: async () => ({ allowed: true }),
    createInteraction: async (_jobId, _payload) => ({
      id: "interaction-001",
      agentJobId: _jobId,
      status: "pending" as const,
      questionType: _payload.questionType,
      questionText: _payload.questionText,
      questionContext: null,
      options: null,
      response: null,
      responseSource: null,
      answeredAt: null,
      expiresAt: _payload.expiresAt,
      timeoutAction: "fail",
      defaultAnswer: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    pollInteraction: async () => ({
      id: "interaction-001",
      agentJobId: "job-001",
      status: "answered" as const,
      questionType: "choice" as const,
      questionText: "test?",
      questionContext: null,
      options: null,
      response: "yes",
      responseSource: "user" as const,
      answeredAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      timeoutAction: "fail",
      defaultAnswer: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    streamJobOutput: async () => ({ processed: 0, stepIndex: 0 }),
    sendJobLogs: async () => ({
      jobId: "job-001",
      received: 0,
      inserted: 0,
      duplicates: 0,
    }),
    getJobStatus: async () => ({ status: "running" as const }),
    getWorkItem: async () => ({
      id: "work-item-001",
      taskId: "A-T-42",
      title: "Test work item",
      description: "Test description",
      boardId: "board-001",
      boardColumnId: "col-001",
      projectId: "project-001",
      type: "task",
      priority: "medium",
      metadata: null,
    }),
  };

  return {
    client,
    heartbeatCalls,
    claimCalls,
    statusCalls,
    setJobsToReturn: (jobs: ClaimedJob[]) => {
      jobsToReturn = jobs;
    },
  };
};

const createMockContainerManager = () => {
  const createdContainers: string[] = [];
  const startedContainers: string[] = [];
  const removedContainers: string[] = [];

  const manager = {
    ping: async () => true,
    pullImage: async () => {},
    createContainer: async (jobId: string) => {
      const containerId = `container-${jobId}`;
      createdContainers.push(containerId);
      return containerId;
    },
    startContainer: async (containerId: string) => {
      startedContainers.push(containerId);
    },
    streamContainerLogs: async () => {
      const { Readable } = await import("node:stream");
      return new Readable({
        read() {
          this.push(null);
        },
      });
    },
    waitContainer: async () => 0,
    getContainerIp: async () => "172.17.0.2",
    connectToNetwork: async () => {},
    getRunnerNetworkName: async () => null,
    stopContainer: async () => {},
    removeContainer: async (containerId: string) => {
      removedContainers.push(containerId);
    },
    listManagedContainers: async () => [],
    cleanupOrphanedContainers: async () => 0,
  } as unknown as ContainerManager;

  return {
    manager,
    createdContainers,
    startedContainers,
    removedContainers,
  };
};

const createMockJobExecutor = () => {
  const executedJobs: ClaimedJob[] = [];
  let executionDelay = 10;
  let shouldFail = false;

  const executor = {
    execute: async (job: ClaimedJob): Promise<JobExecutionResult> => {
      if (shouldFail) {
        throw new Error("Container creation failed");
      }
      executedJobs.push(job);
      await new Promise((resolve) => setTimeout(resolve, executionDelay));
      return {
        jobId: job.id,
        success: true,
        exitCode: 0,
        summary: "mock execution complete",
      };
    },
  } as unknown as JobExecutor;

  return {
    executor,
    executedJobs,
    setExecutionDelay: (ms: number) => {
      executionDelay = ms;
    },
    setShouldFail: (fail: boolean) => {
      shouldFail = fail;
    },
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E Smoke: Runner Orchestrator", () => {
  let orchestrator: RunnerOrchestrator;
  let mockClient: ReturnType<typeof createMockWorkerClient>;
  let mockContainer: ReturnType<typeof createMockContainerManager>;
  let mockExecutor: ReturnType<typeof createMockJobExecutor>;

  beforeEach(() => {
    mockClient = createMockWorkerClient();
    mockContainer = createMockContainerManager();
    mockExecutor = createMockJobExecutor();

    orchestrator = createRunnerOrchestrator(
      {
        workerId: TEST_WORKER_ID,
        hostname: TEST_HOSTNAME,
        maxConcurrent: 2,
        heartbeatIntervalMs: 50_000, // high to avoid interference
        claimIntervalMs: 50_000, // high to avoid interference
      },
      {
        workerClient: mockClient.client,
        containerManager: mockContainer.manager,
        jobExecutor: mockExecutor.executor,
      }
    );
  });

  afterEach(async () => {
    await orchestrator.stop();
  });

  it("sends heartbeat on start", async () => {
    orchestrator.start();

    // Allow the first heartbeat tick
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockClient.heartbeatCalls.length).toBeGreaterThanOrEqual(1);
    expect(mockClient.heartbeatCalls[0].workerId).toBe(TEST_WORKER_ID);
    expect(mockClient.heartbeatCalls[0].hostname).toBe(TEST_HOSTNAME);
    expect(mockClient.heartbeatCalls[0].maxConcurrentAgents).toBe(2);
  });

  it("claims and executes a job", async () => {
    const testJob = createMockJob({ id: "smoke-job-001" });
    mockClient.setJobsToReturn([testJob]);

    orchestrator.start();

    // Allow the first claim + execution cycle
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockClient.claimCalls.length).toBeGreaterThanOrEqual(1);
    expect(mockClient.claimCalls[0].workerId).toBe(TEST_WORKER_ID);
    expect(mockClient.claimCalls[0].count).toBe(2); // maxConcurrent

    expect(mockExecutor.executedJobs.length).toBe(1);
    expect(mockExecutor.executedJobs[0].id).toBe("smoke-job-001");
  });

  it("reports snapshot with active job count", async () => {
    mockExecutor.setExecutionDelay(500); // keep job alive longer
    const testJob = createMockJob({ id: "snapshot-job-001" });
    mockClient.setJobsToReturn([testJob]);

    orchestrator.start();

    // Allow claim to happen
    await new Promise((resolve) => setTimeout(resolve, 100));

    const snapshot = orchestrator.getSnapshot();
    expect(snapshot.workerId).toBe(TEST_WORKER_ID);
    expect(snapshot.isRunning).toBe(true);
    expect(snapshot.activeJobs).toBe(1);
  });

  it("respects maxConcurrent limit", async () => {
    mockExecutor.setExecutionDelay(500); // keep jobs alive

    const jobs = [
      createMockJob({ id: "concurrent-1" }),
      createMockJob({ id: "concurrent-2" }),
      createMockJob({ id: "concurrent-3" }),
    ];
    mockClient.setJobsToReturn(jobs);

    orchestrator.start();

    // Allow claim cycle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // maxConcurrent is 2, so only 2 should be requested
    expect(mockClient.claimCalls[0].count).toBe(2);
  });

  it("does not claim when at capacity", async () => {
    mockExecutor.setExecutionDelay(2000); // keep jobs alive long

    // Fill both slots
    const jobs = [
      createMockJob({ id: "full-1" }),
      createMockJob({ id: "full-2" }),
    ];
    mockClient.setJobsToReturn(jobs);

    orchestrator.start();

    // Allow first claim
    await new Promise((resolve) => setTimeout(resolve, 100));

    const snapshot = orchestrator.getSnapshot();
    expect(snapshot.activeJobs).toBe(2);

    // Verify claim count was limited to available slots
    expect(mockClient.claimCalls[0].count).toBe(2);
  });

  it("releases slot after job completes", async () => {
    mockExecutor.setExecutionDelay(50); // fast execution

    const testJob = createMockJob({ id: "release-job" });
    mockClient.setJobsToReturn([testJob]);

    orchestrator.start();

    // Allow execution to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const snapshot = orchestrator.getSnapshot();
    expect(snapshot.activeJobs).toBe(0);
  });

  it("handles duplicate job IDs gracefully", async () => {
    mockExecutor.setExecutionDelay(500);

    const testJob = createMockJob({ id: "dup-job" });
    mockClient.setJobsToReturn([testJob, testJob]); // same ID twice

    orchestrator.start();

    // Allow claim cycle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should only execute once despite receiving the same job ID twice
    expect(mockExecutor.executedJobs.length).toBe(1);
  });

  it("gracefully stops with active jobs", async () => {
    mockExecutor.setExecutionDelay(200);

    const testJob = createMockJob({ id: "stop-job" });
    mockClient.setJobsToReturn([testJob]);

    orchestrator.start();

    // Allow claim
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(orchestrator.getSnapshot().activeJobs).toBe(1);

    // Stop should wait for active jobs
    await orchestrator.stop();
    expect(orchestrator.getSnapshot().isRunning).toBe(false);
    expect(orchestrator.getSnapshot().activeJobs).toBe(0);
  });

  it("handles claim failure gracefully", async () => {
    // Override claimJobs to throw
    const originalClaim = mockClient.client.claimJobs;
    mockClient.client.claimJobs = async () => {
      throw new Error("Network error");
    };

    orchestrator.start();

    // Allow claim cycle to fire and fail
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Orchestrator should still be running despite claim failure
    expect(orchestrator.getSnapshot().isRunning).toBe(true);
    expect(orchestrator.getSnapshot().activeJobs).toBe(0);

    // Restore for cleanup
    mockClient.client.claimJobs = originalClaim;
  });

  it("handles executor failure gracefully", async () => {
    mockExecutor.setShouldFail(true);

    const testJob = createMockJob({ id: "fail-job" });
    mockClient.setJobsToReturn([testJob]);

    orchestrator.start();

    // Allow execution to fail
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Slot should be released even on failure
    expect(orchestrator.getSnapshot().activeJobs).toBe(0);
    // Orchestrator should still be running
    expect(orchestrator.getSnapshot().isRunning).toBe(true);

    // Restore for cleanup
    mockExecutor.setShouldFail(false);
  });
});

describe("E2E Smoke: Worker Client Contract", () => {
  it("mock client implements full AlmirantWorkerClient interface", () => {
    const { client } = createMockWorkerClient();

    // Verify all methods exist (compile-time check + runtime validation)
    const requiredMethods: (keyof AlmirantWorkerClient)[] = [
      "heartbeat",
      "claimJobs",
      "updateJobStatus",
      "getProviderKeys",
      "getGithubToken",
      "checkQuota",
      "createInteraction",
      "pollInteraction",
      "streamJobOutput",
      "sendJobLogs",
      "getJobStatus",
      "getWorkItem",
    ];

    for (const method of requiredMethods) {
      expect(typeof client[method]).toBe("function");
    }
  });

  it("heartbeat returns without error", async () => {
    const { client } = createMockWorkerClient();
    await expect(
      client.heartbeat({
        workerId: "test",
        hostname: "test",
        activeJobsCount: 0,
        maxConcurrentAgents: 2,
      })
    ).resolves.toBeDefined();
  });

  it("claimJobs returns array of ClaimedJob", async () => {
    const { client, setJobsToReturn } = createMockWorkerClient();
    const job = createMockJob();
    setJobsToReturn([job]);

    const result = await client.claimJobs({
      workerId: "test",
      count: 1,
      activeJobs: 0,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(job.id);
    expect(result[0].workItemId).toBe("work-item-001");
    expect(result[0].provider).toBe("codex");
  });

  it("createInteraction returns pending interaction", async () => {
    const { client } = createMockWorkerClient();

    const interaction = await client.createInteraction("job-001", {
      questionType: "choice",
      questionText: "Which approach?",
      options: ["A", "B"],
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });

    expect(interaction.id).toBe("interaction-001");
    expect(interaction.status).toBe("pending");
    expect(interaction.agentJobId).toBe("job-001");
  });

  it("pollInteraction returns answered interaction", async () => {
    const { client } = createMockWorkerClient();

    const interaction = await client.pollInteraction("job-001", "interaction-001");

    expect(interaction.status).toBe("answered");
    expect(interaction.response).toBe("yes");
  });

  it("getWorkItem returns work item details", async () => {
    const { client } = createMockWorkerClient();

    const workItem = await client.getWorkItem("work-item-001");

    expect(workItem.id).toBe("work-item-001");
    expect(workItem.taskId).toBe("A-T-42");
    expect(workItem.title).toBe("Test work item");
    expect(workItem.boardId).toBe("board-001");
  });
});
