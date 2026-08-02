import { db } from "../../client";
import { workerInteractions } from "../../schema";
import { agentJobs } from "../../schema";
import { and, asc, desc, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import { CLAIM_RECEIPT_CURRENT_JOB_STATUSES } from "./claim-sequence-receipt-repository";

export type CreateInteractionInput = {
  agentJobId: string;
  workItemId?: string | null;
  questionType: "clarification" | "approval" | "choice" | "free_text";
  questionText: string;
  questionContext?: Record<string, unknown> | null;
  options?: string[] | null;
  expiresAt: Date;
  timeoutAction?: string;
  defaultAnswer?: string | null;
};

export const createInteraction = async (
  input: CreateInteractionInput
): Promise<typeof workerInteractions.$inferSelect> => {
  const [created] = await db
    .insert(workerInteractions)
    .values({
      agentJobId: input.agentJobId,
      workItemId: input.workItemId ?? null,
      questionType: input.questionType,
      questionText: input.questionText,
      questionContext: input.questionContext ?? null,
      options: input.options ?? null,
      expiresAt: input.expiresAt,
      timeoutAction: input.timeoutAction ?? "fail",
      defaultAnswer: input.defaultAnswer ?? null,
      status: "pending",
    })
    .returning();

  if (!created) throw new Error("Failed to create worker interaction");
  return created;
};

export type CreateFencedJobInteractionInput = CreateInteractionInput & {
  workerId?: string;
  claimAttemptId?: string;
};

export type CreateFencedJobInteractionResult =
  | {
      outcome: "created";
      job: typeof agentJobs.$inferSelect;
      interaction: typeof workerInteractions.$inferSelect;
    }
  | {
      outcome: "not_found" | "claim_conflict";
    };

/**
 * Atomically transitions an exact active claim to `waiting_for_input` and
 * persists its interaction. Ownership is fenced the same way as the receipts
 * protocol's status-transition path: if a durable claim is active, the
 * request's `workerId`/`claimAttemptId` must match it exactly; if no claim is
 * active, the request must not carry one either. A job with a pending
 * terminal intent (cancel/fail requested but not yet applied) refuses new
 * interactions.
 *
 * Ported from cloud's `createFencedJobInteraction` with the site-build
 * execution-deadline fence removed: cloud locks `site_build_runs`/
 * `site_build_stages` rows correlated to the job before the update, applies
 * `siteBuildJobExecutionWindowPredicate()` inside the `UPDATE ... WHERE`, and
 * re-checks the window after the INSERT (rolling back with a
 * `deadline_exceeded` outcome if the window closed mid-transaction). None of
 * that exists in community — there is no `site_build_runs` table — so the
 * atomic `UPDATE ... WHERE` re-checking claim ownership + status +
 * `pendingTerminalIntent` is the only fence, and the outcome union has no
 * `deadline_exceeded` case.
 */
export const createFencedJobInteraction = async (
  input: CreateFencedJobInteractionInput,
): Promise<CreateFencedJobInteractionResult> => {
  return db.transaction(async (tx) => {
    const [lockedJob] = await tx
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.id, input.agentJobId))
      .for("update");
    if (!lockedJob) return { outcome: "not_found" as const };

    const currentClaimAttemptId =
      typeof lockedJob.config?.claimAttemptId === "string"
        ? lockedJob.config.claimAttemptId.trim()
        : "";
    const requestWorkerId = input.workerId?.trim() ?? "";
    const requestClaimAttemptId = input.claimAttemptId?.trim() ?? "";
    const hasCurrentClaim = currentClaimAttemptId.length > 0;
    const ownsCurrentClaim = hasCurrentClaim
      ? requestWorkerId.length > 0 &&
        requestClaimAttemptId === currentClaimAttemptId &&
        lockedJob.workerId === requestWorkerId
      : requestWorkerId.length === 0 && requestClaimAttemptId.length === 0;
    if (
      !ownsCurrentClaim ||
      !CLAIM_RECEIPT_CURRENT_JOB_STATUSES.includes(
        lockedJob.status as (typeof CLAIM_RECEIPT_CURRENT_JOB_STATUSES)[number],
      ) ||
      lockedJob.config?.pendingTerminalIntent != null
    ) {
      return { outcome: "claim_conflict" as const };
    }

    const ownershipPredicate = hasCurrentClaim
      ? and(
          eq(agentJobs.workerId, requestWorkerId),
          sql`${agentJobs.config} ->> 'claimAttemptId' = ${requestClaimAttemptId}`,
        )
      : sql`COALESCE(${agentJobs.config} ->> 'claimAttemptId', '') = ''`;
    const [updatedJob] = await tx
      .update(agentJobs)
      .set({
        status: "waiting_for_input",
        updatedAt: sql<Date>`clock_timestamp()` as never,
      })
      .where(
        and(
          eq(agentJobs.id, input.agentJobId),
          inArray(agentJobs.status, CLAIM_RECEIPT_CURRENT_JOB_STATUSES),
          ownershipPredicate,
          sql`${agentJobs.config} -> 'pendingTerminalIntent' IS NULL`,
        ),
      )
      .returning();
    if (!updatedJob) {
      return { outcome: "claim_conflict" as const };
    }

    const [interaction] = await tx
      .insert(workerInteractions)
      .values({
        agentJobId: input.agentJobId,
        workItemId: input.workItemId ?? null,
        questionType: input.questionType,
        questionText: input.questionText,
        questionContext: input.questionContext ?? null,
        options: input.options ?? null,
        expiresAt: input.expiresAt,
        timeoutAction: input.timeoutAction ?? "fail",
        defaultAnswer: input.defaultAnswer ?? null,
        status: "pending",
      })
      .returning();
    if (!interaction) {
      throw new Error("Failed to create worker interaction");
    }

    return {
      outcome: "created" as const,
      job: updatedJob,
      interaction,
    };
  });
};

