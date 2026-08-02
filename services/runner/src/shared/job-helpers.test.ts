import { describe, expect, it } from "bun:test";
import type { AlmirantWorkerClient, ClaimedJob } from "@almirant/remote-agent";
import { ConflictError } from "@almirant/remote-agent";
import {
  buildRecoveryContext,
  getRequestedModel,
  resolveDurableSequenceBases,
  resolveDurableSequenceReceipt,
  resolveJobCodingAgent,
  resolveJobProjectId,
  retryUpdateJobStatus,
} from "./job-helpers";

const makeJob = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "job-1",
  workItemId: null,
  projectId: null,
  boardId: null,
  createdByUserId: null,
  workspaceId: null,
  provider: "codex",
  priority: "medium",
  status: "queued",
  retryCount: 0,
  maxRetries: 2,
  availableAt: null,
  config: null,
  ...overrides,
});

describe("buildRecoveryContext", () => {
  it("requests the durable transcript tail", async () => {
    let requestedParams: { limit?: number; tail?: boolean } | undefined;
    let requestedOptions:
      | { signal?: AbortSignal; timeoutMs?: number }
      | undefined;
    const apiClient = {
      getJobTranscript: async (
        _jobId: string,
        params?: { limit?: number; tail?: boolean },
        requestOptions?: { signal?: AbortSignal; timeoutMs?: number },
      ) => {
        requestedParams = params;
        requestedOptions = requestOptions;
        return { transcript: "x" };
      },
    } as unknown as AlmirantWorkerClient;
    const controller = new AbortController();

    await buildRecoveryContext(
      apiClient,
      "job-previous",
      { signal: controller.signal, timeoutMs: 12_345 },
    );

    expect(requestedParams).toEqual({ limit: 500, tail: true });
    expect(requestedOptions).toEqual({
      signal: controller.signal,
      timeoutMs: 12_345,
    });
  });
});

