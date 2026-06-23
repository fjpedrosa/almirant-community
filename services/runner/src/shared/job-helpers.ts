import type { AlmirantWorkerClient, ClaimedJob } from "@almirant/remote-agent";

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retry updateJobStatus with exponential backoff to handle transient API/DB errors. */
export const retryUpdateJobStatus = async (
  workerClient: AlmirantWorkerClient,
  jobId: string,
  payload: Parameters<AlmirantWorkerClient["updateJobStatus"]>[1],
  maxAttempts = 3,
  baseDelayMs = 2000,
): Promise<void> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await workerClient.updateJobStatus(jobId, payload);
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const delay = baseDelayMs * attempt;
      console.warn(
        `[job:${jobId}] updateJobStatus failed (attempt ${attempt}/${maxAttempts}): ${
          error instanceof Error ? error.message : String(error)
        }. Retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
};

export const normalizeJobConfig = (job: ClaimedJob): Record<string, unknown> => {
  return (job.config ?? {}) as Record<string, unknown>;
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
): Promise<string | null> {
  try {
    const response = await apiClient.getJobTranscript(previousJobId, { limit: 500 });
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
  } catch {
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
