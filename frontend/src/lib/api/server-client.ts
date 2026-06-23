import { cookies } from "next/headers";
import type { ProjectWithRelations } from "@/domains/projects/domain/types";
import type { BoardWithStats } from "@/domains/boards/domain/types";
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
