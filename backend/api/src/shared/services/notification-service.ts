import {
  db,
  notifications,
  notificationPreferences,
  eq,
  and,
  desc,
} from "@almirant/database";
import type { NewNotification, NotificationDb } from "@almirant/database";
import { logger } from "@almirant/config";
import { wsConnectionManager } from "../ws/ws-connection-manager";
import { isPushConfigured, sendPushToUser } from "../../domains/notifications/services/push-notification-service";

type NotificationType = "assignment" | "comment" | "mention" | "status_changed";

interface SendNotificationParams {
  recipientUserId: string;
  organizationId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  startAsRead?: boolean;
}

interface UpsertNotificationBySourceParams extends SendNotificationParams {
  sourceEntityType: string;
  sourceEntityId: string;
  bumpToUnreadOnUpdate?: boolean;
}

const emitRealtimeNotification = (
  recipientUserId: string,
  notification: NotificationDb
) => {
  wsConnectionManager.sendToUser(recipientUserId, {
    type: "notification:new",
    payload: {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      actorUserId: notification.actorUserId,
      metadata: notification.metadata ?? {},
      createdAt: notification.createdAt.toISOString(),
    },
  });
};

const getNotificationPreference = async (
  recipientUserId: string,
  organizationId: string,
  type: NotificationType
) => {
  const [pref] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, recipientUserId),
        eq(notificationPreferences.organizationId, organizationId),
        eq(notificationPreferences.notificationType, type)
      )
    )
    .limit(1);

  return pref ?? null;
};

const mapTypeToEventKey = (type: string) => {
  switch (type) {
    case "assignment":
      return "work_item_assigned" as const;
    case "status_changed":
      return "work_item_moved" as const;
    case "comment":
    case "mention":
      return "user_actions" as const;
    default:
      return undefined;
  }
};

const emitPushNotification = (
  recipientUserId: string,
  notification: NotificationDb,
  pushEnabled: boolean | null | undefined
) => {
  if (!isPushConfigured()) return;
  if (!(pushEnabled ?? true)) return;

  sendPushToUser(
    recipientUserId,
    {
      title: notification.title,
      body: notification.body ?? "",
      data: {
        link: notification.link ?? undefined,
        notificationType: notification.type,
      },
    },
    mapTypeToEventKey(notification.type)
  ).catch((err) => {
    logger.error(
      { recipientUserId, error: err },
      "[notification-service] Push dispatch failed"
    );
  });
};

/**
 * Central notification service for in-app notifications.
 *
 * Flow:
 * 1. Check user notification preferences (defaults to enabled if none set)
 * 2. Insert notification row into database
 * 3. Push real-time WS event to the recipient
 *
 * Returns the created notification row, or null if the notification was
 * suppressed by user preferences.
 */
export const sendNotification = async (
  params: SendNotificationParams
): Promise<NotificationDb | null> => {
  const pref = await getNotificationPreference(
    params.recipientUserId,
    params.organizationId,
    params.type
  );
  if (!(pref?.inAppEnabled ?? true)) {
    logger.debug(
      {
        recipientUserId: params.recipientUserId,
        type: params.type,
      },
      "[notification-service] In-app notification suppressed by user preferences"
    );
    return null;
  }

  const startAsRead = params.startAsRead ?? false;

  // 2. Insert notification into database
  const insertValues: NewNotification = {
    recipientUserId: params.recipientUserId,
    organizationId: params.organizationId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
    sourceEntityType: params.sourceEntityType ?? null,
    sourceEntityId: params.sourceEntityId ?? undefined,
    actorUserId: params.actorUserId ?? null,
    isRead: startAsRead,
    readAt: startAsRead ? new Date() : null,
    metadata: params.metadata ?? {},
  };

  const rows = await db
    .insert(notifications)
    .values(insertValues)
    .returning();

  const notification = rows[0];
  if (!notification) {
    logger.error(
      { recipientUserId: params.recipientUserId, type: params.type },
      "[notification-service] Insert returned no rows"
    );
    return null;
  }

  logger.debug(
    {
      notificationId: notification.id,
      recipientUserId: params.recipientUserId,
      type: params.type,
    },
    "[notification-service] Notification created"
  );

  emitRealtimeNotification(params.recipientUserId, notification);

  emitPushNotification(params.recipientUserId, notification, pref?.pushEnabled);

  return notification;
};

