import type { PaginationMeta } from "@/domains/shared/domain/types";

export type TodoItemStatus = "pending" | "in_progress" | "done" | "blocked";
export type TodoItemPriority = "low" | "medium" | "high" | "urgent";

export interface TodoItem {
  id: string;
  organizationId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TodoItemStatus;
  priority: TodoItemPriority | null;
  ownerUserId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TodoItemTag {
  id: string;
  name: string;
  color: string | null;
}

export interface TodoItemWithRelations extends TodoItem {
  owner: { id: string; name: string; email: string; image: string | null } | null;
  createdBy: { id: string; name: string; email: string; image: string | null } | null;
  projectName: string | null;
  commentCount: number;
  lastComment: { userName: string | null; userImage: string | null; createdAt: string } | null;
  tags?: TodoItemTag[];
}

export interface TodoItemComment {
  id: string;
  entityId: string;
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

export interface TodoCommentVersion {
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

export interface TodoItemEvent {
  id: string;
  entityId: string;
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

export interface TodosViewPreferences {
  status?: TodoItemStatus;
  priority?: TodoItemPriority;
  ownerUserId?: string;
  projectId?: string;
  dueDate?: string;
}

export interface TodoItemFilters {
  status?: TodoItemStatus;
  priority?: TodoItemPriority;
  ownerUserId?: string;
  projectId?: string;
  search?: string;
  dueDate?: string;
  showAllDone?: boolean;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  page: number;
  limit: number;
}

export interface CreateTodoItemRequest {
  title: string;
  description?: string | null;
  status?: TodoItemStatus;
  priority?: TodoItemPriority | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTodoItemRequest {
  title?: string;
  description?: string | null;
  status?: TodoItemStatus;
  priority?: TodoItemPriority | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PaginatedTodoItemsResponse {
  items: TodoItemWithRelations[];
  meta: PaginationMeta;
}

// --- Component Props ---

export interface TodosFilterBarProps {
  filters: TodoItemFilters;
  hasActiveFilters: boolean;
  activeFilters: Array<{ key: keyof TodoItemFilters; label: string; value: string }>;
  owners: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: TodoItemStatus | undefined) => void;
  onPriorityChange: (value: TodoItemPriority | undefined) => void;
  onOwnerChange: (value: string | undefined) => void;
  onProjectChange: (value: string | undefined) => void;
  onDueDateChange: (value: string | undefined) => void;
  onClearFilters: () => void;
  onRemoveFilter: (key: keyof TodoItemFilters) => void;
}

export interface TodosListProps {
  items: TodoItemWithRelations[];
  isLoading: boolean;
  hasActiveFilters: boolean;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  onToggleDone: (item: TodoItemWithRelations) => void;
  onToggleBlocked: (item: TodoItemWithRelations) => void;
  onOpenItem: (item: TodoItemWithRelations) => void;
  onDelete: (item: TodoItemWithRelations) => void;
  onOwnerChange: (itemId: string, userId: string) => void;
  onPriorityChange: (item: TodoItemWithRelations, priority: TodoItemPriority) => void;
  onStatusChange: (item: TodoItemWithRelations, status: TodoItemStatus) => void;
}

export interface TodosPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export interface TodoPriorityBadgeProps {
  value: TodoItemPriority | null;
  onChange: (priority: TodoItemPriority) => void;
  isLoading?: boolean;
}

export interface CreateTodoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<CreateTodoFormData>;
  projects: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string; email: string; image?: string | null }>;
  isPending: boolean;
  onSubmit: () => void;
}

export interface CreateTodoFormData {
  title: string;
  description: string;
  priority: TodoItemPriority;
  projectId: string;
  ownerUserId: string;
  dueDate: string;
}

export interface TodoCommentsSectionProps {
  comments: TodoItemComment[];
  isLoading: boolean;
  currentUserId: string | null;
  isAdding: boolean;
  newCommentValue: string;
  editingId: string | null;
  editContent: string;
  onAddComment: () => void;
  onAddCommentDirect: (content: string) => void;
  onDeleteComment: (commentId: string) => void;
  onNewCommentChange: (value: string) => void;
  onStartEdit: (comment: TodoItemComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (value: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  onFileUpload?: (file: File) => Promise<{ url: string; fileName: string; mimeType: string }>;
}

export interface TodoCommentBubbleProps {
  comment: TodoItemComment;
  isOwn: boolean;
  isEditing: boolean;
  editContent: string;
  onStartEdit: (comment: TodoItemComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (value: string) => void;
  onDelete: (commentId: string) => void;
}

export interface TodoCommentInputProps {
  onSubmit: (content: string) => void;
  isAdding: boolean;
  disabled?: boolean;
}

export interface TodoHistorySectionProps {
  events: TodoItemEvent[];
  isLoading: boolean;
}

export interface TodoDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TodoItemWithRelations | null;
  history: TodoItemEvent[];
  isLoading: boolean;
  isHistoryLoading: boolean;
  projects: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  commentsProps?: TodoCommentsSectionProps;
  savingField?: string | null;
  availableTags?: TodoItemTag[];
  onStatusChange: (status: TodoItemStatus) => void;
  onPriorityChange: (priority: TodoItemPriority) => void;
  onOwnerChange: (userId: string) => void;
  onDueDateChange: (date: string | null) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string | null) => void;
  onProjectChange: (projectId: string | null) => void;
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
}

// Inline editable component props (reuse patterns from ideas domain)
export interface TodoInlineOwnerProps {
  currentOwnerId: string | null;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  onChange: (userId: string) => void;
  isLoading?: boolean;
}

export interface TodoInlineDateProps {
  value: string | null;
  onChange: (date: string | null) => void;
  isLoading?: boolean;
}

export interface TodoInlineProjectProps {
  currentProjectId: string | null;
  currentProjectName: string | null;
  projects: Array<{ id: string; name: string }>;
  onChange: (projectId: string | null) => void;
  isLoading?: boolean;
}

export interface TodoInlineTitleProps {
  value: string;
  onChange: (title: string) => void;
  isLoading?: boolean;
}

export interface TodoInlinePriorityProps {
  value: TodoItemPriority | null;
  onChange: (priority: TodoItemPriority) => void;
  isLoading?: boolean;
}
