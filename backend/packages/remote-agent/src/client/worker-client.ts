import type {
  AlmirantWorkerClient,
  ApiClientConfig,
  ApiEnvelope,
  ClaimedJob,
  ClaimJobsPayload,
  CreateWorkerJobPayload,
  CreateInteractionPayload,
  InstallationTokenResponse,
  JobStatusResponse,
  NightlyProjectValidationConfig,
  ProviderKeyProvider,
  ProviderKeysResponse,
  QuotaCheckResponse,
  RepoConfigResponse,
  SendJobLogsPayload,
  SendJobLogsResponse,
  SessionEventRecord,
  StreamJobOutputPayload,
  StreamJobOutputResponse,
  UpdateJobStatusPayload,
  WorkerHeartbeatPayload,
  WorkerInteraction,
  WorkspaceFileDownloadResponse,
  NightlyValidationConfig,
  ValidationCandidate,
  DefinitionOfDoneReviewCandidate,
  FixCandidate,
  ReleaseIntegrationQueueResult,
  WorkItemDetails,
  ScheduledAgentConfig,
  BacklogDrainCandidatesResponse,
  IntegrationBatchDto,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 300;

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class NetworkError extends Error {
  public override name = "NetworkError";
}

export class AuthError extends Error {
  public override name = "AuthError";
}

export class NotFoundError extends Error {
  public override name = "NotFoundError";
}

export class ApiError extends Error {
  public override name = "ApiError";
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const withNoTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

const buildUrl = (baseUrl: string, path: string): string => {
  const base = withNoTrailingSlash(baseUrl);
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
};

const toErrorMessage = async (res: Response, fallback: string): Promise<string> => {
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text().catch(() => "");

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === "string") return parsed.error;
      if (typeof parsed.message === "string") return parsed.message;
    } catch {
      // Ignore JSON parse failures and fallback to plain text snippet.
    }
  }

  const snippet = raw.trim().slice(0, 300);
  return snippet.length > 0 ? `${fallback}: ${snippet}` : fallback;
};

const normalizeEnvelope = <T>(payload: unknown): T => {
  if (typeof payload === "object" && payload !== null && "success" in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (envelope.success) {
      return envelope.data;
    }
    throw new ApiError(envelope.error || "Request failed");
  }

  return payload as T;
};

type RequestOptions = {
  method: "GET" | "POST" | "PATCH";
  json?: unknown;
  timeoutMs?: number;
};

const requestJson = async <T>(
  config: ApiClientConfig,
  path: string,
  options: RequestOptions
): Promise<T> => {
  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialRetryDelayMs =
    config.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;

  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = new Headers();
      headers.set("Authorization", `Bearer ${config.apiKey}`);
      if (options.json !== undefined) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(buildUrl(config.apiBaseUrl, path), {
        method: options.method,
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new AuthError(
          await toErrorMessage(response, `Unauthorized (${response.status})`)
        );
      }

      if (response.status === 404) {
        throw new NotFoundError(await toErrorMessage(response, "Resource not found"));
      }

      if (!response.ok) {
        const message = await toErrorMessage(
          response,
          `HTTP ${response.status} ${response.statusText}`
        );
        if (
          RETRYABLE_STATUS_CODES.has(response.status) &&
          attempt <= maxRetries
        ) {
          const delay =
            initialRetryDelayMs * 2 ** (attempt - 1) +
            Math.floor(Math.random() * 100);
          await sleep(delay);
          continue;
        }
        throw new ApiError(message);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return undefined as T;
      }

      const json = (await response.json()) as unknown;
      return normalizeEnvelope<T>(json);
    } catch (error) {
      if (
        error instanceof AuthError ||
        error instanceof NotFoundError ||
        error instanceof ApiError
      ) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        if (attempt <= maxRetries) {
          const delay = initialRetryDelayMs * 2 ** (attempt - 1);
          await sleep(delay);
          continue;
        }
        throw new NetworkError(`Request timed out after ${timeoutMs}ms`);
      }

      if (attempt <= maxRetries) {
        const delay = initialRetryDelayMs * 2 ** (attempt - 1);
        await sleep(delay);
        continue;
      }

      throw new NetworkError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new NetworkError("Request failed after exhausting retries");
};

