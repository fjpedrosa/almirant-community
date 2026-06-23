import type { AgentJobResult, QueueAdapter, QueueAdapterConfig, QueuedJob } from "./queue-adapter.js";

type BullMqAdapterConfig = QueueAdapterConfig & {
  redisUrl: string;
  queueName?: string;
};

type Completion =
  | { kind: "completed"; result: AgentJobResult }
  | { kind: "failed"; error: { message: string; type: string } }
  | { kind: "released" };

const toBullPriority = (priority: QueuedJob["priority"]): number => {
  switch (priority) {
    case "urgent":
      return 1;
    case "high":
      return 5;
    case "medium":
      return 10;
    case "low":
      return 20;
    default: {
      const exhaustive: never = priority;
      return exhaustive;
    }
  }
};

const parseRedisConnection = (redisUrl: string): Record<string, unknown> => {
  const url = new URL(redisUrl);
  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : undefined;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isFinite(db) ? db : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
};

export const createBullMQQueueAdapter = (config: BullMqAdapterConfig): QueueAdapter => {
  const queueName = config.queueName ?? "agent-jobs";

  let worker: any = null;
  let queue: any = null;
  let started = false;

  const buffer: QueuedJob[] = [];
  const waiters: Array<(jobs: QueuedJob[]) => void> = [];

  const completions = new Map<string, (value: Completion) => void>();

  const enqueueToBuffer = (job: QueuedJob): void => {
    buffer.push(job);
    if (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve(buffer.splice(0, buffer.length));
    }
  };

  const nextJobs = async (count: number): Promise<QueuedJob[]> => {
    const safeCount = Math.max(0, Math.min(count, 50));
    if (safeCount === 0) return [];

    if (buffer.length > 0) return buffer.splice(0, safeCount);

    // Wait for at least one job to be claimed by the BullMQ Worker.
    const all = await new Promise<QueuedJob[]>((resolve) => waiters.push(resolve));
    return all.splice(0, safeCount);
  };

  const claimJobs = async (_workerId: string, count: number): Promise<QueuedJob[]> => {
    if (!started) return [];
    return nextJobs(count);
  };

  const reportCompletion = async (jobId: string, result: AgentJobResult): Promise<void> => {
    const resolve = completions.get(jobId);
    if (!resolve) return;
    completions.delete(jobId);
    resolve({ kind: "completed", result });
  };

  const reportFailure = async (
    jobId: string,
    error: { message: string; type: string }
  ): Promise<void> => {
    const resolve = completions.get(jobId);
    if (!resolve) return;
    completions.delete(jobId);
    resolve({ kind: "failed", error });
  };

  const releaseJob = async (jobId: string): Promise<void> => {
    const resolve = completions.get(jobId);
    if (!resolve) return;
    completions.delete(jobId);
    resolve({ kind: "released" });
  };

  const scheduleRetry: QueueAdapter["scheduleRetry"] = async (jobId) => {
    // BullMQ should own retries/backoff via its own attempts/backoff settings.
    await releaseJob(jobId);
  };

  const reportRunning: QueueAdapter["reportRunning"] = async () => {
    // No-op: BullMQ adapter does not report job status to Almirant API.
  };

  const start = async (): Promise<void> => {
    if (started) return;
    started = true;

    // BullMQ is optional; fail fast with a clear error when selected.
    const bullmq = await import("bullmq");
    const connection = parseRedisConnection(config.redisUrl);

    queue = new bullmq.Queue(queueName, { connection });

    worker = new bullmq.Worker(
      queueName,
      async (bullJob: any) => {
        const jobId = String(bullJob?.id ?? "");
        const data = (bullJob?.data ?? {}) as Partial<QueuedJob>;

        const queued: QueuedJob = {
          jobId,
          workItemId: data.workItemId ?? null,
          projectId: data.projectId ?? null,
          boardId: data.boardId ?? null,
          provider: (data.provider ?? "codex") as QueuedJob["provider"],
          priority: (data.priority ?? "medium") as QueuedJob["priority"],
          retryCount: typeof data.retryCount === "number" ? data.retryCount : 0,
          maxRetries: typeof data.maxRetries === "number" ? data.maxRetries : 2,
          availableAt: typeof data.availableAt === "string" ? data.availableAt : null,
          config: (data.config ?? {}) as Record<string, unknown>,
        };

        // Ensure BullMQ sees the same priority mapping as our internal semantics.
        // Producers should set job opts.priority accordingly; we also expose this mapping for consistency.
        void toBullPriority(queued.priority);

        const completion = await new Promise<Completion>((resolve) => {
          completions.set(jobId, resolve);
          enqueueToBuffer(queued);
        });

        if (completion.kind === "completed") {
          return completion.result;
        }

        if (completion.kind === "released") {
          // Best-effort: requeue by throwing (relies on attempts/backoff if configured).
          throw new Error("job_released");
        }

        const err = new Error(completion.error.message);
        (err as any).name = completion.error.type;
        throw err;
      },
      { connection }
    );
  };

  const stop = async (): Promise<void> => {
    started = false;

    // Wake any waiting claimers so they don't hang forever.
    while (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve([]);
    }

    // Resolve any in-flight jobs as released.
    for (const [jobId, resolve] of completions.entries()) {
      completions.delete(jobId);
      resolve({ kind: "released" });
    }

    try {
      if (worker) await worker.close();
    } finally {
      worker = null;
    }

    try {
      if (queue) await queue.close();
    } finally {
      queue = null;
    }
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