export const getInteractionById = async (
  id: string
): Promise<typeof workerInteractions.$inferSelect | null> => {
  const [row] = await db
    .select()
    .from(workerInteractions)
    .where(eq(workerInteractions.id, id))
    .limit(1);

  return row ?? null;
};

export const getInteractionsByJobId = async (
  agentJobId: string
): Promise<typeof workerInteractions.$inferSelect[]> => {
  return db
    .select()
    .from(workerInteractions)
    .where(eq(workerInteractions.agentJobId, agentJobId))
    .orderBy(asc(workerInteractions.askedAt));
};

export const getPendingInteractionForJob = async (
  agentJobId: string
): Promise<typeof workerInteractions.$inferSelect | null> => {
  const [row] = await db
    .select()
    .from(workerInteractions)
    .where(
      and(
        eq(workerInteractions.agentJobId, agentJobId),
        eq(workerInteractions.status, "pending")
      )
    )
    .orderBy(desc(workerInteractions.askedAt))
    .limit(1);

  return row ?? null;
};

export const respondToInteraction = async (
  id: string,
  answerText: string,
  answeredBy: string,
  answerMetadata?: Record<string, unknown> | null
): Promise<typeof workerInteractions.$inferSelect | null> => {
  const now = new Date();
  const [updated] = await db
    .update(workerInteractions)
    .set({
      answerText,
      answeredBy,
      answerMetadata: answerMetadata ?? null,
      status: "answered",
      answeredAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(workerInteractions.id, id),
        eq(workerInteractions.status, "pending")
      )
    )
    .returning();

  return updated ?? null;
};

export type ExpiredInteraction = typeof workerInteractions.$inferSelect;

export const expireInteractions = async (): Promise<ExpiredInteraction[]> => {
  const now = new Date();
  return db
    .update(workerInteractions)
    .set({
      status: "timed_out",
      updatedAt: now,
    })
    .where(
      and(
        eq(workerInteractions.status, "pending"),
        lt(workerInteractions.expiresAt, now)
      )
    )
    .returning();
};

export const getInteractionsByWorkItemId = async (
  workItemId: string
): Promise<typeof workerInteractions.$inferSelect[]> => {
  return db
    .select()
    .from(workerInteractions)
    .where(eq(workerInteractions.workItemId, workItemId))
    .orderBy(asc(workerInteractions.askedAt));
};

