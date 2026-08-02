import {
  ConflictError,
  type AlmirantWorkerClient,
  type ClaimedJob,
  type WorkerClientRequestOptions,
} from "@almirant/remote-agent";

/**
 * Locally enforces a caller-owned request boundary even for injected or legacy
 * clients that accept an AbortSignal but do not cooperate with it.
 */
export const raceWorkerClientRequest = async <T>(
  operation: () => Promise<T>,
  requestOptions?: WorkerClientRequestOptions,
): Promise<T> => {
  const signal = requestOptions?.signal;
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Worker client request aborted");
  }

  const pending = operation();
  pending.catch(() => undefined);
  if (!signal) return pending;

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new Error("Worker client request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

export const sleep = (
  ms: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Retry updateJobStatus with exponential backoff to handle transient API/DB errors. */
export const retryUpdateJobStatus = async (
  workerClient: AlmirantWorkerClient,
  jobId: string,
  payload: Parameters<AlmirantWorkerClient["updateJobStatus"]>[1],
  maxAttempts = 3,
  baseDelayMs = 2000,
  requestOptions?: Parameters<AlmirantWorkerClient["updateJobStatus"]>[2],
): Promise<void> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (requestOptions?.signal?.aborted) {
      throw requestOptions.signal.reason;
    }
    try {
      await raceWorkerClientRequest(
        () =>
          workerClient.updateJobStatus(
            jobId,
            payload,
            requestOptions,
          ),
        requestOptions,
      );
      return;
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      if (requestOptions?.signal?.aborted) {
        throw requestOptions.signal.reason ?? error;
      }
      if (attempt >= maxAttempts) throw error;
      const delay = baseDelayMs * attempt;
      console.warn(
        `[job:${jobId}] updateJobStatus failed (attempt ${attempt}/${maxAttempts}): ${
          error instanceof Error ? error.message : String(error)
        }. Retrying in ${delay}ms`
      );
      await sleep(delay, requestOptions?.signal);
    }
  }
};

export const normalizeJobConfig = (job: ClaimedJob): Record<string, unknown> => {
  return (job.config ?? {}) as Record<string, unknown>;
};

export type DurableSequenceBases = {
  jobLogs: number;
  sessionEvents: number;
  nativeEvents: number;
};

export type DurableSequenceReceipt = {
  claimAttemptId: string;
  jobLogsEnd: number;
  sessionEventsEnd: number;
  nativeEventsEnd: number;
};

const MAX_PERSISTED_SEQUENCE = 2_147_483_647;

/**
 * Resolve the durable high-water marks captured by the API's atomic claim.
 * A zero fallback is safe only for a genuinely initial job served by an older
 * API. Reused jobs fail closed rather than silently dropping colliding events.
 */
export const resolveDurableSequenceBases = (job: ClaimedJob): DurableSequenceBases => {
  const values = [
    job.jobLogSequenceBase,
    job.sessionEventSequenceBase,
    job.nativeEventSequenceBase,
  ];
  const allMissing = values.every((value) => value == null);

  if (allMissing) {
    const config = normalizeJobConfig(job);
    const hasPreviousJob =
      typeof config.previousJobId === "string" && config.previousJobId.trim().length > 0;
    const isReusedJob = (job.retryCount ?? 0) > 0 || hasPreviousJob;
    if (isReusedJob) {
      throw new Error("reused job is missing durable sequence bases");
    }

    return { jobLogs: 0, sessionEvents: 0, nativeEvents: 0 };
  }

  const valid = values.every(
    (value) =>
      Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= MAX_PERSISTED_SEQUENCE,
  );
  if (!valid) {
    throw new Error("durable sequence bases are incomplete or invalid");
  }

  return {
    jobLogs: values[0] as number,
    sessionEvents: values[1] as number,
    nativeEvents: values[2] as number,
  };
};

/**
 * Detect the claim-receipt capability as one atomic metadata set. Completely
 * absent fields mean an older API and retain legacy behavior; any partial set
 * fails closed because it cannot safely authorize a producer or terminal handoff.
 */
