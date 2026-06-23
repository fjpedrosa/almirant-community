import type { Priority } from "@/domains/work-items/domain/types";
import type { CodingAgent, AgentSelection } from "./coding-agent-compatibility";

export type AgentProvider = "claude-code" | "codex" | "zipu" | "grok";

export type AgentWorkspace =
  | { kind: "git_repo"; repositoryId?: string; repoUrl?: string; ref?: string; branch?: string; depth?: number }
  | { kind: "empty_workspace"; templateId?: string; template?: string }
  | { kind: "uploaded_files"; fileIds: string[]; unpackMode?: "flat" | "preserve_paths" }
  | { kind: "mounted_volume"; volumeId?: string; path?: string; mountPath?: string; readOnly?: boolean }
  | { kind: "memory_only"; contextIds: string[] };

export type { AgentSelection } from "./coding-agent-compatibility";

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

/** @deprecated Use triggerType + promptTemplate instead */
export type AgentJobType =
  | "implementation"
  | "planning"
  | "review"
  | "validation"
  | "bug-fix"
  | "recording"
  | "scheduled"
  | "integration";

export type TriggerType = "event" | "scheduled" | "recovery";

export type RecurrenceType =
  | "exact_recurrence"
  | "cross_runtime_recurrence"
  | "variant"
  | "new";

export interface SuggestedOwnership {
  team: string;
  escalation: string;
}

/** @deprecated Use promptTemplate string instead */
export type RunnerSkillName =
  | "implement"
  | "validate"
  | "nightly-fix"
  | "document"
  | "review"
  | "record-video"
  | "runner-fix-dod";

export interface EnqueueAgentJobData {
  workItemId: string;
  provider: AgentProvider;
  codingAgent?: CodingAgent;
  model?: string;
  priority?: string;
  repositoryId?: string;
  jobType?: AgentJobType;
  skillName?: RunnerSkillName;
  promptTemplate?: string;
  triggerType?: TriggerType;
  interactive?: boolean;
}

export type AgentJobLogLevel = "debug" | "info" | "warn" | "error";

export interface AgentJobConfig {
  repoPath?: string;
  baseBranch?: string;
  executionName?: string;
  repositoryFullName?: string;
  model?: string;
  repositoryId?: string;
  workspace?: AgentWorkspace;
  scheduledConfigId?: string;
  scheduledConfigName?: string;
  skillName?: string;
  debugLogging?: boolean;
  resourceEstimate?: ResourceEstimate;
  [key: string]: unknown;
}


export type ResourceConfidence = "low" | "medium" | "high";
export type ResourceEstimateSource = "forecast" | "profile" | "skill-default";

export interface ResourceEstimate {
  estimatedMemoryMb: number;
  source: ResourceEstimateSource;
  confidence: ResourceConfidence;
  reason?: string;
}

export interface ResourceTimelineSample {
  timestamp: string;
  ramUsedMb: number;
  ramTotalMb: number | null;
  containerMemoryMb: number | null;
  estimatedMemoryMb: number | null;
  activeSubagents: number;
  activeSubagentTypes: string[];
  activeWave: number | null;
}

export interface ResourceTimelineAgent {
  subagentId: string;
  subagentType: string;
  description: string | null;
  startedAt: string;
  completedAt: string | null;
  success: boolean | null;
}

export interface ResourceTimelineSummary {
  jobId: string;
  workItemId: string | null;
  skillName: string | null;
  peakRamMb: number | null;
  averageRamMb: number | null;
  maxSubagents: number;
  forecastMemoryMb: number | null;
  forecastDeltaMb: number | null;
}

export interface ResourceTimeline {
  jobId: string;
  workerId: string | null;
  forecast: ResourceEstimate | null;
  samples: ResourceTimelineSample[];
  agents: ResourceTimelineAgent[];
  summary: ResourceTimelineSummary;
}

export interface SubagentMemoryProfile {
  subagentType: string;
  p50MemoryDeltaMb: number;
  p95MemoryDeltaMb: number;
  peakObservedMb: number;
  sampleCount: number;
  confidence: ResourceConfidence;
}

export interface AgentJobResult {
  summary?: string;
  model?: string;
  [key: string]: unknown;
}

export interface AgentJob {
  id: string;
  workItemId: string | null;
  projectId: string | null;
  boardId: string | null;
  planningSessionId?: string | null;
  jobType?: AgentJobType;

  status: AgentJobStatus;
  provider: AgentProvider;
  model?: string | null;
  priority: Priority;

  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;

  cost: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  cumulativeDurationMs?: number;
  errorMessage: string | null;
  errorType?: string | null;
  availableAt?: Date | string | null;
  sessionId?: string | null;
  prompt?: string | null;
  promptTemplate?: string | null;
  triggerType?: TriggerType | null;
  interactive?: boolean | null;
  createdByUserName?: string | null;
  createdByUserImage?: string | null;
  requestedByUserName?: string | null;
  requestedByUserImage?: string | null;

  config?: AgentJobConfig;
  result?: AgentJobResult | null;

  // Recurrence/fingerprint fields
  runtime?: string | null;
  boundary?: string | null;
  fingerprint?: string | null;
  recurrenceType?: RecurrenceType | null;
  recurrenceCount?: number | null;
  suggestedOwnership?: SuggestedOwnership | null;

  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt?: Date | null;
}

