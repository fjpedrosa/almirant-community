// Skill source type
export type SkillSource = "official" | "custom" | "repo";

// Skill entity
export interface Skill {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  name: string;
  slug: string;
  description: string | null;
  content: string;
  contentHash: string;
  sizeBytes: number;
  source: SkillSource;
  sourcePath: string | null;
  version: number;
  archivedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Lightweight skill item for selectors/dropdowns
export interface SkillSelectorItem {
  id: string;
  name: string;
  slug: string;
  source: SkillSource;
  description: string | null;
}

// Create skill request
export interface CreateSkillRequest {
  name: string;
  description?: string;
  content: string;
  projectId?: string;
  source?: SkillSource;
}

// Update skill request
export interface UpdateSkillRequest {
  name?: string;
  description?: string;
  content?: string;
  projectId?: string;
}

// Component prop types

export interface SkillsListProps {
  skills: Skill[];
  isLoading: boolean;
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onViewDetail: (skill: Skill) => void;
}

export interface SkillFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: Skill | null; // null = create mode
  isPending: boolean;
  onSubmit: (data: CreateSkillRequest | UpdateSkillRequest) => void;
}

export interface SkillDetailPanelProps {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface SkillSourceBadgeProps {
  source: SkillSource;
}

// Chat-based skill generation types

export type SkillChatMessageRole = "user" | "assistant";

export interface SkillChatMessage {
  id: string;
  role: SkillChatMessageRole;
  content: string;
  timestamp: Date;
}

export type SkillChatState = "idle" | "sending" | "generating" | "error";

export interface GeneratedSkill {
  name: string;
  description: string;
  content: string;
}

// SkillChatCreator component props
export interface SkillChatCreatorProps {
  messages: SkillChatMessage[];
  status: SkillChatState;
  generatedSkill: GeneratedSkill | null;
  error: string | null;
  onSendMessage: (content: string) => void;
  onReset: () => void;
  onClearError: () => void;
  onSaveSkill: (skill: GeneratedSkill) => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}
