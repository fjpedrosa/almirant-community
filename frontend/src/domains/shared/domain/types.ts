// Shared domain types

export type MarkdownPreviewSize = "xs" | "sm" | "base";

export interface MarkdownPreviewProps {
  content: string;
  size?: MarkdownPreviewSize;
  className?: string;
  components?: Record<string, React.ComponentType<Record<string, unknown>>>;
}

export type WebhookTrigger =
  | "work_item_created"
  | "work_item_updated"
  | "work_item_moved"
  | "work_item_deleted"
  | "comment_added"
  | "attachment_added"
  | "sprint_closed"
  | "milestone_completed";

export type WebhookStatus = "pending" | "success" | "failed";

export type ImportStatus = "pending" | "processing" | "completed" | "failed";

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// API Response wrapper
export interface ApiResponseData<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

// Owner Avatar Picker
export interface OwnerAvatarPickerMember {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface OwnerAvatarPickerProps {
  currentOwnerId?: string | null;
  members: OwnerAvatarPickerMember[];
  onOwnerChange: (userId: string) => void;
  size?: "sm" | "md";
  disabled?: boolean;
}

// Mention / TiptapCommentEditor
export interface MentionMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface TiptapCommentEditorRef {
  triggerFileUpload: () => void;
  handleDroppedFiles: (files: File[]) => Promise<void>;
}

export interface TiptapCommentEditorProps {
  value: string;
  onChange: (html: string) => void;
  onSubmit: () => void;
  members: MentionMember[];
  placeholder?: string;
  disabled?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onFileUpload?: (file: File) => Promise<{ url: string; fileName: string; mimeType: string }>;
  onUploadingChange?: (isUploading: boolean) => void;
}

export interface MentionSuggestionListProps {
  items: MentionMember[];
  command: (attrs: { id: string; label: string }) => void;
}

// Inline Title (click-to-edit title editor)
export interface InlineTitleProps {
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}

// Confirm Dialog
export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  options: ConfirmDialogOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Owner Multi-Select Filter (for filter bars)
export interface OwnerMultiSelectFilterProps {
  owners: Array<{ id: string; name: string; email?: string; image?: string | null }>;
  selectedOwnerIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}

export type AgentLogLevel = "debug" | "info" | "warn" | "error";

export interface AgentLogChunk {
  id: string;
  seq: number;
  level: AgentLogLevel;
  phase: string;
  eventType: string;
  message: string;
  contentType?: "thinking" | "text" | "tool_use" | "user_input";
  payload?: Record<string, unknown>;
  timestamp: string;
}

export interface AgentLogViewerProps {
  chunks: AgentLogChunk[];
  isLoading?: boolean;
  isLive?: boolean;
  title?: string;
  emptyLabel?: string;
  className?: string;
}

// Create Project CTA (for onboarding new users without projects)
export interface CreateProjectCtaProps {
  title?: string;
  description?: string;
  buttonLabel?: string;
  className?: string;
}
