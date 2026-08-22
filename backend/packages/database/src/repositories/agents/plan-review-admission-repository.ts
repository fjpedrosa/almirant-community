import { db, type Database } from "../../client";
import { agentJobs, planReviewAdmissions, planningSessions } from "../../schema";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { createJob, type CreateAgentJobInput } from "./agent-job-repository";
import type { PlanReviewJobSnapshotV2 } from "@almirant/shared";

export type PlanReviewAdmissionTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AdmitPlanReviewInput = {
  workspaceId: string;
  planningSessionId: string;
  requestedByUserId: string;
  projectId: string;
  boardId: string;
  boardColumnId: string;
  planSha256: string;
  snapshot: PlanReviewJobSnapshotV2;
  reviewJobId: string;
  job: Omit<CreateAgentJobInput, "id">;
  onCreated?: (
    tx: PlanReviewAdmissionTransaction,
    admission: typeof planReviewAdmissions.$inferSelect,
  ) => Promise<{ status: "completed" | "rejected" | "failed"; result: Record<string, unknown> }>;
};

export const PLAN_REVIEW_SESSION_NOT_ACTIVE_ERROR =
  "PLAN_REVIEW_SESSION_NOT_ACTIVE_OR_MISMATCHED";

export const PLAN_REVIEW_APPLICATION_LEASE_MS = 5 * 60 * 1000;

export type ClaimedPlanReviewAdmission = {
  admission: typeof planReviewAdmissions.$inferSelect;
  leaseId: string;
};

export const admitPlanReviewWithJob = async (
  input: AdmitPlanReviewInput,
): Promise<{ admission: typeof planReviewAdmissions.$inferSelect; created: boolean }> =>
  db.transaction(async (tx) => {
    const [planningSession] = await tx
      .select({
        id: planningSessions.id,
      })
      .from(planningSessions)
      .where(and(
        eq(planningSessions.id, input.planningSessionId),
        eq(planningSessions.workspaceId, input.workspaceId),
        eq(planningSessions.projectId, input.projectId),
        eq(planningSessions.boardId, input.boardId),
        eq(planningSessions.status, "active"),
      ))
      .limit(1)
      .for("update");

    if (!planningSession) {
      throw new Error(PLAN_REVIEW_SESSION_NOT_ACTIVE_ERROR);
    }

    await createJob({ ...input.job, id: input.reviewJobId }, { executor: tx });

    const [inserted] = await tx
      .insert(planReviewAdmissions)
      .values({
        id: input.reviewJobId,
        workspaceId: input.workspaceId,
        planningSessionId: input.planningSessionId,
        requestedByUserId: input.requestedByUserId,
        reviewJobId: input.reviewJobId,
        projectId: input.projectId,
        boardId: input.boardId,
        boardColumnId: input.boardColumnId,
        planSha256: input.planSha256,
        snapshot: input.snapshot,
        status: "queued",
      })
      .onConflictDoNothing({ target: [
        planReviewAdmissions.workspaceId,
        planReviewAdmissions.planningSessionId,
        planReviewAdmissions.planSha256,
      ] })
      .returning();

    if (!inserted) {
      const [existing] = await tx
        .select()
        .from(planReviewAdmissions)
        .where(and(
          eq(planReviewAdmissions.workspaceId, input.workspaceId),
          eq(planReviewAdmissions.planningSessionId, input.planningSessionId),
          eq(planReviewAdmissions.planSha256, input.planSha256),
        ))
        .limit(1);
      if (!existing) throw new Error("Plan review admission disappeared after duplicate detection");
      await tx.delete(agentJobs).where(eq(agentJobs.id, input.reviewJobId));
      return { admission: existing, created: false };
    }

    if (!input.onCreated) return { admission: inserted, created: true };

    const terminal = await input.onCreated(tx, inserted);
    const [updated] = await tx
      .update(planReviewAdmissions)
      .set({ status: terminal.status, result: terminal.result, updatedAt: new Date() })
      .where(eq(planReviewAdmissions.id, inserted.id))
      .returning();
    if (!updated) throw new Error("Plan review admission disappeared during terminal application");
    return { admission: updated, created: true };
  });

export const getPlanReviewAdmissionByJobId = async (
  reviewJobId: string,
  workspaceId?: string,
): Promise<typeof planReviewAdmissions.$inferSelect | null> => {
  const [admission] = await db
    .select()
    .from(planReviewAdmissions)
    .where(and(
      eq(planReviewAdmissions.reviewJobId, reviewJobId),
      ...(workspaceId ? [eq(planReviewAdmissions.workspaceId, workspaceId)] : []),
    ))
    .limit(1);
  return admission ?? null;
};

