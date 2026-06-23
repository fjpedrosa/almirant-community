import { describe, expect, it } from "bun:test";
import type { AlmirantWorkerClient, JobLogEntryPayload } from "@almirant/remote-agent";
import { createRunnerJobEventLogger } from "./job-event-logger";

const createWorkerClientMock = (collector: JobLogEntryPayload[][]): AlmirantWorkerClient => {
  return {
    heartbeat: async () => ({}),
    claimJobs: async () => [],
    createJob: async () => {
      throw new Error("not used");
    },
    updateJobStatus: async () => ({}),
    getProviderKeys: async () => ({}),
    getGithubToken: async () => ({ token: "x", expiresAt: new Date().toISOString() }),
    checkQuota: async () => ({ allowed: true }),
    createInteraction: async () => {
      throw new Error("not used");
    },
    pollInteraction: async () => {
      throw new Error("not used");
    },
    getRepoConfig: async () => {
      throw new Error("not used");
    },
    streamJobOutput: async () => ({ processed: 0, stepIndex: 0 }),
    sendJobLogs: async (_jobId, payload) => {
      collector.push(payload.logs);
      return {
        jobId: "job-1",
        received: payload.logs.length,
        inserted: payload.logs.length,
        duplicates: 0,
      };
    },
    getJobStatus: async () => ({ status: "running" }),
    getJobConfig: async () => ({ jobType: "implementation", config: null, status: "running" }),
    getWorkspaceFile: async () => {
      throw new Error("not used");
    },
    getValidationCandidates: async () => [],
    getDodReviewCandidates: async () => [],
    getNightlyValidationConfig: async () => ({
      enabled: false,
      startHour: 1,
      endHour: 6,
      timezone: "Europe/Madrid",
      provider: "claude-code",
    }),
    getAllNightlyValidationConfigs: async () => [],
    getFixCandidates: async () => [],
    getBacklogDrainCandidates: async () => ({
      candidates: [],
      skipped: {
        excluded: [],
        blocked: [],
        active: [],
        concurrency: [],
        recentlyModified: [],
        dodIncomplete: [],
        notDodRemediation: [],
        missingDodReport: [],
        humanReviewRequired: [],
      },
    }),
    getDodRemediationCandidates: async () => ({
      candidates: [],
      skipped: {
        excluded: [],
        blocked: [],
        active: [],
        concurrency: [],
        recentlyModified: [],
        dodIncomplete: [],
        notDodRemediation: [],
        missingDodReport: [],
        humanReviewRequired: [],
      },
    }),
    queueReleaseIntegration: async () => ({
      batches: [],
      skipped: {
        noCandidates: 0,
        activeRunningBatches: 0,
        activeProjectLimit: 0,
        duplicateItems: 0,
        missingPullRequest: 0,
        unresolvedRepository: 0,
      },
    }),
    resetStaleChildTasks: async () => ({ resetIds: [] }),
    getJobTranscript: async () => ({ transcript: "" }),
    getJobSessionEvents: async () => [],
    getJobCompletionSnapshot: async (jobId: string) => ({
      jobId,
      rootWorkItemId: null,
      expectedWorkItemIds: [],
      completedWorkItemIds: [],
    }),
    getScheduledConfigs: async () => [],
    updateScheduledConfigLastRunAt: async () => ({}),
    getIntegrationBatch: async () => {
      throw new Error("not used");
    },
    updateIntegrationBatch: async () => ({}),
    updateIntegrationBatchItem: async () => ({}),
    ensureIntegrationReleasePr: async () => {
      throw new Error("not used");
    },
    refreshIntegrationReleasePrBody: async () => {
      throw new Error("not used");
    },
    mergeIntegrationReleasePr: async () => {
      throw new Error("not used");
    },
    getWorkItem: async () => {
      throw new Error("not used");
    },
  };
};

describe("RunnerJobEventLogger", () => {
  it("skips debug entries when debug is disabled", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock(sent),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 50,
    });

    logger.debug("session", "session.debug", "hidden");
    logger.info("session", "session.created", "visible");
    await logger.stop();

    const flat = sent.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0]?.eventType).toBe("session.created");
  });

  it("includes debug entries when debug is enabled", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock(sent),
      debugEnabled: true,
      flushIntervalMs: 60_000,
      batchSize: 50,
    });

    logger.debug("session", "session.debug", "debug-visible");
    logger.info("session", "session.created", "visible");
    await logger.stop();

    const flat = sent.flat();
    expect(flat).toHaveLength(2);
    expect(flat[0]?.eventType).toBe("session.debug");
    expect(flat[1]?.eventType).toBe("session.created");
  });

  it("persists transcript chunks with phase=transcript and eventType=raw_output", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock(sent),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 50,
    });

    logger.transcript("Hello ");
    logger.transcript("world");
    await logger.stop();

    const flat = sent.flat();
    expect(flat).toHaveLength(2);
    expect(flat[0]?.phase).toBe("transcript");
    expect(flat[0]?.eventType).toBe("raw_output");
    expect(flat[0]?.level).toBe("info");
    expect(flat[0]?.message).toBe("Hello ");
    expect(flat[1]?.message).toBe("world");
  });

  it("ignores empty transcript chunks", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock(sent),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 50,
    });

    logger.transcript("");
    logger.transcript("non-empty");
    await logger.stop();

    const flat = sent.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0]?.message).toBe("non-empty");
  });
});
