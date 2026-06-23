import type { JobLogLine, SpawnResult } from "./types";
import { ps, restartServices, waitHealthy, type ComposeContext } from "./compose-ops";
import { spawnCmd } from "./spawn";

export const CONTROLLABLE_SERVICES = [
  "runner",
  "web-bridge",
  "discord-bridge",
  "frontend",
  "backend",
] as const;

export type ControllableService = (typeof CONTROLLABLE_SERVICES)[number];

export type InstanceServiceState =
  | "healthy"
  | "degraded"
  | "down"
  | "not_configured"
  | "unknown";

export interface InstanceServiceStatus {
  service: ControllableService;
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

export interface ServiceOperationsStatus {
  generatedAt: string;
  services: InstanceServiceStatus[];
  agentContainers: {
    total: number;
    running: number;
    exited: number;
    removableExited: AgentContainerStatus[];
  };
}

export interface CleanupExitedAgentContainersResult {
  removed: number;
  failed: number;
  skippedRunning: number;
  containers: AgentContainerStatus[];
  errors: Array<{ containerId: string; message: string }>;
}

const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/i;

export const isControllableService = (
  service: string,
): service is ControllableService =>
  (CONTROLLABLE_SERVICES as readonly string[]).includes(service);

const toServiceState = (input: {
  present: boolean;
  composeState: string | null;
  health: string | null;
  exitCode: number | null;
}): InstanceServiceState => {
  if (!input.present) return "not_configured";

  if (input.composeState === "running") {
    if (!input.health || input.health === "healthy") return "healthy";
    if (input.health === "starting") return "degraded";
    if (input.health === "unhealthy") return "down";
    return "unknown";
  }

  if (input.composeState === "exited") {
    return input.exitCode === 0 ? "degraded" : "down";
  }

  if (input.composeState === "dead" || input.composeState === "removing") {
    return "down";
  }

  return "unknown";
};

const parseAgentContainerLine = (line: string): AgentContainerStatus | null => {
  const [id, name, state, status, jobId, workerId] = line.split("\t");
  if (!id || !CONTAINER_ID_RE.test(id)) return null;

  return {
    id,
    name: name ?? "",
    state: state ?? "unknown",
    status: status ?? "",
    jobId: jobId || null,
    workerId: workerId || null,
  };
};

const docker = (
  args: string[],
  ctx: ComposeContext,
  timeoutMs: number,
): Promise<SpawnResult> =>
  spawnCmd(["docker", ...args], {
    cwd: ctx.repoPath,
    timeoutMs,
    onLog: ctx.onLog,
  });

export const listAgentContainers = async (
  ctx: ComposeContext,
): Promise<AgentContainerStatus[]> => {
  const result = await docker(
    [
      "ps",
      "-a",
      "--filter",
      "label=almirant-runner=true",
      "--format",
      [
        "{{.ID}}",
        "{{.Names}}",
        "{{.State}}",
        "{{.Status}}",
        "{{.Label \"job-id\"}}",
        "{{.Label \"worker-id\"}}",
      ].join("\t"),
    ],
    ctx,
    15_000,
  );

  if (!result.ok) return [];

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseAgentContainerLine)
    .filter((container): container is AgentContainerStatus => Boolean(container));
};

export const getServiceOperationsStatus = async (
  ctx: ComposeContext,
): Promise<ServiceOperationsStatus> => {
  const [composeServices, agentContainers] = await Promise.all([
    ps(ctx),
    listAgentContainers(ctx),
  ]);
  const byName = new Map(composeServices.map((service) => [service.service, service]));

  const services = CONTROLLABLE_SERVICES.map((service): InstanceServiceStatus => {
    const compose = byName.get(service);
    return {
      service,
      state: toServiceState({
        present: Boolean(compose),
        composeState: compose?.state ?? null,
        health: compose?.health ?? null,
        exitCode: compose?.exitCode ?? null,
      }),
      composeState: compose?.state ?? null,
      health: compose?.health ?? null,
      exitCode: compose?.exitCode ?? null,
      controllable: true,
    };
  });

  const running = agentContainers.filter((container) => container.state === "running");
  const removableExited = agentContainers.filter(
    (container) => container.state !== "running",
  );

  return {
    generatedAt: new Date().toISOString(),
    services,
    agentContainers: {
      total: agentContainers.length,
      running: running.length,
      exited: removableExited.length,
      removableExited,
    },
  };
};

export const restartControllableService = async (
  service: ControllableService,
  ctx: ComposeContext,
): Promise<SpawnResult> => restartServices([service], ctx);

export const waitForControllableService = async (
  service: ControllableService,
  ctx: ComposeContext,
): Promise<{ allHealthy: boolean; statuses: Array<unknown> }> =>
  waitHealthy([service], ctx, 2 * 60_000, 2_000);

export const cleanupExitedAgentContainers = async (
  ctx: ComposeContext,
  onLog?: (line: JobLogLine) => void,
): Promise<CleanupExitedAgentContainersResult> => {
  const containers = await listAgentContainers({ ...ctx, onLog });
  const removable = containers.filter((container) => container.state !== "running");
  const errors: Array<{ containerId: string; message: string }> = [];
  let removed = 0;

  for (const container of removable) {
    if (!CONTAINER_ID_RE.test(container.id)) {
      errors.push({ containerId: container.id, message: "invalid container id" });
      continue;
    }

    const result = await docker(
      ["rm", "-f", container.id],
      { ...ctx, onLog },
      30_000,
    );

    if (result.ok) {
      removed += 1;
      continue;
    }

    errors.push({
      containerId: container.id,
      message: result.stderr || result.stdout || "docker rm failed",
    });
  }

  return {
    removed,
    failed: errors.length,
    skippedRunning: containers.length - removable.length,
    containers: removable,
    errors,
  };
};
