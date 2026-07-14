import { getModelsForProvider } from "@/lib/ai-models-catalog";
import { getReasoningEffortOptions } from "@/lib/ai-model-reasoning";

// Enums / literals
export type ScheduleType = "manual" | "time_window" | "cron";
export type AgentTrigger = "scheduled" | "webhook";

export type AgentJobType =
  | "implementation"
  | "planning"
  | "review"
  | "validation"
  | "bug-fix"
  | "recording"
  | "prewarm"
  | "scheduled"
  | "integration";

export type AgentProvider = "claude-code" | "codex" | "zipu" | "grok";

// Multi-provider types
export type CodingAgent = "claude-code" | "codex" | "opencode";
export type AIProvider = "anthropic" | "openai" | "zai" | "xai";
export type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "enabled" | "disabled";

export const normalizeScheduledCodingAgent = (
  codingAgent: string | null | undefined,
): CodingAgent | null | undefined => {
  if (codingAgent == null) {
    return codingAgent;
  }

  if (codingAgent === "codex-cli") {
    return "codex";
  }

  if (codingAgent === "claude-code" || codingAgent === "codex" || codingAgent === "opencode") {
    return codingAgent;
  }

  return undefined;
};

// Agent classification (frontend-only — derived from persisted config)
export type AgentKind = "repository" | "automation";

export type AutomationTargetKind = "builtin" | "user-skill";

export type BuiltinAutomationId = "backlog-drain" | "dod-remediation" | "dod-review" | "release-integration";

export type AutomationTarget =
  | { kind: "builtin"; id: BuiltinAutomationId }
  | { kind: "user-skill"; slug: string };

export interface BuiltinAutomationOption {
  id: BuiltinAutomationId;
  name: string;
  description: string;
}

export const BACKLOG_DRAIN_AUTOMATION: BuiltinAutomationOption = {
  id: "backlog-drain",
  name: "Backlog drain",
  description: "Picks ready Backlog work items on each tick and enqueues implementation jobs.",
};

export const DOD_REMEDIATION_AUTOMATION: BuiltinAutomationOption = {
  id: "dod-remediation",
  name: "DoD remediation",
  description: "Repairs Backlog work items that failed Definition of Done review, using the saved DoD report.",
};

export const DOD_REVIEW_AUTOMATION: BuiltinAutomationOption = {
  id: "dod-review",
  name: "Definition of Done review",
  description: "Reviews To Review tasks against their Definition of Done after a quiet period.",
};

export const RELEASE_INTEGRATION_AUTOMATION: BuiltinAutomationOption = {
  id: "release-integration",
  name: "Release integration",
  description: "Batches Validating tasks into the shared release integration PR.",
};

export const BUILTIN_AUTOMATIONS: BuiltinAutomationOption[] = [
  BACKLOG_DRAIN_AUTOMATION,
  DOD_REMEDIATION_AUTOMATION,
  DOD_REVIEW_AUTOMATION,
  RELEASE_INTEGRATION_AUTOMATION,
];

// Schedule config types
export interface TimeWindowConfig {
  startHour: number;
  endHour: number;
  daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, etc.
}

export interface CronConfig {
  expression: string;
}

export type ScheduleConfig = TimeWindowConfig | CronConfig;

// Target config type
export interface BacklogDrainProjectRule {
  projectId: string;
  enabled?: boolean;
  maxConcurrentJobs?: number | null;
  excludedWorkItemIds?: string[];
  excludeDescendants?: boolean;
  codingAgent?: CodingAgent | null;
  aiProvider?: AIProvider | null;
  model?: string | null;
  reasoningLevel?: string | null;
}

export interface BacklogDrainConfig {
  enabled?: boolean;
  minAgeMinutes?: number | null;
  defaultMaxConcurrentJobs?: number | null;
  projects?: BacklogDrainProjectRule[];
}

export interface DodReviewConfig {
  enabled?: boolean;
  minAgeMinutes?: number;
  defaultMaxConcurrentJobs?: number | null;
  projects?: BacklogDrainProjectRule[];
}

export interface ReleaseIntegrationConfig {
  enabled?: boolean;
  minAgeMinutes?: number;
  defaultMaxConcurrentJobs?: number | null;
  projects?: BacklogDrainProjectRule[];
}

export interface TargetConfig {
  /** Optional project scope for built-in automations. Empty/undefined means workspace-wide. */
  projectIds?: string[];
  columnIds?: string[];
  statuses?: string[];
  priorities?: string[];
  maxAgeHours?: number;
  customFilters?: Record<string, unknown>;
  requireDodApproved?: boolean;
  backlogDrain?: BacklogDrainConfig;
  dodRemediation?: BacklogDrainConfig;
  dodReview?: DodReviewConfig;
  releaseIntegration?: ReleaseIntegrationConfig;
}