/**
 * Find the latest pending (unanswered) interaction for any job belonging to
 * a given planning session. Returns `null` when there is nothing pending.
 */
export const getPendingInteractionForSession = async (
  planningSessionId: string
): Promise<typeof workerInteractions.$inferSelect | null> => {
  const [row] = await db
    .select({
      id: workerInteractions.id,
      agentJobId: workerInteractions.agentJobId,
      workItemId: workerInteractions.workItemId,
      questionType: workerInteractions.questionType,
      questionText: workerInteractions.questionText,
      questionContext: workerInteractions.questionContext,
      options: workerInteractions.options,
      expiresAt: workerInteractions.expiresAt,
      timeoutAction: workerInteractions.timeoutAction,
      defaultAnswer: workerInteractions.defaultAnswer,
      answerText: workerInteractions.answerText,
      answeredBy: workerInteractions.answeredBy,
      answerMetadata: workerInteractions.answerMetadata,
      answeredAt: workerInteractions.answeredAt,
      status: workerInteractions.status,
      askedAt: workerInteractions.askedAt,
      createdAt: workerInteractions.createdAt,
      updatedAt: workerInteractions.updatedAt,
    })
    .from(workerInteractions)
    .innerJoin(agentJobs, eq(workerInteractions.agentJobId, agentJobs.id))
    .where(
      and(
        eq(agentJobs.planningSessionId, planningSessionId),
        eq(workerInteractions.status, "pending")
      )
    )
    .orderBy(desc(workerInteractions.askedAt))
    .limit(1);

  return (row as typeof workerInteractions.$inferSelect | undefined) ?? null;
};

export const cancelInteractionsByJobId = async (
  agentJobId: string
): Promise<typeof workerInteractions.$inferSelect[]> => {
  const now = new Date();
  return db
    .update(workerInteractions)
    .set({
      status: "cancelled",
      updatedAt: now,
    })
    .where(
      and(
        eq(workerInteractions.agentJobId, agentJobId),
        eq(workerInteractions.status, "pending")
      )
    )
    .returning();
};

/**
 * Find jobs stuck in `waiting_for_input` where all interactions are in a
 * terminal state (no pending interactions remain) and the most recent
 * interaction update is older than `thresholdMs` milliseconds ago.
 *
 * These jobs will never be resumed because the runner missed the answer,
 * typically due to a field mismatch (e.g. `response` vs `answerText`).
 */
export const findJobsWithUnprocessedAnsweredInteractions = async (
  thresholdMs: number
): Promise<
  {
    jobId: string;
    workItemId: string | null;
    latestInteractionId: string;
    latestInteractionUpdatedAt: Date;
  }[]
> => {
  const cutoff = new Date(Date.now() - thresholdMs);

  // Subquery: find the latest interaction per job that is in waiting_for_input
  // Conditions:
  // 1. The job is in waiting_for_input status
  // 2. No pending interactions exist for the job
  // 3. At least one interaction exists (we get the latest one)
  // 4. The latest interaction's updatedAt is older than the threshold

  const rows = await db.execute(sql`
    SELECT
      aj.id AS "jobId",
      aj.work_item_id AS "workItemId",
      latest_int.id AS "latestInteractionId",
      latest_int.updated_at AS "latestInteractionUpdatedAt"
    FROM agent_jobs aj
    INNER JOIN LATERAL (
      SELECT wi.id, wi.updated_at
      FROM worker_interactions wi
      WHERE wi.agent_job_id = aj.id
      ORDER BY wi.updated_at DESC
      LIMIT 1
    ) latest_int ON TRUE
    WHERE aj.status = 'waiting_for_input'
      AND NOT EXISTS (
        SELECT 1 FROM worker_interactions wi2
        WHERE wi2.agent_job_id = aj.id AND wi2.status = 'pending'
      )
      AND latest_int.updated_at < ${cutoff.toISOString()}::timestamptz
  `);

  return rows as unknown as Array<{
    jobId: string;
    workItemId: string | null;
    latestInteractionId: string;
    latestInteractionUpdatedAt: Date;
  }>;
};
