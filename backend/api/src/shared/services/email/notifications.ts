import { logger } from "@almirant/config";
import {
  db,
  user,
  eq,
  or,
  ilike,
  getBoardByIdInternal,
  getEmailNotificationSettingsByUserId,
  getWorkItemById,
  isEmailEventEnabled,
  listEmailNotificationRecipients,
} from "@almirant/database";
import { sendEmail } from "../email-service";
import { getFrontendBaseUrl } from "../../../domains/integrations/telegram/services/telegram-utils";
import {
  buildEmailWorkItemMoved,
  buildEmailWorkItemAssigned,
  buildEmailWorkItemDone,
  buildEmailReviewCompleted,
  buildEmailSprintClosed,
  buildEmailUserActions,
} from "./templates";

// ---------------------------------------------------------------------------
// Assignee resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an assignee string (could be an email or a display name) to the
 * corresponding user row so we can get their userId and email address.
 */
const getUserByAssignee = async (
  assignee: string
): Promise<{ userId: string; email: string; name: string } | null> => {
  const trimmed = assignee.trim();
  if (!trimmed) return null;

  const byEmail = trimmed.includes("@");

  const [result] = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
    })
    .from(user)
    .where(
      byEmail
        ? eq(user.email, trimmed)
        : or(eq(user.name, trimmed), ilike(user.name, trimmed))
    )
    .limit(1);

  return result ?? null;
};

// ---------------------------------------------------------------------------
// Work item URL builder (mirrors telegram pattern)
// ---------------------------------------------------------------------------

const buildWorkItemUrl = async (args: {
  boardId: string;
  taskId: string | null;
}): Promise<string> => {
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

// ---------------------------------------------------------------------------
// Notification functions
// ---------------------------------------------------------------------------

export const emailNotifyWorkItemMoved = async (args: {
  workItemId: string;
  fromColumnName: string;
  toColumnName: string;
}): Promise<void> => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const recipient = await getUserByAssignee(workItem.assignee);
    if (!recipient) return;

    const settings = await getEmailNotificationSettingsByUserId(recipient.userId);
    if (!isEmailEventEnabled(settings, "work_item_moved")) return;

    const url = await buildWorkItemUrl({
      boardId: workItem.boardId,
      taskId: workItem.taskId ?? null,
    });

    const { subject, html } = buildEmailWorkItemMoved({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      projectName: workItem.projectName ?? null,
      boardName: workItem.boardName ?? null,
      fromColumnName: args.fromColumnName,
      toColumnName: args.toColumnName,
      url,
    });

    await sendEmail({ to: recipient.email, subject, html });
  } catch (err) {
    logger.error(err, "emailNotifyWorkItemMoved failed");
  }
};

export const emailNotifyWorkItemAssigned = async (args: {
  workItemId: string;
  assignee: string;
}): Promise<void> => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem) return;

    const recipient = await getUserByAssignee(args.assignee);
    if (!recipient) return;

    const settings = await getEmailNotificationSettingsByUserId(recipient.userId);
    if (!isEmailEventEnabled(settings, "work_item_assigned")) return;

    const url = await buildWorkItemUrl({
      boardId: workItem.boardId,
      taskId: workItem.taskId ?? null,
    });

    const { subject, html } = buildEmailWorkItemAssigned({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      projectName: workItem.projectName ?? null,
      boardName: workItem.boardName ?? null,
      assignee: args.assignee,
      url,
    });

    await sendEmail({ to: recipient.email, subject, html });
  } catch (err) {
    logger.error(err, "emailNotifyWorkItemAssigned failed");
  }
};

export const emailNotifyWorkItemDone = async (args: {
  workItemId: string;
}): Promise<void> => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const recipient = await getUserByAssignee(workItem.assignee);
    if (!recipient) return;

    const settings = await getEmailNotificationSettingsByUserId(recipient.userId);
    if (!isEmailEventEnabled(settings, "work_item_done")) return;

    const url = await buildWorkItemUrl({
      boardId: workItem.boardId,
      taskId: workItem.taskId ?? null,
    });

    const { subject, html } = buildEmailWorkItemDone({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      projectName: workItem.projectName ?? null,
      boardName: workItem.boardName ?? null,
      url,
    });

    await sendEmail({ to: recipient.email, subject, html });
  } catch (err) {
    logger.error(err, "emailNotifyWorkItemDone failed");
  }
};

export const emailNotifyReviewCompleted = async (args: {
  workItemId: string;
  result: "pass" | "fail";
  summary: string;
}): Promise<void> => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const recipient = await getUserByAssignee(workItem.assignee);
    if (!recipient) return;

    const settings = await getEmailNotificationSettingsByUserId(recipient.userId);
    if (!isEmailEventEnabled(settings, "review_completed")) return;

    const url = await buildWorkItemUrl({
      boardId: workItem.boardId,
      taskId: workItem.taskId ?? null,
    });

    const { subject, html } = buildEmailReviewCompleted({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      result: args.result,
      summary: args.summary,
      url,
    });

    await sendEmail({ to: recipient.email, subject, html });
  } catch (err) {
    logger.error(err, "emailNotifyReviewCompleted failed");
  }
};

export const emailNotifySprintClosed = async (args: {
  sprintId: string;
  boardId: string;
  sprintName: string;
  completedCount: number;
  totalCount: number;
}): Promise<void> => {
  try {
    const recipients = await listEmailNotificationRecipients({
      event: "sprint_closed",
    });
    if (recipients.length === 0) return;

    const baseUrl = getFrontendBaseUrl();
    const board = await getBoardByIdInternal(args.boardId);
    const area = board?.area ?? "desarrollo";
    const url = `${baseUrl}/boards/${area}/sprints/${args.sprintId}`;

    const { subject, html } = buildEmailSprintClosed({
      sprintName: args.sprintName,
      completedCount: args.completedCount,
      totalCount: args.totalCount,
      boardName: board?.name ?? null,
      url,
    });

    await Promise.all(
      recipients.map(async (r) => {
        try {
          await sendEmail({ to: r.email, subject, html });
        } catch (err) {
          logger.error(
            { err, email: r.email },
            "emailNotifySprintClosed: send to recipient failed"
          );
        }
      })
    );
  } catch (err) {
    logger.error(err, "emailNotifySprintClosed failed");
  }
};

export const emailNotifyUserActions = async (args: {
  workItemId: string;
  userActions: string;
}): Promise<void> => {
  try {
    const workItem = await getWorkItemById(args.workItemId);
    if (!workItem?.assignee) return;

    const recipient = await getUserByAssignee(workItem.assignee);
    if (!recipient) return;

    const settings = await getEmailNotificationSettingsByUserId(recipient.userId);
    if (!isEmailEventEnabled(settings, "user_actions")) return;

    const url = await buildWorkItemUrl({
      boardId: workItem.boardId,
      taskId: workItem.taskId ?? null,
    });

    const { subject, html } = buildEmailUserActions({
      taskId: workItem.taskId ?? null,
      title: workItem.title,
      userActions: args.userActions,
      url,
    });

    await sendEmail({ to: recipient.email, subject, html });
  } catch (err) {
    logger.error(err, "emailNotifyUserActions failed");
  }
};
