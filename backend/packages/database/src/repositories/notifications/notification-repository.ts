import { db } from "../../client";
import { notifications, notificationPreferences } from "../../schema";
import { user } from "../../schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { NotificationDb, NotificationPreference } from "../../schema";

export interface NotificationWithActor extends NotificationDb {
  actor: { id: string; name: string; image: string | null } | null;
}

/**
 * Get paginated notifications for a user within an organization.
 * Joins with the user table to resolve actor name/image.
 */
export const getNotifications = async (
  userId: string,
  orgId: string,
  filters?: { type?: string; isRead?: boolean },
  pagination?: { page: number; limit: number; offset: number }
): Promise<{ items: NotificationWithActor[]; total: number }> => {
  const limit = pagination?.limit ?? 50;
  const offset = pagination?.offset ?? 0;

  const conditions = [
    eq(notifications.recipientUserId, userId),
    eq(notifications.organizationId, orgId),
  ];

  if (filters?.type) {
    conditions.push(eq(notifications.type, filters.type as NotificationDb["type"]));
  }

  if (filters?.isRead !== undefined) {
    conditions.push(eq(notifications.isRead, filters.isRead));
  }

  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: notifications.id,
        recipientUserId: notifications.recipientUserId,
        organizationId: notifications.organizationId,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        sourceEntityType: notifications.sourceEntityType,
        sourceEntityId: notifications.sourceEntityId,
        actorUserId: notifications.actorUserId,
        isRead: notifications.isRead,
        readAt: notifications.readAt,
        metadata: notifications.metadata,
        createdAt: notifications.createdAt,
        actorId: user.id,
        actorName: user.name,
        actorImage: user.image,
      })
      .from(notifications)
      .leftJoin(user, eq(notifications.actorUserId, user.id))
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(where),
  ]);

  const items: NotificationWithActor[] = rows.map((row) => ({
    id: row.id,
    recipientUserId: row.recipientUserId,
    organizationId: row.organizationId,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    actorUserId: row.actorUserId,
    isRead: row.isRead,
    readAt: row.readAt,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actor: row.actorId
      ? { id: row.actorId, name: row.actorName ?? "Unknown", image: row.actorImage }
      : null,
  }));

  return { items, total: countResult[0]?.count ?? 0 };
};

/**
 * Get the count of unread notifications for a user in an organization.
 * Optimized COUNT query -- will be called frequently from the UI.
 */
export const getUnreadCount = async (
  userId: string,
  orgId: string
): Promise<number> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.organizationId, orgId),
        eq(notifications.isRead, false)
      )
    );

  return result?.count ?? 0;
};

/**
 * Mark a single notification as read.
 * Only the recipient can mark their own notification.
 */
export const markNotificationAsRead = async (
  notificationId: string,
  userId: string
): Promise<boolean> => {
  const result = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientUserId, userId)
      )
    )
    .returning({ id: notifications.id });

  return result.length > 0;
};

/**
 * Mark all unread notifications as read for a user in an organization.
 * Returns the count of notifications that were updated.
 */
export const markAllNotificationsAsRead = async (
  userId: string,
  orgId: string
): Promise<number> => {
  const result = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.organizationId, orgId),
        eq(notifications.isRead, false)
      )
    )
    .returning({ id: notifications.id });

  return result.length;
};

/**
 * Get all notification preferences for a user in an organization.
 */
export const getNotificationPreferences = async (
  userId: string,
  orgId: string
): Promise<NotificationPreference[]> => {
  return db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.organizationId, orgId)
      )
    );
};

/**
 * Upsert a notification preference for a specific notification type.
 * Uses the unique index (userId, organizationId, notificationType) for conflict resolution.
 */
export const upsertNotificationPreference = async (
  userId: string,
  orgId: string,
  notificationType: string,
  inAppEnabled: boolean,
  emailEnabled: boolean,
  pushEnabled: boolean = true
): Promise<NotificationPreference> => {
  const [result] = await db
    .insert(notificationPreferences)
    .values({
      userId,
      organizationId: orgId,
      notificationType: notificationType as NotificationPreference["notificationType"],
      inAppEnabled,
      emailEnabled,
      pushEnabled,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.organizationId,
        notificationPreferences.notificationType,
      ],
      set: {
        inAppEnabled,
        emailEnabled,
        pushEnabled,
        updatedAt: new Date(),
      },
    })
    .returning();

  return result!;
};
