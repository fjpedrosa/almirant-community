import type { ClaimedJob, WorkItemDetails } from "@almirant/remote-agent";

export type RunnerContainerVolume = {
  source: string;
  target: string;
  readOnly?: boolean;
};

export type RunnerContainerSpec = {
  image: string;
  env: Record<string, string>;
  command?: string[];
  entrypoint?: string[];
  workingDir?: string;
  user?: string;
  labels?: Record<string, string>;
  volumes?: RunnerContainerVolume[];
  tmpfs?: Record<string, string>;
  portBindings?: Record<string, Array<{ HostIp?: string; HostPort: string }>>;
  securityOpt?: string[];
  capDrop?: string[];
  readOnlyRootFs?: boolean;
  cpuLimit?: number;
  memoryLimitMb?: number;
  tty?: boolean;
};

export type RuntimeType = "opencode" | "claude-shim" | "codex-shim";

export type PlatformRuntime = "claude-code" | "opencode" | "codex";

export type RuntimeInstructionTarget = "CLAUDE.md" | "AGENTS.md";

export type RuntimeImageCatalog = {
  opencodeImage: string;
  claudeShimImage: string;
  codexShimImage: string;
  servePort?: number;
};

export type RuntimeConfig = {
  type: RuntimeType;
  image: string;
  envVars: Record<string, string>;
  entrypoint?: string[];
  command?: string[];
  configFile?: "opencode.json";
};

export type RuntimeExecutor = {
  codingAgent: string;
  runtimeType: RuntimeType;
  platformRuntime: PlatformRuntime;
  instructionTargets: RuntimeInstructionTarget[];
  resolveRuntimeConfig: (images: RuntimeImageCatalog) => RuntimeConfig;
  buildSkillAugmentation?: (skillName: string) => string | null;
};

export type RuntimeExecutorRegistry = {
  resolve: (params: { provider: string; codingAgent?: string }) => RuntimeExecutor;
  resolveByRuntimeType: (runtimeType: RuntimeType) => RuntimeExecutor;
};

export type ManagedContainerInfo = {
  id: string;
  image: string;
  labels: Record<string, string>;
  state?: string;
  createdAt?: string;
};

export type JobExecutionResult = {
  jobId: string;
  success: boolean;
  exitCode?: number;
  threadId?: string;
  summary?: string;
  errorMessage?: string;
};

export type JobExecutionInput = {
  job: ClaimedJob;
  workItem: WorkItemDetails | null;
};

export type ContainerStats = {
  containerId: string;
  jobId: string;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
};

export type SystemMetrics = {
  cpuPercent: number;
  ramPercent: number;
  ramTotalMb: number;
  ramUsedMb: number;
  processes: Array<{
    jobId: string;
    skillName: string;
  }>;
  containerHealth?: {
    status: "healthy" | "degraded";
    zombieSuspected: number;
    cleanupFailures: number;
    lastCleanupAt?: string;
    lastIssue?: string;
  };
};

export type RunnerStatusSnapshot = {
  workerId: string;
  startedAt: string;
  activeJobs: number;
  isRunning: boolean;
  isDraining: boolean;
  availableSlots: number;
  ramBudgetMb?: number;
  ramCommittedMb?: number;
  ramAvailableMb?: number;
  ramReservedMb?: number;
  ramSystemAvailableMb?: number;
  ramAvailableForRunnersMb?: number;
};

export type ValidateEnvironment = {
  sessionName: string;
  networkName: string;
  frontendUrl: string;
  frontendPort: number;
  containerIds: string[];
};

export type ServiceContainerSpec = {
  name: string;
  image: string;
  env: Record<string, string>;
  command?: string[];
  networkName: string;
  healthcheck?: {
    test: string[];
    intervalMs: number;
    timeoutMs: number;
    retries: number;
    startPeriodMs: number;
  };
  tmpfs?: Record<string, string>;
  dependsOn?: string[];
};

// ---------------------------------------------------------------------------
// Error classification for retry decisions (A-863)
// ---------------------------------------------------------------------------

export type ErrorClassification =
  | "recoverable_oom"
  | "recoverable_timeout"
  | "recoverable_disconnect"
  | "permanent_auth"
  | "permanent_config"
  | "permanent_unknown";

const OOM_PATTERNS = /killed|oomkilled|out of memory|memory/i;
const TIMEOUT_PATTERNS = /timeout|timed out|timed_out/i;
const DISCONNECT_PATTERNS = /econnreset|socket hang up|sse|disconnect|econnrefused|epipe|fetch failed|unable to connect/i;
const AUTH_PATTERNS = /\b401\b|\b403\b|unauthorized|forbidden/i;
const CONFIG_PATTERNS = /invalid config|missing.*config|not found.*repo|repo.*not found|missing.*skill|skill.*not found/i;

export const classifyError = (error: Error | string): ErrorClassification => {
  const message = typeof error === "string" ? error : error.message;

  if (OOM_PATTERNS.test(message)) return "recoverable_oom";
  if (TIMEOUT_PATTERNS.test(message)) return "recoverable_timeout";
  if (DISCONNECT_PATTERNS.test(message)) return "recoverable_disconnect";
  if (AUTH_PATTERNS.test(message)) return "permanent_auth";
  if (CONFIG_PATTERNS.test(message)) return "permanent_config";

  return "permanent_unknown";
};

export const isRecoverableError = (classification: ErrorClassification): boolean =>
  classification.startsWith("recoverable_");
