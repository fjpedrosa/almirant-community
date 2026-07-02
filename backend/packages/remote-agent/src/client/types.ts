export type ApiClientConfig = {
  apiBaseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
};

export type WorkerProvider = "claude-code" | "codex" | "zipu" | "grok" | "opencode" | (string & {});
export type NightlyValidationProvider = "claude-code" | "codex" | "zipu" | "grok";
export type AgentJobPriority = "low" | "medium" | "high" | "urgent";
export type AgentJobStatus =
  | "queued"
  | "running"
  | "finalizing"
  | "completed"
  | "incomplete"
  | "failed"
  | "cancelled"
  | "waiting_for_input"
  | "paused";

export type AgentWorkspace =
  | { kind: "git_repo"; repositoryId?: string; repoUrl?: string; ref?: string; branch?: string; depth?: number }
  | { kind: "empty_workspace"; templateId?: string; template?: string }
  | { kind: "uploaded_files"; fileIds: string[]; unpackMode?: "flat" | "preserve_paths" }
  | { kind: "mounted_volume"; volumeId?: string; path?: string; mountPath?: string; readOnly?: boolean }
  | { kind: "memory_only"; contextIds: string[] };

export type WorkerHeartbeatPayload = {
  workerId: string;
  hostname: string;
  config?: Record<string, unknown>;
  activeJobs?: unknown[];
  activeJobsCount?: number;
  maxConcurrentAgents?: number;
  isDraining?: boolean;
  availableSlots?: number;
  ramBudgetMb?: number;
  ramCommittedMb?: number;
  ramAvailableMb?: number;
  /** ISO timestamp of when the runner process started (useful to detect Watchtower image updates). */
  startedAt?: string;
  systemMetrics?: {
    cpuPercent: number;
    cpuCores?: number;
    ramPercent: number;
    ramTotalMb: number;
    ramUsedMb: number;
    ramSystemAvailableMb?: number;
    ramReservedMb?: number;
    ramAvailableForRunnersMb?: number;
    ramPressurePercent?: number;
    ramBudgetEnabled?: boolean;
    memorySource?: "proc-meminfo" | "os";
    processes: Array<{ jobId: string; skillName: string }>;
    containerMetrics?: Array<{
      containerId: string;
      jobId: string;
      jobType: string;
      cpuPercent: number;
      memoryUsageMb: number;
      memoryLimitMb: number;
      memoryPercent: number;
    }>;
    containerHealth?: {
      status: "healthy" | "degraded";
      zombieSuspected: number;
      cleanupFailures: number;
      lastCleanupAt?: string;
      lastIssue?: string;
    };
  };
};

export type ClaimJobsPayload = {
  workerId: string;
  count: number;
  activeJobs?: number;
  acceptedCodingAgents?: string[];
};

export type ClaimedJob = {
  id: string;
  workItemId: string | null;
  projectId: string | null;
  boardId: string | null;
  createdByUserId: string | null;
  workspaceId: string | null;
  jobType?: "implementation" | "planning" | "review" | "validation" | "bug-fix" | "prewarm" | "scheduled" | "integration";
  provider: WorkerProvider;
  priority: AgentJobPriority;
  status: AgentJobStatus;
  retryCount: number;
  maxRetries: number;
  availableAt: string | null;
  config: Record<string, unknown> | null;
  // New model fields (prompt + trigger)
  prompt?: string | null;
  promptTemplate?: string | null;
  triggerType?: "event" | "scheduled" | "recovery" | null;
  interactive?: boolean | null;
  // Old model fields (kept for backward compat)
  codingAgent?: string | null;
  aiProvider?: string | null;
  model?: string | null;
  skillName?: string | null;
  // A-1945: effort-estimate fields surfaced by claimJobs SQL
  // JOIN on work_item_effort_estimates. null when no estimate exists
  // (either non-runner skills or a 10-minute escape).
  estimatedMemoryMb?: number | null;
  estimatedSubagents?: number | null;
  // A-1945: count of direct child work items (parent_id = work_item_id).
  // Used by the runner alongside estimatedSubagents for resource sizing.
  childCount?: number;
};

export type UpdateJobStatusPayload = {
  status: AgentJobStatus;
  workerId?: string;
  result?: Record<string, unknown>;
  errorMessage?: string;
  errorType?: string;
  retryCount?: number;
  availableAt?: string;
  branchName?: string;
  worktreePath?: string;
  durationMs?: number;
  prUrl?: string;
  prNumber?: number;
  commitSha?: string;
  cost?: number;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
  model?: string;
};

