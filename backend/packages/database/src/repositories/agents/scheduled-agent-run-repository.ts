import { db, type Database } from "../../client";
import {
  agentJobs,
  agentOutputSubmissions,
  scheduledAgentRuns,
} from "../../schema";
import {
  eq,
  and,
  asc,
  desc,
  count,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { ScheduledAgentRunDb, NewScheduledAgentRun } from "../../schema/scheduled-agent-runs";

const ACTIVE_SCHEDULED_RUN_STATUSES = ["pending", "running"] as const;
const TERMINAL_AGENT_JOB_STATUSES = [
  "completed",
  "incomplete",
  "failed",
  "cancelled",
] as const;

type ScheduledAgentRunTerminalStatus = "completed" | "failed" | "cancelled";

// Dispatch intentionally assigns the reserved run UUID to the job before it
// persists agent_job_id. Recover that narrow crash window only when every
// immutable occurrence boundary agrees; UUID equality alone is not sufficient.
const scheduledRunJobCorrelation = () =>
  and(
    eq(scheduledAgentRuns.workspaceId, agentJobs.workspaceId),
    or(
      eq(scheduledAgentRuns.agentJobId, agentJobs.id),
      and(
        isNull(scheduledAgentRuns.agentJobId),
        eq(scheduledAgentRuns.id, agentJobs.id),
        sql`${agentJobs.config}->>'scheduledConfigId' = ${scheduledAgentRuns.configId}::text`,
        sql`${agentJobs.config}->>'scheduledDispatchDueKey' = ${scheduledAgentRuns.dueKey}`,
      ),
    ),
  );

export type ScheduledAgentRunReconciliationResult =
  | {
      reconciled: true;
      runId: string;
      status: ScheduledAgentRunTerminalStatus;
    }
  | {
      reconciled: false;
      reason:
        | "not_found"
        | "job_not_terminal"
        | "awaiting_required_output"
        | "already_terminal";
    };

const resolveTerminalRunOutcome = (context: {
  jobStatus: string;
  outputRequired: boolean;
  submissionStatus: string | null;
  submissionErrorCode: string | null;
}): {
  status: ScheduledAgentRunTerminalStatus;
  itemsSucceeded: number;
  itemsFailed: number;
  errorMessage: string | null;
} | null => {
  if (context.jobStatus === "cancelled") {
    return {
      status: "cancelled",
      itemsSucceeded: 0,
      itemsFailed: 1,
      errorMessage: "agent_job_cancelled",
    };
  }
  if (context.jobStatus === "failed") {
    return {
      status: "failed",
      itemsSucceeded: 0,
      itemsFailed: 1,
      errorMessage: "agent_job_failed",
    };
  }
  if (context.jobStatus === "incomplete") {
    return {
      status: "failed",
      itemsSucceeded: 0,
      itemsFailed: 1,
      errorMessage: "agent_job_incomplete",
    };
  }
  if (context.jobStatus !== "completed") return null;

  if (context.submissionStatus === "terminal_error") {
    return {
      status: "failed",
      itemsSucceeded: 0,
      itemsFailed: 1,
      errorMessage:
        context.submissionErrorCode ?? "agent_output_terminal_error",
    };
  }
  if (
    context.outputRequired &&
    context.submissionStatus !== "submitted"
  ) {
    return null;
  }
  return {
    status: "completed",
    itemsSucceeded: 1,
    itemsFailed: 0,
    errorMessage: null,
  };
};

/**
 * Durable scheduled-run projection of the linked agent job.
 *
 * The job and structured-output rows are authoritative. A required-output
 * completion remains pending until the normal output finalizer has persisted
 * either `submitted` or `terminal_error`. The conditional run update is the
 * concurrency fence: callbacks and sweepers may retry freely, but only one
 * transition can win and a terminal run is never regressed.
 */
export const createScheduledAgentRunRepository = (database: Database) => {
  const reconcileTerminalRunForJob = async (
    jobId: string,
    options?: { now?: Date },
  ): Promise<ScheduledAgentRunReconciliationResult> =>
    database.transaction(async (transaction) => {
      const [context] = await transaction
        .select({
          runId: scheduledAgentRuns.id,
          runStatus: scheduledAgentRuns.status,
          runAgentJobId: scheduledAgentRuns.agentJobId,
          jobStatus: agentJobs.status,
          jobConfig: agentJobs.config,
          jobCompletedAt: agentJobs.completedAt,
          jobFailedAt: agentJobs.failedAt,
          submissionStatus: agentOutputSubmissions.status,
          submissionErrorCode: agentOutputSubmissions.errorCode,
        })
        .from(scheduledAgentRuns)
        .innerJoin(
          agentJobs,
          scheduledRunJobCorrelation(),
        )
        .leftJoin(
          agentOutputSubmissions,
          and(
            eq(agentOutputSubmissions.runId, scheduledAgentRuns.id),
            eq(agentOutputSubmissions.jobId, agentJobs.id),
          ),
        )
        .where(eq(agentJobs.id, jobId))
        .limit(1);

      if (!context) {
        return { reconciled: false, reason: "not_found" };
      }
      if (
        !TERMINAL_AGENT_JOB_STATUSES.includes(
          context.jobStatus as (typeof TERMINAL_AGENT_JOB_STATUSES)[number],
        )
      ) {
        return { reconciled: false, reason: "job_not_terminal" };
      }
      if (
        !ACTIVE_SCHEDULED_RUN_STATUSES.includes(
          context.runStatus as (typeof ACTIVE_SCHEDULED_RUN_STATUSES)[number],
        )
      ) {
        return { reconciled: false, reason: "already_terminal" };
      }

      const now = options?.now ?? new Date();
      if (!context.runAgentJobId) {
        await transaction
          .update(scheduledAgentRuns)
          .set({
            agentJobId: jobId,
            updatedAt: now,
          })
          .where(
            and(
              eq(scheduledAgentRuns.id, context.runId),
              isNull(scheduledAgentRuns.agentJobId),
              inArray(
                scheduledAgentRuns.status,
                [...ACTIVE_SCHEDULED_RUN_STATUSES],
              ),
            ),
          );
      }

      const outcome = resolveTerminalRunOutcome({
        jobStatus: context.jobStatus,
        outputRequired:
          context.jobConfig?.outputPolicy?.required === true,
        submissionStatus: context.submissionStatus,
        submissionErrorCode: context.submissionErrorCode,
      });
      if (!outcome) {
        return {
          reconciled: false,
          reason: "awaiting_required_output",
        };
      }

      const [updated] = await transaction
        .update(scheduledAgentRuns)
        .set({
          status: outcome.status,
          completedAt:
            context.jobCompletedAt ?? context.jobFailedAt ?? now,
          itemsProcessed: 1,
          itemsSucceeded: outcome.itemsSucceeded,
          itemsFailed: outcome.itemsFailed,
          errorMessage: outcome.errorMessage,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledAgentRuns.id, context.runId),
            eq(scheduledAgentRuns.agentJobId, jobId),
            inArray(
              scheduledAgentRuns.status,
              [...ACTIVE_SCHEDULED_RUN_STATUSES],
            ),
          ),
        )
        .returning({ id: scheduledAgentRuns.id });

      if (!updated) {
        return { reconciled: false, reason: "already_terminal" };
      }
      return {
        reconciled: true,
        runId: updated.id,
        status: outcome.status,
      };
    });

  const findUnreconciledTerminalJobIds = async (options?: {
    limit?: number;
  }): Promise<string[]> => {
    const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
    const rows = await database
      .select({ jobId: agentJobs.id })
      .from(scheduledAgentRuns)
      .innerJoin(
        agentJobs,
        scheduledRunJobCorrelation(),
      )
      .where(
        and(
          inArray(
            scheduledAgentRuns.status,
            [...ACTIVE_SCHEDULED_RUN_STATUSES],
          ),
          inArray(agentJobs.status, [...TERMINAL_AGENT_JOB_STATUSES]),
        ),
      )
      .orderBy(
        asc(
          sql`COALESCE(
            ${agentJobs.completedAt},
            ${agentJobs.failedAt},
            ${agentJobs.updatedAt}
          )`,
        ),
      )
      .limit(limit);
    return rows.map((row) => row.jobId);
  };

  return {
    reconcileTerminalRunForJob,
    findUnreconciledTerminalJobIds,
  };
};

