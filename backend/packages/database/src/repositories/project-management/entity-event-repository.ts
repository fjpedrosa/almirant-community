import { db } from "../../client";
import { entityEvents, user } from "../../schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { NewEntityEvent } from "../../schema/entity-events";
import type { PaginationParams } from "../../domain/types";

export type EntityType = "idea" | "todo" | "work_item" | "seed" | "feedback_item";

export interface EntityEventFilters {
  eventType?: string;
}

export interface EntityEventWithUser {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  triggeredBy: string;
  triggeredByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  triggeredByUserName: string | null;
  triggeredByUserImage: string | null;
  triggeredByUserEmail: string | null;
}

export const getEntityEvents = async (
  entityType: EntityType,
  entityId: string,
  pagination: PaginationParams,
  filters?: EntityEventFilters
): Promise<{ items: EntityEventWithUser[]; total: number }> => {
  const conditions = [
    eq(entityEvents.entityType, entityType),
    eq(entityEvents.entityId, entityId),
  ];

  if (filters?.eventType) {
    conditions.push(eq(entityEvents.eventType, filters.eventType));
  }

  const whereClause = and(...conditions);

  const [itemsResult, countResult] = await Promise.all([
    db
      .select({
        id: entityEvents.id,
        entityType: entityEvents.entityType,
        entityId: entityEvents.entityId,
        eventType: entityEvents.eventType,
        fieldName: entityEvents.fieldName,
        oldValue: entityEvents.oldValue,
        newValue: entityEvents.newValue,
        triggeredBy: entityEvents.triggeredBy,
        triggeredByUserId: entityEvents.triggeredByUserId,
        metadata: entityEvents.metadata,
        createdAt: entityEvents.createdAt,
        triggeredByUserName: user.name,
        triggeredByUserImage: user.image,
        triggeredByUserEmail: user.email,
      })
      .from(entityEvents)
      .leftJoin(user, eq(entityEvents.triggeredByUserId, user.id))
      .where(whereClause)
      .orderBy(desc(entityEvents.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entityEvents)
      .where(whereClause),
  ]);

  return {
    items: itemsResult as EntityEventWithUser[],
    total: countResult[0]?.count ?? 0,
  };
};

export const createEntityEvent = async (event: NewEntityEvent): Promise<void> => {
  await db.insert(entityEvents).values(event);
};

export const createEntityEvents = async (events: NewEntityEvent[]): Promise<void> => {
  if (events.length === 0) return;
  await db.insert(entityEvents).values(events);
};

export const serializeEntityEventValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
