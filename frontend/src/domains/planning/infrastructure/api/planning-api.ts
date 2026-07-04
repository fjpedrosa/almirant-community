import { request, requestWithMeta } from "@/lib/api/client";
import type {
  PlanningSession,
  PlanningSessionWithPendingInteraction,
  SeedWithRelations,
  SeedComment,
  SeedEvent,
  Seed,
  CreatePlanningSessionRequest,
  UpdatePlanningSessionRequest,
  CompletePlanningSessionRequest,
  CreateSeedRequest,
  UpdateSeedRequest,
  PromoteSeedRequest,
  SeedStatus,
  SeedFeedbackLink,
  SeedWorkItemLink,
} from "../../domain/types";
import type { SessionEventRecord } from "@/domains/sessions/domain/types";
import type { AgentLogChunk } from "@/domains/shared/domain/types";

export interface PlanningLatestOutput {
  jobId: string | null;
  sessionId: string;
  chunks: AgentLogChunk[];
  text: string;
}

type PlanningSessionWorkItem = {
  id: string;
  workItemId: string;
  title: string;
  type: string;
  taskId: string | null;
  proposedInMessageId: string | null;
  createdAt: string;
};

// --- Planning Sessions API ---

export const planningSessionsApi = {
  list: (params?: URLSearchParams) =>
    request<PlanningSession[]>(
      `/planning-sessions${params ? `?${params}` : ""}`
    ),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<PlanningSession[]>(
      `/planning-sessions${params ? `?${params}` : ""}`
    ),

  get: (id: string) =>
    request<PlanningSessionWithPendingInteraction>(`/planning-sessions/${id}`),

  create: (data: CreatePlanningSessionRequest) =>
    request<PlanningSession>("/planning-sessions", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdatePlanningSessionRequest) =>
    request<PlanningSession>(`/planning-sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  complete: (id: string, result: CompletePlanningSessionRequest) =>
    request<PlanningSession>(`/planning-sessions/${id}/complete`, {
      method: "POST",
      body: JSON.stringify(result),
    }),

  resume: (id: string, forceClose?: boolean) =>
    request<PlanningSessionWithPendingInteraction>(`/planning-sessions/${id}/resume`, {
      method: "POST",
      body: JSON.stringify({ forceClose }),
    }),

  /** Mark seeds attached to this session as to_review and clear selectedForIdeation */
  completeSeedsForSession: (sessionId: string) =>
    request<{ updated: number }>(`/planning-sessions/${sessionId}/complete-seeds`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/planning-sessions/${id}`, {
      method: "DELETE",
    }),

  prewarm: (sessionId: string, agentConfig?: { provider?: string; codingAgent?: string; model?: string }) =>
    request<{ jobId: string }>(`/planning-sessions/${sessionId}/prewarm`, {
      method: "POST",
      body: JSON.stringify(agentConfig ?? {}),
    }),

  generateTitle: (sessionId: string, prompt: string, providerKeyId?: string) =>
    request<{ title: string }>(`/planning-sessions/${sessionId}/generate-title`, {
      method: "POST",
      body: JSON.stringify({ prompt, ...(providerKeyId && { providerKeyId }) }),
    }),

  // Welcome
  getWelcomeMessage: (
    sessionId: string,
    context: { projectName?: string; seedCount?: number },
  ) =>
    request<{ message: string }>(`/planning-sessions/${sessionId}/welcome`, {
      method: "POST",
      body: JSON.stringify(context),
    }),

  // Seeds junction
  getSeeds: (sessionId: string) =>
    request<SeedWithRelations[]>(`/planning-sessions/${sessionId}/seeds`),

  getWorkItems: (sessionId: string) =>
    request<PlanningSessionWorkItem[]>(
      `/planning-sessions/${sessionId}/work-items`
    ),

  getSessionEvents: (sessionId: string) =>
    request<SessionEventRecord[]>(
      `/planning-sessions/${sessionId}/session-events`
    ),

  getSessionProjection: (sessionId: string) =>
    request<unknown>(
      `/planning-sessions/${sessionId}/session-projection`
    ),

  /**
   * Latest agent-job output for a session in ONE call. Collapses the
   * jobs -> output chain (list jobs, take the newest, fetch its output).
   */
  getLatestOutput: (sessionId: string) =>
    request<PlanningLatestOutput>(
      `/planning-sessions/${sessionId}/latest-output?limit=1000`
    ),

  addSeed: (sessionId: string, seedId: string) =>
    request<unknown>(`/planning-sessions/${sessionId}/seeds`, {
      method: "POST",
      body: JSON.stringify({ seedId }),
    }),

  removeSeed: (sessionId: string, seedId: string) =>
    request<{ deleted: boolean }>(
      `/planning-sessions/${sessionId}/seeds/${seedId}`,
      { method: "DELETE" }
    ),
};

