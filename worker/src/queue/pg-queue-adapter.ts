import type { AgentJobResult, QueueAdapter, QueueAdapterConfig, QueuedJob } from "./queue-adapter.js";
import { createApiClient } from "../api-client.js";

type PgQueueAdapterConfig = QueueAdapterConfig & {
  pollIntervalMs?: number;
  maxClaimCount?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const withRetries = async <T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; retryDelayMs?: number }
): Promise<T> => {
  const retries = opts?.retries ?? 3;
  const retryDelayMs = opts?.retryDelayMs ?? 750;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw new Error("Unreachable");
};

const normalizeQueuedJob = (job: any): QueuedJob => {
  return {
    jobId: String(job.id),
    workItemId: job.workItemId ?? null,
    projectId: job.projectId ?? null,
    boardId: job.boardId ?? null,
    provider: job.provider,
    priority: job.priority,
    retryCount: typeof job.retryCount === "number" ? job.retryCount : Number(job.retryCount ?? 0) || 0,
    maxRetries: typeof job.maxRetries === "number" ? job.maxRetries : Number(job.maxRetries ?? 2) || 2,
    availableAt: typeof job.availableAt === "string" ? job.availableAt : null,
    config: (job.config ?? {}) as Record<string, unknown>,
    sessionId: typeof job.sessionId === "string" ? job.sessionId : undefined,
  };
};

export const createPgQueueAdapter = (config: PgQueueAdapterConfig): QueueAdapter => {
  const pollIntervalMs = config.pollIntervalMs ?? 5_000;
  const maxClaimCount = config.maxClaimCount ?? 1;

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isStarted = false;

  const claimJobs = async (_workerId: string, count: number): Promise<QueuedJob[]> => {
    const client = createApiClient({ apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey });
    const jobs = await withRetries(
      () => client.claimJobs({ workerId: config.workerId, count, activeJobs: 0 }),
      { retries: 2, retryDelayMs: 500 }
    );
    return (jobs as any[]).map(normalizeQueuedJob);
  };

  const reportCompletion = async (jobId: string, result: AgentJobResult): Promise<void> => {
    const client = createApiClient({ apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey });
    await client.reportJobStatus(jobId, {
      status: "completed",
      workerId: config.workerId,
      result,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      commitSha: result.commitSha,
      cost: result.cost,
      tokensUsed: result.tokensUsed,
    });
  };

  const reportFailure = async (
    jobId: string,
    error: { message: string; type: string }
  ): Promise<void> => {
    const client = createApiClient({ apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey });
    await client.reportJobStatus(jobId, {
      status: "failed",
      workerId: config.workerId,
      errorMessage: error.message,
      errorType: error.type,
    });
  };

  const scheduleRetry = async (
    jobId: string,
    args: { retryCount: number; availableAt: string; error: { message: string; type: string } }
  ): Promise<void> => {
    const client = createApiClient({ apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey });
    await client.reportJobStatus(jobId, {
      status: "queued",
      workerId: config.workerId,
      retryCount: args.retryCount,
      availableAt: args.availableAt,
      errorMessage: args.error.message,
      errorType: args.error.type,
    });
  };

  const reportRunning: QueueAdapter["reportRunning"] = async (
    jobId,
    args
  ): Promise<void> => {
    const client = createApiClient({ apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey });
    await client.reportJobStatus(jobId, {
      status: "running",
      workerId: config.workerId,
      branchName: args.branchName,
      worktreePath: args.worktreePath,
      sessionId: args.sessionId,
    });
  };

  const releaseJob = async (jobId: string): Promise<void> => {
    const client = createApiClient({ apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey });
    await client.reportJobStatus(jobId, { status: "queued", workerId: config.workerId });
  };

  const start = async (): Promise<void> => {
    if (isStarted) return;
    isStarted = true;

    // Optional self-polling mode: if onJobs is provided, the adapter will fetch and
    // hand off jobs automatically on an interval. Errors are swallowed (no crash).
    if (!config.onJobs) return;

    intervalId = setInterval(() => {
      claimJobs(config.workerId, maxClaimCount)
        .then((jobs) => {
          if (jobs.length === 0) return;
          config.onJobs?.(jobs);
        })
        .catch(() => {
          // Silent retry; keep the loop alive.
        });
    }, pollIntervalMs);
  };

  const stop = async (): Promise<void> => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isStarted = false;
  };

  return {
    claimJobs,
    reportCompletion,
    reportFailure,
    scheduleRetry,
    reportRunning,
    releaseJob,
    start,
    stop,
  };
};
