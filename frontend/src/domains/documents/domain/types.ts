import type { PaginationMeta } from "@/domains/shared/domain/types";

// Document category status
export type DocumentCategoryStatus = "active" | "archived";

// Document category
export interface DocumentCategory {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  icon: string | null;
  order: number;
  status: DocumentCategoryStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Document category with count
export interface DocumentCategoryWithCount extends DocumentCategory {
  documentCount: number;
}

// Document
export interface Document {
  id: string;
  title: string;
  content: string | null;
  categoryId: string | null;
  projectId: string | null;
  filePath: string | null;
  wordCount: number | null;
  sizeBytes: number | null;
  isPinned: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

// Document with category and project info (from joins)
export interface DocumentWithCategory extends Document {
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  projectName: string | null;
  projectColor: string | null;
  isRead?: boolean;
}

// Create/Update requests
export interface CreateDocumentRequest {
  title: string;
  content?: string;
  categoryId?: string;
  projectId?: string;
}

export interface UpdateDocumentRequest {
  title?: string;
  content?: string;
  categoryId?: string | null;
  projectId?: string | null;
  isPinned?: boolean;
}

export interface CreateDocumentCategoryRequest {
  name: string;
  color?: string;
  icon?: string;
  parentId?: string;
}

export interface UpdateDocumentCategoryRequest {
  name?: string;
  color?: string;
  icon?: string;
  status?: DocumentCategoryStatus;
  parentId?: string | null;
}

// Linked work items (from document_work_items junction)
export interface LinkedWorkItem {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  priority: string;
  columnName: string | null;
  columnColor: string | null;
  linkedAt: string;
}

export interface LinkedWorkItemsSectionProps {
  workItems: LinkedWorkItem[];
  isLoading: boolean;
}

// Filters
export interface DocumentFilters {
  search?: string;
  categoryId?: string;
  projectId?: string;
  isPinned?: boolean;
}

export interface DocsPageFilters {
  projectId: string | null;
  docId: string | null;
  search: string;
}

// Full-text search
export interface DocumentSearchParams {
  q: string;
  projectId?: string;
  categoryId?: string;
  page?: number;
  limit?: number;
}

export interface DocumentSearchResult {
  id: string;
  title: string;
  snippet: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  wordCount: number | null;
  updatedAt: string;
  matchedIn: "title" | "content" | "both";
}

export interface DocumentSearchResponse {
  items: DocumentSearchResult[];
  meta: PaginationMeta;
}

// Search component props
export interface DocumentSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  categoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  projects: ProjectOption[];
  categories: DocumentCategoryWithCount[];
  isSearching: boolean;
}

export interface DocumentSearchResultItemProps {
  id: string;
  title: string;
  snippet: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  projectName: string | null;
  projectColor: string | null;
  wordCount: number | null;
  updatedAt: string;
  matchedIn: "title" | "content" | "both";
  searchQuery: string;
  onClick: () => void;
}

export interface DocumentSearchResultsProps {
  results: DocumentSearchResult[];
  searchQuery: string;
  isLoading: boolean;
  total: number;
  onResultClick: (documentId: string) => void;
}

// Paginated response
export interface PaginatedDocumentsResponse {
  items: DocumentWithCategory[];
  meta: PaginationMeta;
}

// Project option for selectors
export interface ProjectOption {
  id: string;
  name: string;
  color: string;
}

// Cross-project document item (lightweight, no content)
export interface CrossProjectDocumentItem {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  wordCount: number | null;
  isPinned: boolean | null;
  updatedAt: Date;
}

// Cross-project document group (one per project or Know-How)
export interface CrossProjectDocumentGroup {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  documents: CrossProjectDocumentItem[];
  recentCount?: number;
}

// Cross-project document card props (presentational)
export interface CrossProjectDocumentCardProps {
  id: string;
  title: string;
  categoryName: string | null;
  categoryColor: string | null;
  wordCount: number | null;
  isPinned: boolean | null;
  updatedAt: Date;
  onClick: () => void;
}

// Cross-project group props (presentational)
export interface CrossProjectGroupProps {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  documents: CrossProjectDocumentItem[];
  isExpanded: boolean;
  onToggle: () => void;
  onDocumentClick: (docId: string) => void;
  recentCount?: number;
}

// Cross-project documents view props (presentational)
export interface CrossProjectDocumentsProps {
  groups: CrossProjectDocumentGroup[];
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categories: DocumentCategoryWithCount[];
  activeCategoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  expandedGroups: Set<string>;
  onToggleGroup: (groupKey: string) => void;
  onDocumentClick: (docId: string) => void;
}

// Document version (from document_versions table)
export interface DocumentVersion {
  id: string;
  documentId: string;
  contentHash: string;
  s3Key: string;
  commitSha: string | null;
  createdAt: string;
}

// Version history component props (presentational)
export interface DocumentVersionHistoryProps {
  versions: DocumentVersion[];
  selectedVersionHash: string | null;
  onSelectVersion: (version: DocumentVersion) => void;
  isLoading: boolean;
}

// Version banner props (shown when viewing a historical version)
export interface DocumentVersionBannerProps {
  version: DocumentVersion;
  isLoadingContent: boolean;
  onBackToLatest: () => void;
}

// Component props
export interface DocumentListItemProps {
  id: string;
  title: string;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  projectName: string | null;
  projectColor: string | null;
  updatedAt: Date;
  wordCount: number | null;
  isSelected: boolean;
  onClick: () => void;
}

export interface DocumentContentViewProps {
  content: string;
  components?: Record<string, React.ComponentType<Record<string, unknown>>>;
}

export interface DocumentEditorProps {
  content: string;
  onChange: (content: string) => void;
}

export interface DocumentMetadataBarProps {
  title: string;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  projectName: string | null;
  projectColor: string | null;
  wordCount: number | null;
  sizeBytes: number | null;
  updatedAt: Date;
  isPinned: boolean | null;
  isEditing: boolean;
  projects: ProjectOption[];
  currentProjectId: string | null;
  onChangeProject: (projectId: string | null) => void;
  onToggleEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export interface DocumentSidebarFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
  projects: ProjectOption[];
  activeProjectFilter: string | null;
  onProjectFilterChange: (projectFilter: string | null) => void;
  searchDropdownContent?: React.ReactNode;
}

export interface DocumentSearchDropdownProps {
  results: DocumentSearchResult[];
  isLoading: boolean;
  selectedIndex: number;
  total: number;
  showTypeToSearch: boolean;
  onSelectResult: (documentId: string) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

export interface CategoryChipProps {
  name: string;
  color: string;
  icon?: string | null;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}

export interface CreateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: DocumentCategoryWithCount[];
  projects: ProjectOption[];
  onSubmit: (data: CreateDocumentRequest) => void;
  isPending: boolean;
}

// Favorite document (from /documents/favorites endpoint)
export interface FavoriteDocument {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  wordCount: number | null;
  isPinned: boolean | null;
  updatedAt: Date;
  favoritedAt: Date;
}

// Favorite documents sidebar section props (presentational)
export interface FavoriteDocumentsSectionProps {
  favorites: FavoriteDocument[];
  selectedDocumentId: string | null;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectDocument: (documentId: string) => void;
  onRemoveFavorite: (documentId: string) => void;
}

// Document tree node types

export interface DocumentTreeFile {
  type: "file";
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  updatedAt: Date;
  wordCount: number | null;
  isRecent: boolean;
  isRead: boolean;
  isFavorited: boolean;
}

export interface DocumentTreeFolder {
  type: "folder";
  id: string;
  name: string;
  color: string;
  icon: string | null;
  depth: number;
  totalDocumentCount: number;
  recentCount: number;
  unreadCount: number;
  children: DocumentTreeNode[];
}

export type DocumentTreeNode = DocumentTreeFolder | DocumentTreeFile;

// Document tree sidebar props (presentational)
export interface DocumentTreeSidebarProps {
  tree: DocumentTreeNode[];
  selectedDocumentId: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;
  onSelectDocument: (documentId: string) => void;
  onToggleFavorite: (documentId: string) => void;
  isLoading: boolean;
}

// Document viewer types

export interface DocumentViewerProps {
  title: string;
  content: string;
  updatedAt: Date;
  categoryName: string | null;
  categoryColor: string | null;
  projectName: string | null;
  projectColor: string | null;
  wordCount: number | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  components?: Record<string, React.ComponentType<Record<string, unknown>>>;
}

export interface DocumentViewerData {
  document: DocumentWithCategory | null;
  isLoading: boolean;
  error: string | null;
}
