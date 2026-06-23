import { db } from "../../client";
import { workItemEvents, user } from "../../schema";
import { eq, and, desc, gte, lte, sql, inArray, isNotNull } from "drizzle-orm";
import type { NewWorkItemEvent, WorkItemEventDb } from "../../schema/work-item-events";
import type { ProvenanceMetadata } from "../../schema/provenance";

// Filters for querying events by work item
export interface WorkItemEventFilters {
  eventType?: string;
  limit?: number;
  offset?: number;
}

// Filters for querying events by date range
export interface WorkItemEventDateRangeFilters {
  workItemId?: string;
  eventType?: string;
}

// Triggered-by context passed from API routes or MCP tools
export interface TriggeredByContext {
  triggeredBy: "user" | "system" | "claude-code" | "worker" | "websocket" | "api" | "nightly" | "mcp";
  triggeredByUserId?: string;
  /** Additional provenance metadata to merge into event metadata */
  provenance?: ProvenanceMetadata;
}

export interface ParticipantActionSummary {
  eventType: string;
  count: number;
  lastDate: Date;
}

export interface WorkItemParticipant {
  userId: string;
  userName: string | null;
  userImage: string | null;
  lastAction: string;
  lastActionDate: Date;
  actions: ParticipantActionSummary[];
}

// Default triggered-by context
export const defaultTriggeredByContext: TriggeredByContext = {
  triggeredBy: "system",
};

// Event enriched with user data from LEFT JOIN
export type WorkItemEventWithUser = WorkItemEventDb & {
  triggeredByUserName: string | null;
  triggeredByUserImage: string | null;
  triggeredByUserEmail: string | null;
};

// Select shape for enriched event queries (LEFT JOIN with user)
const eventWithUserSelect = {
  id: workItemEvents.id,
  workItemId: workItemEvents.workItemId,
  eventType: workItemEvents.eventType,
  fieldName: workItemEvents.fieldName,
  oldValue: workItemEvents.oldValue,
  newValue: workItemEvents.newValue,
  triggeredBy: workItemEvents.triggeredBy,
  triggeredByUserId: workItemEvents.triggeredByUserId,
  metadata: workItemEvents.metadata,
  createdAt: workItemEvents.createdAt,
  triggeredByUserName: user.name,
  triggeredByUserImage: user.image,
  triggeredByUserEmail: user.email,
} as const;

// Get events for a work item, ordered by creation date (newest first)
// Supports optional filters for eventType, limit, and offset
// Includes user data (name, image, email) via LEFT JOIN
export const getWorkItemEventsByWorkItemId = async (
  workItemId: string,
  filters?: WorkItemEventFilters
): Promise<WorkItemEventWithUser[]> => {
  const conditions = [eq(workItemEvents.workItemId, workItemId)];

  if (filters?.eventType) {
    conditions.push(
      sql`${workItemEvents.eventType} = ${filters.eventType}` as ReturnType<typeof eq>
    );
  }

  const query = db
    .select(eventWithUserSelect)
    .from(workItemEvents)
    .leftJoin(user, eq(workItemEvents.triggeredByUserId, user.id))
    .where(and(...conditions))
    .orderBy(desc(workItemEvents.createdAt));

  if (filters?.limit) {
    const limited = query.limit(filters.limit);
    if (filters?.offset) {
      return limited.offset(filters.offset);
    }
    return limited;
  }

  return query;
};

// Get events within a date range, with optional filters
// Includes user data (name, image, email) via LEFT JOIN
export const getEventsByDateRange = async (
  startDate: Date,
  endDate: Date,
  filters?: WorkItemEventDateRangeFilters
): Promise<WorkItemEventWithUser[]> => {
  const conditions = [
    gte(workItemEvents.createdAt, startDate),
    lte(workItemEvents.createdAt, endDate),
  ];

  if (filters?.workItemId) {
    conditions.push(eq(workItemEvents.workItemId, filters.workItemId));
  }

  if (filters?.eventType) {
    conditions.push(
      sql`${workItemEvents.eventType} = ${filters.eventType}` as ReturnType<typeof eq>
    );
  }

  return db
    .select(eventWithUserSelect)
    .from(workItemEvents)
    .leftJoin(user, eq(workItemEvents.triggeredByUserId, user.id))
    .where(and(...conditions))
    .orderBy(desc(workItemEvents.createdAt));
};

// Create a new work item event
export const createWorkItemEvent = async (
  data: NewWorkItemEvent
): Promise<WorkItemEventDb> => {
  const [event] = await db.insert(workItemEvents).values(data).returning();
  return event!;
};

