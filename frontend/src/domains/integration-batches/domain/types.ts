export type IntegrationBatchStatus =
  | "queued"
  | "running"
  | "awaiting_release"
  | "merging"
  | "completed"
  | "failed"
  | "aborted";

export type IntegrationBatchItemStatus =
  | "pending"
  | "rebasing"
  | "migrating"
  | "type_checking"
  | "testing"
  | "merged"
  | "skipped"
  | "failed";

export type IntegrationBatchItemFailureCategory =
  | "merge_conflict"
  | "schema_semantic"
  | "schema_obsolete_branch"
  | "schema_irreconcilable"
  | "migration_apply_failed"
  | "type_check_failed"
  | "tests_failed";

export interface IntegrationBatchItem {
  id: string;
  batchId: string;
  workItemId: string;
  prNumber: number | null;
  prUrl: string | null;
  branchName: string | null;
  processingOrder: number;
  status: IntegrationBatchItemStatus;
  failureCategory: IntegrationBatchItemFailureCategory | null;
  failureReason: string | null;
  commitShaBefore: string | null;
  commitShaAfter: string | null;
  migrationRegenerated: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export interface IntegrationBatch {
  id: string;
  organizationId: string;
  projectId: string;
  repositoryId: string;
  boardId: string | null;
  integrationBranch: string;
  baseBranch: string;
  status: IntegrationBatchStatus;
  triggeredByUserId: string | null;
  currentItemIndex: number;
  sandboxContainerId: string | null;
  finalPrUrl: string | null;
  finalPrNumber: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationBatchWithItems extends IntegrationBatch {
  items: IntegrationBatchItem[];
}

export interface CreateIntegrationBatchRequest {
  projectId: string;
  repositoryId: string;
  workItemIds: string[];
  boardId?: string;
  baseBranch?: string;
}

export const ACTIVE_BATCH_STATUSES: IntegrationBatchStatus[] = [
  "queued",
  "running",
  "awaiting_release",
  "merging",
];

export const TERMINAL_BATCH_STATUSES: IntegrationBatchStatus[] = [
  "completed",
  "failed",
  "aborted",
];

export const isBatchActive = (status: IntegrationBatchStatus): boolean =>
  ACTIVE_BATCH_STATUSES.includes(status);
