import os from "node:os";
import { getSkillMemoryMb } from "@almirant/shared";
import {
  getOrphanedWorkerJobs,
  getWorkers,
  type OrphanedWorkerJobDb,
  type WorkerRegistrationDb,
} from "@almirant/database";

const DEFAULT_RUNNER_RESERVED_MB = 2048;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_JOB_MEMORY_KEY = "runner-implement";

export type InstanceCapacityWarningSeverity = "info" | "warning" | "critical";

export interface InstanceCapacityWarning {
  code:
    | "no_runner_heartbeat"
    | "ram_budget_disabled"
    | "reserved_below_recommendation"
    | "configured_concurrency_above_safe_max"
    | "insufficient_runner_budget"
    | "low_upgrade_headroom";
  severity: InstanceCapacityWarningSeverity;
  message: string;
}

export interface InstanceCapacityHostSnapshot {
  source: "runner-heartbeat" | "backend-os";
  memorySource: "proc-meminfo" | "os" | null;
  ramTotalMb: number;
  ramUsedMb: number;
  ramAvailableMb: number;
  cpuCores: number;
  observedAt: string;
}

export interface InstanceCapacityConfigSnapshot {
  ramBudgetEnabled: boolean;
  reservedMb: number;
  maxConcurrent: number;
  defaultJobMemoryMb: number;
  source: "environment";
}

export interface InstanceCapacityRecommendation {
  recommendedReservedMb: number;
  recommendedConcurrent: number;
  safeMaxConcurrent: number;
  memoryBoundConcurrent: number;
  cpuBoundConcurrent: number;
  effectiveRunnerBudgetMb: number;
  upgradeHeadroomMb: number;
  isConfiguredSafe: boolean;
}

export interface InstanceCapacityWorkerSnapshot {
  workerId: string;
  hostname: string;
  status: "online" | "offline";
  activeJobs: number;
  maxConcurrentAgents: number;
  availableSlots: number;
  isDraining: boolean;
  ramBudgetMb: number | null;
  ramCommittedMb: number | null;
  ramAvailableMb: number | null;
  lastHeartbeatAt: string | null;
  systemMetrics: {
    cpuPercent: number | null;
    cpuCores: number | null;
    ramPercent: number | null;
    ramTotalMb: number | null;
    ramUsedMb: number | null;
    ramSystemAvailableMb: number | null;
    ramReservedMb: number | null;
    ramAvailableForRunnersMb: number | null;
    ramPressurePercent: number | null;
    ramBudgetEnabled: boolean | null;
    memorySource: "proc-meminfo" | "os" | null;
  } | null;
}

export interface InstanceCapacityWorkerCounts {
  total: number;
  visible: number;
  online: number;
  offlineWithOrphanedJobs: number;
  hiddenOffline: number;
}

export interface InstanceCapacityOrphanedJob {
  id: string;
  status: "queued" | "running" | "finalizing" | "waiting_for_input" | "paused";
  jobType: string | null;
  skillName: string | null;
  promptTemplate: string | null;
  workerId: string;
  workerHostname: string | null;
  workItemId: string | null;
  workItemTaskId: string | null;
  workItemTitle: string | null;
  createdAt: string;
  startedAt: string | null;
}

export interface InstanceCapacityDiagnostics {
  generatedAt: string;
  host: InstanceCapacityHostSnapshot;
  config: InstanceCapacityConfigSnapshot;
  recommendation: InstanceCapacityRecommendation;
  workers: InstanceCapacityWorkerSnapshot[];
  workerCounts: InstanceCapacityWorkerCounts;
  orphanedJobs: InstanceCapacityOrphanedJob[];
  warnings: InstanceCapacityWarning[];
  recommendedEnv: string;
}

interface BuildCapacityDiagnosticsInput {
  now: Date;
  host: InstanceCapacityHostSnapshot;
  config: InstanceCapacityConfigSnapshot;
  workers: InstanceCapacityWorkerSnapshot[];
  orphanedJobs?: InstanceCapacityOrphanedJob[];
}

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const toNonNegativeInteger = (value: unknown): number | null => {
  const numberValue = toFiniteNumber(value);
  if (numberValue === null) return null;
  return Math.max(0, Math.floor(numberValue));
};

