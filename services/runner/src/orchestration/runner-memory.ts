import os from "os";
import { readFileSync } from "node:fs";
import type { ClaimedJob } from "@almirant/remote-agent";
import { getResourcesForTier, resolveJobIntent, resolveResourceTier } from "./job-intent";

const BYTES_PER_MB = 1024 * 1024;
const PROC_MEMINFO_PATH = "/proc/meminfo";

export type SystemMemorySnapshot = {
  totalMb: number;
  availableMb: number;
  source: "proc-meminfo" | "os";
};

export type RunnerMemorySnapshot = {
  totalMb: number;
  systemAvailableMb: number;
  reservedMb: number;
  budgetMb: number;
  committedMb: number;
  availableForRunnersMb: number;
  pressurePercent: number;
  source: SystemMemorySnapshot["source"];
};

export type JobMemoryRequirement = {
  memoryMb: number;
  label: string;
  source: "effort-estimate" | "forecast" | "child-heuristic" | "tier";
};

type ResourceEstimateLike = {
  estimatedMemoryMb?: unknown;
};

export const DEFAULT_RUNNER_RESERVED_MB = 2048;
const MIN_FORECAST_MEMORY_BY_TEMPLATE: Record<string, number> = {
  implement: 3072,
  "runner-implement": 3072,
  "runner-fix-dod": 3072,
};

// A-1946 (ported from enterprise): clamp bounds for claim-time effort
// estimates sourced from `work_item_effort_estimates` via the claimJobs JOIN.
const MIN_ESTIMATED_MEMORY_MB = 256;
const MAX_ESTIMATED_MEMORY_MB = 8192;

// A-1946: templates eligible for the childCount fallback heuristic. Only
// parent-item runner jobs benefit from sizing by direct child count.
const CHILD_HEURISTIC_TEMPLATES = new Set(["runner-implement", "runner-document"]);

export const parseMemAvailableMb = (raw: string): number | null => {
  const totalMatch = raw.match(/^MemTotal:\s+(\d+)\s+kB$/m);
  const availableMatch = raw.match(/^MemAvailable:\s+(\d+)\s+kB$/m);

  const totalKb = totalMatch?.[1] ? Number(totalMatch[1]) : null;
  const availableKb = availableMatch?.[1] ? Number(availableMatch[1]) : null;

  if (
    totalKb === null ||
    availableKb === null ||
    !Number.isFinite(totalKb) ||
    !Number.isFinite(availableKb)
  ) {
    return null;
  }

  return Math.floor(availableKb / 1024);
};

const readLinuxSystemMemorySnapshot = (): SystemMemorySnapshot | null => {
  try {
    const raw = readFileSync(PROC_MEMINFO_PATH, "utf8");
    const availableMb = parseMemAvailableMb(raw);
    if (availableMb === null) return null;

    return {
      totalMb: Math.floor(os.totalmem() / BYTES_PER_MB),
      availableMb,
      source: "proc-meminfo",
    };
  } catch {
    return null;
  }
};

export const getSystemMemorySnapshot = (): SystemMemorySnapshot => {
  const linuxSnapshot = readLinuxSystemMemorySnapshot();
  if (linuxSnapshot) return linuxSnapshot;

  return {
    totalMb: Math.floor(os.totalmem() / BYTES_PER_MB),
    availableMb: Math.floor(os.freemem() / BYTES_PER_MB),
    source: "os",
  };
};

export const normalizeReservedMemoryMb = (
  value: number | null | undefined,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RUNNER_RESERVED_MB;
  }

  return Math.max(0, Math.floor(value));
};

export const calculateRunnerMemorySnapshot = (input: {
  system: SystemMemorySnapshot;
  committedMb: number;
  reservedMb: number;
}): RunnerMemorySnapshot => {
  const totalMb = Math.max(0, Math.floor(input.system.totalMb));
  const systemAvailableMb = Math.max(0, Math.floor(input.system.availableMb));
  const committedMb = Math.max(0, Math.floor(input.committedMb));
  const reservedMb = normalizeReservedMemoryMb(input.reservedMb);

  const budgetMb = Math.max(0, totalMb - reservedMb);
  const uncommittedBudgetMb = Math.max(0, budgetMb - committedMb);
  const availableAfterReserveMb = Math.max(0, systemAvailableMb - reservedMb);
  const availableForRunnersMb = Math.min(
    uncommittedBudgetMb,
    availableAfterReserveMb,
  );

  return {
    totalMb,
    systemAvailableMb,
    reservedMb,
    budgetMb,
    committedMb,
    availableForRunnersMb,
    pressurePercent:
      totalMb > 0
        ? Math.round((1 - systemAvailableMb / totalMb) * 10000) / 100
        : 0,
    source: input.system.source,
  };
};

