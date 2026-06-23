/**
 * Instance service operations proxy.
 *
 * The API does not execute Docker itself. It validates admin intent, adds
 * product-level guardrails using database state, and delegates allowlisted
 * operations to the updater sidecar over the internal network.
 */

import { env, logger } from "@almirant/config";
import { getQueuedJobCount, getWorkers } from "@almirant/database";

const HEALTH_TIMEOUT_MS = 2_000;
const PROXY_TIMEOUT_MS = 10_000;

export type ControllableInstanceService =
  | "runner"
  | "web-bridge"
  | "discord-bridge"
  | "frontend"
  | "backend";

export type InstanceServiceState =
  | "healthy"
  | "degraded"
  | "down"
  | "not_configured"
  | "unknown";

export type ServiceOperationStatus = "queued" | "running" | "success" | "failed";

export type ServiceOperationStep =
  | "preparing"
  | "cleaning"
  | "restarting"
  | "healthchecking"
  | "done"
  | string;

export interface ServiceOperationLogLine {
  timestamp: string;
  source: "stdout" | "stderr" | "system";
  text: string;
}

export interface ServiceOperationJob {
  id: string;
  status: ServiceOperationStatus;
  step: ServiceOperationStep | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  logTail: ServiceOperationLogLine[];
  fromSha: string | null;
  toSha: string | null;
  errorMessage: string | null;
}

export interface InstanceServiceStatus {
  service: ControllableInstanceService;
  state: InstanceServiceState;
  composeState: string | null;
  health: string | null;
  exitCode: number | null;
  controllable: true;
}

export interface AgentContainerStatus {
  id: string;
  name: string;
  state: string;
  status: string;
  jobId: string | null;
  workerId: string | null;
}

export interface InstanceServiceOperationsStatus {
  generatedAt: string;
  updaterAvailable: boolean;
  queuedJobs: number;
  activeRunnerJobs: number;
  canRestartRunnerSafely: boolean;
  runnerRestartBlockReason: string | null;
  services: InstanceServiceStatus[];
  agentContainers: {
    total: number;
    running: number;
    exited: number;
    removableExited: AgentContainerStatus[];
  };
  activeOperation: ServiceOperationJob | null;
}

export interface StartServiceOperationResponse {
  jobId: string;
  startedAt: string;
}

type UpdaterStatusResponse = Omit<
  InstanceServiceOperationsStatus,
  | "updaterAvailable"
  | "queuedJobs"
  | "activeRunnerJobs"
  | "canRestartRunnerSafely"
  | "runnerRestartBlockReason"
  | "activeOperation"
>;

const CONTROLLABLE_SERVICES: ReadonlySet<string> = new Set([
  "runner",
  "web-bridge",
  "discord-bridge",
  "frontend",
  "backend",
]);

export const isControllableInstanceService = (
  service: string,
): service is ControllableInstanceService => CONTROLLABLE_SERVICES.has(service);

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

