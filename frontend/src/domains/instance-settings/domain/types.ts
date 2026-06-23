import type {
  TailscaleSetupState,
  TailscaleServeResult,
} from "@/domains/onboarding/domain/types";

// Re-export for convenience within this domain
export type { TailscaleSetupState, TailscaleServeResult };

export type TailnetDatabaseAuthMethod = "auth_key" | "oauth_client";
export type TailnetDatabaseAccessStatus =
  | "not_configured"
  | "provisioning"
  | "connected"
  | "error";

export interface TailnetDatabaseStatusView {
  enabled: boolean;
  status: TailnetDatabaseAccessStatus;
  authMethod: TailnetDatabaseAuthMethod | null;
  hostname: string;
  tag: string;
  tailscaleIp: string | null;
  tailnetName: string | null;
  magicDnsName: string | null;
  connectionString: string | null;
  lastJobId: string | null;
  lastError: string | null;
  connectionTestedAt: string | null;
  lastConnectedAt: string | null;
  updaterAvailable: boolean;
}

export interface TailnetDatabaseConnectInput {
  authMethod: TailnetDatabaseAuthMethod;
  authKey?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  hostname?: string;
  tag?: string;
}

// --- Presentational Props ---

export interface PublicUrlSectionProps {
  currentUrl: string | null;
  inputUrl: string;
  onInputUrlChange: (url: string) => void;
  isSaving: boolean;
  onSave: () => void;
}

export interface TailscaleSectionProps {
  available: boolean;
  hostname: string | null;
  suggestedUrl: string | null;
  reason?: string;
  servingHttps: boolean;
  httpsTarget: string | null;
  isServing: boolean;
  onServe: () => void;
  serveResult: TailscaleServeResult | null;
  isDisabling: boolean;
  onDisable: () => void;
}

export interface TailnetDatabaseSectionProps {
  status: TailnetDatabaseStatusView | null;
  isLoading: boolean;
  isEditing: boolean;
  authMethod: TailnetDatabaseAuthMethod;
  onAuthMethodChange: (method: TailnetDatabaseAuthMethod) => void;
  hostname: string;
  onHostnameChange: (hostname: string) => void;
  tag: string;
  onTagChange: (tag: string) => void;
  authKey: string;
  onAuthKeyChange: (authKey: string) => void;
  oauthClientId: string;
  onOauthClientIdChange: (clientId: string) => void;
  oauthClientSecret: string;
  onOauthClientSecretChange: (clientSecret: string) => void;
  isConnecting: boolean;
  isTesting: boolean;
  isDisabling: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onConnect: () => void;
  onTest: () => void;
  onDisable: () => void;
}

export type CapacityWarningSeverity = "info" | "warning" | "critical";

export interface CapacityWarning {
  code: string;
  severity: CapacityWarningSeverity;
  message: string;
}

export interface InstanceCapacityDiagnostics {
  generatedAt: string;
  host: {
    source: "runner-heartbeat" | "backend-os";
    memorySource: "proc-meminfo" | "os" | null;
    ramTotalMb: number;
    ramUsedMb: number;
    ramAvailableMb: number;
    cpuCores: number;
    observedAt: string;
  };
  config: {
    ramBudgetEnabled: boolean;
    reservedMb: number;
    maxConcurrent: number;
    defaultJobMemoryMb: number;
    source: "environment";
  };
  recommendation: {
    recommendedReservedMb: number;
    recommendedConcurrent: number;
    safeMaxConcurrent: number;
    memoryBoundConcurrent: number;
    cpuBoundConcurrent: number;
    effectiveRunnerBudgetMb: number;
    upgradeHeadroomMb: number;
    isConfiguredSafe: boolean;
  };
  workers: Array<{
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
  }>;
  workerCounts: {
    total: number;
    visible: number;
    online: number;
    offlineWithOrphanedJobs: number;
    hiddenOffline: number;
  };
  orphanedJobs: Array<{
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
  }>;
  warnings: CapacityWarning[];
  recommendedEnv: string;
}

export interface CapacitySectionProps {
  diagnostics: InstanceCapacityDiagnostics | null;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  onCancelOrphanedJob: (jobId: string) => void;
  onCancelAllOrphanedJobs: () => void;
  cancellingOrphanedJobId: string | null;
  isCancellingAllOrphanedJobs: boolean;
}

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

export interface ServiceOperationLogLine {
  timestamp: string;
  source: "stdout" | "stderr" | "system";
  text: string;
}

export interface ServiceOperationJob {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  step: string | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  logTail: ServiceOperationLogLine[];
  fromSha: string | null;
  toSha: string | null;
  errorMessage: string | null;
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

export interface OperationsSectionProps {
  status: InstanceServiceOperationsStatus | null;
  isLoading: boolean;
  isError: boolean;
  isStartingOperation: boolean;
  onRefresh: () => void;
  onRestartService: (
    service: ControllableInstanceService,
    options?: { force?: boolean },
  ) => void;
  onCleanupExitedContainers: () => void;
}

export interface InstanceSettingsViewProps {
  publicUrl: PublicUrlSectionProps;
  tailscale: TailscaleSectionProps;
  tailnetDatabase: TailnetDatabaseSectionProps;
  capacity: CapacitySectionProps;
  operations: OperationsSectionProps;
  isLoading: boolean;
}
