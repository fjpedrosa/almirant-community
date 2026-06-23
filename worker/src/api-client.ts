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

type SuccessResponse<T> = { success: true; data: T };
type ErrorResponse = { success: false; error: string };
type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export type ApiClientConfig = {
  apiBaseUrl: string;
  apiKey?: string;
  sessionToken?: string;
  timeoutMs?: number;
};

export type WorkerHeartbeatPayload = {
  workerId: string;
  hostname: string;
  config?: Record<string, unknown>;
  activeJobs?: unknown[];
  activeJobsCount?: number;
  maxConcurrentAgents?: number;
};

export type WorkerClaimJobsResponse = Array<{
  id: string;
  workItemId: string | null;
  projectId: string | null;
  boardId: string | null;
  provider: "claude-code" | "codex" | "zipu" | "grok";
  priority: "low" | "medium" | "high" | "urgent";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  retryCount: number;
  maxRetries: number;
  availableAt: string | null;
  config: Record<string, unknown> | null;
}>;

export type AgentJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ReportJobStatusPayload = {
  status: AgentJobStatus;
  workerId?: string;
  result?: Record<string, unknown>;
  errorMessage?: string;
  errorType?: string;
  retryCount?: number;
  availableAt?: string;
  branchName?: string;
  worktreePath?: string;
  durationMs?: number;
  prUrl?: string;
  prNumber?: number;
  commitSha?: string;
  cost?: number;
  tokensUsed?: number;
  sessionId?: string;
};

export type WorkItemDetails = {
  id: string;
  taskId: string | null;
  title: string;
  description: string | null;
  boardId: string;
  boardColumnId: string;
  projectId: string | null;
  type: string;
  priority: string;
  metadata: Record<string, unknown> | null;
  estimatedHours: number | null;
  boardColumn?: {
    isDone?: boolean;
  };
};

export type WorkItemDependenciesResponse = {
  dependencies: Array<{
    id: string;
    workItemId: string;
    blockedByWorkItemId: string;
    blockedByWorkItem: {
      id: string;
      taskId: string | null;
      title: string;
      type: string;
      priority: string;
    };
  }>;
  dependents: Array<{
    id: string;
    workItemId: string;
    blockedByWorkItemId: string;
    workItem: {
      id: string;
      taskId: string | null;
      title: string;
      type: string;
      priority: string;
    };
  }>;
};

export type CreatePullRequestPayload = Record<string, unknown>;

export type QuotaCheckResponse = {
  allowed: boolean;
  remaining?: { tokens?: number; costUsd?: number; requests?: number };
  reason?: string;
  periodEnd?: string;
};

export type RunningJobsResponse = Array<{
  id: string;
  worktreePath: string | null;
  branchName: string | null;
  workerId: string | null;
}>;

export type ApiClient = {
  sendHeartbeat: (payload: WorkerHeartbeatPayload) => Promise<unknown>;
  claimJobs: (payload: { workerId: string; count: number; activeJobs?: number }) => Promise<WorkerClaimJobsResponse>;
  reportJobStatus: (jobId: string, payload: ReportJobStatusPayload) => Promise<unknown>;
  listRunningJobs: () => Promise<RunningJobsResponse>;
  getWorkItemDetails: (workItemId: string) => Promise<WorkItemDetails>;
  getWorkItemDependencies: (workItemId: string) => Promise<WorkItemDependenciesResponse>;
  getProviderKeys: (providers?: Array<"anthropic" | "openai" | "zai" | "xai">) => Promise<{ anthropicApiKey?: string; openaiApiKey?: string; xaiApiKey?: string }>;
  checkQuota: (provider: string) => Promise<QuotaCheckResponse>;
  createPullRequest: (payload: CreatePullRequestPayload) => Promise<unknown>;
  /** Fetch a short-lived GitHub App installation token for the given repository UUID. */
  getInstallationToken: (repositoryId: string) => Promise<{ token: string; expiresAt: string }>;
};

const withNoTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const buildAuthHeaderValue = (cfg: ApiClientConfig): string | null => {
  // Prefer session token if present; falls back to API key for worker endpoints.
  if (cfg.sessionToken && cfg.sessionToken.length > 0) return `Bearer ${cfg.sessionToken}`;
  if (cfg.apiKey && cfg.apiKey.length > 0) return `Bearer ${cfg.apiKey}`;
  return null;
};

const toError = async (res: Response, fallback: string): Promise<string> => {
  const ct = res.headers.get("content-type") ?? "";
  const raw = await res.text().catch(() => "");

  if (ct.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as any;
      if (typeof parsed?.error === "string") return parsed.error;
      if (typeof parsed?.message === "string") return parsed.message;
    } catch {
      // ignore
    }
  }

  const snippet = raw.trim().slice(0, 300);
  return snippet.length ? `${fallback}: ${snippet}` : fallback;
};

const requestJson = async <T>(
  cfg: ApiClientConfig,
  path: string,
  init: RequestInit & { json?: unknown }
): Promise<T> => {
  const base = withNoTrailingSlash(cfg.apiBaseUrl);
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = new Headers(init.headers);
  const auth = buildAuthHeaderValue(cfg);
  if (auth) headers.set("Authorization", auth);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");

  try {
    const res = await fetch(url, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(await toError(res, `Unauthorized (${res.status})`));
    }
    if (res.status === 404) {
      throw new NotFoundError(await toError(res, "Not found"));
    }
    if (!res.ok) {
      throw new ApiError(await toError(res, `HTTP ${res.status} ${res.statusText}`));
    }

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      // Some endpoints might return empty body; treat as unknown.
      return (undefined as unknown) as T;
    }

    const parsed = (await res.json()) as ApiResponse<T> | T;
    // Worker/API standard response: { success, data, error }
    if (typeof (parsed as any)?.success === "boolean") {
      const p = parsed as ApiResponse<T>;
      if (p.success) return p.data;
      throw new ApiError(typeof p.error === "string" ? p.error : "Request failed");
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof NetworkError || err instanceof AuthError || err instanceof NotFoundError || err instanceof ApiError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new NetworkError(`Request timed out after ${timeoutMs}ms`);
    }
    throw new NetworkError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeout);
  }
};

export const createApiClient = (cfg: ApiClientConfig): ApiClient => {
  return {
    sendHeartbeat: async (payload) => {
      return requestJson(cfg, "/workers/heartbeat", { method: "POST", json: payload });
    },
    claimJobs: async (payload) => {
      return requestJson(cfg, "/workers/jobs/claim", { method: "POST", json: payload });
    },
    reportJobStatus: async (jobId, payload) => {
      return requestJson(cfg, `/workers/jobs/${jobId}/status`, { method: "POST", json: payload });
    },
    listRunningJobs: async () => {
      return requestJson(cfg, "/workers/jobs/running", { method: "GET" });
    },
    getWorkItemDetails: async (workItemId) => {
      return requestJson(cfg, `/workers/work-items/${workItemId}`, { method: "GET" });
    },
    getWorkItemDependencies: async (workItemId) => {
      return requestJson(cfg, `/workers/work-items/${workItemId}/dependencies`, { method: "GET" });
    },
    getProviderKeys: async (providers) => {
      const qs = providers && providers.length > 0 ? `?providers=${providers.join(",")}` : "";
      return requestJson(cfg, `/workers/provider-keys${qs}`, { method: "GET" });
    },
    checkQuota: async (provider) => {
      return requestJson({ ...cfg, timeoutMs: 5_000 }, `/workers/quota-check?provider=${encodeURIComponent(provider)}`, { method: "GET" });
    },
    createPullRequest: async (payload) => {
      return requestJson(cfg, "/api/github/pull-requests", { method: "POST", json: payload });
    },
    getInstallationToken: async (repositoryId) => {
      return requestJson<{ token: string; expiresAt: string }>(
        cfg,
        `/workers/github/installation-token?repositoryId=${encodeURIComponent(repositoryId)}`,
        { method: "GET" }
      );
    },
  };
};