// Create multiple events at once (e.g., for multi-field updates)
export const createWorkItemEvents = async (
  events: NewWorkItemEvent[]
): Promise<WorkItemEventDb[]> => {
  if (events.length === 0) return [];
  return db.insert(workItemEvents).values(events).returning();
};

// Get agent actions (ai_session events) for a work item
export const getAgentActionsByWorkItemId = async (
  workItemId: string,
  filters?: { limit?: number; offset?: number }
): Promise<WorkItemEventWithUser[]> => {
  return getWorkItemEventsByWorkItemId(workItemId, {
    eventType: 'ai_session',
    limit: filters?.limit ?? 50,
    offset: filters?.offset,
  });
};

/**
 * Batch-fetch events for multiple work item IDs.
 * Returns events ordered by creation date (newest first) with user data.
 * Max 100 work item IDs and 200 events.
 */
export const getEventsByWorkItemIds = async (
  workItemIds: string[],
  filters?: WorkItemEventFilters
): Promise<WorkItemEventWithUser[]> => {
  if (workItemIds.length === 0) return [];
  if (workItemIds.length > 500) {
    throw new Error("Maximum 500 work item IDs are allowed");
  }

  const conditions = [inArray(workItemEvents.workItemId, workItemIds)];

  if (filters?.eventType) {
    conditions.push(
      sql`${workItemEvents.eventType} = ${filters.eventType}` as ReturnType<typeof eq>
    );
  }

  const effectiveLimit = Math.min(filters?.limit ?? 50, 200);

  const query = db
    .select(eventWithUserSelect)
    .from(workItemEvents)
    .leftJoin(user, eq(workItemEvents.triggeredByUserId, user.id))
    .where(and(...conditions))
    .orderBy(desc(workItemEvents.createdAt))
    .limit(effectiveLimit);

  if (filters?.offset) {
    return query.offset(filters.offset);
  }

  return query;
};

/**
 * Batch-fetch unique participants by work item IDs.
 * Returns a map of workItemId -> participants ordered by lastActionDate desc.
 */
export const getParticipantsByWorkItemIds = async (
  workItemIds: string[]
): Promise<Map<string, WorkItemParticipant[]>> => {
  if (workItemIds.length === 0) return new Map();
  if (workItemIds.length > 500) {
    throw new Error("Maximum 500 work item IDs are allowed");
  }

  const rows = await db
    .select({
      workItemId: workItemEvents.workItemId,
      eventType: workItemEvents.eventType,
      createdAt: workItemEvents.createdAt,
      userId: workItemEvents.triggeredByUserId,
      userName: user.name,
      userImage: user.image,
    })
    .from(workItemEvents)
    .leftJoin(user, eq(workItemEvents.triggeredByUserId, user.id))
    .where(
      and(
        inArray(workItemEvents.workItemId, workItemIds),
        isNotNull(workItemEvents.triggeredByUserId)
      )
    )
    .orderBy(desc(workItemEvents.createdAt));

  const byWorkItem = new Map<string, Map<string, WorkItemParticipant>>();

  for (const row of rows) {
    if (!row.userId) continue;
    const workItemId = row.workItemId;
    const workItemParticipants = byWorkItem.get(workItemId) ?? new Map<string, WorkItemParticipant>();
    const participant = workItemParticipants.get(row.userId);

    if (!participant) {
      workItemParticipants.set(row.userId, {
        userId: row.userId,
        userName: row.userName,
        userImage: row.userImage,
        lastAction: row.eventType,
        lastActionDate: row.createdAt,
        actions: [{ eventType: row.eventType, count: 1, lastDate: row.createdAt }],
      });
      byWorkItem.set(workItemId, workItemParticipants);
      continue;
    }

    const action = participant.actions.find((entry) => entry.eventType === row.eventType);
    if (action) {
      action.count += 1;
      if (row.createdAt > action.lastDate) {
        action.lastDate = row.createdAt;
      }
    } else {
      participant.actions.push({
        eventType: row.eventType,
        count: 1,
        lastDate: row.createdAt,
      });
    }
  }

  const result = new Map<string, WorkItemParticipant[]>();
  for (const workItemId of workItemIds) {
    const participants = Array.from(byWorkItem.get(workItemId)?.values() ?? []).sort(
      (a, b) => b.lastActionDate.getTime() - a.lastActionDate.getTime()
    );
    result.set(workItemId, participants);
  }

  return result;
};
