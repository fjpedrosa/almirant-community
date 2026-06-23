import { db } from "../../client";
import { sessionEvents } from "../../schema";
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
 * Batch-insert session events, deduplicating by (agentJobId, sequenceNum)
 * within the batch. Only the first occurrence of each sequence number is kept.
 */
export const insertSessionEventsBatch = async (
  events: NewSessionEvent[],
): Promise<number> => {
  if (events.length === 0) return 0;

  // Deduplicate within the batch: keep the first event per (agentJobId, sequenceNum)
  const seen = new Set<string>();
  const deduplicated: NewSessionEvent[] = [];
  for (const event of events) {
    const key = `${event.agentJobId}:${event.sequenceNum}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(event);
    }
  }

  await db.insert(sessionEvents).values(deduplicated);
  return deduplicated.length;
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