export interface AgentJobLog {
  id: string;
  jobId: string;
  orgId: string;
  workItemId: string | null;
  seq: number;
  level: AgentJobLogLevel;
  phase: string;
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
  timestamp: string;
  createdAt: string;
}

export interface AgentJobLogsMeta {
  nextCursor: number | null;
  hasMore: boolean;
  limit: number;
}

export interface AgentJobLogsResponse {
  logs: AgentJobLog[];
  meta: AgentJobLogsMeta;
}

export interface AgentJobLogsFilters {
  level?: AgentJobLogLevel;
  phase?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: number;
}

export interface BoardAgentSummary {
  running: number;
  queued: number;
  completed: number;
  incomplete: number;
  failed: number;
}

export interface AgentJobIndicatorProps {
  status: AgentJobStatus;
  provider: AgentProvider;
}

export interface RepoOption {
  id: string;
  name: string;
  fullName: string;
}

export interface RepoSelectorProps {
  repos: RepoOption[];
  selectedRepoId: string | null;
  onSelect: (repoId: string | null) => void;
}

export interface ProviderSelectorPopoverProps {
  onSelect: (selection: AgentSelection) => void;
  isPending?: boolean;
  disabled?: boolean;
  repos?: RepoOption[];
  selectedRepoId?: string | null;
  onRepoSelect?: (repoId: string | null) => void;
  actionLabel?: string;
  actionAriaLabel?: string;
  defaultProvider?: AgentProvider;
  /** When true, shows a 3rd step for model selection. Defaults to true. */
  showModelStep?: boolean;
  /** Custom trigger element. If provided, replaces the default icon button. */
  trigger?: React.ReactNode;
}

export interface AgentActivityWidgetProps {
  summary: BoardAgentSummary;
  pendingQuestions?: number;
  onClick?: () => void;
}

export interface ActiveAiJobItem {
  jobId: string;
  workItemTitle: string;
  provider: AgentProvider;
  status: AgentJobStatus;
  startedAt: Date | null;
}

export interface ActiveAiJobsPanelProps {
  jobs: ActiveAiJobItem[];
  onCancelJob: (jobId: string) => void;
  isCancelling: boolean;
  currentTime: number;
}

export interface BatchImplementBarProps {
  onBatchImplement: (provider: AgentProvider) => void;
  disabled?: boolean;
  isPending?: boolean;
}

export interface AgentDashboardStats {
  running: number;
  queued: number;
  completedLast24h: number;
  incompleteLast24h: number;
  failedLast24h: number;
}

export interface AgentDashboardProps {
  stats: AgentDashboardStats;
  activeJobs: AgentJob[];
  recentJobs: AgentJob[];
  isLoading: boolean;
  /** Current timestamp updated every second for live duration timers. */
  currentTime: number;
  /** Hide completed jobs when this dashboard is embedded in provider settings. */
  showRecentJobs?: boolean;
}

// ---------------------------------------------------------------------------
// Worker Interactions (agent <-> user Q&A thread)
// ---------------------------------------------------------------------------

export type WorkerInteractionQuestionType =
  | "clarification"
  | "approval"
  | "choice"
  | "free_text";

export type WorkerInteractionStatus =
  | "pending"
  | "answered"
  | "expired"
  | "cancelled";

export interface WorkerInteraction {
  id: string;
  agentJobId: string;
  workItemId?: string | null;
  questionType: WorkerInteractionQuestionType;
  questionText: string;
  options?: string[] | null;
  questionContext?: Record<string, unknown> | null;
  status: WorkerInteractionStatus;
  answerText?: string | null;
  answeredBy?: string | null;
  answeredAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface RespondInteractionInput {
  answerText: string;
  answerMetadata?: Record<string, unknown>;
}


// ---------------------------------------------------------------------------
// External agent connections
// ---------------------------------------------------------------------------

export interface AgentConnectionPrompt {
  token: string;
  claimUrl: string;
  prompt: string;
  expiresAt: string;
  scope:
    | { type: "all-projects" }
    | { type: "project"; projectId: string; projectName: string | null };
}

export interface AgentConnection {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  verificationStatus?: "pending" | "verified";
  lastUsedAt: string | null;
  createdAt: string | null;
}

export interface AgentConnectionPanelProps {
  projectOptions: Array<{ id: string; name: string }>;
  selectedProjectId: string;
  agentName: string;
  generatedPrompt: AgentConnectionPrompt | null;
  connections: AgentConnection[];
  isLoading: boolean;
  isGenerating: boolean;
  isRevoking: boolean;
  canGenerate: boolean;
  onProjectChange: (projectId: string) => void;
  onAgentNameChange: (name: string) => void;
  onGeneratePrompt: () => void;
  onCopyPrompt: () => void;
  onRevokeConnection: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Agent thread component props
// ---------------------------------------------------------------------------

export interface AgentThreadProps {
  interactions: WorkerInteraction[];
  onRespond: (interactionId: string, answer: string) => void;
  isResponding?: boolean;
}

export interface AgentQuestionMessageProps {
  interaction: WorkerInteraction;
  onRespond: (interactionId: string, answer: string) => void;
  isResponding?: boolean;
}

export interface AgentStatusMessageProps {
  interaction: WorkerInteraction;
}

export interface AgentAnswerMessageProps {
  interaction: WorkerInteraction;
}

export type { CodingAgent } from "./coding-agent-compatibility";
