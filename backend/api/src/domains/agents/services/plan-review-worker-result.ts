import {
  buildInvalidPlanReviewStoredResult,
  planReviewJobSnapshotSchema,
  sanitizePlanReviewJobResult,
} from "@almirant/shared";

export type PlanReviewWorkerResultInput = {
  config: unknown;
  result: unknown;
  resultProvided: boolean;
  status: string;
};

export const sanitizePlanReviewTerminalResult = ({
  config,
  result,
  resultProvided,
  status,
}: PlanReviewWorkerResultInput): Record<string, unknown> | null => {
  const record = typeof config === "object" && config !== null && !Array.isArray(config)
    ? config as Record<string, unknown>
    : null;
  const hasPlanReviewConfig = record?.planReview !== undefined;
  if (!hasPlanReviewConfig) return null;

  const snapshot = planReviewJobSnapshotSchema.safeParse(record?.planReview);
  if (!snapshot.success) return buildInvalidPlanReviewStoredResult();

  const shouldStore = resultProvided || ["completed", "incomplete", "failed", "cancelled"].includes(status);
  return shouldStore ? sanitizePlanReviewJobResult(result, snapshot.data).storedResult : null;
};
