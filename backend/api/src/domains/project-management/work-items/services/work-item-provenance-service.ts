import {
  getActiveJobForWorkItem,
  getJobsByWorkItem,
  getAiSessionsSummaryByWorkItemId,
  getWorkItemEventsByWorkItemId,
  getWorkerById,
  getUserById,
} from "@almirant/database";
import type { ProvenanceMetadata } from "@almirant/database";

/** Aggregated provenance view model for a single work item */
export interface WorkItemProvenance {
  /** Most recent relevant origin (who/what last changed this item) */
  lastOrigin: {
    source: string | null;
    triggeredBy: string;
    userId: string | null;
    userName: string | null;
    userImage: string | null;
    processType: string | null;
    skillName: string | null;
    timestamp: string;
  } | null;

  /** Currently active run, if any */
  activeRun: {
    jobId: string;
    jobType: string;
    status: string;
    provider: string;
    skillName: string | null;
    startedAt: string | null;
    createdByUserId: string | null;
    createdByUserName: string | null;
    worker: {
      workerId: string;
      hostname: string;
      status: string;
      lastHeartbeatAt: string | null;
    } | null;
  } | null;

  /** Recent job history (last 5) */
  recentJobs: Array<{
    jobId: string;
    jobType: string;
    status: string;
    provider: string;
    skillName: string | null;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  }>;

  /** AI session cost summary */
  sessionSummary: {
    totalSessions: number;
    totalTokens: number;
    totalEstimatedCost: string;
    totalDurationMs: number;
  };

  /** Drill-down IDs for deep linking */
  links: {
    activeJobId: string | null;
    latestSessionId: string | null;
    planningSessionId: string | null;
  };
}

/** Helper to convert a Date or null to an ISO string or null */
const toISOStringOrNull = (date: Date | null | undefined): string | null =>
  date instanceof Date ? date.toISOString() : null;

export async function getWorkItemProvenance(
  organizationId: string,
  workItemId: string
): Promise<WorkItemProvenance> {
  // Fetch all data sources in parallel
  const [activeJob, jobs, sessionData, events] = await Promise.all([
    getActiveJobForWorkItem(workItemId),
    getJobsByWorkItem(workItemId),
    getAiSessionsSummaryByWorkItemId(organizationId, workItemId),
    getWorkItemEventsByWorkItemId(workItemId, { limit: 20 }),
  ]);

  // --- lastOrigin: most recent event with meaningful provenance ---
  let lastOrigin: WorkItemProvenance["lastOrigin"] = null;
  if (events.length > 0) {
    const event = events[0]!;
    const meta = (event.metadata ?? {}) as ProvenanceMetadata;
    lastOrigin = {
      source: meta.source ?? null,
      triggeredBy: event.triggeredBy,
      userId: event.triggeredByUserId,
      userName: event.triggeredByUserName,
      userImage: event.triggeredByUserImage,
      processType: meta.processType ?? null,
      skillName: meta.skillName ?? null,
      timestamp: event.createdAt.toISOString(),
    };
  }

  // --- activeRun: from active job + worker lookup ---
  let activeRun: WorkItemProvenance["activeRun"] = null;
  if (activeJob) {
    let worker: WorkItemProvenance["activeRun"] extends infer T
      ? T extends { worker: infer W }
        ? W
        : null
      : null = null;

    if (activeJob.workerId) {
      const workerRow = await getWorkerById(activeJob.workerId);
      if (workerRow) {
        worker = {
          workerId: workerRow.workerId,
          hostname: workerRow.hostname,
          status: workerRow.status,
          lastHeartbeatAt: toISOStringOrNull(workerRow.lastHeartbeatAt),
        };
      }
    }

    const config = activeJob.config as { skillName?: string } | null;
    let createdByUserName: string | null = null;
    if (activeJob.createdByUserId) {
      const jobUser = await getUserById(activeJob.createdByUserId);
      createdByUserName = jobUser?.name ?? null;
    }
    activeRun = {
      jobId: activeJob.id,
      jobType: activeJob.jobType ?? "unknown",
      status: activeJob.status,
      provider: activeJob.provider,
      skillName: config?.skillName ?? null,
      startedAt: toISOStringOrNull(activeJob.startedAt),
      createdByUserId: activeJob.createdByUserId,
      createdByUserName,
      worker,
    };
  }

  // --- recentJobs: last 5 ---
  const recentJobs: WorkItemProvenance["recentJobs"] = jobs
    .slice(0, 5)
    .map((job) => {
      const config = job.config as { skillName?: string } | null;
      return {
        jobId: job.id,
        jobType: job.jobType ?? "unknown",
        status: job.status,
        provider: job.provider,
        skillName: config?.skillName ?? null,
        startedAt: toISOStringOrNull(job.startedAt),
        completedAt: toISOStringOrNull(job.completedAt),
        durationMs: job.durationMs ?? null,
      };
    });

  // --- sessionSummary ---
  const { summary, sessions } = sessionData;
  const sessionSummary: WorkItemProvenance["sessionSummary"] = {
    totalSessions: summary.sessionCount,
    totalTokens: summary.totalTokens,
    totalEstimatedCost: summary.totalEstimatedCost,
    totalDurationMs: summary.totalDurationMs,
  };

  // --- links ---
  const latestSessionId = sessions.length > 0 ? sessions[0]!.id : null;

  // Find planningSessionId: prefer activeJob, then fall back to most recent job with one
  let planningSessionId: string | null = activeJob?.planningSessionId ?? null;
  if (!planningSessionId) {
    for (const job of jobs) {
      if (job.planningSessionId) {
        planningSessionId = job.planningSessionId;
        break;
      }
    }
  }

  const links: WorkItemProvenance["links"] = {
    activeJobId: activeJob?.id ?? null,
    latestSessionId,
    planningSessionId,
  };

  return {
    lastOrigin,
    activeRun,
    recentJobs,
    sessionSummary,
    links,
  };
}
