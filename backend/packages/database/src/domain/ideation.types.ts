import type {
  FeedbackStatus,
  FeedbackCategory,
} from "./feedback.types";
import type {
  WorkItemType,
  Priority,
} from "./project-management.types";

// ──────────────────────────────────────────────
// Ideas Hub
// ──────────────────────────────────────────────

export type IdeaItemType = "idea";
export type IdeaItemStatus = "draft" | "active" | "to_review" | "approved" | "archived" | "rejected" | "pending" | "done" | "blocked";
export type IdeaItemWorkLinkType = "promoted_to" | "related_to";
export type IdeaItemEventType =
  | "created"
  | "updated"
  | "feedback_linked"
  | "feedback_unlinked"
  | "work_item_linked";
export type IdeaItemEventTriggeredBy = "user" | "system" | "claude-code" | "codex";

export interface IdeaItem {
  id: string;
  organizationId: string;
  projectId: string | null;
  type: IdeaItemType;
  status: IdeaItemStatus;
  title: string;
  description: string | null;
  ownerUserId: string | null;
  createdByUserId: string | null;
  dueDate: Date | null;
  metadata: Record<string, unknown> | null;
  discussed: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdeaItemFeedbackLink {
  id: string;
  ideaItemId: string;
  feedbackItemId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdeaItemWorkItemLink {
  id: string;
  ideaItemId: string;
  workItemId: string;
  linkType: IdeaItemWorkLinkType;
  createdBy: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdeaItemWithRelations extends IdeaItem {
  owner: { id: string; name: string; email: string; image: string | null } | null;
  createdBy: { id: string; name: string; email: string; image: string | null } | null;
  projectName: string | null;
  commentCount: number;
  lastComment: { userName: string | null; userImage: string | null; createdAt: Date } | null;
  tags: Array<{ id: string; name: string; color: string }>;
  feedbackLinks: Array<{
    id: string;
    feedbackItemId: string;
    title: string;
    status: FeedbackStatus;
    category: FeedbackCategory;
    createdAt: Date;
  }>;
  workItemLinks: Array<{
    id: string;
    workItemId: string;
    taskId: string | null;
    title: string;
    type: WorkItemType;
    priority: Priority;
    columnName: string;
    linkType: IdeaItemWorkLinkType;
    createdAt: Date;
  }>;
}

export interface IdeaItemFilters {
  type?: IdeaItemType;
  status?: IdeaItemStatus;
  ownerUserId?: string | string[];
  projectId?: string;
  search?: string;
  dueDate?: string;
  discussed?: boolean;
  showAllDone?: boolean;
  mentionedUserId?: string;
  tagIds?: string[] | string;
  sortBy?: "createdAt" | "updatedAt" | "dueDate";
  sortOrder?: "asc" | "desc";
}

export interface CreateIdeaItemRequest {
  projectId?: string | null;
  type: IdeaItemType;
  status?: IdeaItemStatus;
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateIdeaItemRequest {
  projectId?: string | null;
  type?: IdeaItemType;
  status?: IdeaItemStatus;
  title?: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
  discussed?: boolean;
}

export interface IdeaItemTraceabilityResult {
  ideaItem: IdeaItem;
  feedbackLinks: IdeaItemWithRelations["feedbackLinks"];
  workItemLinks: IdeaItemWithRelations["workItemLinks"];
}

export interface IdeaItemEvent {
  id: string;
  ideaItemId: string;
  eventType: IdeaItemEventType | string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  triggeredBy: IdeaItemEventTriggeredBy | string;
  triggeredByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  triggeredByUserName: string | null;
  triggeredByUserImage: string | null;
  triggeredByUserEmail: string | null;
}

export interface IdeaItemEventContext {
  triggeredBy?: IdeaItemEventTriggeredBy;
  triggeredByUserId?: string | null;
}

export interface PromoteIdeaItemRequest {
  ideaItemId: string;
  workItemType: Exclude<WorkItemType, "idea">;
  title: string;
  description?: string;
  priority?: Priority;
  boardId: string;
  boardColumnId: string | null;
  projectId: string;
  parentId?: string;
  notes?: string;
  promotedBy?: string;
}

export interface PromoteIdeaItemResponse {
  workItem: {
    id: string;
    taskId: string | null;
    title: string;
    type: WorkItemType;
  };
  link: {
    id: string;
    ideaItemId: string;
    workItemId: string;
    linkType: IdeaItemWorkLinkType;
    createdAt: Date;
  };
}

// ──────────────────────────────────────────────
// Seeds (standalone entity, extracted from idea_items)
// ──────────────────────────────────────────────

export type SeedStatus = "draft" | "active" | "to_review" | "approved" | "archived" | "rejected";
export type SeedSource = "manual" | "feedback" | "ai_generated" | "import";

export interface Seed {
  id: string;
  organizationId: string;
  projectId: string | null;
  status: SeedStatus;
  title: string;
  description: string | null;
  source: SeedSource;
  priority: Priority | null;
  selectedForIdeation: boolean;
  ownerUserId: string | null;
  createdByUserId: string | null;
  metadata: Record<string, unknown>;
  maturityLevel: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeedFeedbackLink {
  id: string;
  feedbackItemId: string;
  title: string;
  status: string;
  category: string;
  createdAt: Date;
}

export interface SeedWorkItemLink {
  id: string;
  workItemId: string;
  taskId: string | null;
  title: string;
  type: string;
  priority: string | null;
  columnName: string;
  linkType: string;
  createdAt: Date;
}

export interface SeedWithRelations extends Seed {
  owner: { id: string; name: string; email: string; image: string | null } | null;
  createdBy: { id: string; name: string; email: string; image: string | null } | null;
  projectName: string | null;
  commentCount: number;
  lastComment: { userName: string | null; userImage: string | null; createdAt: Date } | null;
  tags: { id: string; name: string; color: string }[];
  feedbackLinks: SeedFeedbackLink[];
  workItemLinks: SeedWorkItemLink[];
}

export type SeedStatusGroup = "active" | "finished";

export interface SeedFilters {
  status?: SeedStatus;
  statuses?: SeedStatus[];
  statusGroup?: SeedStatusGroup;
  projectId?: string;
  search?: string;
  ownerUserId?: string | string[];
  tagIds?: string | string[];
  selectedForIdeation?: boolean;
  sortBy?: "priority" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

export interface CreateSeedInput {
  title: string;
  description?: string;
  source?: SeedSource;
  priority?: Priority;
  projectId?: string;
  ownerUserId?: string;
  selectedForIdeation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateSeedInput {
  title?: string;
  description?: string;
  status?: SeedStatus;
  source?: SeedSource;
  priority?: Priority | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  selectedForIdeation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SeedEventContext {
  triggeredBy?: "user" | "system" | "claude-code" | "codex";
  triggeredByUserId?: string | null;
}

// ──────────────────────────────────────────────
// Todo Items
// ──────────────────────────────────────────────

export type TodoItemStatus = "pending" | "in_progress" | "done" | "blocked";

export interface TodoItem {
  id: string;
  organizationId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TodoItemStatus;
  priority: Priority | null;
  ownerUserId: string | null;
  createdByUserId: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TodoItemWithRelations extends TodoItem {
  owner: { id: string; name: string; email: string; image: string | null } | null;
  createdBy: { id: string; name: string; email: string; image: string | null } | null;
  projectName: string | null;
  commentCount: number;
}

export interface TodoItemFilters {
  status?: TodoItemStatus;
  priority?: string;
  ownerUserId?: string;
  projectId?: string;
  search?: string;
  dueDate?: string;
  showAllDone?: boolean;
}

export interface CreateTodoItemRequest {
  projectId?: string | null;
  title: string;
  description?: string | null;
  status?: TodoItemStatus;
  priority?: Priority | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTodoItemRequest {
  projectId?: string | null;
  title?: string;
  description?: string | null;
  status?: TodoItemStatus;
  priority?: Priority | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TodoItemEventContext {
  triggeredBy?: "user" | "system" | "claude-code" | "codex";
  triggeredByUserId?: string | null;
}
