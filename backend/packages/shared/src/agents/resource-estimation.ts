export type ResourceConfidence = "low" | "medium" | "high";
export type ResourceEstimateSource = "forecast" | "profile" | "skill-default";

export type ResourceEstimate = {
  estimatedMemoryMb: number;
  source: ResourceEstimateSource;
  confidence: ResourceConfidence;
  reason?: string;
};

export type SkillResources = {
  memoryMb: number;
  tmpfs: { workspace: number; tmp: number; home: number };
};

export const BASE_RUNNER_MEMORY_MB = 1024;
/**
 * Production runner telemetry showed 512MB per subagent was too optimistic:
 * recent OpenCode implementation jobs repeatedly hit 1536/2048/2560MB cgroup
 * limits while the host still had RAM available. Keep the default conservative;
 * API forecasts can still override it with per-subagent profiles.
 */
export const DEFAULT_SUBAGENT_MEMORY_MB = 1024;
export const MAX_CONCURRENT_SUBAGENTS = 5;

export const estimateMemoryForConcurrentSubagents = (count: number): number =>
  BASE_RUNNER_MEMORY_MB +
  Math.max(0, Math.floor(count)) * DEFAULT_SUBAGENT_MEMORY_MB;

const memoryFor = (concurrentSubagents: number): number =>
  estimateMemoryForConcurrentSubagents(concurrentSubagents);

export const SKILL_MEMORY_MAP: Record<string, SkillResources> = {
  validate: {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 3072, tmp: 768, home: 1536 },
  },
  "nightly-fix": {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 3072, tmp: 768, home: 1536 },
  },
  recording: {
    memoryMb: memoryFor(0),
    tmpfs: { workspace: 3072, tmp: 768, home: 1536 },
  },
  implement: {
    memoryMb: memoryFor(MAX_CONCURRENT_SUBAGENTS),
    tmpfs: { workspace: 2048, tmp: 512, home: 1024 },
  },
  "runner-implement": {
    memoryMb: memoryFor(MAX_CONCURRENT_SUBAGENTS),
    tmpfs: { workspace: 2048, tmp: 512, home: 1024 },
  },
  fix: {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 2048, tmp: 512, home: 1024 },
  },
  review: {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 2048, tmp: 512, home: 1024 },
  },
  document: {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 1536, tmp: 512, home: 768 },
  },
  "runner-document": {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 1536, tmp: 512, home: 768 },
  },
  ideate: {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 1536, tmp: 512, home: 768 },
  },
  planning: {
    memoryMb: memoryFor(1),
    tmpfs: { workspace: 1536, tmp: 512, home: 768 },
  },
};

export const DEFAULT_MEMORY_MB = memoryFor(1);

export const getSkillMemoryMb = (skillName: string | undefined): number =>
  SKILL_MEMORY_MAP[skillName ?? ""]?.memoryMb ?? DEFAULT_MEMORY_MB;
