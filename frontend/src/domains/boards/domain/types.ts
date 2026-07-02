// Board area
export type BoardArea = "desarrollo" | "ventas" | "prospeccion" | "marketing" | "general";
export type BoardAllowedWorkItemType = "epic" | "feature" | "story" | "task" | "idea";
export type ColumnRole = "backlog" | "todo" | "in_progress" | "review" | "testing" | "needs_fix" | "validating" | "release" | "to_document" | "done" | "other";

// Board entity
export interface Board {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  area: BoardArea;
  isDefault: boolean;
  // Null/empty means "allow all" for backward compatibility.
  allowedTypes?: BoardAllowedWorkItemType[] | null;
  createdAt: Date;
  updatedAt: Date;
}

// Board with columns
export interface BoardWithColumns extends Board {
  columns: BoardColumn[];
}

// Board with stats
export interface BoardWithStats extends Board {
  columns: BoardColumn[];
  totalItems: number;
}

// Board column
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

// Board template
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

// Create board request
export interface CreateBoardRequest {
  name: string;
  description?: string;
  area?: BoardArea;
  isDefault?: boolean;
  allowedTypes?: BoardAllowedWorkItemType[] | null;
}

// Update board request
export interface UpdateBoardRequest {
  name?: string;
  description?: string | null;
  area?: BoardArea;
  isDefault?: boolean;
  allowedTypes?: BoardAllowedWorkItemType[] | null;
}

// Create column request
export interface CreateColumnRequest {
  name: string;
  color?: string;
  order?: number;
  isDone?: boolean;
  role?: ColumnRole;
}

// Update column request
export interface UpdateColumnRequest {
  name?: string;
  color?: string;
  order?: number;
  isDone?: boolean;
  role?: ColumnRole;
}

// Reorder columns request
export interface ReorderColumnsRequest {
  columnIds: string[];
}

// Create board from template request
export interface CreateBoardFromTemplateRequest {
  templateId: string;
  name?: string;
}

export interface BoardSelectorProps {
  boards: BoardWithStats[];
  activeBoardId: string;
  onBoardSelect: (boardId: string) => void;
}

export interface BoardAreaGroupProps {
  areaLabel: string;
  boards: BoardWithStats[];
}

export interface BoardAreaContainerProps {
  area: string;
}

// Settings components props
export interface BoardSettingsCardProps {
  board: BoardWithStats;
  onEdit: (board: BoardWithStats) => void;
  onDelete: (board: BoardWithStats) => void;
  onManageColumns: (board: BoardWithStats) => void;
}

export interface BoardsSettingsListProps {
  boards: BoardWithStats[];
  selectedArea: BoardArea | "all";
  searchQuery: string;
  onAreaChange: (area: BoardArea | "all") => void;
  onSearchChange: (query: string) => void;
  onEditBoard: (board: BoardWithStats) => void;
  onDeleteBoard: (board: BoardWithStats) => void;
  onManageColumns: (board: BoardWithStats) => void;
  onCreateBoard: () => void;
}

export interface CreateBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: BoardTemplate[];
  onCreateFromScratch: (data: CreateBoardRequest) => void;
  onCreateFromTemplate: (data: CreateBoardFromTemplateRequest) => void;
  isLoading: boolean;
}

export interface EditBoardFormProps {
  board: BoardWithStats;
  onSave: (data: UpdateBoardRequest) => void;
  isLoading: boolean;
}

export interface ColumnManagementSectionProps {
  columns: BoardColumn[];
  onAddColumn: (data: { name: string; color: string; isDone?: boolean }) => void;
  onUpdateColumn: (id: string, data: { name?: string; color?: string; isDone?: boolean }) => void;
  onDeleteColumn: (id: string) => void;
  onReorderColumns: (columnIds: string[]) => void;
  isLoading: boolean;
}

export interface ColumnRowProps {
  column: BoardColumn;
  onUpdate: (data: { name?: string; color?: string; isDone?: boolean }) => void;
  onDelete: () => void;
  dragHandleProps?: Record<string, unknown>;
}

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export interface DeleteBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: BoardWithStats | null;
  onConfirm: () => void;
  isLoading: boolean;
}

export interface BoardCardProps {
  board: BoardWithStats;
}

export interface EmptyBoardsStateProps {
  onCreateBoard: () => void;
}

export interface BoardAllowedTypesConfigProps {
  allowedTypes: BoardAllowedWorkItemType[] | null;
  onChange: (types: BoardAllowedWorkItemType[]) => void;
}
