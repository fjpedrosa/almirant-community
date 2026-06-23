import type { ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";

export type MilestoneStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "on_hold"
  | "cancelled";

export type MilestonePriority = "low" | "medium" | "high" | "urgent";

export type MilestoneWorkItemType = "epic" | "feature" | "story" | "task" | "idea";

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  priority: MilestonePriority;
  targetDate: string | null;
  completedAt: string | null;
  createdByUserId: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneWorkItem {
  id: string;
  taskId: string | null;
  title: string;
  type: MilestoneWorkItemType;
  priority: MilestonePriority;
  boardColumnId: string;
  boardColumnName: string;
  isDone: boolean;
  assignee: string | null;
}

export interface MilestoneWithProgress extends Milestone {
  totalItems: number;
  completedItems: number;
  progress: number;
  workItems?: MilestoneWorkItem[];
}

export interface CreateMilestoneRequest {
  projectId: string;
  title: string;
  description?: string | null;
  priority: MilestonePriority;
  targetDate: string;
  workItemIds?: string[];
}

export interface UpdateMilestoneRequest {
  title?: string;
  description?: string | null;
  status?: MilestoneStatus;
  priority?: MilestonePriority;
  targetDate?: string | null;
  completedAt?: string | null;
}

export interface GoalProjectOption {
  id: string;
  name: string;
  color: string;
}

export interface GoalsPageProps {
  projects: GoalProjectOption[];
  selectedProjectId: string | null;
  selectedMilestoneId: string | null;
  onProjectChange: (projectId: string) => void;
  milestones: MilestoneWithProgress[];
  selectedMilestone: MilestoneWithProgress | null;
  isLoadingProjects: boolean;
  isLoadingMilestones: boolean;
  isLoadingMilestoneDetail: boolean;
  onCreateMilestone: () => void;
  onEditMilestone: (milestone: MilestoneWithProgress) => void;
  onSelectMilestone: (milestoneId: string) => void;
  onOpenWorkItem: (workItemId: string) => void;
  formDialog: ReactNode;
}

export interface MilestoneProgressProps {
  percentage: number;
  targetDate: string | null;
}

export interface GoalMetricsProps {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  daysRemaining: number | null;
}

export interface MilestoneChecklistProps {
  items: MilestoneWorkItem[];
  onOpenWorkItem?: (workItemId: string) => void;
}

export interface MilestoneFormValues {
  title: string;
  description: string;
  targetDate: string;
  priority: MilestonePriority;
  workItemIds: string[];
}

export interface MilestoneWorkItemOption {
  id: string;
  taskId: string | null;
  title: string;
  type: MilestoneWorkItemType;
  priority: MilestonePriority;
}

export interface MilestoneCardProps {
  milestone: MilestoneWithProgress;
  isSelected: boolean;
  onSelect: (milestoneId: string) => void;
  onEdit: (milestone: MilestoneWithProgress) => void;
}

export interface MilestoneDetailViewProps {
  milestone: MilestoneWithProgress | null;
  isLoading?: boolean;
  onEditMilestone: (milestone: MilestoneWithProgress) => void;
  onOpenWorkItem: (workItemId: string) => void;
}

export type MilestoneFormMode = "create" | "edit";

export interface MilestoneFormDialogProps {
  isOpen: boolean;
  mode: MilestoneFormMode;
  form: UseFormReturn<MilestoneFormValues>;
  isPending: boolean;
  isLoadingWorkItems: boolean;
  availableWorkItems: MilestoneWorkItemOption[];
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}

export interface RadialProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export type GoalLaunchBlock = "A" | "B" | "C";

export type GoalLaunchStatus =
  | "planned"
  | "in_progress"
  | "blocked"
  | "completed";

export type GoalRiskLevel = "low" | "medium" | "high";

export interface GoalReadinessArea {
  id: string;
  title: string;
  progress: number;
  note: string;
}

export interface GoalLaunchTodoItem {
  id: string;
  title: string;
  description: string;
  block: GoalLaunchBlock;
  requiredForLaunch: boolean;
  weight: number;
  status: GoalLaunchStatus;
  progress: number;
  risk: GoalRiskLevel;
  targetDate: string;
}

export interface GoalMeetingDataset {
  goalTitle: string;
  goalDescription: string;
  startDate: string;
  targetDate: string;
  lastUpdated: string;
  successCriteria: string[];
  measurementNotes: string[];
  readinessAreas: GoalReadinessArea[];
  todoItems: GoalLaunchTodoItem[];
}

export interface GoalReadinessByBlock {
  block: GoalLaunchBlock;
  label: string;
  progress: number;
  totalWeight: number;
}

export interface GoalsMeetingPageProps {
  goalTitle: string;
  goalDescription: string;
  startDate: string;
  targetDate: string;
  lastUpdated: string;
  successCriteria: string[];
  measurementNotes: string[];
  readinessAreas: GoalReadinessArea[];
  todoItems: GoalLaunchTodoItem[];
  requiredItems: GoalLaunchTodoItem[];
  optionalItems: GoalLaunchTodoItem[];
  readinessByBlock: GoalReadinessByBlock[];
  launchProgress: number;
  expectedProgress: number;
  progressDelta: number;
  daysRemaining: number;
  blockedItems: number;
  highRiskItems: number;
  projectedFinishDate: string | null;
  healthLabel: string;
}
