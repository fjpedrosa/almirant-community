import { db } from "../../client";
import {
  telegramAccounts,
  telegramNotificationSettings,
  user,
} from "../../schema";
import { and, eq, ilike, or } from "drizzle-orm";

export type TelegramNotificationSettingsUpdate = Partial<{
  enabled: boolean;
  notifyWorkItemMoved: boolean;
  notifyWorkItemAssigned: boolean;
  notifyWorkItemDone: boolean;
  notifyReviewCompleted: boolean;
  notifySprintClosed: boolean;
  notifyUserActions: boolean;
}>;

export const getTelegramNotificationSettingsByUserId = async (userId: string) => {
  const [result] = await db
    .select()
    .from(telegramNotificationSettings)
    .where(eq(telegramNotificationSettings.userId, userId))
    .limit(1);
  return result ?? null;
};

export const upsertTelegramNotificationSettings = async (
  userId: string,
  updates: TelegramNotificationSettingsUpdate
) => {
  const now = new Date();
  const [result] = await db
    .insert(telegramNotificationSettings)
    .values({
      userId,
      ...updates,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: telegramNotificationSettings.userId,
      set: {
        ...updates,
        updatedAt: now,
      },
    })
    .returning();
  return result ?? null;
};

export const getOrCreateTelegramNotificationSettings = async (userId: string) => {
  const existing = await getTelegramNotificationSettingsByUserId(userId);
  if (existing) return existing;
  return upsertTelegramNotificationSettings(userId, {});
};

export const getTelegramAccountByAssignee = async (assignee: string) => {
  const trimmed = assignee.trim();
  if (!trimmed) return null;

  const byEmail = trimmed.includes("@");

  const [result] = await db
    .select({
      chatId: telegramAccounts.chatId,
      userId: telegramAccounts.userId,
    })
    .from(telegramAccounts)
    .innerJoin(user, eq(user.id, telegramAccounts.userId))
    .where(
      byEmail
        ? eq(user.email, trimmed)
        : or(eq(user.name, trimmed), ilike(user.name, trimmed))
    )
    .limit(1);

  return result ?? null;
};

type NotificationEventKey =
  | "work_item_moved"
  | "work_item_assigned"
  | "work_item_done"
  | "review_completed"
  | "sprint_closed"
  | "user_actions";

const isEventEnabled = (
  settings: (typeof telegramNotificationSettings.$inferSelect) | null,
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

export const listTelegramNotificationRecipients = async (args: {
  event: NotificationEventKey;
}) => {
  const rows = await db
    .select({
      userId: telegramAccounts.userId,
      chatId: telegramAccounts.chatId,
      settings: telegramNotificationSettings,
    })
    .from(telegramAccounts)
    .leftJoin(
      telegramNotificationSettings,
      eq(telegramNotificationSettings.userId, telegramAccounts.userId)
    );

  return rows
    .filter((row) => isEventEnabled(row.settings ?? null, args.event))
    .map((row) => ({ userId: row.userId, chatId: row.chatId }));
};

