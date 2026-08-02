/**
 * Builds an IncidentBundleData by querying all relevant artifacts for a given
 * feedbackItemId, agentJobId, and/or traceId.
 *
 * Caps applied: sessionEvents max 500, jobLogs max 300, errorMemory max 20.
 * agentNativeEvents NOT included (duplicates sessionEvents in raw form — YAGNI).
 *
 * Ported from the enterprise debug domain. All data sources
 * (feedback_items, agent_jobs, session_events, agent_job_logs,
 * agent_observations) exist in cloud, so the port is a straight import-path
 * carry-over — `organizationId` is `workspaceId` in cloud.
 *
 * Security contract:
 * - workspaceId is REQUIRED. The caller is responsible for proving the request
 *   is authorized for this workspace before calling this function.
 * - feedbackItems has no workspaceId column, so feedback ownership cannot be
 *   verified here. The caller must ensure the feedbackItemId is authorized.
 * - agentJobs IS filtered by workspaceId — a job from another workspace will not load.
 * - Auto-resolved jobId from feedback.metadata.jobId is also filtered by workspace, so
 *   a feedback item with a cross-tenant jobId in metadata will produce jobData: null.
 */

import {
  db,
  feedbackItems,
  agentJobs,
  sessionEvents,
  agentJobLogs,
  agentObservations,
  eq,
  and,
  desc,
} from "@almirant/database";
import type { IncidentBundleData } from "@almirant/database";

const SESSION_EVENTS_CAP = 500;
const JOB_LOGS_CAP = 300;
const ERROR_MEMORY_CAP = 20;

export interface BuildIncidentBundleInput {
  feedbackItemId?: string;
  agentJobId?: string;
  traceId?: string;
  /** Required: the workspace the caller is authorized to read. */
  workspaceId: string;
}

export const buildIncidentBundle = async (
  input: BuildIncidentBundleInput
): Promise<IncidentBundleData> => {
  const { feedbackItemId, agentJobId, workspaceId } = input;

  // --- Fetch feedback item ---
  let feedbackData: IncidentBundleData["feedback"] = null;
  let resolvedJobId = agentJobId;
  let frontendTrace: IncidentBundleData["frontendTrace"] = null;

  if (feedbackItemId) {
    const [item] = await db
      .select()
      .from(feedbackItems)
      .where(eq(feedbackItems.id, feedbackItemId))
      .limit(1);

    if (item) {
      feedbackData = {
        id: item.id,
        title: item.title,
        content: item.content ?? null,
        category: item.category,
        metadata: (item.metadata as Record<string, unknown>) ?? {},
        createdAt: item.createdAt.toISOString(),
      };

      // Extract frontend trace from metadata.debugContext.traceSink.
      // Fallback to metadata.traceSink because the widget currently stores the
      // debug context at the metadata root.
      const meta = item.metadata as Record<string, unknown> | null;
      const debugContext = meta?.debugContext as Record<string, unknown> | null;
      const traceSinkRaw = debugContext?.traceSink ?? meta?.traceSink;
      if (Array.isArray(traceSinkRaw)) {
        frontendTrace = traceSinkRaw as IncidentBundleData["frontendTrace"];
      }

      // Try to resolve agentJobId from metadata if not provided.
      // NOTE: the resolved jobId is ALWAYS verified against workspaceId below —
      // a cross-tenant jobId in metadata will produce jobData: null (safe no-op).
      if (!resolvedJobId) {
        const jobIdInMeta =
          (meta?.jobId as string | undefined) ??
          (debugContext?.jobId as string | undefined);
        if (jobIdInMeta) {
          resolvedJobId = jobIdInMeta;
        }
      }
    }
  }

  // --- Fetch agent job, session events, job logs, error memory ---
  let jobData: IncidentBundleData["job"] = null;
  let sessionEventsData: IncidentBundleData["sessionEvents"] = [];
  let jobLogsData: IncidentBundleData["jobLogs"] = [];
  let errorMemoryData: IncidentBundleData["errorMemory"] = [];

  if (resolvedJobId) {
    // Scope query to workspaceId — prevents loading a job from another workspace.
    const [job] = await db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.id, resolvedJobId),
          eq(agentJobs.workspaceId, workspaceId)
        )
      )
      .limit(1);

    if (job) {
      jobData = {
        id: job.id,
        status: job.status,
        jobType: job.jobType ?? "unknown",
        skillName: job.skillName ?? null,
        config: (job.config as unknown as Record<string, unknown>) ?? {},
        errorMessage: job.errorMessage ?? null,
      };

      // Fetch session events (capped)
      const eventsRows = await db
        .select({
          sequenceNum: sessionEvents.sequenceNum,
          kind: sessionEvents.kind,
          payload: sessionEvents.payload,
          createdAt: sessionEvents.createdAt,
        })
        .from(sessionEvents)
        .where(eq(sessionEvents.agentJobId, resolvedJobId))
        .orderBy(sessionEvents.sequenceNum)
        .limit(SESSION_EVENTS_CAP);

      sessionEventsData = eventsRows.map((r) => ({
        sequenceNum: r.sequenceNum,
        kind: r.kind,
        payload: r.payload as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      }));

      // Fetch agent job logs (capped)
      const logsRows = await db
        .select({
          phase: agentJobLogs.phase,
          eventType: agentJobLogs.eventType,
          level: agentJobLogs.level,
          payload: agentJobLogs.payload,
          createdAt: agentJobLogs.createdAt,
        })
        .from(agentJobLogs)
        .where(eq(agentJobLogs.jobId, resolvedJobId))
        .orderBy(agentJobLogs.seq)
        .limit(JOB_LOGS_CAP);

      jobLogsData = logsRows.map((r) => ({
        phase: r.phase,
        eventType: r.eventType,
        level: r.level,
        payload: r.payload as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      }));

      // Fetch error memory (agent_observations) linked to this job
      const obsRows = await db
        .select({
          type: agentObservations.type,
          topicKey: agentObservations.topicKey,
          title: agentObservations.title,
          content: agentObservations.content,
        })
        .from(agentObservations)
        .where(eq(agentObservations.agentJobId, resolvedJobId))
        .orderBy(desc(agentObservations.updatedAt))
        .limit(ERROR_MEMORY_CAP);

      errorMemoryData = obsRows.map((r) => ({
        type: r.type,
        topicKey: r.topicKey,
        title: r.title,
        content: r.content,
      }));
    }
  }

  return {
    version: 1,
    feedback: feedbackData,
    job: jobData,
    sessionEvents: sessionEventsData,
    jobLogs: jobLogsData,
    frontendTrace,
    errorMemory: errorMemoryData,
  };
};
