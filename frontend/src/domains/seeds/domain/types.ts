// Re-export all seed types from planning domain
export type {
  Seed,
  SeedWithRelations,
  SeedStatus,
  SeedSource,
  SeedPriority,
  SeedFilters,
  SeedComment,
  SeedEvent,
  SeedTag,
  SeedFeedbackLink,
  SeedWorkItemLink,
  CreateSeedRequest,
  UpdateSeedRequest,
  PromoteSeedRequest,
  PaginatedSeedsResponse,
  SeedDetailPanelProps,
  SeedChipProps,
  SeedListProps,
  SeedQuickAddProps,
  SeedSelectionBarProps,
} from "@/domains/planning/domain/types";

// Also re-export the Priority type used by seeds
export type { Priority } from "@/domains/work-items/domain/types";
export type { PaginationMeta } from "@/domains/shared/domain/types";

// --- Seeds page presentation props ---

import type {
  SeedStatus,
  SeedSource,
  SeedPriority,
  SeedFilters,
  SeedWithRelations,
  SeedComment,
  SeedEvent,
  SeedTag,
  SeedFeedbackLink,
  SeedWorkItemLink,
} from "@/domains/planning/domain/types";

export interface SeedsFilterBarProps {
  filters: SeedFilters;
  hasActiveFilters: boolean;
  activeFilters: Array<{
    key: keyof SeedFilters;
    label: string;
    value: string;
  }>;
  owners: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  tags?: SeedTag[];
  hideStatusFilter?: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: SeedStatus | undefined) => void;
  onSourceChange: (value: SeedSource | undefined) => void;
  onPriorityChange: (value: SeedPriority | undefined) => void;
  onOwnerChange: (value: string | undefined) => void;
  onProjectChange: (value: string | undefined) => void;
  onTagChange: (value: string | undefined) => void;
  onSelectedForIdeationChange: (value: boolean | undefined) => void;
  onClearFilters: () => void;
  onRemoveFilter: (key: keyof SeedFilters) => void;
}

export interface SeedsItemsListProps {
  items: SeedWithRelations[];
  isLoading: boolean;
  members: Array<{
    id: string;
    name: string;
    email: string;
    image?: string | null;
  }>;
  onOpenItem: (item: SeedWithRelations) => void;
  onDelete: (item: SeedWithRelations) => void;
  onStatusChange: (item: SeedWithRelations, status: SeedStatus) => void;
  onOwnerChange: (itemId: string, userId: string) => void;
}

export interface SeedsPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export interface SeedInlineStatusProps {
  value: SeedStatus;
  onChange: (status: SeedStatus) => void;
  isLoading?: boolean;
}

export interface SeedDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: SeedWithRelations | null;
  isLoading: boolean;
  projects: Array<{ id: string; name: string }>;
  members: Array<{
    id: string;
    name: string;
    email: string;
    image?: string | null;
  }>;
  availableTags?: SeedTag[];
  commentsProps?: SeedCommentsSectionProps;
  historyProps?: SeedHistorySectionProps;
  traceabilityProps?: SeedTraceabilitySectionProps;
  savingField?: string | null;
  onPromote: (item: SeedWithRelations) => void;
  onStatusChange: (status: SeedStatus) => void;
  onOwnerChange: (userId: string) => void;
  onPriorityChange: (priority: SeedPriority | null) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string | null) => void;
  onProjectChange: (projectId: string | null) => void;
  onAddTag?: (data: {
    tagId?: string;
    name?: string;
    color?: string;
  }) => void;
  onRemoveTag?: (tagId: string) => void;
}

export interface SeedCommentsSectionProps {
  comments: SeedComment[];
  isLoading: boolean;
  currentUserId: string | null;
  isAdding: boolean;
  newCommentValue: string;
  editingId: string | null;
  editContent: string;
  members: Array<{
    id: string;
    name: string;
    email: string;
    image: string | null;
  }>;
  onAddComment: () => void;
  onAddCommentDirect: (content: string) => void;
  onDeleteComment: (commentId: string) => void;
  onNewCommentChange: (value: string) => void;
  onStartEdit: (comment: SeedComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (value: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  onFileUpload?: (file: File) => Promise<{ url: string; fileName: string; mimeType: string }>;
}

export interface SeedHistorySectionProps {
  events: SeedEvent[];
  isLoading: boolean;
  members?: Array<{
    id: string;
    name: string;
    email: string;
    image?: string | null;
  }>;
  projects?: Array<{ id: string; name: string }>;
}

export interface SeedTraceabilitySectionProps {
  feedbackLinks: SeedFeedbackLink[];
  workItemLinks: SeedWorkItemLink[];
  isLoading: boolean;
}

export interface CreateSeedFormData {
  title: string;
  description: string;
  source: SeedSource;
  priority: string;
  projectId: string;
  ownerUserId: string;
}

export interface CreateSeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<CreateSeedFormData>;
  projects: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string; email: string; image?: string | null }>;
  isPending: boolean;
  onSubmit: () => void;
}

export interface PromoteSeedFormData {
  workItemType: "task" | "story" | "feature" | "epic";
  title: string;
  description: string;
  priority: string;
  projectId: string;
  boardId: string;
  boardColumnId: string;
  notes: string;
  parentId?: string;
}

export interface PromoteSeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<PromoteSeedFormData>;
  item: SeedWithRelations | null;
  projects: Array<{ id: string; name: string }>;
  boards: Array<{ id: string; name: string }>;
  columns: Array<{ id: string; name: string }>;
  isPending: boolean;
  onSubmit: () => void;
}

export interface SeedsViewPreferences {
  status?: SeedStatus;
  source?: SeedSource;
  priority?: SeedPriority;
  ownerUserId?: string;
  projectId?: string;
  tagId?: string;
  selectedForIdeation?: boolean;
}
