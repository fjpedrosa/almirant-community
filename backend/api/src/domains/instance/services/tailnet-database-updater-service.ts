import { env, logger } from "@almirant/config";
import type { UpdateJob } from "./instance-update-service";

const PROXY_TIMEOUT_MS = 15_000;

export type TailnetDatabaseApplyAuth =
  | { method: "auth_key"; authKey: string }
  | { method: "oauth_client"; oauthClientId: string; oauthClientSecret: string };

export interface TailnetDatabaseApplyRequest {
  hostname: string;
  tag: string;
  auth: TailnetDatabaseApplyAuth;
}

export interface TailnetDatabaseRuntimeStatus {
  configured: boolean;
  online: boolean;
  hostname: string | null;
  tailnetName: string | null;
  tailscaleIp: string | null;
  tailscaleServiceState: string | null;
  proxyServiceState: string | null;
  error: string | null;
}

export interface StartInfraJobResult {
  jobId: string;
  startedAt: string;
}

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
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const parseJobResponse = async (
  response: Response,
): Promise<
  | { ok: true; result: StartInfraJobResult }
  | { ok: false; status: number; reason: string; activeJob?: UpdateJob }
> => {
  if (response.status === 202) {
    const body = (await response.json()) as StartInfraJobResult;
    return { ok: true, result: body };
  }

  if (response.status === 409) {
    const body = (await response.json()) as {
      error: string;
      activeJob?: UpdateJob;
    };
    return {
      ok: false,
      status: 409,
      reason: body.error || "active_job_exists",
      activeJob: body.activeJob,
    };
  }

  let reason = `updater_status_${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    reason = body.code ?? body.error ?? reason;
  } catch {
    // keep generic status reason
  }
  return { ok: false, status: response.status, reason };
};

export const startTailnetDatabaseApply = async (
  payload: TailnetDatabaseApplyRequest,
): Promise<
  | { ok: true; result: StartInfraJobResult }
  | { ok: false; status: number; reason: string; activeJob?: UpdateJob }
> => {
  if (!isConfigured()) {
    return { ok: false, status: 503, reason: "updater_not_configured" };
  }

  try {
    const response = await updaterFetch("/infra/tailscale-db/apply", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return parseJobResponse(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to reach updater for tailnet DB apply");
    return { ok: false, status: 502, reason: `updater_unreachable: ${msg}` };
  }
};

export const startTailnetDatabaseDisable = async (): Promise<
  | { ok: true; result: StartInfraJobResult }
  | { ok: false; status: number; reason: string; activeJob?: UpdateJob }
> => {
  if (!isConfigured()) {
    return { ok: false, status: 503, reason: "updater_not_configured" };
  }

  try {
    const response = await updaterFetch("/infra/tailscale-db/disable", {
      method: "POST",
    });
    return parseJobResponse(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to reach updater for tailnet DB disable");
    return { ok: false, status: 502, reason: `updater_unreachable: ${msg}` };
  }
};

export const getTailnetDatabaseInfraJob = async (
  jobId: string,
): Promise<UpdateJob | null> => {
  if (!isConfigured()) return null;

  try {
    const response = await updaterFetch(
      `/infra/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" },
    );
    if (response.status === 404) return null;
    if (!response.ok) return null;
    return (await response.json()) as UpdateJob;
  } catch {
    return null;
  }
};

export const getTailnetDatabaseRuntimeStatus = async (): Promise<TailnetDatabaseRuntimeStatus | null> => {
  if (!isConfigured()) return null;

  try {
    const response = await updaterFetch("/infra/tailscale-db/status", {
      method: "GET",
    });
    if (!response.ok) return null;
    return (await response.json()) as TailnetDatabaseRuntimeStatus;
  } catch {
    return null;
  }
};