/**
 * Upsert notification by source key. If an existing notification is found for
 * the same recipient + org + type + source, update it in place (instead of
 * creating a new row). Useful for lifecycle notifications like PR open/close/merge.
 */
export const upsertNotificationBySource = async (
  params: UpsertNotificationBySourceParams
): Promise<NotificationDb | null> => {
  const bumpToUnread = params.bumpToUnreadOnUpdate ?? true;

  const pref = await getNotificationPreference(
    params.recipientUserId,
    params.organizationId,
    params.type
  );
  if (!(pref?.inAppEnabled ?? true)) {
    logger.debug(
      {
        recipientUserId: params.recipientUserId,
        type: params.type,
      },
      "[notification-service] In-app notification upsert suppressed by user preferences"
    );
    return null;
  }

  const [existing] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, params.recipientUserId),
        eq(notifications.organizationId, params.organizationId),
        eq(notifications.type, params.type),
        eq(notifications.sourceEntityType, params.sourceEntityType),
        eq(notifications.sourceEntityId, params.sourceEntityId)
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1);

  if (!existing) {
    const { bumpToUnreadOnUpdate: _ignored, ...createParams } = params;
    return sendNotification({
      ...createParams,
      startAsRead: !bumpToUnread,
    });
  }

  const [updated] = await db
    .update(notifications)
    .set({
      title: params.title,
      body: params.body ?? null,
      link: params.link ?? null,
      actorUserId: params.actorUserId ?? null,
      metadata: params.metadata ?? {},
      createdAt: new Date(),
      isRead: bumpToUnread ? false : existing.isRead,
      readAt: bumpToUnread ? null : existing.readAt,
    })
    .where(eq(notifications.id, existing.id))
    .returning();

  if (!updated) return null;

  emitRealtimeNotification(params.recipientUserId, updated);
  emitPushNotification(params.recipientUserId, updated, pref?.pushEnabled);
  return updated;
};

/**
 * Convenience helper to send a batch of notifications to multiple recipients.
 * Sends in parallel. Failures for individual recipients are logged but do not
 * block other recipients.
 */
export const sendNotificationBatch = async (
  paramsList: SendNotificationParams[]
): Promise<NotificationDb[]> => {
  const results = await Promise.allSettled(
    paramsList.map((params) => sendNotification(params))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "rejected") {
      const p = paramsList[i];
      logger.error(
        {
          recipientUserId: p?.recipientUserId,
          type: p?.type,
          error: result.reason,
        },
        "[notification-service] Failed to send notification in batch"
      );
    }
  }

  const sent: NotificationDb[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value != null) {
      sent.push(result.value);
    }
  }
  return sent;
};

/**
 * Helper specifically for mention notifications.
 * Skips self-mentions (when the actor mentions themselves).
 */
export const sendMentionNotification = async (params: {
  mentionedUserId: string;
  actorUserId: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  entityTitle: string;
  link?: string;
}): Promise<NotificationDb | null> => {
  // Don't notify yourself
  if (params.mentionedUserId === params.actorUserId) return null;

  return sendNotification({
    recipientUserId: params.mentionedUserId,
    organizationId: params.organizationId,
    type: "mention",
    title: `Te mencionaron en "${params.entityTitle}"`,
    link: params.link,
    sourceEntityType: params.entityType,
    sourceEntityId: params.entityId,
    actorUserId: params.actorUserId,
    metadata: { entityTitle: params.entityTitle },
  });
};
