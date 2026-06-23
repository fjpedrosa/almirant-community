import { logger } from "@almirant/config";
import {
  getBoardByIdInternal,
  getTelegramAccountByAssignee,
  getTelegramNotificationSettingsByUserId,
  getWorkItemById,
  listTelegramNotificationRecipients,
} from "@almirant/database";
import { telegramBot } from "../telegram-bot";
import { getFrontendBaseUrl } from "../telegram-utils";
import {
  buildReviewCompletedMessage,
  buildSprintClosedMessage,
  buildWorkItemAssignedMessage,
  buildWorkItemDoneMessage,
  buildWorkItemMovedMessage,
  buildUserActionsMessage,
} from "./templates";

const PER_CHAT_RATE_LIMIT_MS = 1000;
const lastSentAtByChatId = new Map<string, number>();

const allowSendForChat = (chatId: string): boolean => {
  const now = Date.now();
  const last = lastSentAtByChatId.get(chatId) ?? 0;
  if (now - last < PER_CHAT_RATE_LIMIT_MS) return false;
  lastSentAtByChatId.set(chatId, now);
  return true;
};

const buildWorkItemUrl = async (args: { boardId: string; taskId: string | null }) => {
  const baseUrl = getFrontendBaseUrl();
  const board = await getBoardByIdInternal(args.boardId);
  const params = new URLSearchParams();

  if (board?.area && board.area !== "desarrollo") {
    params.set("area", board.area);
  }
  params.set("board", args.boardId);
  if (args.taskId) {
    params.set("search", args.taskId);
  }

  const qs = params.toString();
  return qs ? `${baseUrl}/?${qs}` : `${baseUrl}/`;
};

export const notifyWorkItemMoved = async (args: {
  workItemId: string;
  fromColumnName: string;
  toColumnName: string;
}) => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const account = await getTelegramAccountByAssignee(workItem.assignee);
    if (!account) return;

    const settings = await getTelegramNotificationSettingsByUserId(account.userId);
    if (settings && (!settings.enabled || !settings.notifyWorkItemMoved)) return;

    if (!allowSendForChat(account.chatId)) return;

    const url = await buildWorkItemUrl({ boardId: workItem.boardId, taskId: workItem.taskId ?? null });
    const msg = buildWorkItemMovedMessage({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      projectName: workItem.projectName ?? null,
      boardName: workItem.boardName ?? null,
      fromColumnName: args.fromColumnName,
      toColumnName: args.toColumnName,
      url,
    });

    await telegramBot.sendMessage({
      chatId: account.chatId,
      text: msg.text,
      parseMode: "MarkdownV2",
      replyMarkup: msg.replyMarkup,
    });
  } catch (err) {
    logger.error(err, "notifyWorkItemMoved failed");
  }
};

export const notifyWorkItemAssigned = async (args: {
  workItemId: string;
  assignee: string;
}) => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem) return;

    const account = await getTelegramAccountByAssignee(args.assignee);
    if (!account) return;

    const settings = await getTelegramNotificationSettingsByUserId(account.userId);
    if (settings && (!settings.enabled || !settings.notifyWorkItemAssigned)) return;

    if (!allowSendForChat(account.chatId)) return;

    const url = await buildWorkItemUrl({ boardId: workItem.boardId, taskId: workItem.taskId ?? null });
    const msg = buildWorkItemAssignedMessage({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      projectName: workItem.projectName ?? null,
      boardName: workItem.boardName ?? null,
      assignee: args.assignee,
      url,
    });

    await telegramBot.sendMessage({
      chatId: account.chatId,
      text: msg.text,
      parseMode: "MarkdownV2",
      replyMarkup: msg.replyMarkup,
    });
  } catch (err) {
    logger.error(err, "notifyWorkItemAssigned failed");
  }
};

