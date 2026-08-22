import {
  findExpiredPlanReviewApplicationLeases,
  getJobById,
  terminalizeInvalidPlanReviewAdmission,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { buildInvalidPlanReviewStoredResult } from "@almirant/shared";
import { applyPlanReviewTerminalJob } from "../../ai/chat/services/plan-review-completion";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 25;

export type PlanReviewAdmissionRecoveryOptions = { intervalMs?: number; batchSize?: number };

export type PlanReviewAdmissionRecoveryDependencies = {
  findExpiredPlanReviewApplicationLeases: typeof findExpiredPlanReviewApplicationLeases;
  getJobById: typeof getJobById;
  terminalizeInvalidPlanReviewAdmission: typeof terminalizeInvalidPlanReviewAdmission;
  applyPlanReviewTerminalJob: typeof applyPlanReviewTerminalJob;
};

const defaultPlanReviewAdmissionRecoveryDependencies: PlanReviewAdmissionRecoveryDependencies = {
  findExpiredPlanReviewApplicationLeases,
  getJobById,
  terminalizeInvalidPlanReviewAdmission,
  applyPlanReviewTerminalJob,
};

export const recoverExpiredPlanReviewAdmissionsOnce = async (options?: {
  now?: Date;
  batchSize?: number;
}, dependencies: PlanReviewAdmissionRecoveryDependencies = defaultPlanReviewAdmissionRecoveryDependencies): Promise<{ scanned: number; recovered: number }> => {
  const candidates = await dependencies.findExpiredPlanReviewApplicationLeases(options?.now, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  let recovered = 0;
  for (const candidate of candidates) {
    const detail = await dependencies.getJobById(candidate.reviewJobId);
    if (!detail) {
      await dependencies.terminalizeInvalidPlanReviewAdmission(candidate.reviewJobId, buildInvalidPlanReviewStoredResult());
      recovered += 1;
      continue;
    }
    if (!["completed", "incomplete", "failed", "cancelled"].includes(detail.job.status)) continue;
    await dependencies.applyPlanReviewTerminalJob({
      id: detail.job.id,
      status: detail.job.status,
      config: detail.job.config,
      result: detail.job.result,
    });
    recovered += 1;
  }
  return { scanned: candidates.length, recovered };
};

export const startPlanReviewAdmissionRecovery = (options?: PlanReviewAdmissionRecoveryOptions): (() => void) => {
  const intervalMs = Math.max(1_000, options?.intervalMs ?? DEFAULT_INTERVAL_MS);
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await recoverExpiredPlanReviewAdmissionsOnce({ batchSize });
      if (result.recovered > 0) logger.info(result, "Plan-review admission recovery replayed expired leases");
    } catch (error) {
      logger.error({ error }, "Plan-review admission recovery tick failed");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 5_000);
  timer = setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
};