export const createAlmirantWorkerClient = (
  config: ApiClientConfig
): AlmirantWorkerClient => {
  return {
    heartbeat: async (payload: WorkerHeartbeatPayload) => {
      return requestJson<unknown>(config, "/workers/heartbeat", {
        method: "POST",
        json: payload,
      });
    },

    claimJobs: async (payload: ClaimJobsPayload) => {
      return requestJson<ClaimedJob[]>(config, "/workers/jobs/claim", {
        method: "POST",
        json: payload,
      });
    },

    createJob: async (payload: CreateWorkerJobPayload) => {
      return requestJson<ClaimedJob>(config, "/workers/jobs", {
        method: "POST",
        json: payload,
      });
    },

    updateJobStatus: async (jobId: string, payload: UpdateJobStatusPayload) => {
      return requestJson<unknown>(config, `/workers/jobs/${jobId}/status`, {
        method: "POST",
        json: payload,
      });
    },

    getProviderKeys: async (
      providers?: ProviderKeyProvider[],
      context?: {
        jobId?: string;
        createdByUserId?: string;
        organizationId?: string;
        preferredConnectionId?: string;
      }
    ) => {
      const providerList = providers?.filter(Boolean) ?? [];
      const params = new URLSearchParams();
      if (providerList.length > 0) {
        params.set("providers", providerList.join(","));
      }
      if (context?.jobId) {
        params.set("jobId", context.jobId);
      }
      if (context?.createdByUserId) {
        params.set("createdByUserId", context.createdByUserId);
      }
      if (context?.organizationId) {
        params.set("organizationId", context.organizationId);
      }
      if (context?.preferredConnectionId) {
        params.set("preferredConnectionId", context.preferredConnectionId);
      }
      const query = params.toString().length > 0 ? `?${params.toString()}` : "";
      return requestJson<ProviderKeysResponse>(
        config,
        `/workers/provider-keys${query}`,
        {
          method: "GET",
        }
      );
    },

    getGithubToken: async (repositoryId: string) => {
      const query = `?repositoryId=${encodeURIComponent(repositoryId)}`;
      return requestJson<InstallationTokenResponse>(
        config,
        `/workers/github/installation-token${query}`,
        {
          method: "GET",
        }
      );
    },

    getRepoConfig: async (projectId: string) => {
      const query = `?projectId=${encodeURIComponent(projectId)}`;
      return requestJson<RepoConfigResponse>(
        config,
        `/workers/repo-config${query}`,
        {
          method: "GET",
        }
      );
    },

    checkQuota: async (provider: string, organizationId?: string) => {
      const params = new URLSearchParams({ provider });
      if (organizationId?.trim()) {
        params.set("organizationId", organizationId.trim());
      }
      const query = `?${params.toString()}`;
      return requestJson<QuotaCheckResponse>(config, `/workers/quota-check${query}`, {
        method: "GET",
        timeoutMs: 5000,
      });
    },

    createInteraction: async (jobId: string, payload: CreateInteractionPayload) => {
      return requestJson<WorkerInteraction>(
        config,
        `/workers/jobs/${jobId}/interactions`,
        {
          method: "POST",
          json: payload,
        }
      );
    },

    pollInteraction: async (jobId: string, interactionId: string) => {
      return requestJson<WorkerInteraction>(
        config,
        `/workers/jobs/${jobId}/interactions/${interactionId}`,
        {
          method: "GET",
        }
      );
    },

    streamJobOutput: async (jobId: string, payload: StreamJobOutputPayload) => {
      return requestJson<StreamJobOutputResponse>(
        config,
        `/workers/jobs/${jobId}/stream`,
        {
          method: "POST",
          json: payload,
        }
      );
    },

    sendJobLogs: async (jobId: string, payload: SendJobLogsPayload) => {
      return requestJson<SendJobLogsResponse>(
        config,
        `/workers/jobs/${jobId}/logs`,
        {
          method: "POST",
          json: payload,
        }
      );
    },

    getJobStatus: async (jobId: string) => {
      return requestJson<JobStatusResponse>(config, `/workers/jobs/${jobId}/status`, {
        method: "GET",
      });
    },

    getJobConfig: async (jobId: string) => {
      return requestJson<{ jobType: string; config: Record<string, unknown> | null; status: string }>(
        config,
        `/workers/jobs/${jobId}/config`,
        {
          method: "GET",
        }
      );
    },

    getWorkspaceFile: async (jobId: string, fileId: string) => {
      return requestJson<WorkspaceFileDownloadResponse>(
        config,
        `/workers/jobs/${encodeURIComponent(jobId)}/workspace-files/${encodeURIComponent(fileId)}`,
        {
          method: "GET",
        },
      );
    },

    getWorkItem: async (workItemId: string) => {
      return requestJson<WorkItemDetails>(config, `/workers/work-items/${workItemId}`, {
        method: "GET",
      });
    },

    getValidationCandidates: async (params?: {
      organizationId?: string;
      projectId?: string;
      limit?: number;
      requireDodApproved?: boolean;
    }) => {
      const queryParams = new URLSearchParams();
      if (params?.organizationId) {
        queryParams.set("organizationId", params.organizationId);
      }
      if (params?.projectId) {
        queryParams.set("projectId", params.projectId);
      }
      if (params?.limit !== undefined) {
        queryParams.set("limit", String(params.limit));
      }
      if (params?.requireDodApproved !== undefined) {
        queryParams.set("requireDodApproved", String(params.requireDodApproved));
      }
      const query = queryParams.toString().length > 0 ? `?${queryParams.toString()}` : "";
      return requestJson<ValidationCandidate[]>(
        config,
        `/workers/validation-candidates${query}`,
        {
          method: "GET",
        }
      );
    },

    getDodReviewCandidates: async (params?: {
      organizationId?: string;
      projectId?: string;
      limit?: number;
      maxActiveJobs?: number;
      minAgeMinutes?: number;
    }) => {
      const queryParams = new URLSearchParams();
      if (params?.organizationId) {
        queryParams.set("organizationId", params.organizationId);
      }
      if (params?.projectId) {
        queryParams.set("projectId", params.projectId);
      }
      if (params?.limit !== undefined) {
        queryParams.set("limit", String(params.limit));
      }
      if (params?.maxActiveJobs !== undefined) {
        queryParams.set("maxActiveJobs", String(params.maxActiveJobs));
      }
      if (params?.minAgeMinutes !== undefined) {
        queryParams.set("minAgeMinutes", String(params.minAgeMinutes));
      }
      const query = queryParams.toString().length > 0 ? `?${queryParams.toString()}` : "";
      return requestJson<DefinitionOfDoneReviewCandidate[]>(
        config,
        `/workers/dod-review-candidates${query}`,
        {
          method: "GET",
        }
      );
    },

    getFixCandidates: async (params?: { organizationId?: string; projectId?: string }) => {
      const queryParams = new URLSearchParams();
      if (params?.organizationId) {
        queryParams.set("organizationId", params.organizationId);
      }
      if (params?.projectId) {
        queryParams.set("projectId", params.projectId);
      }
      const query = queryParams.toString().length > 0 ? `?${queryParams.toString()}` : "";
      return requestJson<FixCandidate[]>(
        config,
        `/workers/fix-candidates${query}`,
        {
          method: "GET",
        }
      );
    },

    getBacklogDrainCandidates: async (params: { configId: string }) => {
      const queryParams = new URLSearchParams();
      queryParams.set("configId", params.configId);
      return requestJson<BacklogDrainCandidatesResponse>(
        config,
        `/workers/backlog-drain-candidates?${queryParams.toString()}`,
        {
          method: "GET",
        }
      );
    },

    getDodRemediationCandidates: async (params: { configId: string }) => {
      const queryParams = new URLSearchParams();
      queryParams.set("configId", params.configId);
      return requestJson<BacklogDrainCandidatesResponse>(
        config,
        `/workers/dod-remediation-candidates?${queryParams.toString()}`,
        {
          method: "GET",
        }
      );
    },

    queueReleaseIntegration: async (params?: {
      organizationId?: string;
      projectId?: string;
      limit?: number;
      maxActiveItems?: number;
      minAgeMinutes?: number;
    }) => {
      const queryParams = new URLSearchParams();
      if (params?.organizationId) {
        queryParams.set("organizationId", params.organizationId);
      }
      if (params?.projectId) {
        queryParams.set("projectId", params.projectId);
      }
      if (params?.limit !== undefined) {
        queryParams.set("limit", String(params.limit));
      }
      if (params?.maxActiveItems !== undefined) {
        queryParams.set("maxActiveItems", String(params.maxActiveItems));
      }
      if (params?.minAgeMinutes !== undefined) {
        queryParams.set("minAgeMinutes", String(params.minAgeMinutes));
      }
      const query = queryParams.toString().length > 0 ? `?${queryParams.toString()}` : "";
      return requestJson<ReleaseIntegrationQueueResult>(
        config,
        `/workers/release-integration/queue${query}`,
        {
          method: "POST",
        }
      );
    },

    getNightlyValidationConfig: async () => {
      return requestJson<NightlyValidationConfig>(
        config,
        `/workers/nightly-validation/config`,
        {
          method: "GET",
        }
      );
    },

    getAllNightlyValidationConfigs: async () => {
      return requestJson<NightlyProjectValidationConfig[]>(
        config,
        `/workers/nightly-validation/configs`,
        {
          method: "GET",
        }
      );
    },

    resetStaleChildTasks: async (parentWorkItemId: string) => {
      return requestJson<{ resetIds: string[] }>(
        config,
        `/workers/work-items/${parentWorkItemId}/reset-stale-children`,
        {
          method: "POST",
        }
      );
    },

    getJobTranscript: async (jobId: string, params?: { limit?: number; tail?: boolean }) => {
      const queryParams = new URLSearchParams();
      if (params?.limit !== undefined) {
        queryParams.set("limit", String(params.limit));
      }
      if (params?.tail === true) {
        queryParams.set("tail", "true");
      }
      const query = queryParams.toString().length > 0 ? `?${queryParams.toString()}` : "";
      return requestJson<{ transcript: string }>(
        config,
        `/workers/jobs/${jobId}/transcript${query}`,
        {
          method: "GET",
        }
      );
    },

    getJobSessionEvents: async (
      jobId: string,
      params?: { after?: number; kinds?: string[]; limit?: number },
    ) => {
      const queryParams = new URLSearchParams();
      if (params?.after !== undefined) {
        queryParams.set("after", String(params.after));
      }
      if (params?.kinds && params.kinds.length > 0) {
        queryParams.set("kinds", params.kinds.join(","));
      }
      if (params?.limit !== undefined) {
        queryParams.set("limit", String(params.limit));
      }
      const query = queryParams.toString().length > 0 ? `?${queryParams.toString()}` : "";
      return requestJson<SessionEventRecord[]>(
        config,
        `/workers/agent-jobs/${jobId}/session-events${query}`,
        {
          method: "GET",
        }
      );
    },

    getJobCompletionSnapshot: async (jobId: string) => {
      return requestJson<{
        jobId: string;
        rootWorkItemId: string | null;
        expectedWorkItemIds: string[];
        completedWorkItemIds: string[];
      }>(config, `/workers/agent-jobs/${jobId}/completion-snapshot`, {
        method: "GET",
      });
    },

    getScheduledConfigs: async () => {
      return requestJson<ScheduledAgentConfig[]>(
        config,
        `/workers/scheduled-configs`,
        {
          method: "GET",
        }
      );
    },

    updateScheduledConfigLastRunAt: async (configId: string) => {
      return requestJson<unknown>(
        config,
        `/workers/scheduled-configs/${configId}/last-run`,
        {
          method: "POST",
        }
      );
    },

    getIntegrationBatch: async (batchId) => {
      return requestJson<IntegrationBatchDto>(
        config,
        `/internal/integration-batches/${batchId}`,
        { method: "GET" },
      );
    },

    updateIntegrationBatch: async (batchId, payload) => {
      return requestJson<unknown>(
        config,
        `/internal/integration-batches/${batchId}`,
        { method: "PATCH", json: payload },
      );
    },

    updateIntegrationBatchItem: async (batchId, itemId, payload) => {
      return requestJson<unknown>(
        config,
        `/internal/integration-batches/${batchId}/items/${itemId}`,
        { method: "PATCH", json: payload },
      );
    },

    ensureIntegrationReleasePr: async (batchId) => {
      return requestJson<{ prUrl: string; prNumber: number; alreadyExists?: boolean }>(
        config,
        `/internal/integration-batches/${batchId}/release-pr`,
        { method: "POST" },
      );
    },

    refreshIntegrationReleasePrBody: async (batchId) => {
      return requestJson<{ refreshed: boolean }>(
        config,
        `/internal/integration-batches/${batchId}/release-pr/refresh-body`,
        { method: "POST" },
      );
    },

    mergeIntegrationReleasePr: async (batchId, options) => {
      return requestJson<{ merged: boolean; sha: string | null }>(
        config,
        `/internal/integration-batches/${batchId}/release-pr/merge`,
        {
          method: "POST",
          json: { mergeMethod: options?.mergeMethod ?? "squash" },
        },
      );
    },
  };
};
