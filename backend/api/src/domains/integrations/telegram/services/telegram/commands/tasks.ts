import { getInProgressWorkItemsForUser } from "@almirant/database";
import type { TelegramReplyMarkup } from "../../telegram-bot";
import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";
import { telegramState } from "../state";

type TaskRow = {
  id: string;
  taskId: string;
  title: string;
  boardName: string;
  projectName: string | null;
};

function tasksKeyboard(items: TaskRow[]): TelegramReplyMarkup | undefined {
  const rows = items.slice(0, 8).map((w) => [
    { text: w.taskId, callback_data: `mc:item:open:${w.id}` },
    { text: "Ver", callback_data: `mc:item:open:${w.id}` },
  ]);
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
}

export async function handleTasksCommand(
  ctx: TelegramMessageContext,
  projectFilter: string | null
): Promise<TelegramOutboundMessage> {
  const st = telegramState.get(ctx.chatId);
  const all = await getInProgressWorkItemsForUser(ctx.userId, 25);

  const normalizedFilter = (projectFilter ?? "").trim().toLowerCase();
  const filtered = normalizedFilter
    ? all.filter((w) => (w.projectName ?? "").toLowerCase().includes(normalizedFilter))
    : all;

  const lines =
    filtered.length > 0
      ? filtered
          .slice(0, 12)
          .map((w) => `- ${w.taskId} ${w.title} (${w.boardName})`)
          .join("\n")
      : "- (ninguna)";

  const activeProjectNote =
    st.activeProjectName && !normalizedFilter
      ? `\n\nFiltro sugerido: \`/tasks ${st.activeProjectName}\``
      : "";

  return {
    parseMode: "Markdown",
    replyMarkup: tasksKeyboard(
      filtered.map((w) => ({
        id: w.id,
        taskId: w.taskId,
        title: w.title,
        boardName: w.boardName,
        projectName: w.projectName,
      }))
    ),
    text: `*Tus tareas en progreso*\n\n${lines}${activeProjectNote}`,
  };
}

