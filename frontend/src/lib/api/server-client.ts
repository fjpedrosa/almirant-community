import { cookies } from "next/headers";
import type { ProjectWithRelations } from "@/domains/projects/domain/types";
import type { BoardWithStats } from "@/domains/boards/domain/types";
import type { WorkItemsByColumn } from "@/domains/work-items/domain/types";
import type { PlanningSessionWithPendingInteraction } from "@/domains/planning/domain/types";
import { normalizeApiBaseUrl } from "@/lib/runtime-service-url";

/**
 * Server-side API base URL.
 *
 * On the server we cannot use the Next.js rewrite proxy (/api/*) because
 * fetch() inside RSCs/Server Actions resolves relative URLs against the
 * frontend origin, not the backend. We therefore point directly at the
 * backend process using BACKEND_URL (preferred) or derive it from
 * NEXT_PUBLIC_API_URL by stripping the "/api" suffix.
 *
 * Fallback: http://localhost:3001/api (matches the default dev setup).
 */
const resolveServerApiBase = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) {
    return `${backendUrl.replace(/\/+$/, "")}/api`;
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl && !publicApiUrl.startsWith("/")) {
    // e.g. "https://api.example.com/api" – already absolute
    return normalizeApiBaseUrl(publicApiUrl) ?? publicApiUrl.replace(/\/+$/, "");
  }

  return "http://localhost:3001/api";
};

const SERVER_API_BASE = resolveServerApiBase();

/**
 * Reads the session token from the incoming request cookies.
 * Tries all known better-auth cookie name variants.
 */
const getServerSessionToken = async (): Promise<string | null> => {
  const cookieStore = await cookies();

  const candidates = [
    "__Host-better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
  ];

  for (const name of candidates) {
    const raw = cookieStore.get(name)?.value;
    if (raw) return decodeURIComponent(raw);
  }

  return null;
};

/**
 * Internal fetch wrapper for server-side API requests.
 * Attaches the session token and disables Next.js data cache so that
 * every server render gets fresh data (which is then dehydrated into the
 * React Query cache for the client).
 */
async function serverRequest<T>(endpoint: string): Promise<T> {
  const token = await getServerSessionToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${SERVER_API_BASE}${endpoint}`, {
    headers,
    // Do not cache – RSC prefetch results are handed off to React Query's
    // in-memory cache via dehydrate/HydrationBoundary.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Server prefetch failed: ${response.status} ${response.statusText} – ${SERVER_API_BASE}${endpoint}`
    );
  }

  const data = (await response.json()) as { success: boolean; data?: T; error?: string };

  if (!data.success) {
    throw new Error(data.error ?? "Server prefetch request failed");
  }

  return data.data as T;
}

// ─── Domain-specific server API modules ───────────────────────────────────────

export const projectsServerApi = {
  /** Fetches the full projects list (no filters – matches the default page load). */
  list: (): Promise<ProjectWithRelations[]> =>
    serverRequest<ProjectWithRelations[]>("/projects"),
};

export const boardsServerApi = {
  /** Fetches boards filtered by area slug. */
  listByArea: (area: string): Promise<BoardWithStats[]> =>
    serverRequest<BoardWithStats[]>(`/boards/area/${encodeURIComponent(area)}`),
};

export const workItemsServerApi = {
  /**
   * Fetches the columned work-items for an area — the above-the-fold board
   * payload (S6). Mirrors the client `workItemsApi.getByArea(area, _, "board")`
   * endpoint (`/boards/area/<area>/work-items?view=board`) so the SSR prefetch
   * and the client hook hit the SAME route AND request the SAME slim DTO — the
   * dehydrated cache then hydrates (identical shape) without a client refetch.
   * Prefetches only the no-filter first paint. The queryKey is unchanged; only
   * the payload shape (slim) differs.
   */
  getByArea: (area: string): Promise<WorkItemsByColumn[]> =>
    serverRequest<WorkItemsByColumn[]>(
      `/boards/area/${encodeURIComponent(area)}/work-items?view=board`,
    ),
};

/** Minimal shape the session-replay page needs off a job (matches the client hook). */
export interface PlanningAgentJobSummary {
  id: string;
  status: string;
  planningSessionId: string | null;
}

export const planningServerApi = {
  /**
   * Session detail — the above-the-fold header of the replay page. Mirrors the
   * client `planningSessionsApi.get(id)` route so the plain (non-org-scoped)
   * `planningSessionKeys.detail(id)` cache entry hydrates without a refetch.
   */
  getSession: (
    id: string,
  ): Promise<PlanningSessionWithPendingInteraction> =>
    serverRequest<PlanningSessionWithPendingInteraction>(
      `/planning-sessions/${encodeURIComponent(id)}`,
    ),
};

export const agentJobsServerApi = {
  /** Latest job for a planning session (mirrors `useSessionReplay`'s jobsQuery). */
  listBySession: (sessionId: string): Promise<PlanningAgentJobSummary[]> =>
    serverRequest<PlanningAgentJobSummary[]>(
      `/agent-jobs?planningSessionId=${encodeURIComponent(sessionId)}&limit=1&sort=createdAt:desc`,
    ),
  /** Transcript chunks for a job (mirrors `useSessionReplay`'s outputQuery). */
  getOutput: <T = unknown>(jobId: string): Promise<T> =>
    serverRequest<T>(
      `/agent-jobs/${encodeURIComponent(jobId)}/output?limit=1000`,
    ),
};

export interface OnboardingStatusResponse {
  admin: { done: boolean; skipped?: boolean; userCount: number };
  tailscale: { done: boolean; skipped?: boolean; publicUrl: string | null };
  github: { done: boolean; skipped?: boolean; appSlug: string | null };
  completedAt: string | null;
}

export const onboardingServerApi = {
  getStatus: (): Promise<OnboardingStatusResponse> =>
    serverRequest<OnboardingStatusResponse>("/onboarding/status"),
};