export const calculateRamBoundAvailableSlots = (input: {
  maxConcurrent: number;
  activeJobs: number;
  ramBudgetEnabled: boolean;
  availableForRunnersMb: number;
  defaultJobMemoryMb: number;
}): number => {
  const hardCapSlots = Math.max(
    0,
    Math.floor(input.maxConcurrent) - Math.floor(input.activeJobs),
  );

  if (!input.ramBudgetEnabled) return hardCapSlots;

  const defaultJobMemoryMb = Math.max(1, Math.floor(input.defaultJobMemoryMb));
  const ramBoundSlots = Math.floor(
    Math.max(0, input.availableForRunnersMb) / defaultJobMemoryMb,
  );
  return Math.min(hardCapSlots, ramBoundSlots);
};

const resolveForecastMemoryMb = (
  config: Record<string, unknown> | null,
): number | null => {
  const resourceEstimate = config?.resourceEstimate as
    | ResourceEstimateLike
    | undefined;
  const memoryMb = resourceEstimate?.estimatedMemoryMb;

  if (typeof memoryMb !== "number" || !Number.isFinite(memoryMb)) {
    return null;
  }

  const normalized = Math.ceil(memoryMb);
  return normalized > 0 ? normalized : null;
};

const clampEstimatedMemory = (raw: number): number =>
  Math.min(MAX_ESTIMATED_MEMORY_MB, Math.max(MIN_ESTIMATED_MEMORY_MB, raw));

/**
 * Resolves a job's memory requirement. Priority order (A-1946 reconciliation):
 *
 *   1. `effort-estimate` — claim-time `estimatedMemoryMb` from the
 *      `work_item_effort_estimates` JOIN in `claimJobs`, clamped to
 *      [256, 8192] MB.
 *   2. `forecast` — `config.resourceEstimate.estimatedMemoryMb` persisted by
 *      the API's resource-forecast pipeline.
 *   3. `child-heuristic` — for runner-implement/runner-document parents
 *      (childCount > 0): min(4, childCount) * 500 + 1024 MB.
 *   4. `tier` — static resource tier fallback.
 *
 * The community safety floors (per-template production minimums and the
 * browser heavy minimum) apply to every estimate-derived value (1-3):
 * estimates may size a job UP beyond the floor, but never below the
 * empirically-derived minimums that fixed the 2026 OOM incidents.
 */
export const resolveJobMemoryRequirement = (
  job: ClaimedJob,
): JobMemoryRequirement => {
  const intent = resolveJobIntent(job);
  const label = intent.promptTemplate ?? "freeform";
  const browserMinimumMemoryMb = intent.needsBrowser
    ? getResourcesForTier("heavy").memoryMb
    : 0;
  const minimumMemoryMb = Math.max(
    MIN_FORECAST_MEMORY_BY_TEMPLATE[label] ?? 0,
    browserMinimumMemoryMb,
  );

  // 1. Claim-time effort estimate (work_item_effort_estimates JOIN).
  const effortMemoryMb = job.estimatedMemoryMb;
  if (typeof effortMemoryMb === "number" && Number.isFinite(effortMemoryMb)) {
    return {
      memoryMb: Math.max(clampEstimatedMemory(Math.ceil(effortMemoryMb)), minimumMemoryMb),
      label,
      source: "effort-estimate",
    };
  }

  // 2. Persisted resource forecast from the API.
  const forecastMemoryMb = resolveForecastMemoryMb(job.config);
  if (forecastMemoryMb !== null) {
    return {
      memoryMb: Math.max(forecastMemoryMb, minimumMemoryMb),
      label,
      source: "forecast",
    };
  }

  // 3. childCount fallback heuristic (10-minute escape without estimate).
  const childCount = job.childCount;
  if (
    typeof childCount === "number" &&
    Number.isFinite(childCount) &&
    childCount > 0 &&
    CHILD_HEURISTIC_TEMPLATES.has(label)
  ) {
    // childCount > 0 → parent (feature/epic); leaf tasks have 0 children.
    const heuristicMemoryMb = Math.min(4, childCount) * 500 + 1024;
    return {
      memoryMb: Math.max(heuristicMemoryMb, minimumMemoryMb),
      label,
      source: "child-heuristic",
    };
  }

  // 4. Static tier fallback.
  return {
    memoryMb: getResourcesForTier(resolveResourceTier(intent)).memoryMb,
    label,
    source: "tier",
  };
};
