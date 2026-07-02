import type { ApiResponseData, PaginationMeta } from "@/domains/shared/domain/types";
import type {
  AgentJob,
  AgentProvider,
  EnqueueAgentJobData,
  WorkerInteraction,
  RespondInteractionInput,
} from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type {
  GenerateWorkItemsRequest,
  GenerateWorkItemsResponse,
} from "@/domains/ai-planning/domain/types";
import type { SkillInterviewMessageRole } from "@/domains/skill-interview/domain/types";
import type {
  ProjectDetailResponse,
  ProjectNightlyValidationSettings,
  ProjectDiscordChannelData,
  DiscordChannelOption,
  WorkItemStatsByType,
} from "@/domains/projects/domain/types";
import type {
  UsageSummaryResponseItem,
} from "@/domains/integrations/domain/types";
import type { AnalyticsSystemMonitoringResponse } from "@/domains/analytics/domain/types";
import type { AgentSessionListItem } from "@/domains/sessions/domain/types";
import type { WorkItemProvenance } from "@/domains/work-items/domain/types";
import type {
  IntegrationBatch,
  IntegrationBatchWithItems,
  CreateIntegrationBatchRequest,
} from "@/domains/integration-batches/domain/types";
import {
  normalizeApiBaseUrl,
  resolveBrowserApiBaseUrl,
} from "@/lib/runtime-service-url";

export const API_BASE = resolveBrowserApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);