export type ScheduledAgentMcpServers = Record<string, {
  type?: "remote";
  url: string;
  enabled?: boolean;
  oauth?: false;
}>;

export interface BacklogDrainWorkItemTreeItem {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  parentId: string | null;
  projectId: string;
  boardId: string;
  columnRole: string | null;
  columnIsDone: boolean;
}

export interface BacklogDrainCandidate {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  parentId: string | null;
  projectId: string;
  boardId: string;
  codingAgent: CodingAgent;
  aiProvider: AIProvider;
  provider: AgentProvider;
  model: string;
  reasoningLevel?: string | null;
  skillName?: "runner-implement" | "runner-fix-dod";
  dodReport?: string | null;
  dodReviewedAt?: string | null;
}

export interface BacklogDrainPreviewResult {
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

// Entity type
export interface ScheduledAgentConfig {
  id: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string | null;
  skillId: string | null;
  skillName: string | null;
  name: string;
  description: string | null;
  prompt: string | null;
  jobType: AgentJobType;
  provider: AgentProvider;
  codingAgent: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  reasoningLevel: string | null;
  trigger: AgentTrigger;
  webhookToken: string | null;
  scheduleType: ScheduleType;
  scheduleConfig: ScheduleConfig | null;
  timezone: string;
  enabled: boolean;
  targetConfig: TargetConfig;
  mcpServers: ScheduledAgentMcpServers | null;
  maxJobsPerRun: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Project option for the form selector
export interface ProjectOption {
  id: string;
  name: string;
  hasRepository: boolean;
}

// Request types
export interface CreateScheduledAgentData {
  id?: string;
  name: string;
  description?: string;
  prompt?: string;
  jobType: AgentJobType;
  provider: AgentProvider;
  codingAgent?: CodingAgent;
  aiProvider?: string;
  aiModel?: string;
  reasoningLevel?: string;
  trigger?: AgentTrigger;
  webhookToken?: string | null;
  skillId?: string | null;
  scheduleType?: ScheduleType;
  scheduleConfig?: ScheduleConfig | null;
  timezone?: string;
  enabled?: boolean;
  targetConfig?: TargetConfig;
  mcpServers?: ScheduledAgentMcpServers | null;
  maxJobsPerRun?: number;
  projectId?: string | null;
}

export interface UpdateScheduledAgentData {
  name?: string;
  description?: string;
  prompt?: string | null;
  jobType?: AgentJobType;
  provider?: AgentProvider;
  codingAgent?: CodingAgent;
  aiProvider?: string;
  aiModel?: string;
  reasoningLevel?: string;
  trigger?: AgentTrigger;
  webhookToken?: string | null;
  skillId?: string | null;
  scheduleType?: ScheduleType;
  scheduleConfig?: ScheduleConfig | null;
  timezone?: string;
  enabled?: boolean;
  targetConfig?: TargetConfig;
  mcpServers?: ScheduledAgentMcpServers | null;
  maxJobsPerRun?: number;
  projectId?: string | null;
}

// Component props
export interface ScheduledAgentsListProps {
  items: ScheduledAgentConfig[];
  isLoading: boolean;
  triggeringId: string | null;
  /** Map of projectId → display color (optional). */
  projectColors?: Record<string, string>;
  onToggle: (item: ScheduledAgentConfig) => void;
  onEdit: (item: ScheduledAgentConfig) => void;
  onDelete: (item: ScheduledAgentConfig) => void;
  onTrigger: (item: ScheduledAgentConfig) => void;
}

export interface ScheduledAgentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ScheduledAgentConfig | null;
  isPending: boolean;
  onSubmit: (data: CreateScheduledAgentData | UpdateScheduledAgentData) => void;
}

// User skill option surfaced in the Automation type selector
export interface UserSkillOption {
  slug: string;
  name: string;
  description: string | null;
  source: "official" | "custom" | "repo";
}

// Props for the AgentFormDrawer presentational component
// Uses pre-processed data from useAgentFormDrawer hook
export interface AgentFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isEditing: boolean;
  isPending: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  onSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  skills: { slug: string; name: string; description: string | null }[];
  userSkills: UserSkillOption[];
  projects: ProjectOption[];
  scheduleType: string;
  trigger: AgentTrigger;
  availableProviders: AIProvider[];
  availableModels: { value: string; label: string }[];
  availableReasoningLevels: readonly { value: string; label: string }[];
  agentKind: AgentKind;
  automationTargetKind: AutomationTargetKind;
  automationSkillSlug: string | null;
  builtinAutomationId: BuiltinAutomationId;
  automationProjectIds: string[];
  backlogDrainEnabled: boolean;
  backlogDrainProjectIds: string[];
  backlogDrainWorkItems: BacklogDrainWorkItemTreeItem[];
  isLoadingBacklogDrainWorkItems: boolean;
  backlogDrainPreview: BacklogDrainPreviewResult | null;
  isLoadingBacklogDrainPreview: boolean;
  webhookProposal: ScheduledAgentWebhookProposal | null;
  isLoadingWebhookProposal: boolean;
}