export const resolveDurableSequenceReceipt = (
  job: ClaimedJob,
): DurableSequenceReceipt | null => {
  const rawClaimAttemptId = job.claimAttemptId;
  const ends = [
    job.jobLogSequenceEnd,
    job.sessionEventSequenceEnd,
    job.nativeEventSequenceEnd,
  ];
  const allMissing = rawClaimAttemptId == null && ends.every((value) => value == null);
  if (allMissing) return null;

  const bases = [
    job.jobLogSequenceBase,
    job.sessionEventSequenceBase,
    job.nativeEventSequenceBase,
  ];
  const claimAttemptId = rawClaimAttemptId?.trim() ?? "";
  const valid =
    claimAttemptId.length > 0 &&
    bases.every(
      (value) => Number.isSafeInteger(value) && (value as number) >= 0,
    ) &&
    ends.every(
      (value, index) =>
        Number.isSafeInteger(value) &&
        (value as number) >= (bases[index] as number) &&
        (value as number) <= MAX_PERSISTED_SEQUENCE,
    );
  if (!valid) {
    throw new Error("durable sequence receipt metadata is incomplete or invalid");
  }

  return {
    claimAttemptId,
    jobLogsEnd: ends[0] as number,
    sessionEventsEnd: ends[1] as number,
    nativeEventsEnd: ends[2] as number,
  };
};

export const getRequestedModel = (job: ClaimedJob): string | undefined => {
  const topLevelModel = job.model;
  if (typeof topLevelModel === "string" && topLevelModel.trim().length > 0) {
    return topLevelModel;
  }

  const config = normalizeJobConfig(job);
  const raw = config.model;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
};

export const resolveJobCodingAgent = (job: ClaimedJob): string | undefined => {
  const config = normalizeJobConfig(job);
  const configCodingAgent = config.codingAgent;
  if (typeof configCodingAgent === "string" && configCodingAgent.trim().length > 0) {
    return configCodingAgent.trim();
  }

  const topLevelCodingAgent = job.codingAgent;
  return typeof topLevelCodingAgent === "string" && topLevelCodingAgent.trim().length > 0
    ? topLevelCodingAgent.trim()
    : undefined;
};

// Skills may be project-scoped, so DB resolution needs the project id.
// Prefer the top-level column (authoritative) and fall back to config.projectId
// for legacy jobs that only set it inside the JSON blob.
export const resolveJobProjectId = (job: ClaimedJob): string | undefined => {
  if (typeof job.projectId === "string" && job.projectId.length > 0) {
    return job.projectId;
  }

  const config = normalizeJobConfig(job);
  const raw = config.projectId;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
};

export const MAX_RECOVERY_LINES = 50;
export const MAX_RECOVERY_CHARS = 16000; // ~4000 tokens

export async function buildRecoveryContext(
  apiClient: AlmirantWorkerClient,
  previousJobId: string,
  requestOptions?: Parameters<AlmirantWorkerClient["getJobTranscript"]>[2],
): Promise<string | null> {
  try {
    const response = await raceWorkerClientRequest(
      () =>
        apiClient.getJobTranscript(
          previousJobId,
          { limit: 500, tail: true },
          requestOptions,
        ),
      requestOptions,
    );
    if (!response?.transcript || response.transcript.trim().length === 0) return null;

    const lines = response.transcript.split("\n");
    const lastLines = lines.slice(-MAX_RECOVERY_LINES);
    let context = lastLines.join("\n");
    if (context.length > MAX_RECOVERY_CHARS) {
      context = context.slice(-MAX_RECOVERY_CHARS);
    }

    return [
      "## Session Recovery Context",
      `The previous session (job ${previousJobId}) was interrupted before completion.`,
      "Progress up to the interruption:\n",
      "```",
      context,
      "```\n",
      "IMPORTANT: Continue from where the previous session left off.",
      "Do not repeat already completed work.",
    ].join("\n");
  } catch (error) {
    if (requestOptions?.signal?.aborted) {
      throw requestOptions.signal.reason ?? error;
    }
    return null;
  }
}

export const extractRepositoryName = (repoUrl?: string): string | undefined => {
  if (!repoUrl) return undefined;

  const normalized = repoUrl.replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  const rawName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const name = rawName.replace(/\.git$/i, "");

  return name.length > 0 ? name : undefined;
};

/**
 * Extract the "owner/repo" full name from a GitHub repository URL.
 * Handles https://github.com/owner/repo, https://github.com/owner/repo.git,
 * and token-embedded variants.
 */
export const extractRepoFullName = (repoUrl: string): string | undefined => {
  try {
    const cleaned = repoUrl.replace(/\.git\/?$/, "");
    const url = new URL(cleaned);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
  } catch {
    // Not a valid URL
  }
  return undefined;
};