export type ProviderKeyProvider = "anthropic" | "openai" | "zai" | "xai" | (string & {});

export type ProviderKeyConnectionDebug = {
  connectionId: string;
  connectionName: string;
  provider: string;
  authMethod: "api_key" | "subscription";
  /** First 8 chars of the token/key for identification */
  tokenPrefix: string;
  /** Last 4 chars of the token/key for identification */
  tokenSuffix: string;
  tokenExpiresAt: string | null;
  /** Scope that matched: "user" or "organization" */
  scope: string;
  /** Skip reasons for connections that were tried and skipped */
  skipReasons?: Array<{ connectionId: string; name: string; reason: string }>;
};

export type ProviderKeysResponse = {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  xaiApiKey?: string;
  anthropicAuthMethod?: "api_key" | "subscription";
  openaiAuthMethod?: "api_key" | "subscription";
  xaiAuthMethod?: "api_key" | "subscription";
  openaiCredentialsJson?: string;
  planningModel?: string;
  implementationModel?: string;
  validationModel?: string;
  planningReasoningBudget?: string;
  implementationReasoningBudget?: string;
  validationReasoningBudget?: string;
  baseUrl?: string;
  /** Diagnostic metadata for debugging key resolution issues */
  _debug?: Record<string, ProviderKeyConnectionDebug>;
  [key: string]: unknown;
};

export type InstallationTokenResponse = {
  token: string;
  expiresAt: string;
};

export type RepoConfigResponse = {
  repositoryId: string;
  url: string;
  branch: string;
  provider: string;
  name: string;
};

export type QuotaCheckResponse = {
  allowed: boolean;
  remaining?: {
    tokens?: number | null;
    costUsd?: number | null;
    requests?: number | null;
  };
  reason?: string;
  resetAt?: string;
  periodEnd?: string;
  blockingQuotaType?: "daily" | "weekly" | "monthly";
};

export type InteractionQuestionType =
  | "clarification"
  | "approval"
  | "choice"
  | "free_text";

export type CreateInteractionPayload = {
  questionType: InteractionQuestionType;
  questionText: string;
  questionContext?: Record<string, unknown>;
  options?: string[];
  expiresAt: string;
  timeoutAction?: string;
  defaultAnswer?: string;
};

export type WorkerInteraction = {
  id: string;
  agentJobId: string;
  status: "pending" | "answered" | "timeout" | "cancelled";
  questionType: InteractionQuestionType;
  questionText: string;
  questionContext: Record<string, unknown> | null;
  options: string[] | null;
  response: string | null;
  responseSource: "user" | "timeout" | "system" | null;
  answeredAt: string | null;
  expiresAt: string;
  timeoutAction: string;
  defaultAnswer: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkItemDetails = {
  id: string;
  taskId: string | null;
  title: string;
  description: string | null;
  boardId: string;
  boardColumnId: string | null;
  projectId: string | null;
  parentId: string | null;
  type: string;
  priority: string;
  metadata: Record<string, unknown> | null;
  boardColumn?: {
    isDone?: boolean;
  };
  estimatedHours: number | null;
  parent?: {
    id: string;
    title: string;
    type: string;
    taskId: string | null;
  } | null;
};

export type WorkspaceFileDownloadResponse = {
  id: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  contentBase64: string;
  workspacePath?: string | null;
};

export type StreamJobOutputPayload = {
  content: string;
  stepIndex?: number;
  persistContent?: boolean;
  contentType?: "thinking" | "text" | "tool_use";
};

export type StreamJobOutputResponse = {
  processed: number;
  stepIndex: number;
  interactionIds?: string[];
};

export type JobLogLevel = "debug" | "info" | "warn" | "error";

export type JobLogEntryPayload = {
  seq: number;
  level?: JobLogLevel;
  phase: string;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
  timestamp: string;
  contentType?: string;
};

export type SendJobLogsPayload = {
  logs: JobLogEntryPayload[];
};

export type SendJobLogsResponse = {
  jobId: string;
  received: number;
  inserted: number;
  duplicates: number;
};

export type SessionEventRecord = {
  sequenceNum: number;
  kind: string;
  payload: Record<string, unknown> | null;
  provider?: string | null;
  createdAt?: string;
};

export type JobStatusResponse = {
  status: AgentJobStatus;
  shutdownRequested?: boolean;
};

export type SuccessEnvelope<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ErrorEnvelope = {
  success: false;
  error: string;
  meta?: Record<string, unknown>;
};

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface ValidationCandidate {
  id: string;
  taskId: string;
  title: string;
  type: string;
  parentId?: string;
  parentTaskId?: string;
  parentTitle?: string;
  parentType?: string;
  boardId: string;
  projectId: string;
  workspaceId: string;
  childIds: string[];
}

export interface FixCandidate {
  id: string;
  taskId: string;
  title: string;
  type: string;
  parentId: string | null;
  boardId: string;
  projectId: string;
  workspaceId: string | undefined;
  fixAttempts: number;
}

export interface DefinitionOfDoneReviewCandidate {
  id: string;
  taskId: string | null;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  parentId: string | null;
  boardId: string;
  projectId: string | null;
  workspaceId: string | null;
  columnName: string;
  definitionOfDone: string | null;
  dodReport: string | null;
  dodReviewedAt: string | null;
  updatedAt: string;
  /**
   * Review-column leaf work items covered by this candidate. Parent/block
   * candidates use these child IDs as the evidence scope while the job itself
   * targets the parent work item.
   */
  childIds?: string[];
}

export interface ReleaseIntegrationQueueResult {
  batches: Array<{
    batchId: string;
    repositoryId: string;
    projectId: string;
    created: boolean;
    enqueuedItemCount: number;
  }>;
  skipped: {
    noCandidates: number;
    activeRunningBatches: number;
    activeProjectLimit: number;
    duplicateItems: number;
    missingPullRequest: number;
    unresolvedRepository: number;
  };
}

export interface NightlyValidationConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  provider: NightlyValidationProvider;
}