const terminalRunRepository = createScheduledAgentRunRepository(db);

export const reconcileScheduledAgentRunForTerminalJob =
  terminalRunRepository.reconcileTerminalRunForJob;

export const findUnreconciledTerminalScheduledAgentJobIds =
  terminalRunRepository.findUnreconciledTerminalJobIds;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createScheduledAgentRun = async (
  data: Omit<NewScheduledAgentRun, "id" | "createdAt" | "updatedAt">
): Promise<ScheduledAgentRunDb> => {
  const [run] = await db
    .insert(scheduledAgentRuns)
    .values(data)
    .returning();

  if (!run) throw new Error("Failed to create scheduled agent run");
  return run;
};

export const reserveScheduledAgentRun = async (data: {
  configId: string;
  workspaceId: string;
  dueKey: string;
  triggerType: "manual" | "webhook" | "schedule";
}): Promise<{ run: ScheduledAgentRunDb; created: boolean }> => {
  const [created] = await db
    .insert(scheduledAgentRuns)
    .values({
      ...data,
      status: "pending",
      metadata: {},
    })
    .onConflictDoNothing({
      target: [scheduledAgentRuns.configId, scheduledAgentRuns.dueKey],
    })
    .returning();

  if (created) return { run: created, created: true };

  const [existing] = await db
    .select()
    .from(scheduledAgentRuns)
    .where(
      and(
        eq(scheduledAgentRuns.configId, data.configId),
        eq(scheduledAgentRuns.dueKey, data.dueKey),
        eq(scheduledAgentRuns.workspaceId, data.workspaceId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error("Scheduled agent dispatch reservation conflicted but was not found");
  }
  return { run: existing, created: false };
};

export const linkScheduledAgentRunToJob = async (
  runId: string,
  workspaceId: string,
  jobId: string,
): Promise<ScheduledAgentRunDb> => {
  const [updated] = await db
    .update(scheduledAgentRuns)
    .set({
      agentJobId: jobId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, runId),
        eq(scheduledAgentRuns.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Scheduled agent run not found");
  return updated;
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateScheduledAgentRun = async (
  id: string,
  workspaceId: string,
  data: Partial<Pick<NewScheduledAgentRun, "agentJobId" | "status" | "completedAt" | "itemsProcessed" | "itemsSucceeded" | "itemsFailed" | "errorMessage" | "metadata">>
): Promise<ScheduledAgentRunDb> => {
  const [updated] = await db
    .update(scheduledAgentRuns)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(scheduledAgentRuns.id, id), eq(scheduledAgentRuns.workspaceId, workspaceId)))
    .returning();

  if (!updated) throw new Error("Scheduled agent run not found");
  return updated;
};

// ---------------------------------------------------------------------------
// Get by ID
// ---------------------------------------------------------------------------

export const getScheduledAgentRunById = async (
  id: string,
  workspaceId: string,
): Promise<ScheduledAgentRunDb | null> => {
  const [run] = await db
    .select()
    .from(scheduledAgentRuns)
    .where(and(eq(scheduledAgentRuns.id, id), eq(scheduledAgentRuns.workspaceId, workspaceId)))
    .limit(1);

  return run ?? null;
};

// ---------------------------------------------------------------------------
// List by config ID (paginated)
// ---------------------------------------------------------------------------

export const getScheduledAgentRunsByConfigId = async (
  configId: string,
  options: { limit: number; offset: number }
): Promise<{ runs: ScheduledAgentRunDb[]; total: number }> => {
  const [runs, [totalRow]] = await Promise.all([
    db
      .select()
      .from(scheduledAgentRuns)
      .where(eq(scheduledAgentRuns.configId, configId))
      .orderBy(desc(scheduledAgentRuns.startedAt))
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ count: count() })
      .from(scheduledAgentRuns)
      .where(eq(scheduledAgentRuns.configId, configId)),
  ]);

  return { runs, total: totalRow?.count ?? 0 };
};