export const getPlanReviewAdmissionByPlan = async (
  workspaceId: string,
  planningSessionId: string,
  planSha256: string,
): Promise<typeof planReviewAdmissions.$inferSelect | null> => {
  const [admission] = await db
    .select()
    .from(planReviewAdmissions)
    .where(and(
      eq(planReviewAdmissions.workspaceId, workspaceId),
      eq(planReviewAdmissions.planningSessionId, planningSessionId),
      eq(planReviewAdmissions.planSha256, planSha256),
    ))
    .limit(1);
  return admission ?? null;
};

export const getLatestPlanReviewAdmissionBySession = async (
  workspaceId: string,
  planningSessionId: string,
): Promise<typeof planReviewAdmissions.$inferSelect | null> => {
  const [admission] = await db
    .select()
    .from(planReviewAdmissions)
    .where(and(
      eq(planReviewAdmissions.workspaceId, workspaceId),
      eq(planReviewAdmissions.planningSessionId, planningSessionId),
    ))
    .orderBy(desc(planReviewAdmissions.updatedAt), desc(planReviewAdmissions.createdAt))
    .limit(1);
  return admission ?? null;
};

export const claimPlanReviewAdmissionForApplication = async (
  reviewJobId: string,
  now = new Date(),
  leaseDurationMs = PLAN_REVIEW_APPLICATION_LEASE_MS,
): Promise<ClaimedPlanReviewAdmission | null> => {
  const leaseId = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const [claimed] = await db
    .update(planReviewAdmissions)
    .set({
      status: "applying",
      applicationLeaseId: leaseId,
      applicationLeaseAcquiredAt: now,
      applicationLeaseExpiresAt: leaseExpiresAt,
      updatedAt: now,
    })
    .where(and(
      eq(planReviewAdmissions.reviewJobId, reviewJobId),
      or(
        eq(planReviewAdmissions.status, "queued"),
        and(
          eq(planReviewAdmissions.status, "applying"),
          or(isNull(planReviewAdmissions.applicationLeaseExpiresAt), lte(planReviewAdmissions.applicationLeaseExpiresAt, now)),
        ),
      ),
    ))
    .returning();
  return claimed ? { admission: claimed, leaseId } : null;
};

export const terminalizeInvalidPlanReviewAdmission = async (
  reviewJobId: string,
  result: Record<string, unknown>,
  executor: Pick<Database, "update"> = db,
): Promise<typeof planReviewAdmissions.$inferSelect | null> => {
  const [updated] = await executor
    .update(planReviewAdmissions)
    .set({
      status: "failed",
      result,
      applicationLeaseId: null,
      applicationLeaseAcquiredAt: null,
      applicationLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(planReviewAdmissions.reviewJobId, reviewJobId),
      or(eq(planReviewAdmissions.status, "queued"), eq(planReviewAdmissions.status, "applying")),
    ))
    .returning();
  return updated ?? null;
};

export const findExpiredPlanReviewApplicationLeases = async (
  now = new Date(),
  limit = 25,
): Promise<Array<{ reviewJobId: string }>> => db
  .select({ reviewJobId: planReviewAdmissions.reviewJobId })
  .from(planReviewAdmissions)
  .where(and(
    eq(planReviewAdmissions.status, "applying"),
    or(isNull(planReviewAdmissions.applicationLeaseExpiresAt), lte(planReviewAdmissions.applicationLeaseExpiresAt, now)),
  ))
  .orderBy(planReviewAdmissions.updatedAt, planReviewAdmissions.reviewJobId)
  .limit(Math.max(1, Math.min(100, Math.floor(limit))));

export const finishPlanReviewAdmission = async (
  reviewJobId: string,
  leaseId: string,
  status: "completed" | "rejected" | "failed",
  result: Record<string, unknown>,
  executor: Pick<Database, "update"> = db,
): Promise<typeof planReviewAdmissions.$inferSelect | null> => {
  const [updated] = await executor
    .update(planReviewAdmissions)
    .set({
      status,
      result,
      applicationLeaseId: null,
      applicationLeaseAcquiredAt: null,
      applicationLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(planReviewAdmissions.reviewJobId, reviewJobId),
      eq(planReviewAdmissions.status, "applying"),
      eq(planReviewAdmissions.applicationLeaseId, leaseId),
    ))
    .returning();
  return updated ?? null;
};
