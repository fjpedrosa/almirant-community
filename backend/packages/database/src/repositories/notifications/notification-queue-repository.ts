import { db } from "../../client";
import { notificationQueue } from "../../schema";
import { and, eq, isNull, lte, sql, asc } from "drizzle-orm";

export const enqueueNotification = async (
  workspaceId: string,
  recipientUserId: string,
  type: "assignment" | "comment" | "mention" | "status_changed",
  debounceKey: string,
  payload: Record<string, unknown>,
  debounceMinutes: number
): Promise<void> => {
  const scheduledAt = new Date(Date.now() + debounceMinutes * 60 * 1000);

  // Check if there's already a pending notification with the same debounceKey
  const [existing] = await db
    .select({ id: notificationQueue.id })
    .from(notificationQueue)
    .where(
      and(
        eq(notificationQueue.debounceKey, debounceKey),
        isNull(notificationQueue.sentAt)
      )
    )
    .limit(1);

  if (existing) {
    // Reset the timer and update payload with latest data
    await db
      .update(notificationQueue)
      .set({ scheduledAt, payload })
      .where(eq(notificationQueue.id, existing.id));
  } else {
    // Insert new notification
    await db.insert(notificationQueue).values({
      workspaceId,
      recipientUserId,
      type,
      debounceKey,
      payload,
      scheduledAt,
    });
  }
};

export const getPendingNotifications = async (
  batchSize: number = 50
): Promise<(typeof notificationQueue.$inferSelect)[]> => {
  const now = new Date();
  return db
    .select()
    .from(notificationQueue)
    .where(
      and(
        isNull(notificationQueue.sentAt),
        lte(notificationQueue.scheduledAt, now)
      )
    )
    .orderBy(asc(notificationQueue.scheduledAt))
    .limit(batchSize);
};

export const markAsSent = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  const now = new Date();
  await db
    .update(notificationQueue)
    .set({ sentAt: now })
    .where(
      sql`${notificationQueue.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`
    );
};

export const getGroupedPendingByRecipient = async (
  recipientUserId: string,
  type: "assignment" | "comment" | "mention" | "status_changed"
): Promise<(typeof notificationQueue.$inferSelect)[]> => {
  return db
    .select()
    .from(notificationQueue)
    .where(
      and(
        eq(notificationQueue.recipientUserId, recipientUserId),
        eq(notificationQueue.type, type),
        isNull(notificationQueue.sentAt)
      )
    )
    .orderBy(asc(notificationQueue.createdAt));
};
