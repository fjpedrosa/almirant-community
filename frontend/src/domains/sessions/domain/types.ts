import type {
  AgentProvider,
  AgentJobConfig,
  AgentJobResult,
  AgentJobStatus,
  AgentJobType,
} from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type { PaginationMeta, AgentLogChunk } from "@/domains/shared/domain/types";

export type AgentJobTriggerType = "event" | "scheduled" | "recovery";

export interface AgentSessionListItem {
  id: string;
  workItemId: string | null;
  projectId: string | null;
  boardId: string | null;
  planningSessionId?: string | null;
  jobType?: AgentJobType;
  status: AgentJobStatus;
  provider: AgentProvider;
  codingAgent?: CodingAgent | null;
  model?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  cost: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  errorType?: string | null;
  availableAt?: string | null;
  sessionId?: string | null;
  config?: AgentJobConfig;
  result?: AgentJobResult | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt?: string | null;
  workItemTitle?: string | null;
  workItemTaskId?: string | null;
  projectName?: string | null;
  boardName?: string | null;
  planningSessionTitle?: string | null;
  feedbackItemTitle?: string | null;
  triggerType?: AgentJobTriggerType | null;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  createdByUserImage?: string | null;
  requestedByUserName?: string | null;
  requestedByUserImage?: string | null;
}

export interface AgentSessionDetail {
  job: AgentSessionListItem;
  workItem: {
    id: string;
    taskId: string | null;
    title: string;
    boardId: string | null;
    boardColumnId: string | null;
  } | null;
  project: {
    id: string;
    name: string;
  } | null;
  board: {
    id: string;
    name: string;
    area: string;
  } | null;
  planningSession: {
    id: string;
    title: string;
  } | null;
  createdByUser: {
    id: string;
    name: string;
    image: string | null;
  } | null;
}

export interface AgentSessionOutput {
  jobId: string;
  sessionId: string | null;
  status: AgentJobStatus;
  chunks: AgentLogChunk[];
  text: string;
  nextCursor: number | null;
  hasMore: boolean;
  lastSeq: number | null;
}

export interface SessionEventRecord {
  id: string;
  agentJobId: string;
  planningSessionId?: string | null;
  sequenceNum: number;
  kind: string;
  payload: Record<string, unknown>;
  provider?: string | null;
  createdAt: string;
}

export interface SessionsListFilters {
  projectId?: string;
  status?: AgentJobStatus;
  jobType?: AgentJobType;
  taskId?: string;
  page: number;
  limit: number;
}

export interface PaginatedSessionsResponse {
  items: AgentSessionListItem[];
  meta: PaginationMeta;
}

export interface TranscriptSegment {
  contentType: "thinking" | "text" | "tool_use";
  content: string;
}

export type TimelinePhaseStatus = "done" | "active" | "pending";

export interface TimelinePhase {
  id: string;
  label: string;
  status: TimelinePhaseStatus;
  startedAt: string | null;
  eventCount: number;
  details?: string[];
}