export interface NightlyProjectValidationConfig {
  projectId: string;
  projectName: string;
  workspaceId: string;
  nightlyValidation: NightlyValidationConfig;
}

export interface CreateWorkerJobPayload {
  workItemId?: string;
  workspaceId?: string;
  prompt?: string;
  provider: WorkerProvider;
  jobType?: "implementation" | "planning" | "review" | "validation" | "bug-fix" | "prewarm" | "scheduled" | "integration";
  priority?: AgentJobPriority;
  codingAgent?: string;
  aiProvider?: string;
  model?: string;
  reasoningLevel?: string;
  config?: Partial<{
    repoPath: string;
    baseBranch: string;
    projectId: string;
    scheduledConfigId: string;
    scheduledConfigName: string;
    skillName: string;
    skillId: string;
    source: string;
    dodReport: string;
    dodReviewedAt: string;
    repositoryId: string;
    workspace: AgentWorkspace;
    prompt: string;
    reasoningLevel: string;
    batchId: string;
    integrationPhase: "process" | "merge";
    workspaceIntent: "read-only" | "write";
    postSessionPushPolicy: "never" | "on-success";
    mcpServers: Record<string, {
      type?: "remote";
      url: string;
      enabled?: boolean;
      oauth?: false;
    }>;
  }>;
}

export type ScheduledAgentConfigScheduleType = "manual" | "time_window" | "cron";

export interface TimeWindowScheduleConfig {
  startHour: number;
  endHour: number;
  daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, etc.
}

export interface CronScheduleConfig {
  expression: string;
}

export interface ScheduledAgentBacklogDrainProjectRule {
  projectId: string;
  enabled?: boolean;
  maxConcurrentJobs?: number | null;
  excludedWorkItemIds?: string[];
  excludeDescendants?: boolean;
  codingAgent?: "claude-code" | "codex" | "opencode" | null;
  aiProvider?: "anthropic" | "openai" | "google" | "zai" | "xai" | null;
  model?: string | null;
  reasoningLevel?: string | null;
}

export interface ScheduledAgentBacklogDrainConfig {
  enabled?: boolean;
  minAgeMinutes?: number;
  defaultMaxConcurrentJobs?: number | null;
  projects?: ScheduledAgentBacklogDrainProjectRule[];
}

export interface ScheduledAgentTargetConfig {
  projectIds?: string[];
  columnIds?: string[];
  statuses?: string[];
  priorities?: string[];
  maxAgeHours?: number;
  customFilters?: Record<string, unknown>;
  requireDodApproved?: boolean;
  backlogDrain?: ScheduledAgentBacklogDrainConfig;
  dodRemediation?: ScheduledAgentBacklogDrainConfig;
  dodReview?: {
    enabled?: boolean;
    minAgeMinutes?: number;
    defaultMaxConcurrentJobs?: number | null;
    projects?: ScheduledAgentBacklogDrainProjectRule[];
  };
  releaseIntegration?: {
    enabled?: boolean;
    minAgeMinutes?: number;
    defaultMaxConcurrentJobs?: number | null;
    projects?: ScheduledAgentBacklogDrainProjectRule[];
  };
}