const readEnvInteger = (
  source: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number => {
  const raw = source[key];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const readEnvBoolean = (
  source: Record<string, string | undefined>,
  key: string,
  fallback: boolean,
): boolean => {
  const raw = source[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
};

export const resolveCapacityConfigFromEnv = (
  source: Record<string, string | undefined> = process.env,
): InstanceCapacityConfigSnapshot => ({
  ramBudgetEnabled: readEnvBoolean(source, "RUNNER_RAM_BUDGET_ENABLED", true),
  reservedMb: readEnvInteger(
    source,
    "RUNNER_RAM_RESERVED_MB",
    DEFAULT_RUNNER_RESERVED_MB,
  ),
  maxConcurrent: Math.max(
    1,
    readEnvInteger(source, "MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT),
  ),
  defaultJobMemoryMb: Math.max(1, getSkillMemoryMb(DEFAULT_JOB_MEMORY_KEY)),
  source: "environment",
});

export const readBackendHostSnapshot = (now = new Date()): InstanceCapacityHostSnapshot => {
  const totalMb = Math.max(0, Math.floor(os.totalmem() / 1024 / 1024));
  const freeMb = Math.max(0, Math.floor(os.freemem() / 1024 / 1024));

  return {
    source: "backend-os",
    memorySource: "os",
    ramTotalMb: totalMb,
    ramUsedMb: Math.max(0, totalMb - freeMb),
    ramAvailableMb: freeMb,
    cpuCores: Math.max(1, os.cpus().length),
    observedAt: now.toISOString(),
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const normalizeMemorySource = (value: unknown): "proc-meminfo" | "os" | null => {
  if (value === "proc-meminfo" || value === "os") return value;
  return null;
};

const normalizeWorker = (
  worker: WorkerRegistrationDb,
): InstanceCapacityWorkerSnapshot => {
  const metrics = asRecord(worker.systemMetrics);
  const memorySource = normalizeMemorySource(metrics?.memorySource);

  return {
    workerId: worker.workerId,
    hostname: worker.hostname,
    status: worker.status,
    activeJobs: worker.activeJobs,
    maxConcurrentAgents: worker.maxConcurrentAgents,
    availableSlots: worker.availableSlots,
    isDraining: worker.isDraining,
    ramBudgetMb: worker.ramBudgetMb,
    ramCommittedMb: worker.ramCommittedMb,
    ramAvailableMb: worker.ramAvailableMb,
    lastHeartbeatAt: worker.lastHeartbeatAt?.toISOString() ?? null,
    systemMetrics: metrics
      ? {
          cpuPercent: toFiniteNumber(metrics.cpuPercent),
          cpuCores: toNonNegativeInteger(metrics.cpuCores),
          ramPercent: toFiniteNumber(metrics.ramPercent),
          ramTotalMb: toNonNegativeInteger(metrics.ramTotalMb),
          ramUsedMb: toNonNegativeInteger(metrics.ramUsedMb),
          ramSystemAvailableMb: toNonNegativeInteger(
            metrics.ramSystemAvailableMb,
          ),
          ramReservedMb: toNonNegativeInteger(metrics.ramReservedMb),
          ramAvailableForRunnersMb: toNonNegativeInteger(
            metrics.ramAvailableForRunnersMb,
          ),
          ramPressurePercent: toFiniteNumber(metrics.ramPressurePercent),
          ramBudgetEnabled:
            typeof metrics.ramBudgetEnabled === "boolean"
              ? metrics.ramBudgetEnabled
              : null,
          memorySource,
        }
      : null,
  };
};

const toISOStringOrNull = (value: Date | null): string | null =>
  value instanceof Date ? value.toISOString() : null;

const normalizeOrphanedJob = (
  job: OrphanedWorkerJobDb,
): InstanceCapacityOrphanedJob | null => {
  if (!job.workerId) return null;
  if (
    job.status !== "queued" &&
    job.status !== "running" &&
    job.status !== "finalizing" &&
    job.status !== "waiting_for_input" &&
    job.status !== "paused"
  ) {
    return null;
  }

  return {
    id: job.id,
    status: job.status,
    jobType: job.jobType,
    skillName: job.skillName,
    promptTemplate: job.promptTemplate,
    workerId: job.workerId,
    workerHostname: job.workerHostname,
    workItemId: job.workItemId,
    workItemTaskId: job.workItemTaskId,
    workItemTitle: job.workItemTitle,
    createdAt: job.createdAt.toISOString(),
    startedAt: toISOStringOrNull(job.startedAt),
  };
};

const compareHeartbeatDesc = (
  left: InstanceCapacityWorkerSnapshot,
  right: InstanceCapacityWorkerSnapshot,
): number => {
  const leftTime = left.lastHeartbeatAt ? Date.parse(left.lastHeartbeatAt) : 0;
  const rightTime = right.lastHeartbeatAt ? Date.parse(right.lastHeartbeatAt) : 0;
  return rightTime - leftTime;
};

const resolveHostSnapshot = (
  fallback: InstanceCapacityHostSnapshot,
  workers: InstanceCapacityWorkerSnapshot[],
): InstanceCapacityHostSnapshot => {
  const primary = [...workers]
    .filter((worker) => worker.status === "online")
    .sort(compareHeartbeatDesc)
    .find((worker) => worker.systemMetrics?.ramTotalMb);

  const metrics = primary?.systemMetrics;
  if (!primary || !metrics?.ramTotalMb) return fallback;

  const ramUsedMb = metrics.ramUsedMb ?? 0;
  const ramAvailableMb =
    metrics.ramSystemAvailableMb ?? Math.max(0, metrics.ramTotalMb - ramUsedMb);

  return {
    source: "runner-heartbeat",
    memorySource: metrics.memorySource,
    ramTotalMb: metrics.ramTotalMb,
    ramUsedMb,
    ramAvailableMb,
    cpuCores: Math.max(1, metrics.cpuCores ?? fallback.cpuCores),
    observedAt: primary.lastHeartbeatAt ?? fallback.observedAt,
  };
};

export const recommendReservedMemoryMb = (totalMb: number): number => {
  if (totalMb <= 0) return DEFAULT_RUNNER_RESERVED_MB;
  if (totalMb < 12 * 1024) return 2048;
  if (totalMb < 20 * 1024) return 3072;
  if (totalMb < 48 * 1024) return 4096;
  if (totalMb < 96 * 1024) return 6144;
  return 8192;
};

export const recommendConcurrentAgents = (input: {
  totalMb: number;
  cpuCores: number;
}): number => {
  const cpuCores = Math.max(1, Math.floor(input.cpuCores));
  const totalMb = Math.max(0, Math.floor(input.totalMb));

  if (totalMb < 8 * 1024) return 1;
  if (totalMb < 20 * 1024) return Math.min(2, cpuCores);
  if (totalMb < 48 * 1024) {
    return Math.min(Math.max(3, Math.floor(cpuCores / 4)), 4);
  }
  if (totalMb < 96 * 1024) {
    return Math.min(Math.max(4, Math.floor(cpuCores / 4)), 6);
  }
  return Math.min(Math.max(4, Math.floor(cpuCores / 4)), 8);
};

const buildRecommendedEnv = (input: {
  reservedMb: number;
  concurrent: number;
}): string => [
  "RUNNER_RAM_BUDGET_ENABLED=true",
  `RUNNER_RAM_RESERVED_MB=${input.reservedMb}`,
  `MAX_CONCURRENT=${input.concurrent}`,
].join("\n");

export const buildCapacityDiagnostics = (
  input: BuildCapacityDiagnosticsInput,
): InstanceCapacityDiagnostics => {
  const orphanedJobs = input.orphanedJobs ?? [];
  const orphanedJobCountsByWorkerId = orphanedJobs.reduce<Map<string, number>>(
    (counts, job) => {
      counts.set(job.workerId, (counts.get(job.workerId) ?? 0) + 1);
      return counts;
    },
    new Map(),
  );
  const visibleWorkers = input.workers
    .filter(
      (worker) =>
        worker.status === "online" ||
        orphanedJobCountsByWorkerId.has(worker.workerId),
    )
    .map((worker) => {
      const orphanedJobCount = orphanedJobCountsByWorkerId.get(worker.workerId);
      if (worker.status !== "offline" || !orphanedJobCount) return worker;
      return {
        ...worker,
        activeJobs: orphanedJobCount,
        availableSlots: 0,
      };
    });
  const workerCounts: InstanceCapacityWorkerCounts = {
    total: input.workers.length,
    visible: visibleWorkers.length,
    online: input.workers.filter((worker) => worker.status === "online").length,
    offlineWithOrphanedJobs: input.workers.filter(
      (worker) =>
        worker.status === "offline" &&
        orphanedJobCountsByWorkerId.has(worker.workerId),
    ).length,
    hiddenOffline: input.workers.filter(
      (worker) =>
        worker.status === "offline" &&
        !orphanedJobCountsByWorkerId.has(worker.workerId),
    ).length,
  };
  const recommendedReservedMb = recommendReservedMemoryMb(input.host.ramTotalMb);
  const effectiveReservedMb = Math.max(input.config.reservedMb, recommendedReservedMb);
  const effectiveRunnerBudgetMb = Math.max(
    0,
    input.host.ramTotalMb - input.config.reservedMb,
  );
  const recommendedRunnerBudgetMb = Math.max(
    0,
    input.host.ramTotalMb - effectiveReservedMb,
  );
  const memoryBoundConcurrent = Math.floor(
    recommendedRunnerBudgetMb / input.config.defaultJobMemoryMb,
  );
  const cpuBoundConcurrent = Math.max(
    1,
    Math.floor(Math.max(1, input.host.cpuCores) / 2),
  );
  const safeMaxConcurrent = Math.max(
    1,
    Math.min(cpuBoundConcurrent, Math.max(1, memoryBoundConcurrent)),
  );
  const recommendedConcurrent = Math.min(
    safeMaxConcurrent,
    recommendConcurrentAgents({
      totalMb: input.host.ramTotalMb,
      cpuCores: input.host.cpuCores,
    }),
  );
  const upgradeHeadroomMb = Math.max(0, input.host.ramAvailableMb);
  const isConfiguredSafe =
    input.config.ramBudgetEnabled &&
    input.config.reservedMb >= recommendedReservedMb &&
    input.config.maxConcurrent <= safeMaxConcurrent &&
    memoryBoundConcurrent > 0;

  const warnings: InstanceCapacityWarning[] = [];

  if (!input.workers.some((worker) => worker.status === "online")) {
    warnings.push({
      code: "no_runner_heartbeat",
      severity: "warning",
      message:
        "No online runner heartbeat is available; capacity is estimated from the backend container.",
    });
  }

  if (!input.config.ramBudgetEnabled) {
    warnings.push({
      code: "ram_budget_disabled",
      severity: "critical",
      message:
        "Runner RAM budget is disabled; concurrency is only protected by the slot cap.",
    });
  }

  if (input.config.reservedMb < recommendedReservedMb) {
    warnings.push({
      code: "reserved_below_recommendation",
      severity: "warning",
      message: `Reserved RAM is below the recommended ${recommendedReservedMb}MB for this host.`,
    });
  }

  if (input.config.maxConcurrent > safeMaxConcurrent) {
    warnings.push({
      code: "configured_concurrency_above_safe_max",
      severity: "critical",
      message: `Configured concurrency (${input.config.maxConcurrent}) exceeds the safe maximum (${safeMaxConcurrent}) for this host.`,
    });
  }

  if (memoryBoundConcurrent <= 0) {
    warnings.push({
      code: "insufficient_runner_budget",
      severity: "critical",
      message:
        "The reserved memory leaves less than one default agent job worth of RAM for runners.",
    });
  }

  if (upgradeHeadroomMb < recommendedReservedMb + input.config.defaultJobMemoryMb) {
    warnings.push({
      code: "low_upgrade_headroom",
      severity: "warning",
      message:
        "Current available RAM is low for running agents while building frontend/backend images during an upgrade.",
    });
  }

  return {
    generatedAt: input.now.toISOString(),
    host: input.host,
    config: input.config,
    recommendation: {
      recommendedReservedMb,
      recommendedConcurrent,
      safeMaxConcurrent,
      memoryBoundConcurrent,
      cpuBoundConcurrent,
      effectiveRunnerBudgetMb,
      upgradeHeadroomMb,
      isConfiguredSafe,
    },
    workers: visibleWorkers,
    workerCounts,
    orphanedJobs,
    warnings,
    recommendedEnv: buildRecommendedEnv({
      reservedMb: recommendedReservedMb,
      concurrent: recommendedConcurrent,
    }),
  };
};

export const getInstanceCapacityDiagnostics = async (
  now = new Date(),
): Promise<InstanceCapacityDiagnostics> => {
  const [workerRows, orphanedJobRows] = await Promise.all([
    getWorkers(),
    getOrphanedWorkerJobs(),
  ]);
  const workers = workerRows.map(normalizeWorker);
  const orphanedJobs = orphanedJobRows
    .map(normalizeOrphanedJob)
    .filter((job): job is InstanceCapacityOrphanedJob => job !== null);
  const fallbackHost = readBackendHostSnapshot(now);
  const host = resolveHostSnapshot(fallbackHost, workers);
  const config = resolveCapacityConfigFromEnv();

  return buildCapacityDiagnostics({
    now,
    host,
    config,
    workers,
    orphanedJobs,
  });
};
