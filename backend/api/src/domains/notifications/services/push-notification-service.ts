import webpush from "web-push";
import { env, logger } from "@almirant/config";
import {
  getPushSubscriptionsByUserId,
  getActivePushSubscriptionsByUserIds,
  getPushNotificationSettingsByUserId,
  deactivatePushSubscription,
  isPushEventEnabled,
} from "@almirant/database";
import type { PushSubscription as PushSubscriptionRow } from "@almirant/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    link?: string;
    notificationType?: string;
  };
}

type NotificationEventKey =
  | "work_item_moved"
  | "work_item_assigned"
  | "work_item_done"
  | "review_completed"
  | "sprint_closed"
  | "user_actions";

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

let pushInitialized = false;

/**
 * Returns true only when all three VAPID environment variables are present.
 */
export const isPushConfigured = (): boolean =>
  Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

// ---------------------------------------------------------------------------
// Lazy initialization
// ---------------------------------------------------------------------------

/**
 * Calls `webpush.setVapidDetails()` exactly once (lazy, idempotent).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
const initializePush = (): void => {
  if (pushInitialized) return;
  if (!isPushConfigured()) return;

  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!
  );
  pushInitialized = true;
  logger.info("[push-notification-service] VAPID keys configured");
};

// ---------------------------------------------------------------------------
// Internal send helpers
// ---------------------------------------------------------------------------

const toWebPushSubscription = (sub: PushSubscriptionRow) => ({
  endpoint: sub.endpoint,
  keys: {
    p256dh: sub.p256dhKey,
    auth: sub.authKey,
  },
});

const serializePayload = (payload: PushNotificationPayload): string =>
  JSON.stringify(payload);

/**
 * Send a push notification to a single subscription row.
 * Handles 410 Gone by deactivating the subscription.
 */
const sendToSubscription = async (
  sub: PushSubscriptionRow,
  payload: PushNotificationPayload
): Promise<void> => {
  const pushSub = toWebPushSubscription(sub);
  try {
    await webpush.sendNotification(pushSub, serializePayload(payload));
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) {
      const statusCode = (err as WebPushError).statusCode;
      // 410 Gone = subscription expired / unsubscribed
      if (statusCode === 410) {
        logger.info(
          { endpoint: sub.endpoint },
          "[push-notification-service] Subscription gone (410), deactivating"
        );
        await deactivatePushSubscription(sub.endpoint);
        return;
      }
    }
    throw err; // re-throw for caller to handle
  }
};

// ---------------------------------------------------------------------------
// WebPushError type (from web-push library)
// ---------------------------------------------------------------------------

interface WebPushError extends Error {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a push notification to all active subscriptions for a single user.
 * Optionally pass a `notificationEvent` to check per-event user settings.
 *
 * Fire-and-forget: returns void, all errors are caught and logged.
 */
export const sendPushToUser = async (
  userId: string,
  payload: PushNotificationPayload,
  notificationEvent?: NotificationEventKey
): Promise<void> => {
  try {
    if (!isPushConfigured()) return;

    // Check user-level notification settings
    const settings = await getPushNotificationSettingsByUserId(userId);
    if (settings && !settings.enabled) {
      logger.debug(
        { userId },
        "[push-notification-service] Push disabled in user settings, skipping"
      );
      return;
    }

    // Check per-event toggle if provided
    if (notificationEvent && !isPushEventEnabled(settings, notificationEvent)) {
      logger.debug(
        { userId, event: notificationEvent },
        "[push-notification-service] Push event disabled in user settings, skipping"
      );
      return;
    }

    const subscriptions = await getPushSubscriptionsByUserId(userId);
    if (subscriptions.length === 0) return;

    initializePush();

    const results = await Promise.allSettled(
      subscriptions.map((sub) => sendToSubscription(sub, payload))
    );

    // Log individual failures (but don't throw)
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        logger.error(
          {
            userId,
            endpoint: subscriptions[i]?.endpoint,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          },
          "[push-notification-service] Failed to send push to subscription"
        );
      }
    }
  } catch (err) {
    logger.error(
      { userId, error: err },
      "[push-notification-service] sendPushToUser failed"
    );
  }
};

/**
 * Send a push notification to all active subscriptions for multiple users.
 * Uses batch subscription lookup for efficiency.
 *
 * Fire-and-forget: returns void, all errors are caught and logged.
 */
export const sendPushToUsers = async (
  userIds: string[],
  payload: PushNotificationPayload,
  notificationEvent?: NotificationEventKey
): Promise<void> => {
  try {
    if (!isPushConfigured()) return;
    if (userIds.length === 0) return;

    const subscriptionsMap =
      await getActivePushSubscriptionsByUserIds(userIds);
    if (subscriptionsMap.size === 0) return;

    initializePush();

    // For each user, check settings and send to their subscriptions
    const sendPromises: Promise<void>[] = [];

    for (const [userId, subs] of subscriptionsMap) {
      // Check settings asynchronously per user, then send
      const userSend = async (): Promise<void> => {
        try {
          const settings = await getPushNotificationSettingsByUserId(userId);
          if (settings && !settings.enabled) return;

          if (
            notificationEvent &&
            !isPushEventEnabled(settings, notificationEvent)
          ) {
            return;
          }

          const results = await Promise.allSettled(
            subs.map((sub) => sendToSubscription(sub, payload))
          );

          for (let i = 0; i < results.length; i++) {
            const result = results[i]!;
            if (result.status === "rejected") {
              logger.error(
                {
                  userId,
                  endpoint: subs[i]?.endpoint,
                  error:
                    result.reason instanceof Error
                      ? result.reason.message
                      : String(result.reason),
                },
                "[push-notification-service] Failed to send push to subscription"
              );
            }
          }
        } catch (err) {
          logger.error(
            { userId, error: err },
            "[push-notification-service] Failed in batch send for user"
          );
        }
      };

      sendPromises.push(userSend());
    }

    await Promise.allSettled(sendPromises);
  } catch (err) {
    logger.error(
      { userIds, error: err },
      "[push-notification-service] sendPushToUsers failed"
    );
  }
};