export interface BacklogDrainCandidate {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  parentId: string | null;
  projectId: string;
  boardId: string;
  codingAgent: "claude-code" | "codex" | "opencode";
  aiProvider: "anthropic" | "openai" | "google" | "zai" | "xai";
  provider: "claude-code" | "codex" | "zipu" | "grok";
  model: string;
  reasoningLevel?: string | null;
  skillName?: "runner-implement" | "runner-fix-dod";
  dodReport?: string | null;
  dodReviewedAt?: string | null;
}

export interface BacklogDrainCandidatesResponse {
  candidates: BacklogDrainCandidate[];
  skipped: {
    excluded: string[];
    blocked: Array<{ workItemId: string; blockedBy: string[] }>;
    active: string[];
    concurrency: string[];
    recentlyModified: Array<{ workItemId: string; lastModifiedAt: string }>;
    dodIncomplete: string[];
    notDodRemediation: string[];
    missingDodReport: string[];
    humanReviewRequired: string[];
  };
}

export interface ScheduledAgentConfig {
  id: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string | null;
  name: string;
  prompt: string | null;
  jobType: string;
  provider: WorkerProvider;
  scheduleType: ScheduledAgentConfigScheduleType;
  scheduleConfig: TimeWindowScheduleConfig | CronScheduleConfig | null;
  timezone: string;
  enabled: boolean;
  targetConfig: ScheduledAgentTargetConfig;
  mcpServers: Record<string, {
    type?: "remote";
    url: string;
    enabled?: boolean;
    oauth?: false;
  }> | null;
  maxJobsPerRun: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  codingAgent: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  reasoningLevel: string | null;
}

