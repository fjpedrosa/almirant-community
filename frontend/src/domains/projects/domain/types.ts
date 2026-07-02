import type { PaginationMeta } from "@/domains/shared/domain/types";
import type { SprintStatus } from "@/domains/sprints/domain/types";
import type { GithubAvailableRepo, GithubInstallation } from "@/domains/github/domain/types";
import type { ITask, ILink, IScaleConfig, TID } from "@svar-ui/react-gantt";

// Re-export library types for convenience
export type { ITask as GanttLibTask, ILink as GanttLibLink, IScaleConfig as GanttLibScale, TID as GanttTaskId };

// ---------------------------------------------------------------------------
// Discord Notification Preferences types (project-level)
// ---------------------------------------------------------------------------

/** Keys that represent toggleable notification preferences (duplicated from integrations domain to keep domains independent) */
export type NotificationPrefKey =
  | "notifyWorkItemCreated"
  | "notifyWorkItemMoved"
  | "notifyWorkItemAssigned"
  | "notifyWorkItemDone"
  | "notifyWorkItemComment"
  | "notifyWorkItemUpdated"
  | "notifyWorkItemDeleted"
  | "notifyCommentAdded"
  | "notifyAttachmentAdded"
  | "notifySprintStarted"
  | "notifySprintClosed"
  | "notifyMilestoneCompleted"
  | "notifyPrOpened"
  | "notifyPrMerged"
  | "notifyCiFailed"
  | "notifyAgentJobCompleted"
  | "notifyAgentJobFailed"
  | "notifySeedPromoted";

export interface NotificationToggleItem {
  key: NotificationPrefKey;
  label: string;
}

export interface NotificationCategory {
  name: string;
  toggles: NotificationToggleItem[];
}

/** Local state for the notification prefs form (only toggleable booleans + enabled) */
export type NotificationPrefsFormState = Record<NotificationPrefKey, boolean> & {
  enabled: boolean;
};

