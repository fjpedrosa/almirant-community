import { db } from "../../client";
import { pushSubscriptions, pushNotificationSettings } from "../../schema";
import { and, eq, inArray } from "drizzle-orm";
import type { PushSubscription, PushNotificationSettings } from "../../schema";

// ---------------------------------------------------------------------------
// Push Subscription CRUD
// ---------------------------------------------------------------------------

export type CreatePushSubscriptionInput = {
  userId: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  userAgent?: string;
  deviceLabel?: string;
};

/**
 * Create or update a push subscription.
 * Uses upsert on the unique `endpoint` column — if the same browser
 * re-registers we update keys instead of creating duplicates.
 */
export const createPushSubscription = async (
  data: CreatePushSubscriptionInput
): Promise<PushSubscription> => {
  const now = new Date();
  const [result] = await db
    .insert(pushSubscriptions)
    .values({
      userId: data.userId,
      endpoint: data.endpoint,
      p256dhKey: data.p256dhKey,
      authKey: data.authKey,
      userAgent: data.userAgent ?? null,
      deviceLabel: data.deviceLabel ?? null,
      isActive: true,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dhKey: data.p256dhKey,
        authKey: data.authKey,
        userAgent: data.userAgent ?? null,
        deviceLabel: data.deviceLabel ?? null,
        isActive: true,
        updatedAt: now,
      },
    })
    .returning();
  return result!;
};

/**
 * Permanently delete a push subscription by its endpoint URL.
 */
export const deletePushSubscription = async (
  endpoint: string
): Promise<boolean> => {
  const result = await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .returning({ id: pushSubscriptions.id });
  return result.length > 0;
};

/**
 * Permanently delete a push subscription by ID, scoped to the owning user
 * for security (a user can only delete their own subscriptions).
 */
export const deletePushSubscriptionById = async (
  id: string,
  userId: string
): Promise<boolean> => {
  const result = await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId))
    )
    .returning({ id: pushSubscriptions.id });
  return result.length > 0;
};

/**
 * Soft-delete: mark a subscription as inactive instead of removing it.
 * Useful when a push service reports an expired / invalid subscription.
 */
export const deactivatePushSubscription = async (
  endpoint: string
): Promise<boolean> => {
  const result = await db
    .update(pushSubscriptions)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .returning({ id: pushSubscriptions.id });
  return result.length > 0;
};

/**
 * Get all active push subscriptions for a given user.
 */
export const getPushSubscriptionsByUserId = async (
  userId: string
): Promise<PushSubscription[]> => {
  return db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.isActive, true)
      )
    );
};

/**
 * Batch lookup of active push subscriptions for multiple users.
 * Returns a Map<userId, PushSubscription[]> for easy per-user iteration.
 */
export const getActivePushSubscriptionsByUserIds = async (
  userIds: string[]
): Promise<Map<string, PushSubscription[]>> => {
  if (userIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        inArray(pushSubscriptions.userId, userIds),
        eq(pushSubscriptions.isActive, true)
      )
    );

  const map = new Map<string, PushSubscription[]>();
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(row);
    map.set(row.userId, list);
  }
  return map;
};

// ---------------------------------------------------------------------------
// Push Notification Settings CRUD
// ---------------------------------------------------------------------------

export type PushNotificationSettingsUpdate = Partial<{
  enabled: boolean;
  notifyWorkItemMoved: boolean;
  notifyWorkItemAssigned: boolean;
  notifyWorkItemDone: boolean;
  notifyReviewCompleted: boolean;
  notifySprintClosed: boolean;
  notifyUserActions: boolean;
}>;

/**
 * Get push notification settings for a user.
 * Returns null when no settings row exists (defaults to enabled).
 */
export const getPushNotificationSettingsByUserId = async (
  userId: string
): Promise<PushNotificationSettings | null> => {
  const [result] = await db
    .select()
    .from(pushNotificationSettings)
    .where(eq(pushNotificationSettings.userId, userId))
    .limit(1);
  return result ?? null;
};

/**
 * Upsert push notification settings.
 * Uses the unique index on userId for conflict resolution.
 */
export const upsertPushNotificationSettings = async (
  userId: string,
  updates: PushNotificationSettingsUpdate
): Promise<PushNotificationSettings> => {
  const now = new Date();
  const [result] = await db
    .insert(pushNotificationSettings)
    .values({
      userId,
      ...updates,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pushNotificationSettings.userId,
      set: {
        ...updates,
        updatedAt: now,
      },
    })
    .returning();
  return result!;
};

/**
 * Get or lazily create push notification settings for a user.
 * When no row exists a new one is created with all defaults (enabled).
 */
export const getOrCreatePushNotificationSettings = async (
  userId: string
): Promise<PushNotificationSettings> => {
  const existing = await getPushNotificationSettingsByUserId(userId);
  if (existing) return existing;
  return upsertPushNotificationSettings(userId, {});
};

// ---------------------------------------------------------------------------
// Push notification event helpers
// ---------------------------------------------------------------------------

type NotificationEventKey =
  | "work_item_moved"
  | "work_item_assigned"
  | "work_item_done"
  | "review_completed"
  | "sprint_closed"
  | "user_actions";

/**
 * Check whether a specific push notification event is enabled for a user.
 * Falls back to true (all enabled) when no settings row exists.
 */
export const isPushEventEnabled = (
  settings: PushNotificationSettings | null,
  event: NotificationEventKey
): boolean => {
  if (!settings) return true;
  if (!settings.enabled) return false;

  switch (event) {
    case "work_item_moved":
      return settings.notifyWorkItemMoved;
    case "work_item_assigned":
      return settings.notifyWorkItemAssigned;
    case "work_item_done":
      return settings.notifyWorkItemDone;
    case "review_completed":
      return settings.notifyReviewCompleted;
    case "sprint_closed":
      return settings.notifySprintClosed;
    case "user_actions":
      return settings.notifyUserActions;
  }
};
