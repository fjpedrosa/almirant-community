/**
 * Click-to-update proxy service.
 *
 * The backend cannot rebuild itself (no git, no docker, no source in the
 * container) so it delegates to the `updater` sidecar over the internal
 * docker network. This module is a thin proxy with a single concern:
 * forward HTTP calls to the sidecar and surface its responses, plus a
 * cached liveness probe used by the banner to decide whether to show the
 * "Update now" button or fall back to "Copy command".
 */

import { env, logger } from "@almirant/config";

const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_CACHE_TTL_MS = 60 * 1_000;

const PROXY_TIMEOUT_MS = 10_000;

export type UpdateStatus = "queued" | "running" | "success" | "failed";
export type UpdateStep =
  | "fetching"
  | "building"
  | "recreating"
  | "healthchecking"
  | "done";
export type UpdateLogSource = "stdout" | "stderr" | "system";

export interface UpdateLogLine {
  timestamp: string;
  source: UpdateLogSource;
  text: string;
}

export interface UpdateJob {
  id: string;
  status: UpdateStatus;
  step: UpdateStep | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  logTail: UpdateLogLine[];
  fromSha: string | null;
  toSha: string | null;
  errorMessage: string | null;
}

export interface StartUpdateResult {
  jobId: string;
  startedAt: string;
  fromSha: string | null;
}

let availabilityCache: { value: boolean; expiresAt: number } | null = null;

const isConfigured = (): boolean =>
  Boolean(env.UPDATER_INTERNAL_URL && env.UPDATER_INTERNAL_TOKEN);

const updaterFetch = async (
  path: string,
  init: RequestInit,
  timeoutMs = PROXY_TIMEOUT_MS,
): Promise<Response> => {
  if (!env.UPDATER_INTERNAL_URL || !env.UPDATER_INTERNAL_TOKEN) {
    throw new Error("Updater is not configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${env.UPDATER_INTERNAL_URL}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "X-Updater-Token": env.UPDATER_INTERNAL_TOKEN,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Cached HEAD-style liveness check. Cheap enough to call on every page load
 * via the banner because it short-circuits when the cache is fresh and only
 * pings the sidecar when it expires.
 */
export const isUpdaterAvailable = async (): Promise<boolean> => {
  if (!isConfigured()) return false;

  const now = Date.now();
  if (availabilityCache && availabilityCache.expiresAt > now) {
    return availabilityCache.value;
  }

  let available = false;
  try {
    const response = await updaterFetch("/health", { method: "GET" }, HEALTH_TIMEOUT_MS);
    available = response.ok;
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "Updater health check failed",
    );
    available = false;
  }

  availabilityCache = { value: available, expiresAt: now + HEALTH_CACHE_TTL_MS };
  return available;
};

/** Forces the next call to re-probe instead of using the cached value. */
export const __resetUpdaterAvailabilityCache = (): void => {
  availabilityCache = null;
};

export const startUpdate = async (): Promise<
  | { ok: true; result: StartUpdateResult }
  | { ok: false; status: number; reason: string; activeJob?: UpdateJob }
> => {
  if (!isConfigured()) {
    return { ok: false, status: 503, reason: "updater_not_configured" };
  }

  let response: Response;
  try {
    response = await updaterFetch("/jobs", { method: "POST" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to reach updater");
    return { ok: false, status: 502, reason: `updater_unreachable: ${msg}` };
  }

  if (response.status === 202) {
    const body = (await response.json()) as StartUpdateResult;
    return { ok: true, result: body };
  }

  if (response.status === 409) {
    const body = (await response.json()) as {
      error: string;
      activeJob: UpdateJob;
    };
    return { ok: false, status: 409, reason: "active_job_exists", activeJob: body.activeJob };
  }

  return { ok: false, status: response.status, reason: `updater_status_${response.status}` };
};

export const getUpdateJob = async (
  jobId: string,
): Promise<UpdateJob | null> => {
  if (!isConfigured()) return null;

  let response: Response;
  try {
    response = await updaterFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg, jobId }, "Failed to fetch update job");
    return null;
  }

  if (response.status === 404) return null;
  if (!response.ok) return null;

  return (await response.json()) as UpdateJob;
};

export const getActiveUpdateJob = async (): Promise<UpdateJob | null> => {
  if (!isConfigured()) return null;

  let response: Response;
  try {
    response = await updaterFetch("/jobs/active", { method: "GET" });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const body = (await response.json()) as { job: UpdateJob | null };
  return body.job;
};