/** Props for the project-level Discord notification preferences card (presentational) */
export interface ProjectDiscordNotificationPrefsCardProps {
  isConnected: boolean;
  isInheriting: boolean;
  categories: NotificationCategory[];
  formState: NotificationPrefsFormState;
  orgFormState: NotificationPrefsFormState;
  isLoading: boolean;
  isSaving: boolean;
  hasChanges: boolean;
  onToggle: (key: NotificationPrefKey | "enabled", value: boolean) => void;
  onMasterToggle: (value: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onToggleInherit: () => void;
}

// Project status
export type ProjectStatus = "active" | "archived" | "on_hold";

// Doc link type
export type DocLinkType = "notion" | "github" | "gdocs" | "confluence" | "figma" | "other";

// Repository provider
export type RepositoryProvider = "github" | "gitlab" | "bitbucket" | "other";

export type NightlyValidationProvider = "claude-code" | "codex" | "zipu" | "grok";

export interface ProjectNightlyValidationSettings {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  provider: NightlyValidationProvider;
}

export type AiConfigProvider = "claude-code" | "codex" | "zipu" | "grok";

export type ProjectImplementationCodingAgent = "claude-code" | "codex" | "opencode";
export type ProjectImplementationAiProvider = "anthropic" | "openai" | "zai" | "xai";

export interface ProjectAgentDefaults {
  implementation?: {
    codingAgent?: ProjectImplementationCodingAgent | null;
    aiProvider?: ProjectImplementationAiProvider | null;
    model?: string | null;
    reasoningLevel?: string | null;
  } | null;
}

export interface ProjectAiConfig {
  defaultProvider: AiConfigProvider | null;
  agentDefaults: ProjectAgentDefaults;
}

export interface ProjectDiscordChannelData {
  projectChannel: { channelId: string; channelName: string } | null;
  connection: {
    defaultChannelId: string | null;
    defaultChannelName: string | null;
    guildName: string | null;
  } | null;
}

export interface DiscordChannelOption {
  id: string;
  name: string;
  type: string;
  position: number;
  parentId: string | null;
}

// Project entity
export interface Project {
  id: string;
  name: string;
  description: string | null;
  folderPath: string | null;
  color: string;
  icon: string | null;
  status: ProjectStatus;
  clientName: string | null;
  productionUrl: string | null;
  stagingUrl: string | null;
  screenshotUrl: string | null;
  techStack: string[] | null;
  workspaceId: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Project repository
export interface ProjectRepository {
  id: string;
  projectId: string;
  name: string;
  url: string;
  provider: RepositoryProvider;
  isMonorepo: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

// Project with relations
export interface ProjectWithRelations extends Project {
  docLinks: ProjectDocLink[];
  repositories: ProjectRepository[];
  notes: ProjectNote[];
  workItemsCount: number;
  completedItemsCount: number;
  workspaceName: string | null;
  epicCount?: number;
  featureCount?: number;
  storyCount?: number;
  taskCount?: number;
  completedEpicCount?: number;
  completedFeatureCount?: number;
  completedStoryCount?: number;
  completedTaskCount?: number;
}

// Project doc link
export interface ProjectDocLink {
  id: string;
  projectId: string;
  title: string;
  url: string;
  type: DocLinkType;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

// Project note
export interface ProjectNote {
  id: string;
  projectId: string;
  title: string;
  content: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

// Batch response for project detail endpoint
export interface ProjectDetailResponse {
  project: ProjectWithRelations;
  boards: ProjectBoardItem[];
  docLinks: ProjectDocLink[];
  repositories: ProjectRepository[];
  notes: ProjectNote[];
}

// Create project request
export interface CreateProjectRequest {
  name: string;
  description?: string;
  folderPath?: string;
  color?: string;
  icon?: string;
  status?: ProjectStatus;
  clientName?: string;
  productionUrl?: string;
  stagingUrl?: string;
  techStack?: string[];
  workspaceId?: string | null;
  startDate?: string;
  targetDate?: string;
}

// Update project request
export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
  folderPath?: string | null;
  color?: string;
  icon?: string | null;
  status?: ProjectStatus;
  clientName?: string | null;
  productionUrl?: string | null;
  stagingUrl?: string | null;
  techStack?: string[] | null;
  workspaceId?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
}

// Project filters
export interface ProjectFilters {
  search?: string;
  status?: ProjectStatus;
  workspaceId?: string;
  /** When true, return only projects with no workspace (personal projects). */
  personal?: boolean;
}

// Paginated response
export interface PaginatedProjectsResponse {
  projects: ProjectWithRelations[];
  meta: PaginationMeta;
}

// Create doc link request
export interface CreateDocLinkRequest {
  title: string;
  url: string;
  type?: DocLinkType;
  order?: number;
}

// Update doc link request
export interface UpdateDocLinkRequest {
  title?: string;
  url?: string;
  type?: DocLinkType;
  order?: number;
}

// Create note request
export interface CreateNoteRequest {
  title: string;
  content?: string;
  order?: number;
}

// Update note request
export interface UpdateNoteRequest {
  title?: string;
  content?: string | null;
  order?: number;
}

// Create repository request
export interface CreateRepositoryRequest {
  name: string;
  url: string;
  provider?: RepositoryProvider;
  isMonorepo?: boolean;
  order?: number;
}

// Update repository request
export interface UpdateRepositoryRequest {
  name?: string;
  url?: string;
  provider?: RepositoryProvider;
  isMonorepo?: boolean;
  order?: number;
}

// GitHub repo option for combobox selection
export interface GithubRepoOption {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  isPrivate: boolean;
  language: string | null;
  defaultBranch: string;
}

// GitHub summary for project card/header
export interface ProjectGithubInfo {
  githubRepoUrl: string | null;
  openPrCount: number;
  lastCommitAt: string | null;
  lastDeployStatus: "pending" | "queued" | "in_progress" | "success" | "failure" | "cancelled" | "skipped" | "neutral" | null;
}

// Component props
export interface ProjectCardProps {
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  color: string;
  status: ProjectStatus;
  workItemsCount: number;
  completedItemsCount: number;
  clientName: string | null;
  techStack: string[] | null;
  github?: ProjectGithubInfo | null;
  workspaceName?: string | null;
  epicCount?: number;
  featureCount?: number;
  storyCount?: number;
  taskCount?: number;
  completedTaskCount?: number;
}

export interface ProjectFormProps {
  defaultValues?: Partial<CreateProjectRequest>;
  onSubmit: (data: CreateProjectRequest) => void;
  isSubmitting?: boolean;
}

export interface DocLinkListProps {
  links: ProjectDocLink[];
  onAdd?: () => void;
  onEdit?: (link: ProjectDocLink) => void;
  onDelete?: (linkId: string) => void;
  onReorder?: (linkIds: string[]) => void;
}

export interface NoteEditorProps {
  title: string;
  content: string | null;
  onChange: (content: string) => void;
  onTitleChange: (title: string) => void;
  onSave: () => void;
  isSaving?: boolean;
}

// Projects grid props
export interface ProjectsGridProps {
  projects: ProjectWithRelations[];
  isLoading: boolean;
  onCreateClick: () => void;
  onProjectHover?: (projectId: string) => void;
  onProjectHoverEnd?: () => void;
}

// Projects filter bar props
export interface ProjectsFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
}

// Project detail header props
export interface ProjectDetailHeaderProps {
  name: string;
  color: string;
  description: string | null;
  status: ProjectStatus;
  githubRepoUrl?: string | null;
  onBack: () => void;
  onEdit: () => void;
}

// Project screenshot card props
export interface ProjectScreenshotCardProps {
  name: string;
  color: string;
  productionUrl: string | null;
  status: ProjectStatus;
  screenshotUrl: string | null;
  hostname: string | null;
  imageError: boolean;
  hasUrl: boolean;
  githubRepoUrl: string | null;
  githubRepoName: string | null;
  onImageError: () => void;
  onVisitSite: () => void;
  onRefreshScreenshot?: () => void;
  isRefreshing?: boolean;
}

// Project stats grid props
export interface ProjectStatsGridProps {
  workItemsCount: number;
  completedItemsCount: number;
  epicCount?: number;
  featureCount?: number;
  storyCount?: number;
  taskCount?: number;
  completedEpicCount?: number;
  completedFeatureCount?: number;
  completedStoryCount?: number;
  completedTaskCount?: number;
}

// Stats by work item type
export interface WorkItemTypeStat {
  type: string;
  totalCount: number;
  completedCount: number;
}

export interface WorkItemStatsByType {
  byType: WorkItemTypeStat[];
  total: { totalCount: number; completedCount: number };
}

// Project stats by type component props (presentational)
export interface ProjectStatsByTypeProps {
  stats: WorkItemTypeStat[];
  isLoading: boolean;
}

// Board item for project boards tab
export interface ProjectBoardItem {
  id: string;
  name: string;
  area: string;
  totalItems: number;
  columns: Array<{ id: string; name: string; color: string }>;
}

// Project boards tab props
export interface ProjectBoardsTabProps {
  boards: ProjectBoardItem[];
}

// Project docs tab props
export interface ProjectDocsTabProps {
  docLinks: ProjectDocLink[];
  newLinkTitle: string;
  newLinkUrl: string;
  newLinkType: DocLinkType;
  onTitleChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onTypeChange: (value: DocLinkType) => void;
  onAddLink: () => void;
  onDeleteLink: (linkId: string) => void;
  isAdding: boolean;
  docLinkIcons: Record<DocLinkType, string>;
}

// Project overview tab props
export interface ProjectOverviewTabProps {
  description: string | null;
  clientName: string | null;
  productionUrl: string | null;
  stagingUrl: string | null;
  techStack: string[] | null;
  folderPath: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  status: ProjectStatus;
}

// Project repos tab props
export interface ProjectReposTabProps {
  repositories: ProjectRepository[];
  newRepoName: string;
  newRepoUrl: string;
  newRepoProvider: RepositoryProvider;
  newRepoIsMonorepo: boolean;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onProviderChange: (value: RepositoryProvider) => void;
  onMonorepoChange: (value: boolean) => void;
  onAddRepo: () => void;
  onDeleteRepo: (repoId: string) => void;
  isAdding: boolean;
  // GitHub repo selector
  githubRepos?: GithubRepoOption[];
  isLoadingGithubRepos?: boolean;
  githubRepoSearchQuery?: string;
  onGithubRepoSearchChange?: (value: string) => void;
  onGithubRepoSelect?: (repo: GithubRepoOption) => void;
  isGithubConnected?: boolean;
}

// Project notes tab props
export interface ProjectNotesTabProps {
  notes: ProjectNote[];
  selectedNoteId: string | null;
  noteContent: string;
  newNoteTitle: string;
  selectedNote: ProjectNote | undefined;
  onSelectNote: (noteId: string, content: string) => void;
  onNoteContentChange: (value: string) => void;
  onNewNoteTitleChange: (value: string) => void;
  onAddNote: () => void;
  onSaveNote: () => void;
  onDeleteNote: (noteId: string) => void;
  isCreating: boolean;
  isSaving: boolean;
}

// Sprint item with board context (for project sprints tab)
export interface ProjectSprintItem {
  id: string;
  boardId: string;
  boardName: string;
  name: string;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workItemCount: number;
}

// Project sprints container props
export interface ProjectSprintsContainerProps {
  projectId: string;
}

// Project sprints tab props (presentational)
export interface ProjectSprintsTabProps {
  sprints: ProjectSprintItem[];
  isLoading: boolean;
  onSprintClick?: (sprintId: string) => void;
}

// ──────────────────────────────────────────────
// Gantt Chart types
// ──────────────────────────────────────────────

// Zoom levels for the timeline axis
export type GanttZoomLevel = "week" | "month" | "quarter";

export type GanttColorMode = "status" | "type";

// Scale presets per zoom level (maps to @svar-ui/react-gantt IScaleConfig[])
export type GanttScalePresets = Record<GanttZoomLevel, IScaleConfig[]>;

// Gantt chart task - extends the library's ITask with our domain semantics
export interface GanttTask extends ITask {
  id: number;
  text: string;
  start: Date;
  end?: Date;
  duration?: number;
  progress?: number;
  type?: "task" | "summary" | "milestone";
  parent?: number;
  open?: boolean;
  // Custom fields for our domain
  workItemId?: string;
  workItemType?: "epic" | "feature" | "story";
  color?: string;
}

// Gantt chart link for dependencies between tasks
export interface GanttLink extends ILink {
  id: number;
  source: number;
  target: number;
  type: "e2s" | "s2s" | "e2e" | "s2e";
}

// Gantt chart column configuration
export interface GanttColumnConfig {
  id: string;
  header: string;
  width?: number;
  align?: "left" | "right" | "center";
  flexgrow?: number;
}

// Gantt chart presentational component props
export interface GanttChartProps {
  tasks: GanttTask[];
  links: GanttLink[];
  scales: IScaleConfig[];
  columns?: GanttColumnConfig[];
  zoomLevel: GanttZoomLevel;
  onZoomChange: (level: GanttZoomLevel) => void;
  colorMode: GanttColorMode;
  onColorModeChange: (mode: GanttColorMode) => void;
  onTaskClick?: (taskId: number) => void;
  onTaskDateChange?: (data: { taskId: number; start: Date; end: Date }) => void;
  isLoading?: boolean;
  readonly?: boolean;
  allExpanded?: boolean;
  onToggleExpand?: () => void;
}

// ──────────────────────────────────────────────
// Roadmap types
// ──────────────────────────────────────────────

// Status filter values for roadmap items
export type RoadmapStatusFilter = "all" | "in-progress" | "completed" | "planned";

// Date range for roadmap filtering
export interface RoadmapDateRange {
  from: Date | null;
  to: Date | null;
}

// Roadmap filter state
export interface RoadmapFilters {
  projectId?: string;
  epicId?: string;
  dateRange: RoadmapDateRange;
  status: RoadmapStatusFilter;
}

// Roadmap item from the API (story/task level)
export interface RoadmapItem {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  priority: string;
  assignee: string | null;
  boardColumnId: string;
  columnName: string;
  startDate: string | null;
  endDate: string | null;
}

// Roadmap feature (has children stories/tasks)
export interface RoadmapFeature extends RoadmapItem {
  children: RoadmapItem[];
}

// Roadmap epic (has children features)
export interface RoadmapEpic extends RoadmapItem {
  children: RoadmapFeature[];
}

// Full roadmap API response
export interface ProjectRoadmapData {
  projectId: string;
  epics: RoadmapEpic[];
}

// Option for select dropdowns
export interface SelectOption {
  value: string;
  label: string;
}

// Roadmap filters component props (presentational)
export interface RoadmapFiltersProps {
  // Filter values
  projectId: string | undefined;
  epicId: string | undefined;
  dateFrom: Date | null;
  dateTo: Date | null;
  status: RoadmapStatusFilter;
  // Options
  projectOptions: SelectOption[];
  epicOptions: SelectOption[];
  // Handlers
  onProjectChange: (value: string | undefined) => void;
  onEpicChange: (value: string | undefined) => void;
  onDateFromChange: (date: Date | null) => void;
  onDateToChange: (date: Date | null) => void;
  onStatusChange: (value: RoadmapStatusFilter) => void;
  onClearFilters: () => void;
  // State
  hasActiveFilters: boolean;
}

// ──────────────────────────────────────────────
// Project wizard types
// ──────────────────────────────────────────────

export type ProjectWizardStep =
  | "project-name"
  | "github-repo"
  | "collaborators"
  | "api-key"
  | "vercel-deploy"
  | "summary";

export interface ProjectWizardApiKey {
  id: string;
  name: string;
  key: string;
}

export interface WizardGithubRepoSelection {
  installationId: number;
  fullName: string;
  url: string;
  isNew: boolean;
}

export interface ProjectWizardState {
  projectName: string;
  collaboratorEmails: string[];
  apiKey: ProjectWizardApiKey | null;
  githubRepo: WizardGithubRepoSelection | null;
  createNewRepo: boolean;
  newRepoName: string;
  newRepoIsPrivate: boolean;
  deployToVercel: boolean;
  vercelProjectName: string;
}

export interface ProjectWizardProps {
  step: ProjectWizardStep;
  stepIndex: number;
  totalSteps: number;
  state: ProjectWizardState;
  isGeneratingApiKey: boolean;
  isFinishing: boolean;
  canProceed: boolean;
  onProjectNameChange: (name: string) => void;
  collaboratorInput: string;
  onCollaboratorInputChange: (value: string) => void;
  onAddCollaborator: (email: string) => void;
  onRemoveCollaborator: (email: string) => void;
  onGenerateApiKey: () => void;
  onCopyApiKey: () => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
  // GitHub repo step
  githubInstallations: GithubInstallation[];
  selectedInstallationId: number | null;
  onSelectInstallation: (id: number) => void;
  githubRepos: GithubAvailableRepo[];
  isLoadingGithubRepos: boolean;
  selectedRepoFullName: string | null;
  onSelectRepo: (repo: GithubAvailableRepo) => void;
  createNewRepo: boolean;
  onToggleCreateNew: () => void;
  newRepoName: string;
  onNewRepoNameChange: (name: string) => void;
  newRepoIsPrivate: boolean;
  onTogglePrivate: () => void;
  isCreatingRepo: boolean;
  githubMode: GithubMode;
  needsOAuthForRepoCreation: boolean;
  onConnectGitHub: () => void;
  needsGithubReconnect: boolean;
  onReconnectGitHub: () => void;
  // Vercel deploy step
  deployToVercel: boolean;
  onToggleDeployToVercel: () => void;
  vercelProjectName: string;
  onVercelProjectNameChange: (name: string) => void;
}

export interface WizardStepProjectNameProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
}

export interface WizardStepCollaboratorsProps {
  collaboratorEmails: string[];
  collaboratorInput: string;
  onCollaboratorInputChange: (value: string) => void;
  onAddCollaborator: (email: string) => void;
  onRemoveCollaborator: (email: string) => void;
}

export interface WizardStepApiKeyProps {
  apiKey: ProjectWizardApiKey | null;
  isGeneratingApiKey: boolean;
  onGenerateApiKey: () => void;
  onCopyApiKey: () => void;
}

export type GithubMode = "app" | "oauth" | "none";

export interface WizardStepGithubRepoProps {
  installations: GithubInstallation[];
  selectedInstallationId: number | null;
  onSelectInstallation: (id: number) => void;
  repos: GithubAvailableRepo[];
  isLoadingRepos: boolean;
  selectedRepoFullName: string | null;
  onSelectRepo: (repo: GithubAvailableRepo) => void;
  createNewRepo: boolean;
  onToggleCreateNew: () => void;
  newRepoName: string;
  onNewRepoNameChange: (name: string) => void;
  newRepoIsPrivate: boolean;
  onTogglePrivate: () => void;
  isCreatingRepo: boolean;
  githubMode: GithubMode;
  needsOAuthForRepoCreation: boolean;
  onConnectGitHub: () => void;
  needsReconnect: boolean;
  onReconnectGitHub: () => void;
}

export interface WizardStepVercelDeployProps {
  deployToVercel: boolean;
  onToggleDeployToVercel: () => void;
  vercelProjectName: string;
  onVercelProjectNameChange: (name: string) => void;
  githubRepoFullName: string | null;
}

export interface WizardStepSummaryProps {
  state: ProjectWizardState;
  githubRepoFullName: string | null;
  deployToVercel: boolean;
  vercelProjectName: string;
}
