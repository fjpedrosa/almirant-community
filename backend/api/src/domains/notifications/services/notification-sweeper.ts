import type { NotificationQueueDb } from "@almirant/database";
import type {
  AssignmentItem,
  CommentItem,
  MentionItem,
  StatusChangedItem,
} from "./email-templates";
import { logger } from "@almirant/config";
import { parseLocale, DEFAULT_LOCALE, type Locale } from "@almirant/i18n";

type NotificationSweeperConfig = {
  intervalMs?: number;
  batchSize?: number;
};

/** Injectable dependencies for testing. */
export type SweeperDeps = {
  getPendingNotifications: (batchSize: number) => Promise<NotificationQueueDb[]>;
  markAsSent: (ids: string[]) => Promise<void>;
  isEmailConfigured: () => boolean;
  sendEmail: (opts: {
    to: string;
    subject: string;
    html: string;
  }) => Promise<{ success: boolean; error?: string }>;
  buildAssignmentEmail: (
    name: string,
    items: AssignmentItem[],
    locale: Locale,
  ) => { subject: string; html: string };
  buildCommentEmail: (
    name: string,
    items: CommentItem[],
    locale: Locale,
  ) => { subject: string; html: string };
  buildMentionEmail: (
    name: string,
    items: MentionItem[],
    locale: Locale,
  ) => { subject: string; html: string };
  buildStatusChangedEmail: (
    name: string,
    items: StatusChangedItem[],
    locale: Locale,
  ) => { subject: string; html: string };
  lookupRecipient: (
    userId: string,
  ) => Promise<{ name: string; email: string; locale: string } | null>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
};

let prodDepsPromise: Promise<SweeperDeps> | null = null;

const getProdDeps = async (): Promise<SweeperDeps> => {
  if (prodDepsPromise) return prodDepsPromise;

  prodDepsPromise = (async () => {
    const [dbModule, emailModule, templatesModule] = await Promise.all([
      import("@almirant/database"),
      import("../../../shared/services/email-service"),
      import("./email-templates"),
    ]);

    return {
      getPendingNotifications: dbModule.getPendingNotifications,
      markAsSent: dbModule.markAsSent,
      isEmailConfigured: emailModule.isEmailConfigured,
      sendEmail: emailModule.sendEmail,
      buildAssignmentEmail: templatesModule.buildAssignmentEmail,
      buildCommentEmail: templatesModule.buildCommentEmail,
      buildMentionEmail: templatesModule.buildMentionEmail,
      buildStatusChangedEmail: templatesModule.buildStatusChangedEmail,
      lookupRecipient: async (userId: string) => {
        const [row] = await dbModule.db
          .select({ name: dbModule.user.name, email: dbModule.user.email, locale: dbModule.user.locale })
          .from(dbModule.user)
          .where(dbModule.eq(dbModule.user.id, userId))
          .limit(1);
        return row ?? null;
      },
      logger,
    };
  })();

  return prodDepsPromise;
};

/**
 * Groups notifications by a composite key of (recipientUserId, type).
 * Returns a Map where key = "userId:type" and value = array of notifications.
 */
