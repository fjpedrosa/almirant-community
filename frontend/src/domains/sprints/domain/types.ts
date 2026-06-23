import type { WorkItemType, Priority } from "@/domains/work-items/domain/types";

// Sprint status
export type SprintStatus = "open" | "closed";

// Sprint entity
export interface Sprint {
  id: string;
  boardId: string;
  name: string;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Sprint with work item count
export interface SprintWithCount extends Sprint {
  workItemCount: number;
}

// Sprint work item detail (from junction table)
export interface SprintWorkItemDetail {
  id: string;
  workItemId: string;
  taskId: string | null;
  title: string;
  type: WorkItemType;
  priority: Priority;
  assignee: string | null;
  completedAt: string | null;
}

// Create sprint request
export interface CreateSprintRequest {
  name: string;
  startDate?: string;
  endDate?: string;
}

// Ancestor info for hierarchy grouping
export interface DoneItemAncestor {
  id: string;
  title: string;
  type: string;
}

// Done item preview (shown before closing sprint)
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

// Component props
export interface SprintHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSprint: SprintWithCount | null;
  closedSprints: SprintWithCount[];
  isLoading: boolean;
  expandedSprintId: string | null;
  onToggleExpand: (sprintId: string) => void;
  expandedSprintItems: SprintWorkItemDetail[];
  isLoadingItems: boolean;
  onCreateSprint: () => void;
  onCloseSprint: () => void;
  hasActiveSprint: boolean;
  onViewReport?: (sprintId: string) => void;
  expandedSprintSummary: SprintSummaryData | null;
  isLoadingSummary: boolean;
  area?: string;
  shareBannerSprintName?: string | null;
  onShareBannerAction?: () => void;
  onShareBannerDismiss?: () => void;
}

export interface SprintItemRowProps {
  title: string;
  type: WorkItemType;
  priority: Priority;
  assignee: string | null;
  completedAt: string | null;
}

export interface CreateSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateSprintRequest) => void;
  isPending: boolean;
  suggestedName: string;
}

// Date range for sprint close by date
export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

// Close by date range request
export interface CloseByDateRangeRequest {
  name: string;
  startDate: string;
  endDate: string;
}

export interface CloseSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name?: string) => void;
  onConfirmByDateRange: (data: CloseByDateRangeRequest) => void;
  isPending: boolean;
  doneItems: DoneItemPreview[];
  isLoadingPreview: boolean;
  isAdHoc: boolean;
  suggestedName: string;
  activeSprintName?: string;
  // Date range close props
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  dateRangeDoneItems: DoneItemPreview[];
  isLoadingDateRangePreview: boolean;
}

export interface SprintHistoryContainerProps {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area?: string;
}

// User contribution stats for sprint report
export interface UserSprintStats {
  userId: string;
  userName: string;
  userImage: string | null;
  tasksCreated: number;
  tasksCompleted: number;
  tasksAssigned: number;
}

// Sprint comparison data (from previous sprints for trends)
export interface SprintComparison {
  sprintId: string;
  sprintName: string;
  completedCount: number;
  carryoverCount: number;
  velocity: number;
  startDate: string | null;
  endDate: string | null;
  closedAt: string | null;
}

// Full sprint report data
export interface SprintReportData {
  sprint: SprintWithCount;
  completedTasks: {
    count: number;
    items: SprintWorkItemDetail[];
  };
  carryoverTasks: {
    count: number;
    items: SprintWorkItemDetail[];
  };
  velocity: number;
  averageTimePerTask: number;
  distributionByType: Record<string, number>;
  distributionByPriority: Record<string, number>;
  distributionByAssignee: { assignee: string | null; count: number }[];
  userStats?: UserSprintStats[];
  aiCost: {
    totalSessions: number;
    totalTokens: number;
    totalCost: number;
  };
  comparison: SprintComparison[];
  screenshots?: {
    total: number;
    groups: Array<{
      groupId: string;
      groupTaskId: string | null;
      groupTitle: string;
      groupType: WorkItemType;
      screenshots: Array<{
        workItemId: string;
        workItemTaskId: string | null;
        workItemTitle: string;
        imageUrl: string;
        caption: string;
      }>;
    }>;
    document: { id: string; title: string } | null;
  };
  changelog?: string;
}

// Sprint report component props
export interface SprintReportProps {
  report: SprintReportData;
  isLoading: boolean;
  onClose: () => void;
  fullReportHref?: string;
  onShareToX?: () => void;
  canShareToX?: boolean;
}

// Full-page sprint report component props
export interface SprintReportPageProps {
  report: SprintReportData;
  isLoading: boolean;
  backHref: string;
  onShareToX?: () => void;
  canShareToX?: boolean;
}

// Full-page sprint report container props
export interface SprintReportPageContainerProps {
  sprintId: string;
  area: string;
}

// Sprint report container props
export interface SprintReportContainerProps {
  sprintId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  area?: string;
  autoOpenShareOnLoad?: boolean;
}

// Inline sprint summary (lightweight metrics shown in history panel)
export interface SprintSummaryData {
  completedCount: number;
  velocity: number;
  aiCost: number;
}

export interface SprintSummaryInlineProps {
  summary: SprintSummaryData;
  isLoading: boolean;
}

export type SprintShareMode = "sprint" | "last7d";

export interface SprintShareSection {
  heading: string;
  summary: string;
  highlights: string[];
}

export interface SprintShareSource {
  mode: SprintShareMode;
  title: string;
  intro?: string;
  sections: SprintShareSection[];
  ctaText?: string;
  ctaUrl?: string;
  hashtags?: string[];
}

export interface SprintShareParseResult {
  title: string | null;
  sections: SprintShareSection[];
}

export interface SprintShareFormatInput {
  mode: SprintShareMode;
  title: string;
  intro?: string;
  sections: SprintShareSection[];
  ctaText?: string;
  ctaUrl?: string;
  hashtags?: string[];
  maxTweetLength?: number;
}

export interface SprintShareTweet {
  index: number;
  text: string;
  characterCount: number;
}

export interface SprintShareThreadDraft {
  mode: SprintShareMode;
  title: string;
  tweets: SprintShareTweet[];
  totalTweets: number;
}

export interface ShareToXDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SprintShareThreadDraft | null;
  isPreparing?: boolean;
  isCopying?: boolean;
  onCopyThread: () => void;
  onOpenIntent: () => void;
  isShareAvailable: boolean;
}
