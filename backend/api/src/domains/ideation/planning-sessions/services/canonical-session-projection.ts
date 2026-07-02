import type { CanonicalEvent, CanonicalEventEnvelope } from "@almirant/canonical-events";
import {
  CANONICAL_PROJECTOR_VERSION,
  buildCanonicalSessionProjection,
  type CanonicalSessionProjection,
} from "@almirant/canonical-events";
import {
  getSessionEventsBySessionId,
  getSessionSnapshot,
  upsertSessionSnapshot,
  type SessionEventDb,
} from "@almirant/database";

type ProjectionBuildInput = {
  planningSessionId: string;
  workspaceId?: string | null;
  limit?: number;
};

const eventRowToEnvelope = (
  row: SessionEventDb,
  workspaceId: string,
): CanonicalEventEnvelope => ({
  jobId: row.agentJobId,
  sessionId: row.planningSessionId ?? "",
  workspaceId,
  threadId: "",
  timestamp: row.createdAt.getTime(),
  sequenceNumber: row.sequenceNum,
  event: row.payload as CanonicalEvent,
});

const projectionSummary = (projection: CanonicalSessionProjection): Record<string, unknown> => ({
  status: projection.status,
  currentTurnId: projection.currentTurnId,
  activeQuestion: projection.activeQuestion,
  pendingFollowUp: projection.pendingFollowUp,
});

const projectionMetrics = (projection: CanonicalSessionProjection): Record<string, unknown> => ({
  lastSequenceNumber: projection.lastSequenceNumber,
  duplicateCount: projection.duplicateCount,
  outOfOrderCount: projection.outOfOrderCount,
  blockCount: projection.blocks.length,
  activeToolCallCount: Object.keys(projection.activeToolCalls).length,
});

export const buildCanonicalProjectionFromSessionEvents = async ({
  planningSessionId,
  workspaceId,
  limit = 10_000,
}: ProjectionBuildInput): Promise<CanonicalSessionProjection | null> => {
  const events = await getSessionEventsBySessionId(planningSessionId, { limit });
  if (events.length === 0) return null;

  return buildCanonicalSessionProjection(
    events.map((row) => eventRowToEnvelope(row, workspaceId ?? "")),
  );
};

export const refreshCanonicalSessionProjection = async (
  input: ProjectionBuildInput,
): Promise<CanonicalSessionProjection | null> => {
  const projection = await buildCanonicalProjectionFromSessionEvents(input);
  if (!projection) return null;

  await upsertSessionSnapshot({
    planningSessionId: input.planningSessionId,
    projectorVersion: CANONICAL_PROJECTOR_VERSION,
    lastCanonicalSeq: projection.lastSequenceNumber,
    timeline: projection as unknown as Record<string, unknown>,
    summary: projectionSummary(projection),
    metrics: projectionMetrics(projection),
  });

  return projection;
};

export const getOrRefreshCanonicalSessionProjection = async (
  input: ProjectionBuildInput,
): Promise<CanonicalSessionProjection | null> => {
  const snapshot = await getSessionSnapshot(input.planningSessionId);
  if (
    snapshot !== null &&
    snapshot.projectorVersion === CANONICAL_PROJECTOR_VERSION &&
    snapshot.timeline
  ) {
    return snapshot.timeline as unknown as CanonicalSessionProjection;
  }

  return refreshCanonicalSessionProjection(input);
};
