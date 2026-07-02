import type { MentionMember, PaginationMeta } from "@/domains/shared/domain/types";
import type { Priority, WorkItemType } from "@/domains/work-items/domain/types";

export type IdeaItemType = "idea";
export type IdeaItemStatus = "draft" | "active" | "to_review" | "approved" | "archived" | "rejected";
export type IdeaItemWorkLinkType = "promoted_to" | "related_to";
export type IdeaTabValue = "all" | "ideas";

export interface IdeaItem {
  id: string;
  workspaceId: string;
  projectId: string | null;
  type: IdeaItemType;
  status: IdeaItemStatus;
  title: string;
  description: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  metadata: Record<string, unknown>;
  discussed: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaItemFeedbackLink {
  id: string;
  feedbackItemId: string;
  title: string;
  status: "new" | "triaged" | "in_progress" | "pending_validation" | "implementing" | "deployed" | "verified" | "cancelled";
  category: "bug" | "feature_request" | "improvement" | "question" | "praise" | "other";
  createdAt: string;
}

export interface IdeaItemWorkItemLink {
  id: string;
  workItemId: string;
  taskId: string | null;
  title: string;
  type: WorkItemType;
  priority: Priority;
  columnName: string;
  linkType: IdeaItemWorkLinkType;
  createdAt: string;
}

export interface IdeaItemTag {
  id: string;
  name: string;
  color: string;
}

export interface IdeaItemWithRelations extends IdeaItem {
  owner: { id: string; name: string; email: string; image: string | null } | null;
  createdBy: { id: string; name: string; email: string; image: string | null } | null;
  projectName: string | null;
  commentCount: number;
  lastComment: { userName: string | null; userImage: string | null; createdAt: string } | null;
  feedbackLinks: IdeaItemFeedbackLink[];
  workItemLinks: IdeaItemWorkItemLink[];
  tags: IdeaItemTag[];
}

export interface IdeaItemTraceabilityResult {
  ideaItem: IdeaItem;
  feedbackLinks: IdeaItemFeedbackLink[];
  workItemLinks: IdeaItemWorkItemLink[];
}

export interface IdeaItemComment {
  id: string;
  ideaItemId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

export interface IdeaCommentVersion {
  id: string;
  commentId: string;
  entityType: string;
  content: string;
  editedAt: string;
  editedByUserId: string;
  editedBy: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

export interface IdeaCommentsSectionProps {
  comments: IdeaItemComment[];
  isLoading: boolean;
  currentUserId: string | null;
  isAdding: boolean;
  newCommentValue: string;
  editingId: string | null;
  editContent: string;
  members: MentionMember[];
  onAddComment: () => void;
  onAddCommentDirect: (content: string) => void;
  onDeleteComment: (commentId: string) => void;
  onNewCommentChange: (value: string) => void;
  onStartEdit: (comment: IdeaItemComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (value: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  onFileUpload?: (file: File) => Promise<{ url: string; fileName: string; mimeType: string }>;
}

export interface IdeaItemEvent {
  id: string;
  ideaItemId: string;
  eventType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  triggeredBy: string;
  triggeredByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  triggeredByUserName: string | null;
  triggeredByUserImage: string | null;
  triggeredByUserEmail: string | null;
}

export interface IdeaItemFilters {
  type?: IdeaItemType;
  status?: IdeaItemStatus;
  ownerUserId?: string;
  projectId?: string;
  tagIds?: string[];
  search?: string;
  dueDate?: string;
  discussed?: boolean;
  showAllDone?: boolean;
  mentionedUserId?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  page: number;
  limit: number;
}

export interface CreateIdeaItemRequest {
  title: string;
  type: IdeaItemType;
  status?: IdeaItemStatus;
  projectId?: string | null;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateIdeaItemRequest {
  title?: string;
  type?: IdeaItemType;
  status?: IdeaItemStatus;
  projectId?: string | null;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PromoteIdeaItemRequest {
  workItemType: Exclude<WorkItemType, "idea">;
  title: string;
  description?: string;
  priority?: Priority;
  boardId: string;
  boardColumnId: string;
  projectId: string;
  parentId?: string;
  notes?: string;
  promotedBy?: string;
}

export interface PromoteIdeaItemResponse {
  source: {
    id: string;
    type: IdeaItemType;
    status: IdeaItemStatus;
  };
  workItem: {
    id: string;
    taskId: string | null;
    title: string;
    type: Exclude<WorkItemType, "idea">;
  };
  link: {
    id: string;
    ideaItemId: string;
    workItemId: string;
    linkType: IdeaItemWorkLinkType;
    createdAt: string;
  };
}

export interface PaginatedIdeaItemsResponse {
  items: IdeaItemWithRelations[];
  meta: PaginationMeta;
}

export interface IdeasFilterBarProps {
  filters: IdeaItemFilters;
  hasActiveFilters: boolean;
  activeFilters: Array<{ key: keyof IdeaItemFilters; label: string; value: string }>;
  owners: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  tags?: IdeaItemTag[];
  hideTypeFilter?: boolean;
  onSearchChange: (value: string) => void;
  onTypeChange: (value: IdeaItemType | undefined) => void;
  onStatusChange: (value: IdeaItemStatus | undefined) => void;
  onOwnerChange: (value: string | undefined) => void;
  onProjectChange: (value: string | undefined) => void;
  onDueDateChange: (value: string | undefined) => void;
  onDiscussedChange: (value: boolean | undefined) => void;
  onMentionedChange: (value: string | undefined) => void;
  onTagChange: (value: string[] | undefined) => void;
  onClearFilters: () => void;
  onRemoveFilter: (key: keyof IdeaItemFilters) => void;
}

export interface IdeasItemsListProps {
  items: IdeaItemWithRelations[];
  isLoading: boolean;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  onOpenItem: (item: IdeaItemWithRelations) => void;
  onDelete: (item: IdeaItemWithRelations) => void;
  onStatusChange: (item: IdeaItemWithRelations, status: IdeaItemStatus) => void;
  onDiscussedToggle: (item: IdeaItemWithRelations) => void;
  onOwnerChange: (itemId: string, userId: string) => void;
}

export interface IdeasPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export interface QuickCaptureFormData {
  title: string;
  description: string;
  type: IdeaItemType;
  projectId: string;
  ownerUserId: string;
  dueDate: string;
}

export interface QuickCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<QuickCaptureFormData>;
  projects: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string; email: string; image?: string | null }>;
  isPending: boolean;
  onSubmit: () => void;
}

export interface EditIdeaItemFormData {
  title: string;
  description: string;
  type: IdeaItemType;
  status: IdeaItemStatus;
  projectId: string;
  ownerUserId: string;
  dueDate: string;
}

export interface EditIdeaItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<EditIdeaItemFormData>;
  projects: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string; email: string; image?: string | null }>;
  isPending: boolean;
  onSubmit: () => void;
}

export interface PromoteIdeaItemFormData {
  workItemType: Exclude<WorkItemType, "idea">;
  title: string;
  description: string;
  priority: Priority;
  projectId: string;
  boardId: string;
  boardColumnId: string;
  notes: string;
  parentId?: string;
}

export interface PromoteIdeaItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<PromoteIdeaItemFormData>;
  item: IdeaItemWithRelations | null;
  projects: Array<{ id: string; name: string }>;
  boards: Array<{ id: string; name: string }>;
  columns: Array<{ id: string; name: string }>;
  isPending: boolean;
  onSubmit: () => void;
}

export interface IdeaTraceabilityPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: IdeaItemWithRelations | null;
  traceability: IdeaItemTraceabilityResult | null;
  isLoading: boolean;
}

export interface IdeaDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: IdeaItemWithRelations | null;
  traceability: IdeaItemTraceabilityResult | null;
  history: IdeaItemEvent[];
  isLoading: boolean;
  isTraceabilityLoading: boolean;
  isHistoryLoading: boolean;
  projects: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  availableTags?: IdeaItemTag[];
  commentsProps?: IdeaCommentsSectionProps;
  savingField?: string | null;
  onPromote: (item: IdeaItemWithRelations) => void;
  onStatusChange: (status: IdeaItemStatus) => void;
  onOwnerChange: (userId: string) => void;
  onDueDateChange: (date: string | null) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string | null) => void;
  onProjectChange: (projectId: string | null) => void;
  onDiscussedToggle?: (item: IdeaItemWithRelations) => void;
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
}

