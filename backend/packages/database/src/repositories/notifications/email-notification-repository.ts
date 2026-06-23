import { db } from "../../client";
import { emailNotificationSettings, user } from "../../schema";
import { eq } from "drizzle-orm";

export type EmailNotificationSettingsUpdate = Partial<{
  enabled: boolean;
  notifyWorkItemMoved: boolean;
  notifyWorkItemAssigned: boolean;
  notifyWorkItemDone: boolean;
  notifyReviewCompleted: boolean;
  notifySprintClosed: boolean;
  notifyUserActions: boolean;
}>;

export const getEmailNotificationSettingsByUserId = async (userId: string) => {
  const [result] = await db
    .select()
    .from(emailNotificationSettings)
    .where(eq(emailNotificationSettings.userId, userId))
    .limit(1);
  return result ?? null;
};

export const upsertEmailNotificationSettings = async (
  userId: string,
  updates: EmailNotificationSettingsUpdate
) => {
  const now = new Date();
  const [result] = await db
    .insert(emailNotificationSettings)
    .values({
      userId,
      ...updates,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: emailNotificationSettings.userId,
      set: {
        ...updates,
        updatedAt: now,
      },
    })
    .returning();
  return result ?? null;
};

export const getOrCreateEmailNotificationSettings = async (userId: string) => {
  const existing = await getEmailNotificationSettingsByUserId(userId);
  if (existing) return existing;
  return upsertEmailNotificationSettings(userId, {});
};

type NotificationEventKey =
  | "work_item_moved"
  | "work_item_assigned"
  | "work_item_done"
  | "review_completed"
  | "sprint_closed"
  | "user_actions";

export const isEmailEventEnabled = (
  settings: (typeof emailNotificationSettings.$inferSelect) | null,
  event: NotificationEventKey
): boolean => {
  // If the user never configured settings, defaults apply (all enabled).
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

/**
 * List all users who should receive an email notification for a given event.
 * Joins the `user` table with `email_notification_settings` and filters
 * by the per-event toggle (defaulting to enabled when no settings row exists).
 */
export const listEmailNotificationRecipients = async (args: {
  event: NotificationEventKey;
}) => {
  const rows = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      settings: emailNotificationSettings,
    })
    .from(user)
    .leftJoin(
      emailNotificationSettings,
      eq(emailNotificationSettings.userId, user.id)
    );

  return rows
    .filter((row) => isEmailEventEnabled(row.settings ?? null, args.event))
    .map((row) => ({ userId: row.userId, email: row.email, name: row.name }));
};