export const notifyWorkItemDone = async (args: { workItemId: string }) => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const account = await getTelegramAccountByAssignee(workItem.assignee);
    if (!account) return;

    const settings = await getTelegramNotificationSettingsByUserId(account.userId);
    if (settings && (!settings.enabled || !settings.notifyWorkItemDone)) return;

    if (!allowSendForChat(account.chatId)) return;

    const url = await buildWorkItemUrl({ boardId: workItem.boardId, taskId: workItem.taskId ?? null });
    const msg = buildWorkItemDoneMessage({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      projectName: workItem.projectName ?? null,
      boardName: workItem.boardName ?? null,
      url,
    });

    await telegramBot.sendMessage({
      chatId: account.chatId,
      text: msg.text,
      parseMode: "MarkdownV2",
      replyMarkup: msg.replyMarkup,
    });
  } catch (err) {
    logger.error(err, "notifyWorkItemDone failed");
  }
};

export const notifyReviewCompleted = async (args: {
  workItemId: string;
  result: "pass" | "fail";
  summary: string;
}) => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const account = await getTelegramAccountByAssignee(workItem.assignee);
    if (!account) return;

    const settings = await getTelegramNotificationSettingsByUserId(account.userId);
    if (settings && (!settings.enabled || !settings.notifyReviewCompleted)) return;

    if (!allowSendForChat(account.chatId)) return;

    const url = await buildWorkItemUrl({ boardId: workItem.boardId, taskId: workItem.taskId ?? null });
    const msg = buildReviewCompletedMessage({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      result: args.result,
      summary: args.summary,
      url,
    });

    await telegramBot.sendMessage({
      chatId: account.chatId,
      text: msg.text,
      parseMode: "MarkdownV2",
      replyMarkup: msg.replyMarkup,
    });
  } catch (err) {
    logger.error(err, "notifyReviewCompleted failed");
  }
};

export const notifySprintClosed = async (args: {
  sprintId: string;
  boardId: string;
  sprintName: string;
  completedCount: number;
  totalCount: number;
}) => {
  try {
    const recipients = await listTelegramNotificationRecipients({ event: "sprint_closed" });
    if (recipients.length === 0) return;

    const baseUrl = getFrontendBaseUrl();
    const board = await getBoardByIdInternal(args.boardId);
    const area = board?.area ?? "desarrollo";
    const url = `${baseUrl}/boards/${area}/sprints/${args.sprintId}`;

    const msg = buildSprintClosedMessage({
      sprintName: args.sprintName,
      completedCount: args.completedCount,
      totalCount: args.totalCount,
      boardName: board?.name ?? null,
      url,
    });

    await Promise.all(
      recipients.map(async (r) => {
        try {
          if (!allowSendForChat(r.chatId)) return;
          await telegramBot.sendMessage({
            chatId: r.chatId,
            text: msg.text,
            parseMode: "MarkdownV2",
            replyMarkup: msg.replyMarkup,
          });
        } catch (err) {
          logger.error(err, "notifySprintClosed send failed");
        }
      })
    );
  } catch (err) {
    logger.error(err, "notifySprintClosed failed");
  }
};

export const notifyUserActions = async (args: {
  workItemId: string;
  userActions: string;
}) => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const account = await getTelegramAccountByAssignee(workItem.assignee);
    if (!account) return;

    const settings = await getTelegramNotificationSettingsByUserId(account.userId);
    if (settings && (!settings.enabled || !settings.notifyUserActions)) return;

    if (!allowSendForChat(account.chatId)) return;

    const url = await buildWorkItemUrl({ boardId: workItem.boardId, taskId: workItem.taskId ?? null });
    const msg = buildUserActionsMessage({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      userActions: args.userActions,
      url,
    });

    await telegramBot.sendMessage({
      chatId: account.chatId,
      text: msg.text,
      parseMode: "MarkdownV2",
      replyMarkup: msg.replyMarkup,
    });
  } catch (err) {
    logger.error(err, "notifyUserActions failed");
  }
};