export interface ScheduledAgentWebhookProposal {
  id: string;
  webhookToken: string;
  webhookUrl: string;
  testWebhookUrl: string;
}

// Utility constants
export const JOB_TYPE_OPTIONS: { value: AgentJobType; label: string }[] = [
  { value: "implementation", label: "Implementation" },
  { value: "planning", label: "Planning" },
  { value: "review", label: "Review" },
  { value: "validation", label: "Validation" },
  { value: "bug-fix", label: "Bug Fix" },
  { value: "recording", label: "Recording" },
  { value: "prewarm", label: "Prewarm" },
  { value: "scheduled", label: "Scheduled" },
  { value: "integration", label: "Integration" },
];

export const PROVIDER_OPTIONS: { value: AgentProvider; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "zipu", label: "z.ai" },
  { value: "grok", label: "xAI" },
];

export const DAY_OF_WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

// Cascading AI options
export const CODING_AGENT_OPTIONS: { value: CodingAgent; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
  { value: "opencode", label: "OpenCode" },
];

export const AI_PROVIDER_OPTIONS: { value: AIProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "zai", label: "z.ai" },
  { value: "xai", label: "xAI" },
];

export const getScheduledReasoningLevelOptions = (input: {
  codingAgent?: CodingAgent;
  aiProvider?: AIProvider;
  model?: string;
}) => getReasoningEffortOptions(input);

// Maps coding agent → available AI providers
export const PROVIDERS_BY_CODING_AGENT: Record<CodingAgent, AIProvider[]> = {
  "claude-code": ["anthropic", "zai"],
  "codex": ["openai"],
  "opencode": ["openai", "zai", "xai"],
};

export const getAiProvidersForScheduledRuntime = (
  _agentProvider: AgentProvider | undefined,
  codingAgent: CodingAgent | undefined,
): AIProvider[] => {
  if (!codingAgent) return [];
  return PROVIDERS_BY_CODING_AGENT[codingAgent] ?? [];
};

// Maps AI provider → available models from the central catalog.
export const MODELS_BY_PROVIDER: Record<AIProvider, { value: string; label: string }[]> = {
  anthropic: getModelsForProvider("anthropic", "agent-runtime").map((m) => ({ value: m.id, label: m.displayName })),
  openai: getModelsForProvider("openai", "agent-runtime").map((m) => ({ value: m.id, label: m.displayName })),
  zai: getModelsForProvider("zai", "agent-runtime").map((m) => ({ value: m.id, label: m.displayName })),
  xai: getModelsForProvider("xai", "agent-runtime").map((m) => ({ value: m.id, label: m.displayName })),
};

// Timezone options with UTC offset labels
export const TIMEZONE_OPTIONS: { value: string; label: string; offset: string }[] = [
  { value: "Europe/Madrid", label: "Europe/Madrid", offset: "UTC+1/+2" },
  { value: "Europe/London", label: "Europe/London", offset: "UTC+0/+1" },
  { value: "America/New_York", label: "America/New York", offset: "UTC-5/-4" },
  { value: "America/Los_Angeles", label: "America/Los Angeles", offset: "UTC-8/-7" },
  { value: "America/Chicago", label: "America/Chicago", offset: "UTC-6/-5" },
  { value: "America/Mexico_City", label: "America/Mexico City", offset: "UTC-6/-5" },
  { value: "America/Sao_Paulo", label: "America/Sao Paulo", offset: "UTC-3" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo", offset: "UTC+9" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai", offset: "UTC+8" },
  { value: "Australia/Sydney", label: "Australia/Sydney", offset: "UTC+10/+11" },
  { value: "UTC", label: "UTC", offset: "UTC+0" },
];

// Hour options for time select (0-23)
export const HOUR_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 24 },
  (_, i) => ({
    value: i,
    label: `${i.toString().padStart(2, "0")}:00`,
  })
);

// Day presets for quick selection
export const DAY_PRESETS = {
  weekdays: [1, 2, 3, 4, 5],
  weekend: [0, 6],
  everyday: [0, 1, 2, 3, 4, 5, 6],
} as const;

// Type guards
export const isTimeWindowConfig = (
  config: ScheduleConfig | null | undefined
): config is TimeWindowConfig => {
  return !!config && "startHour" in config && "endHour" in config && "daysOfWeek" in config;
};

export const isCronConfig = (config: ScheduleConfig | null | undefined): config is CronConfig => {
  return !!config && "expression" in config;
};