export interface IdeasViewPreferences {
  tab: IdeaTabValue;
  // Persisted content filters
  status?: IdeaItemStatus;
  ownerUserId?: string;
  projectId?: string;
  tagIds?: string;
  discussed?: boolean;
  dueDate?: string;
  mentionedUserId?: string;
}

// Inline editable components (A-211)
export interface IdeaInlineStatusProps {
  value: IdeaItemStatus;
  type: IdeaItemType;
  onChange: (status: IdeaItemStatus) => void;
  isLoading?: boolean;
}

export interface IdeaInlineOwnerProps {
  currentOwnerId: string | null;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  onChange: (userId: string) => void;
  isLoading?: boolean;
}

export interface IdeaInlineDateProps {
  value: string | null;
  onChange: (date: string | null) => void;
  isLoading?: boolean;
}

export interface IdeaInlineProjectProps {
  currentProjectId: string | null;
  currentProjectName: string | null;
  projects: Array<{ id: string; name: string }>;
  onChange: (projectId: string | null) => void;
  isLoading?: boolean;
}

// Comment bubble (A-214)
export interface IdeaCommentBubbleProps {
  comment: IdeaItemComment;
  isOwn: boolean;
  isEditing: boolean;
  editContent: string;
  members: MentionMember[];
  onStartEdit: (comment: IdeaItemComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (value: string) => void;
  onDelete: (commentId: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
}

// Comment input (A-216)
export interface IdeaCommentInputProps {
  onSubmit: (content: string) => void;
  isAdding: boolean;
  members: MentionMember[];
  disabled?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onFileUpload?: (file: File) => Promise<{ url: string; fileName: string; mimeType: string }>;
}

// Collapsible sections (A-217)
export interface IdeaHistorySectionProps {
  events: IdeaItemEvent[];
  isLoading: boolean;
  members?: Array<{ id: string; name: string; email: string; image?: string | null }>;
  projects?: Array<{ id: string; name: string }>;
}

export interface IdeaTraceabilitySectionProps {
  feedbackLinks: IdeaItemFeedbackLink[];
  workItemLinks: IdeaItemWorkItemLink[];
  isLoading: boolean;
}

export interface IdeaTagChipsProps {
  tags: Array<{ id: string; name: string; color: string | null }>;
  availableTags: Array<{ id: string; name: string; color: string | null }>;
  onAddTag: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag: (tagId: string) => void;
  isCompact?: boolean;
}
