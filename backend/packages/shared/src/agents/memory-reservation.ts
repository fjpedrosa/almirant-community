/**
 * Canonical memory accounting shared by runtime execution and resource demand
 * planning. Bind mounts are the normal path; tmpfs is an explicit fallback
 * that must be validated before starting a claimed container. The database
 * claim query mirrors these constants because SQL cannot import TypeScript.
 */

export type MemoryResourceTier = "light" | "standard" | "heavy";
export type MemoryRuntime = "opencode" | "claude-shim" | "codex-shim" | "pi-shim";

/** Host memory withheld for the OS, Docker, and the runner process itself. */
export const DEFAULT_RUNNER_RESERVED_MB = 2048;

/** Runtime headroom is part of the claim reservation, never an afterthought. */
export const RUNTIME_MEMORY_OVERHEAD_MB: Readonly<Record<MemoryRuntime, number>> = {
  opencode: 0,
  "claude-shim": 512,
  "codex-shim": 1536,
  "pi-shim": 512,
};

/** Worst-case tmpfs mount sizes by resource tier. */
export const CONSERVATIVE_TMPFS_MOUNT_MB: Readonly<Record<
  MemoryResourceTier,
  Readonly<{ workspace: number; tmp: number; home: number }>
>> = {
  light: { workspace: 1024, tmp: 512, home: 1280 },
  standard: { workspace: 2048, tmp: 512, home: 2048 },
  heavy: { workspace: 2048, tmp: 768, home: 2560 },
};

/** Worst-case tmpfs tax by resource tier (workspace + tmp + home). */
export const CONSERVATIVE_TMPFS_OVERHEAD_MB: Readonly<Record<MemoryResourceTier, number>> = {
  light: CONSERVATIVE_TMPFS_MOUNT_MB.light.workspace
    + CONSERVATIVE_TMPFS_MOUNT_MB.light.tmp
    + CONSERVATIVE_TMPFS_MOUNT_MB.light.home,
  standard: CONSERVATIVE_TMPFS_MOUNT_MB.standard.workspace
    + CONSERVATIVE_TMPFS_MOUNT_MB.standard.tmp
    + CONSERVATIVE_TMPFS_MOUNT_MB.standard.home,
  heavy: CONSERVATIVE_TMPFS_MOUNT_MB.heavy.workspace
    + CONSERVATIVE_TMPFS_MOUNT_MB.heavy.tmp
    + CONSERVATIVE_TMPFS_MOUNT_MB.heavy.home,
};

export const DEFAULT_TIER_MEMORY_MB: Readonly<Record<MemoryResourceTier, number>> = {
  light: 1024,
  standard: 1536,
  heavy: 3072,
};

export const getCanonicalTmpfsOverheadMb = (tier: MemoryResourceTier): number =>
  CONSERVATIVE_TMPFS_OVERHEAD_MB[tier];

/** Match runner residual accounting for an empty or active host. */
export const calculateCanonicalMemoryResidualMb = (input: {
  totalMb: number;
  availableMb: number;
  committedMb: number;
  reservedMb?: number | null;
}): number => {
  const totalMb = Math.max(0, Math.floor(input.totalMb));
  const availableMb = Math.max(0, Math.floor(input.availableMb));
  const committedMb = Math.max(0, Math.floor(input.committedMb));
  const reservedMb = typeof input.reservedMb === "number" && Number.isFinite(input.reservedMb)
    ? Math.max(0, Math.floor(input.reservedMb))
    : DEFAULT_RUNNER_RESERVED_MB;

  return Math.max(
    0,
    Math.min(
      totalMb - reservedMb - committedMb,
      availableMb - reservedMb,
    ),
  );
};

export type CanonicalMemoryBaseInput = {
  effortMemoryMb?: number | null;
  forecastMemoryMb?: number | null;
  childCount?: number | null;
  template?: string | null;
  browser?: boolean;
  tier: MemoryResourceTier;
};

export type CanonicalMemoryBase = {
  memoryMb: number;
  source: "effort-estimate" | "forecast" | "child-heuristic" | "tier";
};

const MIN_ESTIMATED_MEMORY_MB = 256;
const MAX_ESTIMATED_MEMORY_MB = 8192;
const MIN_FORECAST_MEMORY_BY_TEMPLATE: Readonly<Record<string, number>> = {
  implement: 3072,
  "runner-implement": 3072,
  "runner-fix-dod": 3072,
};

const clampEstimatedMemory = (value: number): number =>
  Math.min(MAX_ESTIMATED_MEMORY_MB, Math.max(MIN_ESTIMATED_MEMORY_MB, value));

const minimumMemoryFor = (input: CanonicalMemoryBaseInput): number => Math.max(
  MIN_FORECAST_MEMORY_BY_TEMPLATE[input.template ?? ""] ?? 0,
  input.browser ? DEFAULT_TIER_MEMORY_MB.heavy : 0,
);

/** Resolve the base demand before tmpfs and runtime overhead are added. */
export const resolveCanonicalMemoryBase = (
  input: CanonicalMemoryBaseInput,
): CanonicalMemoryBase => {
  const minimumMemoryMb = minimumMemoryFor(input);

  if (typeof input.effortMemoryMb === "number" && Number.isFinite(input.effortMemoryMb)) {
    return {
      memoryMb: Math.max(clampEstimatedMemory(Math.ceil(input.effortMemoryMb)), minimumMemoryMb),
      source: "effort-estimate",
    };
  }

  if (typeof input.forecastMemoryMb === "number" && Number.isFinite(input.forecastMemoryMb)) {
    const forecastMemoryMb = Math.ceil(input.forecastMemoryMb);
    if (forecastMemoryMb > 0) {
      return {
        memoryMb: Math.max(forecastMemoryMb, minimumMemoryMb),
        source: "forecast",
      };
    }
  }

  if (
    typeof input.childCount === "number" &&
    Number.isFinite(input.childCount) &&
    input.childCount > 0 &&
    (input.template === "runner-implement" || input.template === "runner-document")
  ) {
    const heuristicMemoryMb = Math.min(4, input.childCount) * 500 + 1024;
    return {
      memoryMb: Math.max(
        heuristicMemoryMb,
        input.template === "runner-implement" ? minimumMemoryMb : 0,
      ),
      source: "child-heuristic",
    };
  }

  return {
    memoryMb: DEFAULT_TIER_MEMORY_MB[input.tier],
    source: "tier",
  };
};

export const calculateCanonicalMemoryReservationMb = (input: {
  baseMemoryMb: number;
  tier: MemoryResourceTier;
  runtime: MemoryRuntime;
  /** Optional fallback mode; bind mounts (the normal path) stay disk-backed. */
  includeTmpfs?: boolean;
}): number =>
  Math.max(0, Math.ceil(input.baseMemoryMb))
  + (input.includeTmpfs ? getCanonicalTmpfsOverheadMb(input.tier) : 0)
  + RUNTIME_MEMORY_OVERHEAD_MB[input.runtime];