export interface IntegrationBatchItemDto {
  id: string;
  batchId: string;
  workItemId: string;
  prNumber: number | null;
  prUrl: string | null;
  branchName: string | null;
  processingOrder: number;
  status:
    | "pending"
    | "rebasing"
    | "migrating"
    | "type_checking"
    | "testing"
    | "merged"
    | "skipped"
    | "failed";
  failureCategory:
    | "merge_conflict"
    | "schema_semantic"
    | "schema_obsolete_branch"
    | "schema_irreconcilable"
    | "migration_apply_failed"
    | "type_check_failed"
    | "tests_failed"
    | null;
  failureReason: string | null;
  commitShaBefore: string | null;
  commitShaAfter: string | null;
  migrationRegenerated: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export interface IntegrationBatchDto {
  id: string;
  workspaceId: string;
  projectId: string;
  repositoryId: string;
  boardId: string | null;
  integrationBranch: string;
  baseBranch: string;
  status:
    | "queued"
    | "running"
    | "awaiting_release"
    | "merging"
    | "completed"
    | "failed"
    | "aborted";
  triggeredByUserId: string | null;
  currentItemIndex: number;
  sandboxContainerId: string | null;
  finalPrUrl: string | null;
  finalPrNumber: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  items: IntegrationBatchItemDto[];
}

export interface UpdateIntegrationBatchPayload {
  status?: IntegrationBatchDto["status"];
  currentItemIndex?: number;
  sandboxContainerId?: string | null;
  finalPrUrl?: string | null;
  finalPrNumber?: number | null;
  errorMessage?: string | null;
  completedAt?: string;
}

export interface UpdateIntegrationBatchItemPayload {
  status?: IntegrationBatchItemDto["status"];
  failureCategory?: NonNullable<IntegrationBatchItemDto["failureCategory"]>;
  failureReason?: string;
  commitShaBefore?: string;
  commitShaAfter?: string;
  migrationRegenerated?: boolean;
  completedAt?: string;
}

export type AlmirantWorkerClient = {
  heartbeat: (payload: WorkerHeartbeatPayload) => Promise<unknown>;
  claimJobs: (payload: ClaimJobsPayload) => Promise<ClaimedJob[]>;
  createJob: (payload: CreateWorkerJobPayload) => Promise<ClaimedJob>;
  updateJobStatus: (jobId: string, payload: UpdateJobStatusPayload) => Promise<unknown>;
  getProviderKeys: (
    providers?: ProviderKeyProvider[],
    context?: {
      jobId?: string;
      createdByUserId?: string;
      workspaceId?: string;
      /**
       * Admin-pinned connection UUID. When provided, the backend skips the
       * org's default resolution order and uses this specific connection's
       * credentials (scoped to the job's org).
       */
      preferredConnectionId?: string;
    }
  ) => Promise<ProviderKeysResponse>;
  getGithubToken: (repositoryId: string) => Promise<InstallationTokenResponse>;
  getRepoConfig: (projectId: string) => Promise<RepoConfigResponse>;
  checkQuota: (provider: string, workspaceId?: string) => Promise<QuotaCheckResponse>;
  createInteraction: (jobId: string, payload: CreateInteractionPayload) => Promise<WorkerInteraction>;
  pollInteraction: (jobId: string, interactionId: string) => Promise<WorkerInteraction>;
  streamJobOutput: (
    jobId: string,
    payload: StreamJobOutputPayload
  ) => Promise<StreamJobOutputResponse>;
  sendJobLogs: (jobId: string, payload: SendJobLogsPayload) => Promise<SendJobLogsResponse>;
  getJobStatus: (jobId: string) => Promise<JobStatusResponse>;
  getJobConfig: (jobId: string) => Promise<{ jobType: string; config: Record<string, unknown> | null; status: string }>;
  getWorkspaceFile: (jobId: string, fileId: string) => Promise<WorkspaceFileDownloadResponse>;
  getWorkItem: (workItemId: string) => Promise<WorkItemDetails>;
  getValidationCandidates: (params?: {
    workspaceId?: string;
    projectId?: string;
    limit?: number;
    requireDodApproved?: boolean;
  }) => Promise<ValidationCandidate[]>;
  getDodReviewCandidates: (params?: {
    workspaceId?: string;
    projectId?: string;
    limit?: number;
    maxActiveJobs?: number;
    minAgeMinutes?: number;
  }) => Promise<DefinitionOfDoneReviewCandidate[]>;
  getFixCandidates: (params?: { workspaceId?: string; projectId?: string }) => Promise<FixCandidate[]>;
  getBacklogDrainCandidates: (params: { configId: string }) => Promise<BacklogDrainCandidatesResponse>;
  getDodRemediationCandidates: (params: { configId: string }) => Promise<BacklogDrainCandidatesResponse>;
  queueReleaseIntegration: (params?: {
    workspaceId?: string;
    projectId?: string;
    limit?: number;
    maxActiveItems?: number;
    minAgeMinutes?: number;
  }) => Promise<ReleaseIntegrationQueueResult>;
  getNightlyValidationConfig: () => Promise<NightlyValidationConfig>;
  getAllNightlyValidationConfigs: () => Promise<NightlyProjectValidationConfig[]>;
  resetStaleChildTasks: (parentWorkItemId: string) => Promise<{ resetIds: string[] }>;
  getJobTranscript: (jobId: string, params?: { limit?: number; tail?: boolean }) => Promise<{ transcript: string }>;
  getJobSessionEvents: (
    jobId: string,
    params?: { after?: number; kinds?: string[]; limit?: number }
  ) => Promise<SessionEventRecord[]>;
  /**
   * Returns the deterministic expected-vs-completed snapshot for a
   * runner-implement job. Used by the completion gate (INV-4) to verify
   * that every expected leaf task received a `complete_ai_task` call
   * (i.e. has a matching ai_sessions row with agent_job_id).
   */
  getJobCompletionSnapshot: (jobId: string) => Promise<{
    jobId: string;
    rootWorkItemId: string | null;
    expectedWorkItemIds: string[];
    completedWorkItemIds: string[];
  }>;
  getScheduledConfigs: () => Promise<ScheduledAgentConfig[]>;
  updateScheduledConfigLastRunAt: (configId: string) => Promise<unknown>;
  // Integration batches (runner-only internal API)
  getIntegrationBatch: (batchId: string) => Promise<IntegrationBatchDto>;
  updateIntegrationBatch: (
    batchId: string,
    payload: UpdateIntegrationBatchPayload,
  ) => Promise<unknown>;
  updateIntegrationBatchItem: (
    batchId: string,
    itemId: string,
    payload: UpdateIntegrationBatchItemPayload,
  ) => Promise<unknown>;
  ensureIntegrationReleasePr: (batchId: string) => Promise<{
    prUrl: string;
    prNumber: number;
    alreadyExists?: boolean;
  }>;
  refreshIntegrationReleasePrBody: (batchId: string) => Promise<{
    refreshed: boolean;
  }>;
  /**
   * Merge the release PR through the GitHub API.
   * Resolves to `{ merged, sha }` on success.
   */
  mergeIntegrationReleasePr: (
    batchId: string,
    options?: { mergeMethod?: "merge" | "squash" | "rebase" },
  ) => Promise<{ merged: boolean; sha: string | null }>;
};