// --- Seeds API ---

export const seedsApi = {
  list: (params?: URLSearchParams) =>
    request<SeedWithRelations[]>(`/seeds${params ? `?${params}` : ""}`),

  listWithMeta: (params?: URLSearchParams) =>
    requestWithMeta<SeedWithRelations[]>(
      `/seeds${params ? `?${params}` : ""}`
    ),

  get: (id: string) => request<SeedWithRelations>(`/seeds/${id}`),

  create: (data: CreateSeedRequest) =>
    request<Seed>("/seeds", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdateSeedRequest) =>
    request<SeedWithRelations>(`/seeds/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/seeds/${id}`, {
      method: "DELETE",
    }),

  setStatus: (id: string, status: SeedStatus) =>
    request<SeedWithRelations>(`/seeds/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  setOwner: (id: string, ownerUserId: string | null) =>
    request<SeedWithRelations>(`/seeds/${id}/owner`, {
      method: "PATCH",
      body: JSON.stringify({ ownerUserId }),
    }),

  toggleSelectedForIdeation: (id: string, selected: boolean) =>
    request<SeedWithRelations>(`/seeds/${id}/select-for-planning`, {
      method: "PATCH",
      body: JSON.stringify({ selected }),
    }),

  bulkSelectForIdeation: (ids: string[], selected: boolean) =>
    request<{ updated: number }>("/seeds/bulk-select-for-planning", {
      method: "POST",
      body: JSON.stringify({ ids, selected }),
    }),

  getSelected: (projectId?: string) => {
    const params = projectId
      ? `?${new URLSearchParams({ projectId })}`
      : "";
    return request<SeedWithRelations[]>(`/seeds/selected${params}`);
  },

  promote: (id: string, data: PromoteSeedRequest) =>
    request<{
      source: { id: string; status: string };
      workItem: {
        id: string;
        taskId: string | null;
        title: string;
        type: string;
      };
      link: {
        id: string;
        seedId: string;
        workItemId: string;
        linkType: string;
        createdAt: string;
      };
    }>(`/seeds/${id}/promote`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Traceability
  getTraceability: (id: string) =>
    request<{
      feedbackLinks: SeedFeedbackLink[];
      workItemLinks: SeedWorkItemLink[];
    }>(`/seeds/${id}/traceability`),

  // History
  getHistory: (id: string, params?: URLSearchParams) =>
    requestWithMeta<SeedEvent[]>(
      `/seeds/${id}/history${params ? `?${params}` : ""}`
    ),

  // Feedback links
  linkFeedback: (id: string, feedbackItemId: string) =>
    request<unknown>(`/seeds/${id}/feedback-links/${feedbackItemId}`, {
      method: "POST",
    }),

  unlinkFeedback: (id: string, feedbackItemId: string) =>
    request<{ deleted: boolean }>(
      `/seeds/${id}/feedback-links/${feedbackItemId}`,
      { method: "DELETE" }
    ),

  // Comments
  listComments: (id: string) =>
    request<SeedComment[]>(`/seeds/${id}/comments`),

  addComment: (id: string, content: string) =>
    request<SeedComment>(`/seeds/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  updateComment: (id: string, commentId: string, content: string) =>
    request<SeedComment>(`/seeds/${id}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  deleteComment: (id: string, commentId: string) =>
    request<{ deleted: boolean }>(`/seeds/${id}/comments/${commentId}`, {
      method: "DELETE",
    }),

  // Tags
  addTag: (
    id: string,
    data: { tagId?: string; name?: string; color?: string }
  ) =>
    request<SeedWithRelations>(`/seeds/${id}/tags`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeTag: (id: string, tagId: string) =>
    request<{ deleted: boolean }>(`/seeds/${id}/tags/${tagId}`, {
      method: "DELETE",
    }),
};