const groupNotifications = (
  notifications: NotificationQueueDb[]
): Map<string, NotificationQueueDb[]> => {
  const groups = new Map<string, NotificationQueueDb[]>();

  for (const notification of notifications) {
    const key = `${notification.recipientUserId}:${notification.type}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(notification);
    } else {
      groups.set(key, [notification]);
    }
  }

  return groups;
};

/** Pick the first non-empty string from a list of payload fields. */
const firstString = (...values: unknown[]): string | null => {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
};

const coercePayloadText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  let normalized = value.trim();
  if (!normalized) return null;

  // Handle payloads that arrive as JSON-stringified text.
  for (let i = 0; i < 2; i++) {
    if (!(normalized.startsWith("\"") && normalized.endsWith("\""))) {
      break;
    }

    try {
      const parsed = JSON.parse(normalized);
      if (typeof parsed !== "string") break;
      normalized = parsed.trim();
    } catch {
      break;
    }
  }

  return normalized || null;
};

/**
 * Extracts AssignmentItem data from a notification's payload.
 * Returns null if required fields are missing.
 */
const toAssignmentItem = (
  notification: NotificationQueueDb
): AssignmentItem | null => {
  const p = notification.payload;
  const ideaItemId = firstString(p.ideaItemId, p.seedId, p.todoId);
  const ideaItemTitle = firstString(p.ideaItemTitle, p.seedTitle, p.todoTitle);
  const assignerName = firstString(p.assignerName);
  const itemLink = typeof p.itemLink === "string" ? p.itemLink : undefined;

  if (!ideaItemId || !ideaItemTitle || !assignerName) return null;
  return { ideaItemId, ideaItemTitle, assignerName, itemLink };
};

/**
 * Extracts CommentItem data from a notification's payload.
 * Returns null if required fields are missing.
 */
const toCommentItem = (
  notification: NotificationQueueDb
): CommentItem | null => {
  const p = notification.payload;
  const ideaItemId = coercePayloadText(p.ideaItemId) ?? coercePayloadText(p.seedId) ?? coercePayloadText(p.todoId);
  const ideaItemTitle = coercePayloadText(p.ideaItemTitle) ?? coercePayloadText(p.seedTitle) ?? coercePayloadText(p.todoTitle);
  const commentContent = coercePayloadText(p.commentContent);
  const commenterName = coercePayloadText(p.commenterName);
  const itemLink = coercePayloadText(p.itemLink) ?? undefined;

  if (!ideaItemId || !ideaItemTitle || !commentContent || !commenterName)
    return null;
  return { ideaItemId, ideaItemTitle, commentContent, commenterName, itemLink };
};

/**
 * Extracts MentionItem data from a notification's payload.
 * Returns null if required fields are missing.
 */
const toMentionItem = (
  notification: NotificationQueueDb
): MentionItem | null => {
  const p = notification.payload;
  const ideaItemId = coercePayloadText(p.ideaItemId) ?? coercePayloadText(p.seedId) ?? coercePayloadText(p.todoId);
  const ideaItemTitle = coercePayloadText(p.ideaItemTitle) ?? coercePayloadText(p.seedTitle) ?? coercePayloadText(p.todoTitle);
  const commentContent = coercePayloadText(p.commentContent);
  const mentionerName = coercePayloadText(p.mentionerName);
  const itemLink = coercePayloadText(p.itemLink) ?? undefined;

  if (!ideaItemId || !ideaItemTitle || !commentContent || !mentionerName)
    return null;
  return { ideaItemId, ideaItemTitle, commentContent, mentionerName, itemLink };
};

const toStatusChangedItem = (
  notification: NotificationQueueDb
): StatusChangedItem | null => {
  const p = notification.payload;
  const title = coercePayloadText(p.title);
  const body = coercePayloadText(p.body);
  const itemLink = coercePayloadText(p.itemLink) ?? undefined;

  if (!title) return null;
  return { title, body, itemLink };
};

/**
 * Builds the email subject and HTML body for a group of notifications.
 * Extracts structured items from each notification's payload and delegates
 * to the appropriate template builder based on notification type.
 */
const buildEmailForGroup = (
  type: string,
  notifications: NotificationQueueDb[],
  recipientName: string,
  locale: Locale,
  deps: SweeperDeps
): { subject: string; html: string } | null => {
  switch (type) {
    case "assignment": {
      const items: AssignmentItem[] = [];
      for (const n of notifications) {
        const item = toAssignmentItem(n);
        if (item) items.push(item);
        else
          deps.logger.warn(
            { notificationId: n.id, payload: n.payload },
            "[notification-sweeper] Assignment notification has invalid payload, skipping item"
          );
      }
      if (items.length === 0) return null;
      return deps.buildAssignmentEmail(recipientName, items, locale);
    }
    case "comment": {
      const items: CommentItem[] = [];
      for (const n of notifications) {
        const item = toCommentItem(n);
        if (item) items.push(item);
        else
          deps.logger.warn(
            { notificationId: n.id, payload: n.payload },
            "[notification-sweeper] Comment notification has invalid payload, skipping item"
          );
      }
      if (items.length === 0) return null;
      return deps.buildCommentEmail(recipientName, items, locale);
    }
    case "mention": {
      const items: MentionItem[] = [];
      for (const n of notifications) {
        const item = toMentionItem(n);
        if (item) items.push(item);
        else
          deps.logger.warn(
            { notificationId: n.id, payload: n.payload },
            "[notification-sweeper] Mention notification has invalid payload, skipping item"
          );
      }
      if (items.length === 0) return null;
      return deps.buildMentionEmail(recipientName, items, locale);
    }
    case "status_changed": {
      const items: StatusChangedItem[] = [];
      for (const n of notifications) {
        const item = toStatusChangedItem(n);
        if (item) items.push(item);
        else
          deps.logger.warn(
            { notificationId: n.id, payload: n.payload },
            "[notification-sweeper] Status change notification has invalid payload, skipping item"
          );
      }
      if (items.length === 0) return null;
      return deps.buildStatusChangedEmail(recipientName, items, locale);
    }
    default:
      deps.logger.warn(
        { type, count: notifications.length },
        "[notification-sweeper] Unknown notification type, skipping group"
      );
      return null;
  }
};

/**
 * Single sweep: fetch pending notifications, group by recipient+type,
 * build emails, send, and mark successful ones as sent.
 *
 * Accepts an optional `deps` override for testing (no mock.module needed).
 */
export const runNotificationSweeperOnce = async (
  cfg?: NotificationSweeperConfig,
  depsOverride?: SweeperDeps
): Promise<void> => {
  const d = depsOverride ?? (await getProdDeps());
  const batchSize = cfg?.batchSize ?? 50;

  // Guard: skip entirely if email is not configured
  if (!d.isEmailConfigured()) {
    d.logger.debug(
      "[notification-sweeper] Email not configured (RESEND_API_KEY missing), skipping sweep"
    );
    return;
  }

  // 1. Fetch pending notifications where scheduledAt <= NOW()
  const pending = await d.getPendingNotifications(batchSize);
  if (pending.length === 0) return;

  d.logger.info(
    { count: pending.length },
    "[notification-sweeper] Processing pending notifications"
  );

  // 2. Group by (recipientUserId, type)
  const groups = groupNotifications(pending);
  const successfulIds: string[] = [];

  // 3. Process each group
  for (const [key, notifications] of groups) {
    const separatorIndex = key.indexOf(":");
    const recipientUserId = key.slice(0, separatorIndex);
    const type = key.slice(separatorIndex + 1);

    try {
      // 3a. Look up recipient
      const recipient = await d.lookupRecipient(recipientUserId);
      if (!recipient) {
        d.logger.warn(
          { recipientUserId, type, count: notifications.length },
          "[notification-sweeper] Recipient user not found, skipping group"
        );
        continue;
      }

      if (!recipient.email) {
        d.logger.warn(
          { recipientUserId, type, count: notifications.length },
          "[notification-sweeper] Recipient has no email, skipping group"
        );
        continue;
      }

      // 3b. Build email content with user's locale
      const userLocale = parseLocale(recipient.locale) ?? DEFAULT_LOCALE;
      const emailContent = buildEmailForGroup(
        type,
        notifications,
        recipient.name,
        userLocale,
        d
      );

      if (!emailContent) {
        d.logger.warn(
          { recipientUserId, type, count: notifications.length },
          "[notification-sweeper] Could not build email content, skipping group"
        );
        continue;
      }

      const { subject, html } = emailContent;

      // 3c. Send email
      const result = await d.sendEmail({
        to: recipient.email,
        subject,
        html,
      });

      if (result.success) {
        // 3d. Collect IDs for marking as sent
        const ids = notifications.map((n) => n.id);
        successfulIds.push(...ids);

        d.logger.info(
          {
            recipientUserId,
            recipientEmail: recipient.email,
            type,
            count: notifications.length,
          },
          "[notification-sweeper] Email sent successfully"
        );
      } else {
        // 3e. Log failure, do NOT collect IDs (will retry next tick)
        d.logger.error(
          {
            recipientUserId,
            recipientEmail: recipient.email,
            type,
            count: notifications.length,
            error: result.error,
          },
          "[notification-sweeper] Failed to send email, will retry"
        );
      }
    } catch (err) {
      d.logger.error(
        {
          err,
          recipientUserId,
          type,
          count: notifications.length,
        },
        "[notification-sweeper] Unexpected error processing notification group"
      );
    }
  }

  // 4. Mark all successfully sent notifications
  if (successfulIds.length > 0) {
    await d.markAsSent(successfulIds);
    d.logger.info(
      { sentCount: successfulIds.length, totalCount: pending.length },
      "[notification-sweeper] Marked notifications as sent"
    );
  }
};

/**
 * Starts the notification sweeper as a background service.
 * Returns a stop function for graceful shutdown.
 */
export const startNotificationSweeper = (
  cfg?: NotificationSweeperConfig
): (() => void) => {
  const intervalMs = cfg?.intervalMs ?? 30_000;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runNotificationSweeperOnce(cfg);
    } catch (err) {
      logger.error(
        { err },
        "[notification-sweeper] Unhandled error in sweep tick"
      );
    } finally {
      running = false;
    }
  };

  // Run once shortly after boot (but don't block startup).
  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info(
    { intervalMs },
    "[notification-sweeper] Background sweeper started"
  );

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[notification-sweeper] Background sweeper stopped");
  };
};