export const buildApiRequestUrl = (
  apiBase: string,
  endpoint: string
): string => {
  if (/^https?:\/\//.test(endpoint)) return endpoint;

  const normalizedBase = normalizeApiBaseUrl(apiBase) ?? "/api";
  const endpointWithSlash = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const normalizedEndpoint =
    normalizedBase.endsWith("/api") &&
    (endpointWithSlash === "/api" || endpointWithSlash.startsWith("/api/"))
      ? endpointWithSlash.slice("/api".length) || ""
      : endpointWithSlash;

  return `${normalizedBase}${normalizedEndpoint}`;
};

/**
 * Error thrown by `request`/`requestWithMeta` when the backend responds with
 * `success: false` (or the HTTP status is non-OK).
 *
 * Extends the native `Error` so every existing `err instanceof Error` / `.message`
 * check keeps working, while additionally exposing:
 *  - `status`: HTTP status of the response.
 *  - `body`:   parsed JSON body (typically `{ success, error, data, meta }`).
 *  - `payload`: alias for `body` (kept to match the downstream error-parser
 *    helpers that probe `.payload`, `.body` and `.cause` in that order).
 *
 * This is intentionally minimal — callers that only need a human message keep
 * using `err.message`; the richer error-code handling (e.g. the launch
 * investigation parser in the feedback-triage domain) reads `body.data`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly payload: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.payload = body;
  }
}

export const getSessionToken = (): string | null => {
  if (typeof document === "undefined") return null;

  const cookiePairs = document.cookie
    .split(";")
    .map((part) => part.trim())
    .map((part) => {
      const idx = part.indexOf("=");
      return idx === -1 ? [part, ""] : [part.slice(0, idx), part.slice(idx + 1)];
    });

  const cookieMap = new Map(cookiePairs as Array<[string, string]>);
  const candidates = [
    "__Host-better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
  ];

  for (const name of candidates) {
    const raw = cookieMap.get(name);
    if (raw) return decodeURIComponent(raw);
  }

  return null;
};

export async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = buildApiRequestUrl(API_BASE, endpoint);
  const token = getSessionToken();

  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    credentials: options.credentials ?? "include",

    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/sign-in";
    }
    throw new ApiError("Unauthorized", 401, null);
  }

  let data: ApiResponseData<T>;
  try {
    data = (await response.json()) as ApiResponseData<T>;
  } catch {
    throw new ApiError(`Server error (${response.status})`, response.status, null);
  }

  if (!data.success) {
    throw new ApiError(data.error || "Request failed", response.status, data);
  }

  return data.data as T;
}

// Request with pagination meta
export async function requestWithMeta<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T; meta: PaginationMeta }> {
  const url = buildApiRequestUrl(API_BASE, endpoint);
  const token = getSessionToken();

  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    credentials: options.credentials ?? "include",

    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/sign-in";
    }
    throw new ApiError("Unauthorized", 401, null);
  }

  let result: ApiResponseData<T>;
  try {
    result = (await response.json()) as ApiResponseData<T>;
  } catch {
    throw new ApiError(`Server error (${response.status})`, response.status, null);
  }

  if (!result.success) {
    throw new ApiError(result.error || "Request failed", response.status, result);
  }

  return {
    data: result.data as T,
    meta: result.meta as PaginationMeta,
  };
}

// Tags API
export const tagsApi = {
  list: () => request<unknown>("/tags"),

  get: (id: string) => request<unknown>(`/tags/${id}`),

  create: (data: unknown) =>
    request<unknown>("/tags", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/tags/${id}`, {
      method: "DELETE",
    }),
};

// Webhooks API
export const webhooksApi = {
  list: () => request<unknown>("/webhooks"),

  get: (id: string, includeLogs = false) =>
    request<unknown>(`/webhooks/${id}${includeLogs ? "?includeLogs=true" : ""}`),

  create: (data: unknown) =>
    request<unknown>("/webhooks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/webhooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/webhooks/${id}`, {
      method: "DELETE",
    }),

  test: (id: string) =>
    request<unknown>(`/webhooks/${id}/test`, {
      method: "POST",
    }),
};

// Imports API
export const importsApi = {
  list: () => request<unknown>("/imports"),

  get: (id: string) => request<unknown>(`/imports/${id}`),

  preview: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const token = getSessionToken();

    const response = await fetch(`${API_BASE}/imports/preview`, {
      method: "POST",
      body: formData,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });

    const data = (await response.json()) as ApiResponseData<unknown>;

    if (!data.success) {
      throw new Error(data.error || "Preview failed");
    }

    return data.data;
  },

  start: (data: unknown) =>
    request<unknown>("/imports", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Projects API
export const projectsApi = {
  list: (params?: URLSearchParams) =>
    request<unknown>(`/projects${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/projects${params ? `?${params}` : ""}`),

  get: (id: string) => request<unknown>(`/projects/${id}`),

  getLinkedGithubUrls: () =>
    request<string[]>("/projects/linked-github-urls"),

  create: (data: unknown) =>
    request<unknown>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/projects/${id}`, {
      method: "DELETE",
    }),

  archive: (id: string) =>
    request<unknown>(`/projects/${id}/archive`, {
      method: "POST",
    }),

  captureScreenshot: (id: string) =>
    request<unknown>(`/projects/${id}/capture-screenshot`, {
      method: "POST",
    }),

  getRoadmap: (id: string) =>
    request<unknown>(`/projects/${id}/roadmap`),

  getDetail: (id: string) =>
    request<ProjectDetailResponse>(`/projects/${id}/detail`),

  getStatsByType: (id: string) =>
    request<WorkItemStatsByType>(`/projects/${id}/stats/by-type`),

  getNightlyValidation: (id: string) =>
    request<ProjectNightlyValidationSettings>(`/projects/${id}/nightly-validation`),

  updateNightlyValidation: (id: string, data: ProjectNightlyValidationSettings) =>
    request<ProjectNightlyValidationSettings>(`/projects/${id}/nightly-validation`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getAiConfig: (id: string) =>
    request<import("@/domains/projects/domain/types").ProjectAiConfig>(`/projects/${id}/ai-config`),

  updateAiConfig: (id: string, data: Partial<import("@/domains/projects/domain/types").ProjectAiConfig>) =>
    request<import("@/domains/projects/domain/types").ProjectAiConfig>(`/projects/${id}/ai-config`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getDiscordChannel: (id: string) =>
    request<ProjectDiscordChannelData>(`/projects/${id}/discord-channel`),

  updateDiscordChannel: (id: string, data: { channelId: string; channelName: string }) =>
    request<unknown>(`/projects/${id}/discord-channel`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getDiscordNotificationPrefs: (projectId: string) =>
    request<ProjectDiscordNotificationPrefsResponse>(`/projects/${projectId}/discord-notifications`),

  updateDiscordNotificationPrefs: (projectId: string, data: Partial<Omit<DiscordNotificationPrefsResponse, 'id' | 'discordConnectionId' | 'projectId' | 'createdAt' | 'updatedAt'>>) =>
    request<DiscordNotificationPrefsResponse>(`/projects/${projectId}/discord-notifications`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteDiscordNotificationPrefs: (projectId: string) =>
    request<unknown>(`/projects/${projectId}/discord-notifications`, {
      method: "DELETE",
    }),
};

// Discord types
interface DiscordConnectionResponse {
  id: string;
  workspaceId: string;
  guildId: string;
  guildName: string | null;
  defaultChannelId: string | null;
  defaultChannelName: string | null;
  botJoinedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DiscordAuthorizeResponse {
  url: string;
}

interface DiscordTestResponse {
  sent: boolean;
  messageId?: string;
  error?: string;
}

interface DiscordNotificationPrefsResponse {
  id: string;
  discordConnectionId: string;
  projectId: string | null;
  enabled: boolean;
  notifyWorkItemCreated: boolean;
  notifyWorkItemMoved: boolean;
  notifyWorkItemAssigned: boolean;
  notifyWorkItemDone: boolean;
  notifyWorkItemComment: boolean;
  notifyWorkItemUpdated: boolean;
  notifyWorkItemDeleted: boolean;
  notifyCommentAdded: boolean;
  notifyAttachmentAdded: boolean;
  notifySprintStarted: boolean;
  notifySprintClosed: boolean;
  notifyMilestoneCompleted: boolean;
  notifyPrOpened: boolean;
  notifyPrMerged: boolean;
  notifyCiFailed: boolean;
  notifyAgentJobCompleted: boolean;
  notifyAgentJobFailed: boolean;
  notifySeedPromoted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProjectDiscordNotificationPrefsResponse {
  preferences: DiscordNotificationPrefsResponse | null;
  orgDefaults: DiscordNotificationPrefsResponse | Omit<DiscordNotificationPrefsResponse, 'id' | 'discordConnectionId' | 'projectId' | 'createdAt' | 'updatedAt'>;
}

// Discord API
export const discordApi = {
  getChannels: () =>
    request<DiscordChannelOption[]>("/integrations/discord/channels"),

  getConnection: () =>
    request<DiscordConnectionResponse | null>("/integrations/discord/connection"),

  authorize: () =>
    request<DiscordAuthorizeResponse>("/integrations/discord/authorize"),

  updateConnection: (id: string, data: { defaultChannelId?: string; defaultChannelName?: string }) =>
    request<unknown>(`/integrations/discord/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  disconnect: (id: string) =>
    request<unknown>(`/integrations/discord/${id}`, {
      method: "DELETE",
    }),

  testConnection: (id: string, data?: { channelId?: string }) =>
    request<DiscordTestResponse>(`/integrations/discord/${id}/test`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),

  getNotificationPrefs: (connectionId: string) =>
    request<DiscordNotificationPrefsResponse>(`/integrations/discord/${connectionId}/notifications`),

  updateNotificationPrefs: (connectionId: string, data: Partial<Omit<DiscordNotificationPrefsResponse, 'id' | 'discordConnectionId' | 'projectId' | 'createdAt' | 'updatedAt'>>) =>
    request<DiscordNotificationPrefsResponse>(`/integrations/discord/${connectionId}/notifications`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// Repositories API
export const repositoriesApi = {
  list: (projectId: string) =>
    request<unknown>(`/projects/${projectId}/repositories`),

  create: (projectId: string, data: unknown) =>
    request<unknown>(`/projects/${projectId}/repositories`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (projectId: string, repoId: string, data: unknown) =>
    request<unknown>(`/projects/${projectId}/repositories/${repoId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, repoId: string) =>
    request<unknown>(`/projects/${projectId}/repositories/${repoId}`, {
      method: "DELETE",
    }),
};

// Doc Links API
export const docLinksApi = {
  list: (projectId: string) =>
    request<unknown>(`/projects/${projectId}/doc-links`),

  create: (projectId: string, data: unknown) =>
    request<unknown>(`/projects/${projectId}/doc-links`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (projectId: string, linkId: string, data: unknown) =>
    request<unknown>(`/projects/${projectId}/doc-links/${linkId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, linkId: string) =>
    request<unknown>(`/projects/${projectId}/doc-links/${linkId}`, {
      method: "DELETE",
    }),

  reorder: (projectId: string, linkIds: string[]) =>
    request<unknown>(`/projects/${projectId}/doc-links/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ linkIds }),
    }),
};

// Notes API
export const notesApi = {
  list: (projectId: string) =>
    request<unknown>(`/projects/${projectId}/notes`),

  get: (projectId: string, noteId: string) =>
    request<unknown>(`/projects/${projectId}/notes/${noteId}`),

  create: (projectId: string, data: unknown) =>
    request<unknown>(`/projects/${projectId}/notes`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (projectId: string, noteId: string, data: unknown) =>
    request<unknown>(`/projects/${projectId}/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, noteId: string) =>
    request<unknown>(`/projects/${projectId}/notes/${noteId}`, {
      method: "DELETE",
    }),

  reorder: (projectId: string, noteIds: string[]) =>
    request<unknown>(`/projects/${projectId}/notes/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ noteIds }),
    }),
};

// Boards API
export const boardsApi = {
  listAll: () => request<unknown>("/boards"),

  listByArea: (area: string) =>
    request<unknown>(`/boards/area/${area}`),

  get: (id: string) => request<unknown>(`/boards/${id}`),

  create: (data: unknown) =>
    request<unknown>("/boards", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/boards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/boards/${id}`, {
      method: "DELETE",
    }),

  provision: () =>
    request<unknown>("/boards/provision", {
      method: "POST",
    }),

  createFromTemplate: (data: { templateId: string; name?: string }) =>
    request<unknown>("/boards/from-template", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listColumns: (boardId: string) =>
    request<unknown>(`/boards/${boardId}/columns`),

  createColumn: (boardId: string, data: unknown) =>
    request<unknown>(`/boards/${boardId}/columns`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateColumn: (boardId: string, colId: string, data: unknown) =>
    request<unknown>(`/boards/${boardId}/columns/${colId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteColumn: (boardId: string, colId: string) =>
    request<unknown>(`/boards/${boardId}/columns/${colId}`, {
      method: "DELETE",
    }),

  reorderColumns: (boardId: string, columnIds: string[]) =>
    request<unknown>(`/boards/${boardId}/columns/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ columnIds }),
    }),

  getTemplates: () => request<unknown>("/boards/templates"),
};

// Work Items API
export const workItemsApi = {
  resolveTaskIds: (taskIds: string[]) =>
    request<Array<{ taskId: string; workItemId: string; boardArea: string }>>(
      `/work-items/resolve-task-ids?taskIds=${taskIds.join(",")}`
    ),

  list: (params?: URLSearchParams) =>
    request<unknown>(`/work-items${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/work-items${params ? `?${params}` : ""}`),

  get: (id: string) => request<unknown>(`/work-items/${id}`),

  create: (data: unknown) =>
    request<unknown>("/work-items", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/work-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/work-items/${id}`, {
      method: "DELETE",
    }),

  move: (id: string, boardColumnId: string, position: number) =>
    request<unknown>(`/work-items/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify({ boardColumnId, position }),
    }),

  changeParent: (id: string, parentId: string | null) =>
    request<unknown>(`/work-items/${id}/parent`, {
      method: "PATCH",
      body: JSON.stringify({ parentId }),
    }),

  bulkMove: (workItemIds: string[], boardColumnId: string) =>
    request<unknown>("/work-items/bulk/move", {
      method: "POST",
      body: JSON.stringify({ workItemIds, boardColumnId }),
    }),

  bulkPriority: (workItemIds: string[], priority: string) =>
    request<unknown>("/work-items/bulk/priority", {
      method: "PATCH",
      body: JSON.stringify({ workItemIds, priority }),
    }),

  getByBoard: (boardId: string, params?: Record<string, string>) => {
    const query = params
      ? `?${new URLSearchParams(params).toString()}`
      : "";
    return request<unknown>(`/boards/${boardId}/work-items${query}`);
  },

  getByArea: (area: string, params?: Record<string, string>) => {
    const query = params
      ? `?${new URLSearchParams(params).toString()}`
      : "";
    return request<unknown>(`/boards/area/${area}/work-items${query}`);
  },

  getHierarchy: (parentId: string) =>
    request<unknown>(`/work-items?parentId=${parentId}`),

  resetAi: (id: string) =>
    request<unknown>(`/work-items/${id}/reset-ai`, {
      method: "PATCH",
    }),

  savePrompt: (id: string, prompt: string) =>
    request<unknown>(`/work-items/${id}/prompt`, {
      method: "PATCH",
      body: JSON.stringify({ prompt }),
    }),

  getAiSessions: (id: string) =>
    request<unknown>(`/work-items/${id}/ai-sessions`),

  getSessions: (id: string) =>
    request<AgentSessionListItem[]>(`/work-items/${id}/sessions`),

  createAiSession: (id: string, data: unknown) =>
    request<unknown>(`/work-items/${id}/ai-sessions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getEvents: (id: string, params?: URLSearchParams) =>
    request<unknown>(`/work-items/${id}/events${params ? `?${params.toString()}` : ""}`),

  getProvenance: (id: string) =>
    request<WorkItemProvenance>(`/work-items/${id}/provenance`),

  getChildrenEvents: (id: string, params?: URLSearchParams) =>
    request<unknown>(`/work-items/${id}/children-events${params ? `?${params.toString()}` : ""}`),

  getParticipants: (workItemIds: string[]) =>
    request<unknown>("/work-items/participants", {
      method: "POST",
      body: JSON.stringify({ workItemIds }),
    }),

  getDependencies: (id: string) =>
    request<unknown>(`/work-items/${id}/dependencies`),

  addDependency: (id: string, blockedByWorkItemId: string) =>
    request<unknown>(`/work-items/${id}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ blockedByWorkItemId }),
    }),

  removeDependency: (id: string, blockedByWorkItemId: string) =>
    request<unknown>(`/work-items/${id}/dependencies/${blockedByWorkItemId}`, {
      method: "DELETE",
    }),

  getLinkedDocuments: (id: string) =>
    request<unknown>(`/work-items/${id}/documents`),

  linkDocument: (id: string, documentId: string) =>
    request<unknown>(`/work-items/${id}/documents`, {
      method: "POST",
      body: JSON.stringify({ documentId }),
    }),

  unlinkDocument: (id: string, documentId: string) =>
    request<unknown>(`/work-items/${id}/documents/${documentId}`, {
      method: "DELETE",
    }),

  getSuggestedDocs: (id: string) =>
    request<unknown>(`/work-items/${id}/suggested-docs`),

  getContext: (id: string) =>
    request<unknown>(`/work-items/${id}/context`),

  getCommits: (id: string) =>
    request<unknown>(`/work-items/${id}/commits`),

  linkCommit: (id: string, commitId: string) =>
    request<unknown>(`/work-items/${id}/commits`, {
      method: "POST",
      body: JSON.stringify({ commitId }),
    }),

  unlinkCommit: (id: string, commitId: string) =>
    request<unknown>(`/work-items/${id}/commits/${commitId}`, {
      method: "DELETE",
    }),

  getInteractions: (workItemId: string) =>
    request<WorkerInteraction[]>(`/work-items/${workItemId}/interactions`),

  generateDocs: (id: string, options?: { providerKeyId?: string }) =>
    request<{ document: { id: string; title: string; projectId: string | null } }>(`/work-items/${id}/generate-docs`, {
      method: "POST",
      ...(options ? { body: JSON.stringify(options) } : {}),
    }),

  applyDodHumanAction: (
    id: string,
    optionId: string,
  ) =>
    request<{
      applied: boolean;
      optionId: string;
      actionType: string;
      note?: string;
    }>(`/work-items/${id}/dod-human-action/apply`, {
      method: "POST",
      body: JSON.stringify({ optionId }),
    }),
};

// Milestones API
export const milestonesApi = {
  list: (projectId: string) =>
    request<unknown>(`/milestones?projectId=${projectId}`),

  get: (id: string) =>
    request<unknown>(`/milestones/${id}`),

  create: (data: unknown) =>
    request<unknown>("/milestones", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/milestones/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/milestones/${id}`, {
      method: "DELETE",
    }),

  addWorkItems: (id: string, workItemIds: string[]) =>
    request<unknown>(`/milestones/${id}/work-items`, {
      method: "POST",
      body: JSON.stringify({ workItemIds }),
    }),

  removeWorkItem: (id: string, workItemId: string) =>
    request<unknown>(`/milestones/${id}/work-items/${workItemId}`, {
      method: "DELETE",
    }),
};

// Agent Jobs API
export const agentJobsApi = {
  list: (params?: URLSearchParams) =>
    request<AgentJob[]>(`/agent-jobs${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<AgentJob[]>(`/agent-jobs${params ? `?${params}` : ""}`),

  enqueue: ({ jobType, skillName, codingAgent, model, promptTemplate, triggerType, interactive, ...rest }: EnqueueAgentJobData) =>
    request<AgentJob>("/agent-jobs", {
      method: "POST",
      body: JSON.stringify({
        ...rest,
        ...(jobType ? { jobType } : {}),
        ...(codingAgent ? { codingAgent } : {}),
        ...(model ? { model } : {}),
        ...(skillName ? { config: { skillName } } : {}),
        ...(promptTemplate ? { promptTemplate } : {}),
        ...(triggerType ? { triggerType } : {}),
        ...(typeof interactive === "boolean" ? { interactive } : {}),
      }),
    }),

  batchEnqueue: (data: { workItemIds: string[]; provider: AgentProvider; codingAgent?: CodingAgent; model?: string; priority?: string; repositoryId?: string }) =>
    request<{ created: number; jobs: AgentJob[] }>("/agent-jobs/batch", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getByBoard: (boardId: string) => request<AgentJob[]>(`/agent-jobs/board/${boardId}`),

  getByWorkItem: (workItemId: string) =>
    requestWithMeta<AgentJob[]>(`/agent-jobs?workItemId=${workItemId}`),

  cancel: (jobId: string) => request<AgentJob>(`/agent-jobs/${jobId}/cancel`, { method: "POST" }),

  retry: (jobId: string) => request<AgentJob>(`/agent-jobs/${jobId}/retry`, { method: "POST" }),

  getById: (id: string) => request<AgentJob>(`/agent-jobs/${id}`),

  getLogs: (id: string, params?: URLSearchParams) =>
    request<unknown[]>(`/agent-jobs/${id}/logs${params ? `?${params}` : ""}`),

  getTranscript: (id: string, params?: URLSearchParams) =>
    request<{
      transcript: string;
      chunks: Array<{ seq: number; message: string; timestamp: string }>;
      nextCursor: number | null;
      hasMore: boolean;
    }>(`/agent-jobs/${id}/transcript${params ? `?${params}` : ""}`),

  getInteractions: (jobId: string) =>
    request<WorkerInteraction[]>(`/agent-jobs/${jobId}/interactions`),

  respondToInteraction: (jobId: string, interactionId: string, data: RespondInteractionInput) =>
    request<WorkerInteraction>(`/agent-jobs/${jobId}/interactions/${interactionId}/respond`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  resetStuck: () =>
    request<{ reset: number; items: string[] }>("/agent-jobs/reset-stuck", { method: "POST" }),
};

// Integration batches API
export const integrationBatchesApi = {
  create: (data: CreateIntegrationBatchRequest) =>
    request<IntegrationBatch>("/integration-batches", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listActive: (projectId: string) =>
    request<IntegrationBatch[]>(
      `/integration-batches/active?projectId=${encodeURIComponent(projectId)}`,
    ),

  get: (id: string) =>
    request<IntegrationBatchWithItems>(`/integration-batches/${id}`),

  approve: (id: string) =>
    request<IntegrationBatch>(`/integration-batches/${id}/approve`, {
      method: "POST",
    }),

  reject: (id: string) =>
    request<IntegrationBatch>(`/integration-batches/${id}/reject`, {
      method: "POST",
    }),
};

// Sprints API
export const sprintsApi = {
  listByBoard: (boardId: string) =>
    request<unknown>(`/boards/${boardId}/sprints`),

  getActive: (boardId: string) =>
    request<unknown>(`/boards/${boardId}/sprints/active`),

  getNextNumber: (boardId: string) =>
    request<unknown>(`/boards/${boardId}/sprints/next-number`),

  getDonePreview: (boardId: string, params?: { from?: string; to?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    const qs = searchParams.toString();
    return request<unknown>(`/boards/${boardId}/sprints/done-preview${qs ? `?${qs}` : ''}`);
  },

  create: (boardId: string, data: { name: string; startDate?: string; endDate?: string }) =>
    request<unknown>(`/boards/${boardId}/sprints`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  close: (boardId: string, sprintId: string) =>
    request<unknown>(`/boards/${boardId}/sprints/${sprintId}/close`, {
      method: "POST",
    }),

  closeAdHoc: (boardId: string, name: string) =>
    request<unknown>(`/boards/${boardId}/sprints/close-adhoc`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  closeByDateRange: (boardId: string, data: { name: string; startDate: string; endDate: string }) =>
    request<unknown>(`/boards/${boardId}/sprints/close-by-date`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getWorkItems: (boardId: string, sprintId: string) =>
    request<unknown>(`/boards/${boardId}/sprints/${sprintId}/work-items`),

  getReport: (sprintId: string, compareCount?: number, projectId?: string) => {
    const params = new URLSearchParams();
    if (compareCount) params.set('compareCount', String(compareCount));
    if (projectId) params.set('projectId', projectId);
    const qs = params.toString();
    return request<unknown>(`/sprints/${sprintId}/report${qs ? `?${qs}` : ''}`);
  },
};

// Attachments API
export const attachmentsApi = {
  list: (workItemId: string) =>
    request<unknown>(`/work-items/${workItemId}/attachments`),

  upload: async (workItemId: string, file: File, uploadedBy?: string) => {
    const url = `${API_BASE}/work-items/${workItemId}/attachments`;
    const token = getSessionToken();
    const formData = new FormData();
    formData.append("file", file);
    if (uploadedBy) formData.append("uploadedBy", uploadedBy);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    const data = (await response.json()) as ApiResponseData<unknown>;
    if (!data.success) throw new Error(data.error || "Upload failed");
    return data.data;
  },

  delete: (workItemId: string, attachmentId: string) =>
    request<unknown>(`/work-items/${workItemId}/attachments/${attachmentId}`, {
      method: "DELETE",
    }),
};

// Handbook API
export const handbookApi = {
  list: (params?: URLSearchParams) =>
    requestWithMeta<import("@/domains/handbook/domain/types").HandbookEntry[]>(
      `/handbook${params ? `?${params}` : ""}`
    ),

  get: (id: string) =>
    request<import("@/domains/handbook/domain/types").HandbookEntry>(`/handbook/${id}`),

  categories: () =>
    request<import("@/domains/handbook/domain/types").HandbookCategorySummary[]>("/handbook/categories"),

  search: (params: URLSearchParams) =>
    request<import("@/domains/handbook/domain/types").HandbookSearchResult[]>(`/handbook/search?${params}`),

  importDefault: () =>
    request<import("@/domains/handbook/domain/types").HandbookImportResult>("/handbook/import", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  proposals: (params?: URLSearchParams) =>
    request<import("@/domains/handbook/domain/types").HandbookCaptureProposal[]>(
      `/handbook/proposals${params ? `?${params}` : ""}`
    ),

  createProposal: (data: import("@/domains/handbook/domain/types").CreateHandbookProposalRequest) =>
    request<import("@/domains/handbook/domain/types").HandbookCaptureProposal>("/handbook/proposals", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  approveProposal: (id: string) =>
    request<import("@/domains/handbook/domain/types").HandbookEntry>(`/handbook/proposals/${id}/approve`, {
      method: "POST",
    }),

  rejectProposal: (id: string) =>
    request<import("@/domains/handbook/domain/types").HandbookCaptureProposal>(`/handbook/proposals/${id}/reject`, {
      method: "POST",
    }),
};

// Documents API
export const documentsApi = {
  list: (params?: URLSearchParams) =>
    request<unknown>(`/documents${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/documents${params ? `?${params}` : ""}`),

  get: (id: string) => request<unknown>(`/documents/${id}`),

  create: (data: unknown) =>
    request<unknown>("/documents", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/documents/${id}`, {
      method: "DELETE",
    }),

  search: (params: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/documents/search?${params}`),

  crossProject: (params?: URLSearchParams) =>
    request<unknown>(`/documents/cross-project${params ? `?${params}` : ""}`),

  getLinkedWorkItems: (id: string) =>
    request<unknown>(`/documents/${id}/work-items`),

  getVersions: (id: string, params?: URLSearchParams) =>
    request<unknown>(
      `/documents/${id}/versions${params ? `?${params}` : ""}`
    ),

  getVersionContent: (id: string, contentHash: string) =>
    request<{ content: string }>(
      `/documents/${id}/versions/${contentHash}/content`
    ),

  markAsRead: (id: string) =>
    request<unknown>(`/documents/${id}/read`, { method: "POST" }),

  toggleFavorite: (id: string) =>
    request<{ isFavorite: boolean }>(`/documents/${id}/favorite`, { method: "POST" }),

  getFavorites: () =>
    request<unknown[]>("/documents/favorites"),
};

// Document Categories API
export const documentCategoriesApi = {
  list: () => request<unknown>("/document-categories"),

  get: (id: string) => request<unknown>(`/document-categories/${id}`),

  create: (data: unknown) =>
    request<unknown>("/document-categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/document-categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/document-categories/${id}`, {
      method: "DELETE",
    }),
};

// Agents API
export const agentsApi = {
  listApiKeys: () => request<unknown>("/api-keys"),

  generateApiKey: (name: string) =>
    request<unknown>("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  revokeApiKey: (id: string) =>
    request<unknown>(`/api-keys/${id}`, {
      method: "DELETE",
    }),

  listAgentConnections: () => request<unknown>("/agent-connections"),

  createAgentConnectionPrompt: (data: { projectId?: string | null; agentName?: string }) =>
    request<unknown>("/agent-connections/link-token", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  revokeAgentConnection: (id: string) =>
    request<unknown>(`/agent-connections/${id}`, {
      method: "DELETE",
    }),
};

// Telegram API
export const telegramApi = {
  status: () => request<unknown>("/telegram/status"),

  notificationSettings: () => request<unknown>("/telegram/notifications"),

  updateNotificationSettings: (data: Record<string, unknown>) =>
    request<unknown>("/telegram/notifications", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  createLinkCode: () =>
    request<unknown>("/telegram/link-code", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  unlink: () =>
    request<unknown>("/telegram/unlink", {
      method: "POST",
      body: JSON.stringify({}),
    }),
};

// Email Notifications API
export const emailNotificationsApi = {
  getSettings: () =>
    request<{
      id: string;
      userId: string;
      enabled: boolean;
      notifyWorkItemMoved: boolean;
      notifyWorkItemAssigned: boolean;
      notifyWorkItemDone: boolean;
      notifyReviewCompleted: boolean;
      notifySprintClosed: boolean;
      notifyUserActions: boolean;
      createdAt: string;
      updatedAt: string;
    }>("/email-notifications/settings"),

  updateSettings: (data: Record<string, boolean>) =>
    request<{
      id: string;
      userId: string;
      enabled: boolean;
      notifyWorkItemMoved: boolean;
      notifyWorkItemAssigned: boolean;
      notifyWorkItemDone: boolean;
      notifyReviewCompleted: boolean;
      notifySprintClosed: boolean;
      notifyUserActions: boolean;
      createdAt: string;
      updatedAt: string;
    }>("/email-notifications/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// AI API
export const aiApi = {
  formatText: (data: { text: string; fieldContext: string; providerKeyId?: string }) =>
    request<{ formattedText: string }>("/ai/format-text", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getModelPricing: () =>
    request<unknown>("/ai/model-pricing"),

  // Conversations CRUD
  listConversations: (projectId: string) =>
    request<unknown>(`/ai/conversations?${new URLSearchParams({ projectId })}`),

  getConversation: (id: string) =>
    request<unknown>(`/ai/conversations/${id}`),

  createConversation: (data: unknown) =>
    request<unknown>("/ai/conversations", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateConversation: (id: string, data: unknown) =>
    request<unknown>(`/ai/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteConversation: (id: string) =>
    request<unknown>(`/ai/conversations/${id}`, {
      method: "DELETE",
    }),

  generateWorkItems: (data: GenerateWorkItemsRequest) =>
    request<GenerateWorkItemsResponse>("/ai/chat/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  transcribeAudio: async (audioBlob: Blob, language?: string) => {
    const url = `${API_BASE}/ai/transcribe`;
    const token = getSessionToken();
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");
    if (language) formData.append("language", language);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    const data = (await response.json()) as ApiResponseData<{ text: string }>;
    if (!data.success) throw new Error(data.error || "Transcription failed");
    return data.data;
  },
};

// Users API
export const usersApi = {
  getMe: () => request<unknown>("/users/me"),

  updateLocale: (locale: string) =>
    request<{ locale: string }>("/users/me/locale", {
      method: "PATCH",
      body: JSON.stringify({ locale }),
    }),

  listMembers: () =>
    request<
      Array<{
        memberId: string;
        userId: string;
        name: string;
        email: string;
        image: string | null;
        role: string;
        joinedAt: string;
      }>
    >("/users/members"),
};

interface SkillInterviewStreamRequest {
  messages: Array<{
    role: SkillInterviewMessageRole;
    content: string;
  }>;
  projectId?: string;
  providerKeyId?: string;
  modelName?: string;
}

export const skillInterviewApi = {
  stream: async (
    data: SkillInterviewStreamRequest,
    signal?: AbortSignal,
  ): Promise<Response> => {
    const url = `${API_BASE}/ai/skill-interview`;
    const token = getSessionToken();

    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });

    if (response.status === 401) {
      if (typeof window !== "undefined") {
        window.location.href = "/sign-in";
      }
      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;

      try {
        const payload = (await response.json()) as { error?: string };
        if (payload.error) {
          message = payload.error;
        }
      } catch {
        // Ignore malformed error payloads and keep the status-based message.
      }

      throw new Error(message);
    }

    return response;
  },
};

// View Preferences API
export const viewPreferencesApi = {
  get: (pageKey: string) =>
    request<Record<string, unknown> | null>(`/users/me/view-preferences/${pageKey}`),

  save: (pageKey: string, config: Record<string, unknown>) =>
    request<{ saved: boolean }>(`/users/me/view-preferences/${pageKey}`, {
      method: "PUT",
      body: JSON.stringify({ config }),
    }),
};

// Saved Views API
export const savedViewsApi = {
  list: (boardId: string) =>
    request<unknown>(`/boards/${boardId}/views`),

  create: (boardId: string, data: { name: string; config: Record<string, unknown> }) =>
    request<unknown>(`/boards/${boardId}/views`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (boardId: string, id: string, data: { name?: string; config?: Record<string, unknown> }) =>
    request<unknown>(`/boards/${boardId}/views/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (boardId: string, id: string) =>
    request<unknown>(`/boards/${boardId}/views/${id}`, {
      method: "DELETE",
    }),
};

// GitHub API
export const githubApi = {
  getStatus: () =>
    request<unknown>("/github/status"),

  getInstallations: () =>
    request<unknown>("/github/installations"),

  syncInstallations: () =>
    request<unknown>("/github/sync-installations", {
      method: "POST",
    }),

  getAvailableInstallations: () =>
    request<unknown>("/github/available-installations"),

  connectInstallation: (installationId: number) =>
    request<unknown>("/github/connect-installation", {
      method: "POST",
      body: JSON.stringify({ installationId }),
    }),

  disconnectInstallation: (connectionId: string) =>
    request<unknown>(`/github/installations/${connectionId}`, {
      method: "DELETE",
    }),

  getInstallationRepos: (installationId: number, page = 1, perPage = 100) =>
    request<unknown>(`/github/installations/${installationId}/repos?page=${page}&per_page=${perPage}`),

  linkRepo: (installationId: string, repoId: string, githubRepoFullName: string) =>
    request<unknown>(`/github/installations/${installationId}/link`, {
      method: "POST",
      body: JSON.stringify({ repoId, githubRepoFullName }),
    }),

  unlinkRepo: (installationId: string, repoId: string) =>
    request<unknown>(`/github/installations/${installationId}/unlink/${repoId}`, {
      method: "DELETE",
    }),

  createRepo: (installationId: number, data: { name: string; description?: string; isPrivate?: boolean; autoInit?: boolean }) =>
    request<unknown>(`/github/installations/${installationId}/repos`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getSummary: (projectId: string) =>
    request<unknown>(`/github/projects/${projectId}/summary`),

  getPullRequests: (projectId: string, state?: string) =>
    request<unknown>(`/github/projects/${projectId}/prs${state ? `?state=${state}` : ""}`),

  getCommits: (projectId: string, limit?: number) =>
    request<unknown>(`/github/projects/${projectId}/commits${limit ? `?limit=${limit}` : ""}`),

  getActions: (projectId: string, limit?: number) =>
    request<unknown>(`/github/projects/${projectId}/actions${limit ? `?limit=${limit}` : ""}`),

  getContributors: (projectId: string) =>
    request<unknown>(`/github/projects/${projectId}/contributors`),

  getActivity: (projectId: string, limit?: number) =>
    request<unknown>(`/github/projects/${projectId}/activity${limit ? `?limit=${limit}` : ""}`),

  sync: (projectId: string) =>
    request<unknown>(`/github/projects/${projectId}/sync`, {
      method: "POST",
    }),

  createUserRepo: (data: { name: string; description?: string; isPrivate?: boolean; autoInit?: boolean }) =>
    request<unknown>("/github/user/repos", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Vercel API
export const vercelApi = {
  getStatus: () => request<unknown>("/vercel/status"),

  getAuthUrl: () => request<{ url: string }>("/vercel/auth-url"),

  exchangeCode: (code: string, state: string) =>
    request<unknown>("/vercel/callback", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    }),

  disconnect: () =>
    request<unknown>("/vercel/connection", {
      method: "DELETE",
    }),

  getProjects: () => request<unknown>("/vercel/projects"),

  createProject: (data: {
    name: string;
    framework?: string;
    gitRepository?: { type: string; repo: string };
  }) =>
    request<unknown>("/vercel/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Ideas Hub API
export const ideasApi = {
  list: (params?: URLSearchParams) =>
    request<unknown>(`/ideas/items${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/ideas/items${params ? `?${params}` : ""}`),

  get: (id: string) =>
    request<unknown>(`/ideas/items/${id}`),

  create: (data: unknown) =>
    request<unknown>("/ideas/items", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/ideas/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/ideas/items/${id}`, {
      method: "DELETE",
    }),

  setStatus: (id: string, status: string) =>
    request<unknown>(`/ideas/items/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  setOwner: (id: string, ownerUserId: string | null) =>
    request<unknown>(`/ideas/items/${id}/owner`, {
      method: "PATCH",
      body: JSON.stringify({ ownerUserId }),
    }),

  setDueDate: (id: string, dueDate: string | null) =>
    request<unknown>(`/ideas/items/${id}/due-date`, {
      method: "PATCH",
      body: JSON.stringify({ dueDate }),
    }),

  toggleDiscussed: (id: string, discussed: boolean) =>
    request<unknown>(`/ideas/items/${id}/discussed`, {
      method: "PATCH",
      body: JSON.stringify({ discussed }),
    }),

  promote: (
    id: string,
    data: unknown
  ) =>
    request<unknown>(`/ideas/items/${id}/promote`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getTraceability: (id: string) =>
    request<unknown>(`/ideas/items/${id}/traceability`),

  getHistory: (id: string, params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/ideas/items/${id}/history${params ? `?${params}` : ""}`),

  linkFeedback: (id: string, feedbackItemId: string, metadata?: Record<string, unknown>) =>
    request<unknown>(`/ideas/items/${id}/feedback-links/${feedbackItemId}`, {
      method: "POST",
      body: JSON.stringify({ metadata }),
    }),

  unlinkFeedback: (id: string, feedbackItemId: string) =>
    request<unknown>(`/ideas/items/${id}/feedback-links/${feedbackItemId}`, {
      method: "DELETE",
    }),

  // Comments
  listComments: (ideaItemId: string) =>
    request<unknown[]>(`/ideas/items/${ideaItemId}/comments`),

  addComment: (ideaItemId: string, content: string) =>
    request<unknown>(`/ideas/items/${ideaItemId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  updateComment: (ideaItemId: string, commentId: string, content: string) =>
    request<unknown>(`/ideas/items/${ideaItemId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  getCommentHistory: (ideaItemId: string, commentId: string) =>
    request<unknown[]>(`/ideas/items/${ideaItemId}/comments/${commentId}/history`),

  deleteComment: (ideaItemId: string, commentId: string) =>
    request<unknown>(`/ideas/items/${ideaItemId}/comments/${commentId}`, {
      method: "DELETE",
    }),

  // Tags
  addTag: (id: string, data: { tagId?: string; name?: string; color?: string }) =>
    request<unknown>(`/ideas/items/${id}/tags`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeTag: (id: string, tagId: string) =>
    request<unknown>(`/ideas/items/${id}/tags/${tagId}`, {
      method: "DELETE",
    }),
};

// Seeds API
export const seedsApi = {
  list: (params?: URLSearchParams) =>
    request<unknown>(`/seeds${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/seeds${params ? `?${params}` : ""}`),

  get: (id: string) =>
    request<unknown>(`/seeds/${id}`),

  create: (data: unknown) =>
    request<unknown>("/seeds", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/seeds/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/seeds/${id}`, {
      method: "DELETE",
    }),

  setStatus: (id: string, status: string) =>
    request<unknown>(`/seeds/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  setOwner: (id: string, ownerUserId: string | null) =>
    request<unknown>(`/seeds/${id}/owner`, {
      method: "PATCH",
      body: JSON.stringify({ ownerUserId }),
    }),

  selectForPlanning: (id: string, selected: boolean) =>
    request<unknown>(`/seeds/${id}/select-for-planning`, {
      method: "PATCH",
      body: JSON.stringify({ selected }),
    }),

  bulkSelectForPlanning: (ids: string[], selected: boolean) =>
    request<unknown>("/seeds/bulk-select-for-planning", {
      method: "POST",
      body: JSON.stringify({ ids, selected }),
    }),

  promote: (id: string, data: unknown) =>
    request<unknown>(`/seeds/${id}/promote`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getTraceability: (id: string) =>
    request<unknown>(`/seeds/${id}/traceability`),

  getHistory: (id: string, params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/seeds/${id}/history${params ? `?${params}` : ""}`),

  // Tags
  addTag: (id: string, data: { tagId?: string; name?: string; color?: string }) =>
    request<unknown>(`/seeds/${id}/tags`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeTag: (id: string, tagId: string) =>
    request<unknown>(`/seeds/${id}/tags/${tagId}`, {
      method: "DELETE",
    }),

  // Comments
  listComments: (seedId: string) =>
    request<unknown[]>(`/seeds/${seedId}/comments`),

  addComment: (seedId: string, content: string) =>
    request<unknown>(`/seeds/${seedId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  updateComment: (seedId: string, commentId: string, content: string) =>
    request<unknown>(`/seeds/${seedId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  deleteComment: (seedId: string, commentId: string) =>
    request<unknown>(`/seeds/${seedId}/comments/${commentId}`, {
      method: "DELETE",
    }),
};

// Todos API
export const todosApi = {
  list: (params?: URLSearchParams) =>
    request<unknown>(`/todos${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/todos${params ? `?${params}` : ""}`),

  get: (id: string) =>
    request<unknown>(`/todos/${id}`),

  create: (data: unknown) =>
    request<unknown>("/todos", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/todos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<unknown>(`/todos/${id}`, {
      method: "DELETE",
    }),

  setStatus: (id: string, status: string) =>
    request<unknown>(`/todos/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  setOwner: (id: string, ownerUserId: string | null) =>
    request<unknown>(`/todos/${id}/owner`, {
      method: "PATCH",
      body: JSON.stringify({ ownerUserId }),
    }),

  setDueDate: (id: string, dueDate: string | null) =>
    request<unknown>(`/todos/${id}/due-date`, {
      method: "PATCH",
      body: JSON.stringify({ dueDate }),
    }),

  getHistory: (id: string, params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/todos/${id}/history${params ? `?${params}` : ""}`),

  // Comments
  listComments: (todoId: string) =>
    request<unknown[]>(`/todos/${todoId}/comments`),

  addComment: (todoId: string, content: string) =>
    request<unknown>(`/todos/${todoId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  updateComment: (todoId: string, commentId: string, content: string) =>
    request<unknown>(`/todos/${todoId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  getCommentHistory: (todoId: string, commentId: string) =>
    request<unknown[]>(`/todos/${todoId}/comments/${commentId}/history`),

  deleteComment: (todoId: string, commentId: string) =>
    request<unknown>(`/todos/${todoId}/comments/${commentId}`, {
      method: "DELETE",
    }),

  // Tags
  addTag: (id: string, data: { tagId?: string; name?: string; color?: string }) =>
    request<unknown>(`/todos/${id}/tags`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeTag: (id: string, tagId: string) =>
    request<unknown>(`/todos/${id}/tags/${tagId}`, {
      method: "DELETE",
    }),
};

// Feedback API (public widget only)
export const feedbackApi = {
  createItem: (data: unknown) =>
    request<unknown>("/feedback-items", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Upload a feedback screenshot. Stored in S3 under a flat
   * `feedback-screenshots/<uuid>-<name>` prefix (no org scoping). The backend
   * enforces access at view time via feedback-item ownership, so admins can
   * still see screenshots uploaded by users from different workspaces.
   */
  uploadScreenshot: async (file: File): Promise<{ key: string }> => {
    const url = `${API_BASE}/feedback-screenshots`;
    const token = getSessionToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    const data = (await response.json()) as ApiResponseData<{ key: string }>;
    if (!data.success) throw new Error(data.error || "Screenshot upload failed");
    return data.data as { key: string };
  },

  /**
   * Build the URL that serves a feedback screenshot for a given feedback
   * item. Access is enforced server-side based on the feedback item
   * (admin OR author).
   */
  buildScreenshotUrl: (feedbackItemId: string): string =>
    `${API_BASE}/feedback-items/${feedbackItemId}/screenshot`,
};

