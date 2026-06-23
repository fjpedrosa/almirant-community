import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../../client";
import {
  agentNativeEvents,
  type AgentNativeEventDb,
  type NewAgentNativeEvent,
} from "../../schema";

export interface AgentNativeEventFilters {
  afterSequence?: number;
  limit?: number;
}

export const insertAgentNativeEventsBatch = async (
  events: NewAgentNativeEvent[],
): Promise<number> => {
  if (events.length === 0) return 0;

  await db
    .insert(agentNativeEvents)
    .values(events)
    .onConflictDoNothing({
      target: [agentNativeEvents.agentJobId, agentNativeEvents.sequenceNum],
    });

  return events.length;
};

export const getAgentNativeEventsByJobId = async (
  agentJobId: string,
  filters: AgentNativeEventFilters = {},
): Promise<AgentNativeEventDb[]> => {
  const conditions = [eq(agentNativeEvents.agentJobId, agentJobId)];

  if (filters.afterSequence !== undefined) {
    conditions.push(gt(agentNativeEvents.sequenceNum, filters.afterSequence));
  }

  return db
    .select()
    .from(agentNativeEvents)
    .where(and(...conditions))
    .orderBy(asc(agentNativeEvents.sequenceNum))
    .limit(filters.limit ?? 5000);
};

export const getAgentNativeEventsBySessionId = async (
  planningSessionId: string,
  filters: AgentNativeEventFilters = {},
): Promise<AgentNativeEventDb[]> => {
  const conditions = [eq(agentNativeEvents.planningSessionId, planningSessionId)];

  if (filters.afterSequence !== undefined) {
    conditions.push(gt(agentNativeEvents.sequenceNum, filters.afterSequence));
  }

  return db
    .select()
    .from(agentNativeEvents)
    .where(and(...conditions))
    .orderBy(asc(agentNativeEvents.sequenceNum))
    .limit(filters.limit ?? 5000);
};

export const countAgentNativeEventsBySessionId = async (
  planningSessionId: string,
): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentNativeEvents)
    .where(eq(agentNativeEvents.planningSessionId, planningSessionId));

  return row?.count ?? 0;
};

export const deleteAgentNativeEventsBySessionId = async (
  planningSessionId: string,
): Promise<number> => {
  const deleted = await db
    .delete(agentNativeEvents)
    .where(eq(agentNativeEvents.planningSessionId, planningSessionId))
    .returning({ id: agentNativeEvents.id });

  return deleted.length;
};
