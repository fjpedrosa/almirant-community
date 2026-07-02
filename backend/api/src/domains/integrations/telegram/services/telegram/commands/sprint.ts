import { closeSprint, getActiveSprint, getBoardByIdInternal } from "@almirant/database";
import type { TelegramReplyMarkup } from "../../telegram-bot";
import type { TelegramCallbackContext, TelegramMessageContext, TelegramOutboundMessage } from "../types";
import { callbackStore } from "../callback-store";
import { telegramState } from "../state";
import { kickoffSprintVisualReportGeneration } from "../../../../../project-management/sprints/services/sprint-visual-report-service";

type PendingSprintClose = {
  kind: "sprint-close";
  sprintId: string;
  boardId: string;
  workspaceId: string;
  userId: string;
};

export async function handleSprintCommand(
  ctx: TelegramMessageContext
): Promise<TelegramOutboundMessage> {
  const st = telegramState.get(ctx.chatId);
  if (!st.activeBoardId) {
    return {
      parseMode: "Markdown",
      text: "No hay un board seleccionado. Usa `/board <nombre>` primero.",
    };
  }

  const board = await getBoardByIdInternal(st.activeBoardId);

  if (!board) {
    return { parseMode: "Markdown", text: "No pude cargar el board activo." };
  }

  const sprint = await getActiveSprint(board.workspaceId, st.activeBoardId);

  if (!sprint) {
    return {
      parseMode: "Markdown",
      text: `🏃 Board: *${board.name}*\n\nNo hay sprint activo.`,
    };
  }

  return {
    parseMode: "Markdown",
    text:
      `🏃 *Sprint activo*\n\n` +
      `📋 *Board:* ${board.name}\n` +
      `🏷️ *Nombre:* ${sprint.name}\n` +
      `📦 *Items:* ${sprint.workItemCount}\n` +
      `📅 *Estado:* ${sprint.status}`,
  };
}

export async function handleSprintCloseCommand(
  ctx: TelegramMessageContext
): Promise<TelegramOutboundMessage> {
  const st = telegramState.get(ctx.chatId);
  if (!st.activeBoardId) {
    return {
      parseMode: "Markdown",
      text: "No hay un board seleccionado. Usa `/board <nombre>` primero.",
    };
  }

  const board = await getBoardByIdInternal(st.activeBoardId);
  if (!board) {
    return { parseMode: "Markdown", text: "No hay sprint activo para cerrar." };
  }

  const sprint = await getActiveSprint(board.workspaceId, st.activeBoardId);
  if (!sprint) {
    return { parseMode: "Markdown", text: "No hay sprint activo para cerrar." };
  }

  const token = callbackStore.put<PendingSprintClose>({
    kind: "sprint-close",
    sprintId: sprint.id,
    boardId: board.id,
    workspaceId: board.workspaceId,
    userId: ctx.userId,
  });

  const replyMarkup: TelegramReplyMarkup = {
    inline_keyboard: [
      [
        { text: "Cerrar sprint", callback_data: `mc:sprint:close:confirm:${token}` },
        { text: "Cancelar", callback_data: `mc:sprint:close:cancel:${token}` },
      ],
    ],
  };

  return {
    parseMode: "Markdown",
    replyMarkup,
    text:
      `Vas a cerrar el sprint *${sprint.name}* del board *${board.name}*.\n\n` +
      "Esto archivará items en columnas Done.\n\n" +
      "¿Confirmas?",
  };
}

export async function handleSprintCloseConfirmCallback(
  ctx: TelegramCallbackContext,
  token: string
): Promise<string | null> {
  const data = callbackStore.take<PendingSprintClose>(token);
  if (!data || data.kind !== "sprint-close") return null;

  const sprint = await closeSprint(data.workspaceId, data.sprintId, data.boardId);
  kickoffSprintVisualReportGeneration({
    sprintId: sprint.id,
    boardId: data.boardId,
    sprintName: sprint.name,
  });
  return "✅ Sprint cerrado.";
}
