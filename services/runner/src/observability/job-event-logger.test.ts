import { describe, expect, it } from "bun:test";
import type { AlmirantWorkerClient, JobLogEntryPayload } from "@almirant/remote-agent";
import { createRunnerJobEventLogger } from "./job-event-logger";
import { createJobSecretRedactor } from "../security/job-secret-redactor";

type SendJobLogs = AlmirantWorkerClient["sendJobLogs"];

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createWorkerClientMock = (
  collector: JobLogEntryPayload[][],
  sendJobLogsOverride?: SendJobLogs,
): AlmirantWorkerClient => {
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
    sendJobLogs:
      sendJobLogsOverride ??
      (async (_jobId, payload) => {
        collector.push(payload.logs);
        return {
          jobId: "job-1",
          received: payload.logs.length,
          inserted: payload.logs.length,
          duplicates: 0,
        };
      }),
    getJobStatus: async () => ({ status: "running" }),
    getJobConfig: async () => ({ jobType: "implementation", config: null, status: "running" }),
    getWorkspaceFile: async () => {
      throw new Error("not used");
    },
    getAgentPluginBundle: async () => {
      throw new Error("not used");
    },
    getEvidenceArtifact: async () => {
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
  it("propagates terminal cancellation into an in-flight strict log drain", async () => {
    let observedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const workerClient = createWorkerClientMock(
      [],
      async (_jobId, payload, requestOptions) => {
        observedSignal = requestOptions?.signal;
        controller.abort(new Error("terminal_deadline_exceeded"));
        await Promise.resolve();
        return {
          jobId: "job-1",
          received: payload.logs.length,
          inserted: payload.logs.length,
          duplicates: 0,
        };
      },
    );
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient,
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 50,
    });
    logger.info("finish", "job.finished", "must not persist after cutoff");

    await expect(logger.stop({
      signal: controller.signal,
      timeoutMs: 30_000,
    })).rejects.toThrow("terminal_deadline_exceeded");
    expect(observedSignal).toBe(controller.signal);
    expect(logger.getSequenceHighWater()).toBe(0);
  });

  it("strictly drains every batch before stop resolves", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const firstSend = createDeferred<void>();
    let sendCount = 0;
    const workerClient = createWorkerClientMock(sent, async (_jobId, payload) => {
      sent.push(payload.logs);
      sendCount += 1;
      if (sendCount === 1) await firstSend.promise;
      return {
        jobId: "job-1",
        received: payload.logs.length,
        inserted: payload.logs.length,
        duplicates: 0,
      };
    });
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient,
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 2,
    });

    for (let seq = 1; seq <= 5; seq += 1) {
      logger.info("session", `event.${seq}`, `entry ${seq}`);
    }

    const stopped = logger.stop();
    firstSend.resolve();
    await stopped;

    expect(sent.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(sent.flat().map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drains entries enqueued while a flush is in flight", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const firstSend = createDeferred<void>();
    let sendCount = 0;
    const workerClient = createWorkerClientMock(sent, async (_jobId, payload) => {
      sent.push(payload.logs);
      sendCount += 1;
      if (sendCount === 1) await firstSend.promise;
      return {
        jobId: "job-1",
        received: payload.logs.length,
        inserted: payload.logs.length,
        duplicates: 0,
      };
    });
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient,
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 2,
    });

    logger.info("session", "event.1", "first");
    logger.info("session", "event.2", "second");
    logger.info("session", "event.3", "queued during flush");

    const stopped = logger.stop();
    firstSend.resolve();
    await stopped;

    expect(sent.map((batch) => batch.map((entry) => entry.seq))).toEqual([
      [1, 2],
      [3],
    ]);
  });

  it("fails closed after bounded strict-drain retries", async () => {
    const sent: JobLogEntryPayload[][] = [];
    let sendAttempts = 0;
    const workerClient = createWorkerClientMock(sent, async () => {
      sendAttempts += 1;
      throw new Error("log persistence unavailable");
    });
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient,
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 50,
    });
    logger.info("session", "event.1", "must persist before release");

    await expect(logger.stop()).rejects.toThrow("log persistence unavailable");
    expect(sendAttempts).toBe(3);
  });

  it("starts at the durable log high-water mark plus one", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock(sent),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 50,
      seqOffset: 73,
    });

    logger.info("claim", "job.claimed", "claimed");
    logger.info("session", "session.started", "started");
    expect(logger.getSequenceHighWater()).toBe(73);
    await logger.stop();

    expect(sent.flat().map((entry) => entry.seq)).toEqual([74, 75]);
    expect(logger.getSequenceHighWater()).toBe(75);
  });

  it("latches max-buffer overflow while a flush is blocked and makes stop fail closed", async () => {
    const sent: JobLogEntryPayload[][] = [];
    const firstSend = createDeferred<void>();
    const workerClient = createWorkerClientMock(sent, async (_jobId, payload) => {
      sent.push(payload.logs);
      await firstSend.promise;
      return {
        jobId: "job-1",
        received: payload.logs.length,
        inserted: payload.logs.length,
        duplicates: 0,
      };
    });
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient,
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 1,
      maxBuffered: 2,
    });

    logger.info("session", "event.1", "in flight");
    await Promise.resolve();
    logger.info("session", "event.2", "queued");
    expect(() => logger.info("session", "event.3", "must not be dropped"))
      .toThrow("buffer capacity");

    const stopped = logger.stop();
    firstSend.resolve();
    await expect(stopped).rejects.toThrow("buffer capacity");
    // The two accepted rows are still drained; the rejected third row is not
    // represented in emittedThrough and the fatal latch still blocks release.
    expect(logger.getSequenceHighWater()).toBe(2);
  });

  it("extends the reservation at 75% before sending a log batch", async () => {
    const calls: string[] = [];
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock([], async (_jobId, payload) => {
        calls.push(`send:${payload.logs.map((log) => log.seq).join(",")}`);
        return {
          jobId: "job-1",
          received: payload.logs.length,
          inserted: payload.logs.length,
          duplicates: 0,
        };
      }),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 3,
      seqOffset: 0,
      sequenceEnd: 4,
      ensureReservation: async (requiredThrough) => {
        calls.push(`ensure:${requiredThrough}`);
        return 8;
      },
    });

    logger.info("session", "event.1", "one");
    logger.info("session", "event.2", "two");
    logger.info("session", "event.3", "three");
    await logger.stop();

    expect(calls).toEqual(["ensure:5", "send:1,2,3"]);
    expect(logger.getSequenceHighWater()).toBe(3);
  });

  it("does not send over an unconfirmed reservation and keeps unpublished rows out of high-water", async () => {
    let sendCalls = 0;
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock([], async (_jobId, payload) => {
        sendCalls += 1;
        return {
          jobId: "job-1",
          received: payload.logs.length,
          inserted: payload.logs.length,
          duplicates: 0,
        };
      }),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 3,
      seqOffset: 0,
      sequenceEnd: 2,
      ensureReservation: async () => {
        throw new Error("reservation unavailable");
      },
    });
    logger.info("session", "event.1", "one");
    logger.info("session", "event.2", "two");
    logger.info("session", "event.3", "three");

    await expect(logger.stop()).rejects.toThrow("reservation unavailable");
    expect(sendCalls).toBe(0);
    expect(logger.getSequenceHighWater()).toBe(0);
  });

  it("fails before enqueue when the persisted INT32 sequence space is exhausted", async () => {
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock([]),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      seqOffset: 2_147_483_647,
      sequenceEnd: 2_147_483_647,
      ensureReservation: async () => 2_147_483_647,
    });

    expect(() => logger.info("session", "event.overflow", "no room"))
      .toThrow("INT32");
    await expect(logger.stop()).rejects.toThrow("INT32");
  });

  it("accepts no new log events once the handoff drain begins", async () => {
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock([]),
      debugEnabled: false,
      flushIntervalMs: 60_000,
    });
    logger.info("session", "event.before", "accepted");

    const stopped = logger.stop();
    expect(() => logger.info("session", "event.after", "rejected"))
      .toThrow("frozen");
    await stopped;
  });

  it("appends log rows across three same-job cooldown executions", async () => {
    const sent: JobLogEntryPayload[][] = [];
    let durableBase = 0;

    for (let execution = 0; execution < 3; execution += 1) {
      const logger = createRunnerJobEventLogger({
        jobId: "job-1",
        workerClient: createWorkerClientMock(sent),
        debugEnabled: false,
        flushIntervalMs: 60_000,
        batchSize: 50,
        seqOffset: durableBase,
      });
      logger.info("session", "session.started", "started");
      logger.info("session", "session.finished", "finished");
      await logger.stop();
      durableBase = sent.flat().at(-1)!.seq;
    }

    expect(sent.flat().map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

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

  it("redacts late-registered exact secrets before messages, transcripts and payloads are persisted", async () => {
    const secret = "mcp-session-token+/=logger-boundary";
    const encodedSecret = encodeURIComponent(secret);
    const sent: JobLogEntryPayload[][] = [];
    const redactor = createJobSecretRedactor();
    const logger = createRunnerJobEventLogger({
      jobId: "job-1",
      workerClient: createWorkerClientMock(sent),
      debugEnabled: false,
      flushIntervalMs: 60_000,
      batchSize: 50,
      redactor,
    });

    redactor.register("mcp_session_token", secret);
    logger.info("session", "session.secret", `literal=${secret}`, {
      nested: { callback: `https://example.test/?token=${encodedSecret}` },
    });
    logger.transcript(`transcript=${secret}`, "text", {
      token: secret,
    });
    await logger.stop();

    const serialized = JSON.stringify(sent);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(encodedSecret);
    expect(serialized).toContain("[REDACTED:JOB_SECRET]");
  });
});
