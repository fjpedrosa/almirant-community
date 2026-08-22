import {
  claimPlanReviewAdmissionForApplication,
  db,
  finishPlanReviewAdmission,
  getPlanReviewAdmissionByJobId,
  terminalizeInvalidPlanReviewAdmission,
  type AgentJobConfig,
} from "@almirant/database";
import {
  buildInvalidPlanReviewStoredResult,
  planReviewJobSnapshotSchema,
  sanitizePlanReviewJobResult,
  type PlanReviewJobSnapshotV2,
} from "@almirant/shared";
import { aiWorkItemsPayloadSchema, generateWorkItems } from "../../shared/services/work-item-generator";

type TerminalPlanReviewJob = {
  id: string;
  status: string;
  config?: AgentJobConfig | Record<string, unknown> | null;
  result?: unknown;
};

export type PlanReviewCompletionDependencies = {
  claimPlanReviewAdmissionForApplication: typeof claimPlanReviewAdmissionForApplication;
  db: typeof db;
  finishPlanReviewAdmission: typeof finishPlanReviewAdmission;
  getPlanReviewAdmissionByJobId: typeof getPlanReviewAdmissionByJobId;
  terminalizeInvalidPlanReviewAdmission: typeof terminalizeInvalidPlanReviewAdmission;
  generateWorkItems: typeof generateWorkItems;
};

const defaultPlanReviewCompletionDependencies: PlanReviewCompletionDependencies = {
  claimPlanReviewAdmissionForApplication,
  db,
  finishPlanReviewAdmission,
  getPlanReviewAdmissionByJobId,
  terminalizeInvalidPlanReviewAdmission,
  generateWorkItems,
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const readSnapshot = (config: TerminalPlanReviewJob["config"]): PlanReviewJobSnapshotV2 | null => {
  const parsed = planReviewJobSnapshotSchema.safeParse(asRecord(config)?.planReview);
  return parsed.success ? parsed.data : null;
};

/** Applies one terminal plan-review result using a durable application lease. */
export const applyPlanReviewTerminalJob = async (
  job: TerminalPlanReviewJob,
  dependencies: PlanReviewCompletionDependencies = defaultPlanReviewCompletionDependencies,
): Promise<void> => {
  const snapshot = readSnapshot(job.config);
  if (!snapshot) {
    await dependencies.terminalizeInvalidPlanReviewAdmission(job.id, buildInvalidPlanReviewStoredResult());
    return;
  }

  const admission = await dependencies.getPlanReviewAdmissionByJobId(job.id);
  if (!admission) return;
  const claimed = await dependencies.claimPlanReviewAdmissionForApplication(job.id);
  if (!claimed) return;
  const { admission: claimedAdmission, leaseId } = claimed;

  if (job.status !== "completed") {
    await dependencies.finishPlanReviewAdmission(job.id, leaseId, "failed", {
      outcome: "not_completed",
      reason: `Plan review job ended with status ${job.status}.`,
    });
    return;
  }

  try {
    const { output } = sanitizePlanReviewJobResult(job.result, snapshot);
    if (!output) {
      const finished = await dependencies.finishPlanReviewAdmission(job.id, leaseId, "failed", {
        outcome: "not_completed",
        reason: "Plan review result was invalid or could not be validated.",
      });
      if (!finished) throw new Error("Plan review application lease was lost.");
      return;
    }

    if (output.outcome === "reject" || output.outcome === "not_completed") {
      const finished = await dependencies.finishPlanReviewAdmission(job.id, leaseId, "rejected", output as unknown as Record<string, unknown>);
      if (!finished) throw new Error("Plan review application lease was lost.");
      return;
    }

    const canonicalPlan = JSON.parse(output.finalPlan.content) as Record<string, unknown>;
    const payload = aiWorkItemsPayloadSchema.parse({
      items: canonicalPlan.items,
      dependencies: canonicalPlan.dependencies ?? [],
    });
    await dependencies.db.transaction(async (tx) => {
      const generated = await dependencies.generateWorkItems({
        workspaceId: claimedAdmission.workspaceId,
        items: payload.items,
        dependencies: payload.dependencies,
        projectId: claimedAdmission.projectId,
        boardId: claimedAdmission.boardId,
        boardColumnId: claimedAdmission.boardColumnId,
        atomic: true,
        executor: tx,
      });
      if (generated.errors.length > 0 || generated.dependencyErrors.length > 0) {
        throw new Error("Approved plan could not be applied completely.");
      }
      const finished = await dependencies.finishPlanReviewAdmission(job.id, leaseId, "completed", { output, generated }, tx);
      if (!finished) throw new Error("Plan review application lease was lost.");
    });
  } catch (error) {
    await dependencies.finishPlanReviewAdmission(job.id, leaseId, "failed", {
      outcome: "not_completed",
      reason: error instanceof Error && error.message.includes("sensitive")
        ? "Plan review result contained rejected sensitive material."
        : "Plan review result was invalid or could not be applied.",
    });
  }
};
