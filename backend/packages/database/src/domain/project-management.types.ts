// ──────────────────────────────────────────────
// Projects
// ──────────────────────────────────────────────

export type ProjectStatus = "active" | "archived" | "on_hold";
export type DocLinkType = "notion" | "github" | "gdocs" | "confluence" | "figma" | "other";
export type RepositoryProvider = "github" | "gitlab" | "bitbucket" | "other";

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
  organizationId: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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

export interface ProjectNote {
  id: string;
  projectId: string;
  title: string;
  content: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWithRelations extends Project {
  organizationName: string | null;
  docLinks: ProjectDocLink[];
  repositories: ProjectRepository[];
  notes: ProjectNote[];
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
  organizationId?: string | null;
  startDate?: string;
  targetDate?: string;
}

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
  screenshotUrl?: string | null;
  techStack?: string[] | null;
  organizationId?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
}

export interface ProjectFilters {
  search?: string;
  status?: ProjectStatus;
  organizationId?: string;
  /** When provided, return projects belonging to ANY of these organization IDs + personal projects. */
  organizationIds?: string[];
  /** When true, return only projects with no organization (personal projects). */
  personal?: boolean;
  /** When true, include archived projects in results even when no status filter is set. */
  includeArchived?: boolean;
  /** When provided, restrict results to projects where this user is a member. */
  userId?: string;
}

export interface CreateDocLinkRequest {
  title: string;
  url: string;
  type?: DocLinkType;
  order?: number;
}

export interface UpdateDocLinkRequest {
  title?: string;
  url?: string;
  type?: DocLinkType;
  order?: number;
}

export interface CreateNoteRequest {
  title: string;
  content?: string;
  order?: number;
}

export interface UpdateNoteRequest {
  title?: string;
  content?: string | null;
  order?: number;
}

export interface CreateRepositoryRequest {
  name: string;
  url: string;
  provider?: RepositoryProvider;
  isMonorepo?: boolean;
  order?: number;
}

export interface UpdateRepositoryRequest {
  name?: string;
  url?: string;
  provider?: RepositoryProvider;
  isMonorepo?: boolean;
  order?: number;
}

// ──────────────────────────────────────────────
// Tags
// ──────────────────────────────────────────────

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
}

export interface CreateTagRequest {
  name: string;
  color?: string;
}

export interface UpdateTagRequest {
  name?: string;
  color?: string;
}

// ──────────────────────────────────────────────
// Work Item Documentation (stored in metadata.documentation)
// ──────────────────────────────────────────────

export interface WorkItemDocumentation {
  summary: string;
  screenshots: string[];
  mermaidDiagrams?: string[];
  generatedAt: string;
}

// ──────────────────────────────────────────────
// Boards
// ──────────────────────────────────────────────

export type BoardArea = "desarrollo" | "ventas" | "prospeccion" | "marketing" | "general";
export type ColumnRole = "backlog" | "todo" | "in_progress" | "review" | "testing" | "needs_fix" | "validating" | "release" | "to_document" | "done" | "other";