// Quota API
export const quotaApi = {
  listQuotas: () => request<unknown>("/quotas"),

  createQuota: (data: unknown) =>
    request<unknown>("/quotas", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateQuota: (id: string, data: unknown) =>
    request<unknown>(`/quotas/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getUsageSummary: () => request<unknown>("/quotas/usage"),

  getProviderUsage: (provider: string) =>
    request<unknown>(`/quotas/usage/${provider}`),

  getAlerts: () => request<unknown>("/quotas/alerts"),

  acknowledgeAlert: (id: string) =>
    request<unknown>(`/quotas/alerts/${id}/ack`, {
      method: "POST",
    }),
};

// Usage API
export const usageApi = {
  getSummary: (projectId?: string) =>
    request<{
      workspaceId: string;
      projectId?: string;
      period: string;
      totalSeconds: number;
      totalJobs: number;
      breakdown: {
        implement: number;
        validate: number;
        planning: number;
        review: number;
        chat: number;
      };
      quotas: Array<{
        provider: string;
        periodType: string;
        maxTokens: number | null;
        maxCostUsd: number | null;
        maxRequests: number | null;
        usedTokens: number;
        usedCostUsd: number;
        usedRequests: number;
        percentTokens: number | null;
        percentCost: number | null;
        percentRequests: number | null;
        periodEnd: string | null;
      }>;
    }>(`/usage/summary${projectId ? `?projectId=${projectId}` : ""}`),

  getHistory: (months?: number) =>
    request<
      Array<{
        period: string;
        totalSeconds: number;
        totalJobs: number;
        breakdown: {
          implement: number;
          validate: number;
          planning: number;
          review: number;
          chat: number;
        };
      }>
    >(`/usage/history${months ? `?months=${months}` : ""}`),

  getUserSummary: (period?: string) =>
    request<{
      userId: string;
      period: string;
      totalSeconds: number;
      billableSeconds: number;
      totalJobs: number;
      breakdown: {
        implement: number;
        validate: number;
        planning: number;
        review: number;
        chat: number;
      };
    }>(`/usage/user-summary${period ? `?period=${period}` : ""}`),

  getUserHistory: (months?: number) =>
    request<
      Array<{
        period: string;
        totalSeconds: number;
        billableSeconds: number;
        totalJobs: number;
        breakdown: {
          implement: number;
          validate: number;
          planning: number;
          review: number;
          chat: number;
        };
      }>
    >(`/usage/user-history${months ? `?months=${months}` : ""}`),

  getDaily: (days?: number, sessionType?: string, userId?: string) => {
    const params = new URLSearchParams();
    if (days) params.set("days", String(days));
    if (sessionType) params.set("sessionType", sessionType);
    if (userId) params.set("userId", userId);
    const qs = params.toString();
    return request<
      Array<{
        date: string;
        totalSeconds: number;
        totalJobs: number;
        breakdown: Record<string, number>;
      }>
    >(`/usage/daily${qs ? `?${qs}` : ""}`);
  },

  getHourly: (days?: number, sessionType?: string, userId?: string) => {
    const params = new URLSearchParams();
    if (days) params.set("days", String(days));
    if (sessionType) params.set("sessionType", sessionType);
    if (userId) params.set("userId", userId);
    const qs = params.toString();
    return request<
      Array<{
        hour: number;
        label: string;
        totalSeconds: number;
        totalJobs: number;
      }>
    >(`/usage/hourly${qs ? `?${qs}` : ""}`);
  },

  getWeekly: (weeks?: number, sessionType?: string, userId?: string) => {
    const params = new URLSearchParams();
    if (weeks) params.set("weeks", String(weeks));
    if (sessionType) params.set("sessionType", sessionType);
    if (userId) params.set("userId", userId);
    const qs = params.toString();
    return request<
      Array<{
        date: string;
        totalSeconds: number;
        totalJobs: number;
        breakdown: Record<string, number>;
      }>
    >(`/usage/weekly${qs ? `?${qs}` : ""}`);
  },
};

// Analytics API (org-level analytics endpoints)
export const analyticsApi = {
  getOverview: () =>
    request<{
      totalAiSessions: number;
      activeUsers: number;
      totalMinutes: number;
      activeProjects: number;
      totalBoards: number;
      workItemsCreated: number;
      workItemsCompleted: number;
      currentMonthUsage: {
        totalSeconds: number;
        totalJobs: number;
        breakdown: {
          implement: number;
          validate: number;
          planning: number;
          review: number;
          chat: number;
        };
      };
    }>("/analytics/overview"),

  getUsers: (period?: string) =>
    request<
      Array<{
        userId: string;
        userName: string | null;
        userEmail: string | null;
        period: string;
        totalSeconds: number;
        billableSeconds: number;
        totalJobs: number;
        breakdown: {
          implement: number;
          validate: number;
          planning: number;
          review: number;
          chat: number;
        };
      }>
    >(`/analytics/users${period ? `?period=${period}` : ""}`),

  getUserDetail: (userId: string, months?: number) =>
    request<
      Array<{
        userId: string;
        period: string;
        totalSeconds: number;
        billableSeconds: number;
        totalJobs: number;
        breakdown: {
          implement: number;
          validate: number;
          planning: number;
          review: number;
          chat: number;
        };
      }>
    >(`/analytics/users/${userId}${months ? `?months=${months}` : ""}`),

  getTrends: (months?: number) =>
    request<
      Array<{
        period: string;
        totalSeconds: number;
        totalJobs: number;
        breakdown: {
          implement: number;
          validate: number;
          planning: number;
          review: number;
          chat: number;
        };
      }>
    >(`/analytics/trends${months ? `?months=${months}` : ""}`),

  getTokenUsage: (months?: number) =>
    request<
      Array<{
        period: string;
        totalTokens: number;
        totalCost: number;
        jobCount: number;
      }>
    >(`/analytics/token-usage${months ? `?months=${months}` : ""}`),

  getModelUsage: (months?: number) =>
    request<
      Array<{
        model: string;
        jobCount: number;
        totalTokens: number;
        totalCost: number;
      }>
    >(`/analytics/model-usage${months ? `?months=${months}` : ""}`),

  getAgentUsage: (months?: number, userId?: string) => {
    const params = new URLSearchParams();
    if (months) params.set("months", String(months));
    if (userId) params.set("userId", userId);
    const qs = params.toString();
    return request<
      Array<{
        codingAgent: string;
        jobCount: number;
        totalTokens: number;
        totalCost: number;
      }>
    >(`/analytics/agent-usage${qs ? `?${qs}` : ""}`);
  },

  getSystemMonitoring: (range?: "1h" | "6h" | "24h") =>
    request<AnalyticsSystemMonitoringResponse>(
      `/analytics/system-monitoring${range ? `?range=${range}` : ""}`,
    ),
};

// Notifications API
export const notificationsApi = {
  list: (params?: URLSearchParams) =>
    requestWithMeta<unknown[]>(`/notifications${params ? `?${params}` : ""}`),

  getUnreadCount: () =>
    request<{ count: number }>("/notifications/unread-count"),

  markAsRead: (id: string) =>
    request<unknown>(`/notifications/${id}/read`, { method: "PATCH" }),

  markAllAsRead: () =>
    request<unknown>("/notifications/read-all", { method: "PATCH" }),

  getPreferences: () =>
    request<unknown[]>("/notifications/preferences"),

  updatePreference: (data: { notificationType: string; inAppEnabled: boolean; emailEnabled: boolean }) =>
    request<unknown>("/notifications/preferences", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// Observability API (Sentry & PostHog proxy)
export const observabilityApi = {
  getSentryIssues: (connectionId: string) =>
    request<unknown[]>(`/observability/sentry/issues?connectionId=${connectionId}`),

  getSentryStats: (connectionId: string) =>
    request<unknown>(`/observability/sentry/stats?connectionId=${connectionId}`),

  getPosthogInsights: (connectionId: string) =>
    request<unknown[]>(`/observability/posthog/insights?connectionId=${connectionId}`),

  getPosthogEvents: (connectionId: string) =>
    request<unknown[]>(`/observability/posthog/events?connectionId=${connectionId}`),
};

// Connections API
export const connectionsApi = {
  list: (params?: URLSearchParams) =>
    request<unknown[]>(`/connections${params ? `?${params}` : ""}`),

  get: (id: string) => request<unknown>(`/connections/${id}`),

  create: (data: unknown) =>
    request<unknown>("/connections", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<unknown>(`/connections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/connections/${id}`, {
      method: "DELETE",
    }),

  test: (id: string) =>
    request<{ valid: boolean; error?: string }>(`/connections/${id}/test`, {
      method: "POST",
    }),

  testCredentials: (data: {
    provider: string;
    credentials: Record<string, unknown>;
    config?: Record<string, unknown>;
  }) =>
    request<{ valid: boolean; error?: string }>(
      "/connections/test-credentials",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  refresh: (id: string) =>
    request<unknown>(`/connections/${id}/refresh`, {
      method: "POST",
    }),

  reconnect: (
    id: string,
    data: { code?: string; state?: string; setupToken?: string },
  ) =>
    request<unknown>(`/connections/${id}/reconnect`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getUsage: (
    id: string,
    params?: { startDate?: string; endDate?: string; forceRefresh?: boolean },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    if (params?.forceRefresh) searchParams.set("forceRefresh", "true");
    const qs = searchParams.toString();
    return request<unknown>(`/connections/${id}/usage${qs ? `?${qs}` : ""}`);
  },

  getUsageSummary: (params?: { forceRefresh?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.forceRefresh) searchParams.set("forceRefresh", "true");
    const qs = searchParams.toString();
    return request<UsageSummaryResponseItem[]>(
      `/connections/usage-summary${qs ? `?${qs}` : ""}`,
    );
  },

  getOAuthUrl: (provider: string, scope?: "user" | "organization") =>
    request<{ url: string; state: string }>(
      `/connections/oauth/${provider}/auth-url${scope ? `?scope=${scope}` : ""}`
    ),

  handleOAuthCallback: (
    provider: string,
    data: {
      code: string;
      state: string;
      scope?: "user" | "organization";
      category?: "code" | "ai" | "deployment" | "monitoring";
      name?: string;
    }
  ) =>
    request<unknown>(`/connections/oauth/${provider}/callback`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getOAuthProviders: () =>
    request<unknown[]>("/connections/oauth/providers"),

  setDefault: (id: string) =>
    request<void>(`/connections/${id}/set-default`, {
      method: "POST",
    }),

  createLinkToken: (data: { provider: string; scope: string }) =>
    request<{ token: string; expiresAt: string }>("/connections/link-token", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getLinkTokenStatus: (token: string) =>
    request<{
      status: "pending" | "completed";
      provider: string;
      credentials: Record<string, unknown> | null;
      config: Record<string, unknown> | null;
      connectionName: string | null;
      expiresAt: string;
    }>(`/connections/link-token/${token}/status`),

  deleteLinkToken: (token: string) =>
    request<{ deleted: boolean }>(`/connections/link-token/${token}`, {
      method: "DELETE",
    }),

  reorderPriorities: (connectionIds: string[]) =>
    request<void>("/connections/reorder", {
      method: "POST",
      body: JSON.stringify({ connectionIds }),
    }),

  // Device code flow (OpenAI)
  requestDeviceCode: () =>
    request<{
      userCode: string;
      deviceAuthId: string;
      verificationUrl: string;
      interval: number;
    }>("/connections/device-code/request", { method: "POST" }),

  pollDeviceToken: (data: {
    deviceAuthId: string;
    userCode: string;
    scope?: string;
    name?: string;
  }) =>
    request<{
      status: "pending" | "completed" | "expired" | "error";
      connection?: unknown;
      error?: string;
    }>("/connections/device-code/poll", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Expenses API
export const expensesApi = {
  list: (params?: URLSearchParams) =>
    request<import("@/domains/expenses/domain/types").ExpenseWithRelations[]>(
      `/api/expenses?${params?.toString() ?? ""}`
    ),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<import("@/domains/expenses/domain/types").ExpenseWithRelations[]>(
      `/api/expenses?${params?.toString() ?? ""}`
    ),

  get: (id: string) =>
    request<import("@/domains/expenses/domain/types").ExpenseWithRelations>(`/api/expenses/${id}`),

  create: (data: unknown) =>
    request<import("@/domains/expenses/domain/types").ExpenseWithRelations>("/expenses", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<import("@/domains/expenses/domain/types").ExpenseWithRelations>(`/api/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/expenses/${id}`, { method: "DELETE" }),

  uploadInvoice: async (id: string, file: File) => {
    const url = `${API_BASE}/api/expenses/${id}/invoice`;
    const token = getSessionToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url, {
      method: "POST",
      body: formData,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });

    const data = (await response.json()) as ApiResponseData<
      import("@/domains/expenses/domain/types").ExpenseWithRelations
    >;
    if (!data.success) throw new Error(data.error || "Upload failed");
    return data.data as import("@/domains/expenses/domain/types").ExpenseWithRelations;
  },

  createWithInvoice: async (file: File) => {
    const url = `${API_BASE}/api/expenses/with-invoice`;
    const token = getSessionToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url, {
      method: "POST",
      body: formData,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });

    const data = (await response.json()) as ApiResponseData<
      import("@/domains/expenses/domain/types").ExpenseWithRelations
    >;
    if (!data.success) throw new Error(data.error || "Upload failed");
    return data.data as import("@/domains/expenses/domain/types").ExpenseWithRelations;
  },

  getAggregations: (params?: URLSearchParams) =>
    request<import("@/domains/expenses/domain/types").ExpenseAggregations>(
      `/api/expenses/aggregations?${params?.toString() ?? ""}`
    ),
};

// Expense Categories API
export const expenseCategoriesApi = {
  list: () =>
    request<import("@/domains/expenses/domain/types").ExpenseCategory[]>("/expense-categories"),

  create: (data: unknown) =>
    request<import("@/domains/expenses/domain/types").ExpenseCategory>("/expense-categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<import("@/domains/expenses/domain/types").ExpenseCategory>(
      `/api/expense-categories/${id}`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),

  delete: (id: string) =>
    request<void>(`/api/expense-categories/${id}`, { method: "DELETE" }),
};

// Recurring Expenses API
export const recurringExpensesApi = {
  list: (params?: URLSearchParams) =>
    request<import("@/domains/expenses/domain/types").RecurringExpense[]>(
      `/api/recurring-expenses?${params?.toString() ?? ""}`
    ),

  get: (id: string) =>
    request<import("@/domains/expenses/domain/types").RecurringExpense>(
      `/api/recurring-expenses/${id}`
    ),

  create: (data: unknown) =>
    request<import("@/domains/expenses/domain/types").RecurringExpense>("/recurring-expenses", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    request<import("@/domains/expenses/domain/types").RecurringExpense>(
      `/api/recurring-expenses/${id}`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),

  delete: (id: string) =>
    request<void>(`/api/recurring-expenses/${id}`, { method: "DELETE" }),

  upcoming: (daysAhead?: number) =>
    request<import("@/domains/expenses/domain/types").RecurringExpense[]>(
      `/api/recurring-expenses/upcoming?days=${daysAhead ?? 30}`
    ),

  summary: () =>
    request<import("@/domains/expenses/domain/types").RecurringSummary>(
      "/api/recurring-expenses/summary"
    ),
};

// Workspace Settings API
export const workspaceSettingsApi = {
  get: () => request<unknown>("/workspace-settings"),

  update: (data: unknown) =>
    request<unknown>("/workspace-settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// Service Accounts API
export const serviceAccountsApi = {
  list: (workspaceId: string) =>
    request<import("@/domains/api-keys/domain/types").ServiceAccount[]>(
      `/workspaces/${workspaceId}/service-accounts`
    ),

  create: (workspaceId: string, data: { name: string; type: string }) =>
    request<unknown>(`/workspaces/${workspaceId}/service-accounts`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  provision: (workspaceId: string) =>
    request<unknown>(`/workspaces/${workspaceId}/service-accounts/provision`, {
      method: "POST",
    }),

  rotateKey: (workspaceId: string, serviceAccountId: string) =>
    request<{ key: string; keyPrefix: string }>(
      `/workspaces/${workspaceId}/service-accounts/${serviceAccountId}/rotate-key`,
      { method: "POST" }
    ),

  deactivate: (workspaceId: string, serviceAccountId: string) =>
    request<void>(
      `/workspaces/${workspaceId}/service-accounts/${serviceAccountId}`,
      { method: "DELETE" }
    ),
};

// Uploads API
export interface UploadFileResult {
  url: string;
  fileName: string;
  mimeType: string;
}

export const uploadsApi = {
  uploadImage: async (file: File): Promise<string> => {
    const url = `${API_BASE}/uploads/images`;
    const token = getSessionToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    const data = (await response.json()) as ApiResponseData<{ url: string }>;
    if (!data.success) throw new Error(data.error || "Image upload failed");
    return (data.data as { url: string }).url;
  },

  uploadFile: async (file: File): Promise<UploadFileResult> => {
    const url = `${API_BASE}/uploads/files`;
    const token = getSessionToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    const data = (await response.json()) as ApiResponseData<UploadFileResult>;
    if (!data.success) throw new Error(data.error || "File upload failed");
    return data.data as UploadFileResult;
  },
};

// Instance version API (update-check banner)
export const instanceVersionApi = {
  get: () =>
    request<import("@/domains/shared/domain/instance-version-types").InstanceVersionInfo>(
      "/instance/version"
    ),

  // Click-to-update — returns { available: true } when the updater sidecar
  // is reachable from the backend, false otherwise. Cached server-side 60s.
  isUpdaterAvailable: () =>
    request<import("@/domains/shared/domain/instance-version-types").UpdaterAvailability>(
      "/instance/update/available"
    ),

  startUpdate: () =>
    request<import("@/domains/shared/domain/instance-version-types").StartUpdateResponse>(
      "/instance/update",
      { method: "POST" }
    ),

  getUpdateJob: (jobId: string) =>
    request<import("@/domains/shared/domain/instance-version-types").UpdateJob>(
      `/instance/update/${jobId}`
    ),

  getActiveUpdateJob: () =>
    request<{ job: import("@/domains/shared/domain/instance-version-types").UpdateJob | null }>(
      "/instance/update/active"
    ),
};

// Onboarding API
export const onboardingApi = {
  getStatus: () =>
    request<import("@/domains/onboarding/domain/types").OnboardingState>(
      "/onboarding/status"
    ),

  complete: () =>
    request<void>("/onboarding/complete", { method: "POST" }),

  skip: (step: import("@/domains/onboarding/domain/types").OnboardingStepKey) =>
    request<void>("/onboarding/skip", {
      method: "POST",
      body: JSON.stringify({ step }),
    }),
};

// Tailscale API
export const tailscaleApi = {
  getStatus: () =>
    request<import("@/domains/onboarding/domain/types").TailscaleSetupState>(
      "/instance/tailscale/status"
    ),

  serve: (port: number) =>
    request<import("@/domains/onboarding/domain/types").TailscaleServeResult>(
      "/instance/tailscale/serve",
      { method: "POST", body: JSON.stringify({ port }) }
    ),

  setPublicUrl: (publicUrl: string) =>
    request<{ publicUrl: string | null }>("/instance/public-url", {
      method: "POST",
      body: JSON.stringify({ publicUrl }),
    }),

  disableServe: (port: number) =>
    request<{ disabled: boolean }>("/instance/tailscale/serve", {
      method: "DELETE",
      body: JSON.stringify({ port }),
    }),
};

// Tailnet database access API
export const tailnetDatabaseApi = {
  getStatus: () =>
    request<import("@/domains/instance-settings/domain/types").TailnetDatabaseStatusView>(
      "/instance/tailnet/database/status"
    ),

  connect: (
    data: import("@/domains/instance-settings/domain/types").TailnetDatabaseConnectInput
  ) =>
    request<import("@/domains/instance-settings/domain/types").TailnetDatabaseStatusView>(
      "/instance/tailnet/database/connect",
      { method: "POST", body: JSON.stringify(data) }
    ),

  test: () =>
    request<import("@/domains/instance-settings/domain/types").TailnetDatabaseStatusView>(
      "/instance/tailnet/database/test",
      { method: "POST" }
    ),

  disable: () =>
    request<import("@/domains/instance-settings/domain/types").TailnetDatabaseStatusView>(
      "/instance/tailnet/database",
      { method: "DELETE" }
    ),
};

// GitHub App API (instance-level setup)
export const githubAppApi = {
  getStatus: () =>
    request<import("@/domains/onboarding/domain/types").GithubAppStatus>(
      "/instance/github-app/status"
    ),

  saveCredentials: (
    data: import("@/domains/onboarding/domain/types").GithubAppFormValues
  ) =>
    request<{ configured: boolean }>("/instance/github-app/credentials", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteCredentials: () =>
    request<void>("/instance/github-app/credentials", {
      method: "DELETE",
    }),

  getManifestUrl: (params: {
    state: string;
    appName: string;
    returnTo?: string;
  }) => {
    const qs = new URLSearchParams({
      state: params.state,
      appName: params.appName,
    });
    if (params.returnTo) qs.set("returnTo", params.returnTo);
    return `/instance/github-app/manifest?${qs.toString()}`;
  },
};

// Scheduled Agents API
export const scheduledAgentsApi = {
  list: (params?: URLSearchParams) =>
    request<import("@/domains/scheduled-agents/domain/types").ScheduledAgentConfig[]>(
      `/scheduled-agents${params ? `?${params}` : ""}`
    ),

  get: (id: string) =>
    request<import("@/domains/scheduled-agents/domain/types").ScheduledAgentConfig>(
      `/scheduled-agents/${id}`
    ),

  create: (data: import("@/domains/scheduled-agents/domain/types").CreateScheduledAgentData) =>
    request<import("@/domains/scheduled-agents/domain/types").ScheduledAgentConfig>(
      "/scheduled-agents",
      { method: "POST", body: JSON.stringify(data) }
    ),

  update: (
    id: string,
    data: import("@/domains/scheduled-agents/domain/types").UpdateScheduledAgentData
  ) =>
    request<import("@/domains/scheduled-agents/domain/types").ScheduledAgentConfig>(
      `/scheduled-agents/${id}`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/scheduled-agents/${id}`, { method: "DELETE" }),

  trigger: (id: string) =>
    request<Record<string, unknown>>(`/scheduled-agents/${id}/trigger`, { method: "POST" }),

  proposeWebhook: (data?: { id?: string; webhookToken?: string | null }) =>
    request<import("@/domains/scheduled-agents/domain/types").ScheduledAgentWebhookProposal>(
      "/scheduled-agents/webhook-proposal",
      { method: "POST", body: JSON.stringify(data ?? {}) }
    ),

  listBacklogDrainWorkItems: (projectIds: string[]) =>
    request<import("@/domains/scheduled-agents/domain/types").BacklogDrainWorkItemTreeItem[]>(
      `/scheduled-agents/backlog-drain/work-items?projectIds=${encodeURIComponent(projectIds.join(","))}`
    ),

  previewBacklogDrain: (data: {
    projectId?: string | null;
    targetConfig: import("@/domains/scheduled-agents/domain/types").TargetConfig;
    codingAgent?: import("@/domains/scheduled-agents/domain/types").CodingAgent | null;
    aiProvider?: import("@/domains/scheduled-agents/domain/types").AIProvider | null;
    aiModel?: string | null;
    reasoningLevel?: string | null;
  }) =>
    request<import("@/domains/scheduled-agents/domain/types").BacklogDrainPreviewResult>(
      "/scheduled-agents/backlog-drain/preview",
      { method: "POST", body: JSON.stringify(data) }
    ),
};

// Ask API
export const askApi = {
  query: (data: import("@/domains/ask/domain/types").AskRequest) =>
    request<import("@/domains/ask/domain/types").AskResponse>("/ask", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  submitFeedback: (
    data: import("@/domains/ask/domain/types").AskFeedbackRequest,
  ) =>
    request<{ recorded: boolean }>("/ask/feedback", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Skills API
export const skillsApi = {
  list: (params?: URLSearchParams) =>
    request<import("@/domains/skills/domain/types").Skill[]>(
      `/skills${params ? `?${params}` : ""}`
    ),

  get: (id: string) =>
    request<import("@/domains/skills/domain/types").Skill>(`/skills/${id}`),

  selector: (projectId?: string) =>
    request<import("@/domains/skills/domain/types").SkillSelectorItem[]>(
      `/skills/selector${projectId ? `?projectId=${projectId}` : ""}`
    ),

  create: (data: import("@/domains/skills/domain/types").CreateSkillRequest) =>
    request<import("@/domains/skills/domain/types").Skill>("/skills", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: import("@/domains/skills/domain/types").UpdateSkillRequest
  ) =>
    request<import("@/domains/skills/domain/types").Skill>(`/skills/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<import("@/domains/skills/domain/types").Skill>(`/skills/${id}`, {
      method: "DELETE",
    }),
};

// Push Subscriptions API
export const pushSubscriptionsApi = {
  getVapidKey: () =>
    request<{ publicKey: string }>("/push-subscriptions/vapid-key"),

  getSubscriptions: () =>
    request<import("@/domains/notifications/domain/types").PushSubscriptionRecord[]>("/push-subscriptions"),

  subscribe: (data: { endpoint: string; p256dhKey: string; authKey: string; userAgent?: string; deviceLabel?: string }) =>
    request<import("@/domains/notifications/domain/types").PushSubscriptionRecord>("/push-subscriptions/subscribe", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  unsubscribe: (id: string) =>
    request<{ deleted: boolean }>(`/push-subscriptions/${id}`, {
      method: "DELETE",
    }),
};