describe("retryUpdateJobStatus", () => {
  it("aborts terminal status transport and backoff at the caller deadline", async () => {
    let attempts = 0;
    let observedAbort = false;
    const workerClient = {
      updateJobStatus: async (
        _jobId: string,
        _payload: unknown,
        requestOptions?: { signal?: AbortSignal },
      ) => {
        attempts += 1;
        await new Promise<void>((_resolve, reject) => {
          requestOptions?.signal?.addEventListener("abort", () => {
            observedAbort = true;
            reject(requestOptions.signal?.reason);
          }, { once: true });
        });
      },
    } as unknown as AlmirantWorkerClient;
    const controller = new AbortController();

    const status = retryUpdateJobStatus(
      workerClient,
      "job-terminal-deadline",
      { status: "failed" },
      3,
      2_000,
      { signal: controller.signal, timeoutMs: 30_000 },
    );
    await Promise.resolve();
    controller.abort(new Error("terminal_deadline_exceeded"));

    await expect(status).rejects.toThrow(
      "terminal_deadline_exceeded",
    );
    expect(attempts).toBe(1);
    expect(observedAbort).toBe(true);
  });

  it("does not retry a stale claim conflict", async () => {
    let attempts = 0;
    const workerClient = {
      updateJobStatus: async () => {
        attempts += 1;
        throw new ConflictError("stale claim");
      },
    } as unknown as AlmirantWorkerClient;

    await expect(
      retryUpdateJobStatus(
        workerClient,
        "job-1",
        { status: "queued" },
        3,
        0,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(attempts).toBe(1);
  });
});

describe("resolveDurableSequenceBases", () => {
  it("uses the three durable high-water marks returned by the atomic claim", () => {
    expect(resolveDurableSequenceBases(makeJob({
      jobLogSequenceBase: 12,
      sessionEventSequenceBase: 34,
      nativeEventSequenceBase: 56,
    }))).toEqual({
      jobLogs: 12,
      sessionEvents: 34,
      nativeEvents: 56,
    });
  });

  it("keeps same-job recovery valid when previousJobId equals the claimed job", () => {
    expect(resolveDurableSequenceBases(makeJob({
      config: { previousJobId: "job-1" },
      jobLogSequenceBase: 12,
      sessionEventSequenceBase: 34,
      nativeEventSequenceBase: 56,
    }))).toEqual({
      jobLogs: 12,
      sessionEvents: 34,
      nativeEvents: 56,
    });
  });

  it("allows a legacy initial job with no persisted history to start at zero", () => {
    expect(resolveDurableSequenceBases(makeJob())).toEqual({
      jobLogs: 0,
      sessionEvents: 0,
      nativeEvents: 0,
    });
  });

  it("fails closed when a reused same-job execution lacks durable bases", () => {
    expect(() => resolveDurableSequenceBases(makeJob({
      config: { previousJobId: "job-1" },
    }))).toThrow("reused job is missing durable sequence bases");
  });

  it("rejects partial or invalid bases instead of silently reusing sequence zero", () => {
    expect(() => resolveDurableSequenceBases(makeJob({
      jobLogSequenceBase: 1,
      sessionEventSequenceBase: 2,
    }))).toThrow("durable sequence bases are incomplete or invalid");

    expect(() => resolveDurableSequenceBases(makeJob({
      jobLogSequenceBase: -1,
      sessionEventSequenceBase: 2,
      nativeEventSequenceBase: 3,
    }))).toThrow("durable sequence bases are incomplete or invalid");

    expect(() => resolveDurableSequenceBases(makeJob({
      jobLogSequenceBase: 2_147_483_648,
      sessionEventSequenceBase: 2,
      nativeEventSequenceBase: 3,
    }))).toThrow("durable sequence bases are incomplete or invalid");
  });
});

describe("resolveDurableSequenceReceipt", () => {
  it("returns the exact inclusive receipt bounds advertised by a new claim", () => {
    expect(resolveDurableSequenceReceipt(makeJob({
      claimAttemptId: "attempt-1",
      jobLogSequenceBase: 10,
      sessionEventSequenceBase: 20,
      nativeEventSequenceBase: 30,
      jobLogSequenceEnd: 4_106,
      sessionEventSequenceEnd: 4_116,
      nativeEventSequenceEnd: 4_126,
    }))).toEqual({
      claimAttemptId: "attempt-1",
      jobLogsEnd: 4_106,
      sessionEventsEnd: 4_116,
      nativeEventsEnd: 4_126,
    });
  });

  it("keeps a legacy claim without receipt capability in legacy mode", () => {
    expect(resolveDurableSequenceReceipt(makeJob())).toBeNull();
  });

  it("fails closed on partial or non-monotonic receipt metadata", () => {
    expect(() => resolveDurableSequenceReceipt(makeJob({
      claimAttemptId: "attempt-1",
      jobLogSequenceBase: 10,
      sessionEventSequenceBase: 20,
      nativeEventSequenceBase: 30,
      jobLogSequenceEnd: 4_106,
      sessionEventSequenceEnd: 4_116,
    }))).toThrow("incomplete or invalid");

    expect(() => resolveDurableSequenceReceipt(makeJob({
      claimAttemptId: "attempt-1",
      jobLogSequenceBase: 10,
      sessionEventSequenceBase: 20,
      nativeEventSequenceBase: 30,
      jobLogSequenceEnd: 9,
      sessionEventSequenceEnd: 4_116,
      nativeEventSequenceEnd: 4_126,
    }))).toThrow("incomplete or invalid");
  });
});

describe("getRequestedModel", () => {
  it("prefers the top-level job.model when present", () => {
    const job = makeJob({
      model: "gpt-5.4",
      config: { model: "o3" },
    });

    expect(getRequestedModel(job)).toBe("gpt-5.4");
  });

  it("falls back to config.model when top-level job.model is missing", () => {
    const job = makeJob({
      config: { model: "gpt-5.4" },
    });

    expect(getRequestedModel(job)).toBe("gpt-5.4");
  });

  it("ignores blank top-level values before checking config.model", () => {
    const job = makeJob({
      model: "   ",
      config: { model: "gpt-5.4" },
    });

    expect(getRequestedModel(job)).toBe("gpt-5.4");
  });
});

describe("resolveJobCodingAgent", () => {
  it("prefers config.codingAgent when present for legacy jobs", () => {
    const job = makeJob({
      codingAgent: "claude-code",
      config: { codingAgent: "opencode" },
    });

    expect(resolveJobCodingAgent(job)).toBe("opencode");
  });

  it("falls back to the top-level job.codingAgent when config is missing", () => {
    const job = makeJob({
      codingAgent: "opencode",
      config: {
        skillName: "runner-implement",
      },
    });

    expect(resolveJobCodingAgent(job)).toBe("opencode");
  });

  it("ignores blank values", () => {
    const job = makeJob({
      codingAgent: "   ",
      config: { codingAgent: "" },
    });

    expect(resolveJobCodingAgent(job)).toBeUndefined();
  });
});

describe("resolveJobProjectId", () => {
  it("prefers the top-level job.projectId when present", () => {
    const job = makeJob({
      projectId: "79d7fd78-037b-41ff-92aa-3671f692062e",
      config: { projectId: "other-project" },
    });

    expect(resolveJobProjectId(job)).toBe("79d7fd78-037b-41ff-92aa-3671f692062e");
  });

  it("falls back to config.projectId when top-level is null", () => {
    const job = makeJob({
      projectId: null,
      config: { projectId: "79d7fd78-037b-41ff-92aa-3671f692062e" },
    });

    expect(resolveJobProjectId(job)).toBe("79d7fd78-037b-41ff-92aa-3671f692062e");
  });

  it("returns undefined when neither source is set", () => {
    const job = makeJob({ projectId: null, config: null });

    expect(resolveJobProjectId(job)).toBeUndefined();
  });

  it("ignores non-string config.projectId values", () => {
    const job = makeJob({
      projectId: null,
      config: { projectId: 42 },
    });

    expect(resolveJobProjectId(job)).toBeUndefined();
  });
});