export const isServiceOperationsAvailable = async (): Promise<boolean> => {
  if (!isConfigured()) return false;

  try {
    const response = await updaterFetch("/health", { method: "GET" }, HEALTH_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
};

const getRunnerActiveJobCount = async (): Promise<number> => {
  const workers = await getWorkers();
  return workers
    .filter((worker) => worker.status === "online")
    .reduce((total, worker) => total + Math.max(0, worker.activeJobs), 0);
};

const getActiveServiceOperation = async (): Promise<ServiceOperationJob | null> => {
  if (!isConfigured()) return null;

  try {
    const response = await updaterFetch("/services/jobs/active", { method: "GET" });
    if (!response.ok) return null;
    const body = (await response.json()) as { job: ServiceOperationJob | null };
    return body.job ?? null;
  } catch {
    return null;
  }
};

export const getInstanceServiceOperationsStatus =
  async (): Promise<InstanceServiceOperationsStatus> => {
    const [updaterAvailable, queuedJobs, activeRunnerJobs] = await Promise.all([
      isServiceOperationsAvailable(),
      getQueuedJobCount(),
      getRunnerActiveJobCount(),
    ]);

    const fallback = {
      generatedAt: new Date().toISOString(),
      services: [] as InstanceServiceStatus[],
      agentContainers: {
        total: 0,
        running: 0,
        exited: 0,
        removableExited: [] as AgentContainerStatus[],
      },
    };

    let status: UpdaterStatusResponse = fallback;
    if (updaterAvailable) {
      try {
        const response = await updaterFetch("/services/status", { method: "GET" });
        if (response.ok) {
          status = (await response.json()) as UpdaterStatusResponse;
        }
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to load updater service status",
        );
      }
    }

    const canRestartRunnerSafely = activeRunnerJobs === 0;

    return {
      ...status,
      updaterAvailable,
      queuedJobs,
      activeRunnerJobs,
      canRestartRunnerSafely,
      runnerRestartBlockReason: canRestartRunnerSafely
        ? null
        : "runner_has_active_jobs",
      activeOperation: await getActiveServiceOperation(),
    };
  };

export const startInstanceServiceRestart = async (input: {
  service: ControllableInstanceService;
  force?: boolean;
}): Promise<
  | { ok: true; result: StartServiceOperationResponse }
  | {
      ok: false;
      status: number;
      reason: string;
      activeJob?: ServiceOperationJob;
    }
> => {
  if (!isConfigured()) {
    return { ok: false, status: 503, reason: "updater_not_configured" };
  }

  if (input.service === "runner" && !input.force) {
    const activeRunnerJobs = await getRunnerActiveJobCount();
    if (activeRunnerJobs > 0) {
      return {
        ok: false,
        status: 409,
        reason: "runner_has_active_jobs",
      };
    }
  }

  let response: Response;
  try {
    response = await updaterFetch(
      `/services/${encodeURIComponent(input.service)}/restart`,
      { method: "POST" },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg, service: input.service }, "Failed to reach updater");
    return { ok: false, status: 502, reason: `updater_unreachable: ${msg}` };
  }

  if (response.status === 202) {
    return {
      ok: true,
      result: (await response.json()) as StartServiceOperationResponse,
    };
  }

  if (response.status === 409) {
    const body = (await response.json()) as {
      activeJob?: ServiceOperationJob;
    };
    return {
      ok: false,
      status: 409,
      reason: "active_job_exists",
      activeJob: body.activeJob,
    };
  }

  return { ok: false, status: response.status, reason: `updater_status_${response.status}` };
};

export const startExitedAgentContainerCleanup = async (): Promise<
  | { ok: true; result: StartServiceOperationResponse }
  | {
      ok: false;
      status: number;
      reason: string;
      activeJob?: ServiceOperationJob;
    }
> => {
  if (!isConfigured()) {
    return { ok: false, status: 503, reason: "updater_not_configured" };
  }

  let response: Response;
  try {
    response = await updaterFetch("/services/agent-containers/cleanup-exited", {
      method: "POST",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to reach updater");
    return { ok: false, status: 502, reason: `updater_unreachable: ${msg}` };
  }

  if (response.status === 202) {
    return {
      ok: true,
      result: (await response.json()) as StartServiceOperationResponse,
    };
  }

  if (response.status === 409) {
    const body = (await response.json()) as {
      activeJob?: ServiceOperationJob;
    };
    return {
      ok: false,
      status: 409,
      reason: "active_job_exists",
      activeJob: body.activeJob,
    };
  }

  return { ok: false, status: response.status, reason: `updater_status_${response.status}` };
};

export const getServiceOperationJob = async (
  jobId: string,
): Promise<ServiceOperationJob | null> => {
  if (!isConfigured()) return null;

  try {
    const response = await updaterFetch(
      `/services/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" },
    );
    if (response.status === 404 || !response.ok) return null;
    return (await response.json()) as ServiceOperationJob;
  } catch {
    return null;
  }
};
