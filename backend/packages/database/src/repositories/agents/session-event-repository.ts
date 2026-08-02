import { db } from "../../client";
import {
  DURABLE_SESSION_EVENT_CONFLICT_PREDICATE,
  sessionEvents,
} from "../../schema";
import { eq, and, gt, inArray, asc } from "drizzle-orm";
import type { NewSessionEvent, SessionEventDb } from "../../schema/session-events";

export interface SessionEventFilters {
  afterSequence?: number;
  kinds?: string[];
  limit?: number;
}

export const insertSessionEvent = async (
  event: NewSessionEvent,
): Promise<SessionEventDb> => {
  const rows = await db
    .insert(sessionEvents)
    .values(event)
    .returning();
  return rows[0]!;
};

/**
 * Batch-insert session events. Legacy producer sequences were process-local,
 * so repeated (agentJobId, sequenceNum) values are preserved. Explicit
 * durable.v2 events are deduplicated within the batch and PostgreSQL atomically
 * suppresses concurrent redelivery through the matching partial unique index.
 */
export const insertSessionEventsBatch = async (
  events: NewSessionEvent[],
): Promise<number> => {
  if (events.length === 0) return 0;

  const seenDurableSequences = new Set<string>();
  const deduplicated: NewSessionEvent[] = [];
  for (const event of events) {
    if (event.sequenceProtocolVersion === "durable.v2") {
      const key = `${event.agentJobId}:${event.sequenceNum}`;
      if (seenDurableSequences.has(key)) continue;
      seenDurableSequences.add(key);
    }
    deduplicated.push(event);
  }

  const inserted = await db
    .insert(sessionEvents)
    .values(deduplicated)
    .onConflictDoNothing({
      target: [sessionEvents.agentJobId, sessionEvents.sequenceNum],
      where: DURABLE_SESSION_EVENT_CONFLICT_PREDICATE,
    })
    .returning({ id: sessionEvents.id });

  return inserted.length;
};

export const getSessionEventsByJobId = async (
  agentJobId: string,
  filters: SessionEventFilters = {},
): Promise<SessionEventDb[]> => {
  const conditions = [eq(sessionEvents.agentJobId, agentJobId)];

  if (filters.afterSequence !== undefined) {
    conditions.push(gt(sessionEvents.sequenceNum, filters.afterSequence));
  }
  if (filters.kinds && filters.kinds.length > 0) {
    conditions.push(inArray(sessionEvents.kind, filters.kinds));
  }

  return db
    .select()
    .from(sessionEvents)
    .where(and(...conditions))
    .orderBy(asc(sessionEvents.sequenceNum))
    .limit(filters.limit ?? 5000);
};

export const getSessionEventsBySessionId = async (
  planningSessionId: string,
  filters: SessionEventFilters = {},
): Promise<SessionEventDb[]> => {
  const conditions = [eq(sessionEvents.planningSessionId, planningSessionId)];

  if (filters.afterSequence !== undefined) {
    conditions.push(gt(sessionEvents.sequenceNum, filters.afterSequence));
  }
  if (filters.kinds && filters.kinds.length > 0) {
    conditions.push(inArray(sessionEvents.kind, filters.kinds));
  }

  return db
    .select()
    .from(sessionEvents)
    .where(and(...conditions))
    .orderBy(asc(sessionEvents.sequenceNum))
    .limit(filters.limit ?? 5000);
};

export const deleteSessionEventsBySessionId = async (
  planningSessionId: string,
): Promise<number> => {
  const deleted = await db
    .delete(sessionEvents)
    .where(eq(sessionEvents.planningSessionId, planningSessionId))
    .returning({ id: sessionEvents.id });

  return deleted.length;
};