export interface Board {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  area: BoardArea;
  isDefault: boolean;
  // Null/empty means "allow all" for backward compatibility.
  allowedTypes: ("epic" | "feature" | "story" | "task" | "idea")[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  color: string;
  order: number;
  role: ColumnRole;
  isDone: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardWithColumns extends Board {
  columns: BoardColumn[];
}

export interface BoardWithStats extends Board {
  columns: BoardColumn[];
  totalItems: number;
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string | null;
  area: BoardArea;
  columns: BoardTemplateColumn[];
  isBuiltIn: boolean;
  createdAt: Date;
}

export interface BoardTemplateColumn {
  name: string;
  color: string;
  order: number;
  isDone: boolean;
  role?: ColumnRole;
}

export interface CreateBoardRequest {
  name: string;
  description?: string;
  area?: BoardArea;
  isDefault?: boolean;
  allowedTypes?: ("epic" | "feature" | "story" | "task" | "idea")[] | null;
}

export interface UpdateBoardRequest {
  name?: string;
  description?: string | null;
  area?: BoardArea;
  isDefault?: boolean;
  allowedTypes?: ("epic" | "feature" | "story" | "task" | "idea")[] | null;
}

export interface CreateColumnRequest {
  name: string;
  color?: string;
  order?: number;
  isDone?: boolean;
  role?: ColumnRole;
}

export interface UpdateColumnRequest {
  name?: string;
  color?: string;
  order?: number;
  isDone?: boolean;
  role?: ColumnRole;
}

// ──────────────────────────────────────────────
// Work Items
// ──────────────────────────────────────────────

export type WorkItemType = "epic" | "feature" | "story" | "task" | "idea";
export type ParentWorkItemType = "epic" | "feature" | "story";
export type LeafWorkItemType = "task" | "idea";
export type Priority = "low" | "medium" | "high" | "urgent";
export type CodingAgent = "codex" | "claude-code" | "opencode";

/** Type guard: returns true if the given type is a leaf type (task or idea) that requires a boardColumnId. */
export const isLeafType = (type: WorkItemType): type is LeafWorkItemType =>
  type === "task" || type === "idea";

/** Type guard: returns true if the given type is a parent type (epic, feature, story) with no boardColumnId. */
export const isParentType = (type: WorkItemType): type is ParentWorkItemType =>
  type === "epic" || type === "feature" || type === "story";

export interface AncestorInfo {
  id: string;
  title: string;
  type: WorkItemType;
  taskId: string | null;
}

export interface WorkItem {
  id: string;
  projectId: string | null;
  boardId: string;
  boardColumnId: string | null;
  parentId: string | null;
  type: WorkItemType;
  title: string;
  description: string | null;
  priority: Priority;
  assignee: string | null;
  position: number;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  metadata: Record<string, unknown>;
  isAiProcessing: boolean;
  taskId: string | null;
  createdByUserId: string | null;
  requestedByUserId: string | null;
  codingAgent: CodingAgent | null;
  aiModel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChildUserActions {
  itemId: string;
  taskId: string | null;
  userActions: string;
  validationChecks?: string;
  documentationNotes?: string;
  isDeployChecklist?: boolean;
}

export interface ChildHumanActionRequirement {
  itemId: string;
  taskId: string | null;
  message: string;
  externalValidationRequired?: boolean;
  externalValidationTools?: string[];
}

export interface ChildrenSummary {
  totalLeafCount: number;
  doneCount: number;
  progressPercent: number;
  countPerColumn: Record<string, number>;
  leafIdsByColumn: Record<string, string[]>;
  childUserActions?: ChildUserActions[];
  childHumanActionRequirements?: ChildHumanActionRequirement[];
  aggregatedAssignees?: { id: string; name: string; email: string; image: string | null }[];
  totalEstimatedPoints?: number;
}

export interface WorkItemWithContext extends WorkItem {
  tags: { id: string; name: string; color: string }[];
  assignees: WorkItemAssignee[];
  childrenCount: number;
  parentTitle: string | null;
  parentType: WorkItemType | null;
  parentTaskId: string | null;
  createdBy: { id: string; name: string; image: string | null } | null;
  ancestors?: AncestorInfo[];
  projectName: string | null;
  projectColor: string | null;
  /** True when the item's column placement is computed from its children's progress (parent types). */
  isVirtualColumn: boolean;
  childrenSummary?: ChildrenSummary;
}

export interface WorkItemWithRelations extends WorkItem {
  parent: { id: string; title: string; type: WorkItemType; taskId: string | null } | null;
  ancestors?: AncestorInfo[];
  children: { id: string; title: string; type: WorkItemType; priority: Priority }[];
  tags: { id: string; name: string; color: string }[];
  assignees: WorkItemAssignee[];
  createdBy: { id: string; name: string; image: string | null } | null;
  projectName: string;
  boardName: string;
  columnName: string | null;
  columnColor: string | null;
  columnIsDone: boolean;
  childrenSummary?: ChildrenSummary;
}

export interface CreateWorkItemRequest {
  id?: string;
  projectId?: string | null;
  boardId: string;
  boardColumnId: string | null;
  parentId?: string;
  type: WorkItemType;
  title: string;
  description?: string;
  priority?: Priority;
  assignee?: string;
  position?: number;
  dueDate?: string;
  estimatedHours?: number;
  metadata?: Record<string, unknown>;
  tagIds?: string[];
  createdByUserId?: string;
}

export interface UpdateWorkItemRequest {
  title?: string;
  description?: string | null;
  type?: WorkItemType;
  priority?: Priority;
  assignee?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  metadata?: Record<string, unknown>;
  tagIds?: string[];
  parentId?: string | null;
  projectId?: string | null;
  requestedByUserId?: string | null;
  codingAgent?: CodingAgent | null;
  aiModel?: string | null;
}

export interface WorkItemFilters {
  search?: string;
  projectId?: string;
  boardId?: string;
  boardColumnId?: string;
  type?: WorkItemType;
  priority?: Priority;
  assignee?: string;
  parentId?: string;
  area?: string;
  tagId?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  isDone?: boolean;
}

export interface WorkItemsByColumn {
  column: BoardColumn;
  items: WorkItemWithContext[];
  count: number;
}

export interface MoveWorkItemRequest {
  boardColumnId: string;
  position: number;
}

export interface ChangeParentRequest {
  parentId: string | null;
}

export interface BulkMoveRequest {
  workItemIds: string[];
  boardColumnId: string;
}

export interface BulkChangePriorityRequest {
  workItemIds: string[];
  priority: Priority;
}

// ──────────────────────────────────────────────
// Work Item Attachments
// ──────────────────────────────────────────────

export interface WorkItemAttachment {
  id: string;
  workItemId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateAttachmentRequest {
  workItemId: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  uploadedBy?: string;
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// Work Item Assignees
// ──────────────────────────────────────────────

export type AssigneeRole = "responsible" | "collaborator" | "reviewer";

export interface WorkItemAssignee {
  id: string;
  workItemId: string;
  userId: string;
  role: AssigneeRole;
  assignedAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

export interface AssignWorkItemRequest {
  userId: string;
  role?: AssigneeRole;
}

export interface UpdateAssigneeRoleRequest {
  role: AssigneeRole;
}

// ──────────────────────────────────────────────
// Sprints
// ──────────────────────────────────────────────

export type SprintStatus = "open" | "closed";

export interface Sprint {
  id: string;
  boardId: string;
  name: string;
  status: SprintStatus;
  startDate: Date | null;
  endDate: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SprintWithCount extends Sprint {
  workItemCount: number;
}

export interface SprintWorkItemDetail {
  id: string;
  workItemId: string;
  taskId: string | null;
  title: string;
  type: WorkItemType;
  priority: Priority;
  assignee: string | null;
  completedAt: Date | null;
}

export interface CreateSprintRequest {
  boardId: string;
  name: string;
  startDate?: string;
  endDate?: string;
}

export interface DoneItemAncestor {
  id: string;
  title: string;
  type: string;
}

export interface DoneItemPreview {
  id: string;
  title: string;
  type: WorkItemType;
  priority: Priority;
  assignee: string | null;
  finishedAt: string | null;
  parentId?: string;
  ancestors?: DoneItemAncestor[];
}


export interface CompletedWorkItemByDate {
  id: string;
  title: string;
  type: WorkItemType;
  priority: Priority;
  assignee: string | null;
  taskId: string | null;
  boardColumnId: string | null;
  completedAt: Date;
  parentId?: string;
  ancestors?: DoneItemAncestor[];
}

// ──────────────────────────────────────────────
// Sprint Report
// ──────────────────────────────────────────────

export interface SprintWorkItemDetailExtended extends SprintWorkItemDetail {
  projectId: string | null;
}

export interface SprintComparison {
  sprintId: string;
  sprintName: string;
  completedCount: number;
  carryoverCount: number;
  velocity: number;
  startDate: Date | null;
  endDate: Date | null;
  closedAt: Date | null;
}

export interface SprintReportScreenshot {
  workItemId: string;
  workItemTaskId: string | null;
  workItemTitle: string;
  imageUrl: string;
  caption: string;
}

export interface SprintReportScreenshotGroup {
  groupId: string;
  groupTaskId: string | null;
  groupTitle: string;
  groupType: WorkItemType;
  screenshots: SprintReportScreenshot[];
}

export interface SprintVisualReportDocumentRef {
  id: string;
  title: string;
}

export interface SprintReportScreenshotsSection {
  total: number;
  groups: SprintReportScreenshotGroup[];
  document: SprintVisualReportDocumentRef | null;
}

export interface UserSprintStats {
  userId: string;
  userName: string;
  userImage: string | null;
  tasksCreated: number;
  tasksCompleted: number;
  tasksAssigned: number;
}

export interface SprintReport {
  sprint: SprintWithCount;
  completedTasks: {
    count: number;
    items: SprintWorkItemDetail[];
  };
  carryoverTasks: {
    count: number;
    items: SprintWorkItemDetail[];
  };
  velocity: number; // tasks per day
  averageTimePerTask: number; // hours
  distributionByType: Record<string, number>;
  distributionByPriority: Record<string, number>;
  distributionByAssignee: { assignee: string | null; count: number }[];
  userStats?: UserSprintStats[];
  aiCost: {
    totalSessions: number;
    totalTokens: number;
    totalCost: number;
  };
  comparison: SprintComparison[]; // previous sprints for trend comparison
  screenshots?: SprintReportScreenshotsSection;
  changelog?: string; // markdown content from changelog document
}

// ──────────────────────────────────────────────
// Roadmap Dates
// ──────────────────────────────────────────────

/** A nullable date range representing when work started and ended */
export interface RoadmapDateRange {
  startDate: Date | null;
  endDate: Date | null;
}

/** Minimal work item info needed for hierarchical date calculation */
export interface WorkItemForRoadmap {
  id: string;
  parentId: string | null;
  type: WorkItemType;
  boardColumnId: string | null;
}

/** A work item enriched with computed date range from its hierarchy */
export interface WorkItemWithRoadmapDates extends WorkItemForRoadmap {
  dateRange: RoadmapDateRange;
}
