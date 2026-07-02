import { getActiveSprint, getAllBoards, getWorkItemsByBoard } from "@almirant/database";
import type { TelegramReplyMarkup } from "../../telegram-bot";
import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";
import { fuzzyPickOne } from "../format";
import { telegramState } from "../state";
import { getWorkspaceIdForUser } from "../workspace-context";

function boardsKeyboard(boards: { id: string; name: string }[]): TelegramReplyMarkup | undefined {
  const rows = boards.slice(0, 6).map((b) => [{ text: b.name, callback_data: `mc:board:open:${b.id}` }]);
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
}

export async function handleBoardsCommand(
  ctx: TelegramMessageContext
): Promise<TelegramOutboundMessage> {
  const workspaceId = await getWorkspaceIdForUser(ctx.userId);
  if (!workspaceId) {
    return {
      parseMode: "Markdown",
      text: "No pude resolver tu organización activa para listar boards.",
    };
  }

  const allBoards = await getAllBoards(workspaceId);

  const lines =
    allBoards.length > 0
      ? allBoards
          .slice(0, 15)
          .map((b) => `- ${b.name} (${b.area})`)
          .join("\n")
      : "- (sin boards)";

  return {
    parseMode: "Markdown",
    replyMarkup: boardsKeyboard(allBoards),
    text:
      "*Boards*\n\n" +
      `${lines}\n\n` +
      "Usa `/board <nombre>` para ver el resumen, o toca un botón.",
  };
}

export async function handleBoardCommand(
  ctx: TelegramMessageContext,
  boardQuery: string
): Promise<TelegramOutboundMessage> {
  const workspaceId = await getWorkspaceIdForUser(ctx.userId);
  if (!workspaceId) {
    return {
      parseMode: "Markdown",
      text: "No pude resolver tu organización activa para buscar boards.",
    };
  }

  const allBoards = await getAllBoards(workspaceId);
  const picked = fuzzyPickOne(boardQuery, allBoards.map((b) => ({ id: b.id, name: b.name })));
  if (!picked) {
    return {
      parseMode: "Markdown",
      text: "No encontré ese board. Prueba con `/boards` para ver la lista.",
    };
  }

  const [columns, sprint] = await Promise.all([
    getWorkItemsByBoard(workspaceId, picked.id),
    getActiveSprint(workspaceId, picked.id),
  ]);

  telegramState.setActiveBoard(ctx.chatId, { id: picked.id, name: picked.name });

  const colLines =
    columns.length > 0
      ? columns.map((c) => `- *${c.column.name}:* ${c.count}`).join("\n")
      : "- (sin columnas)";

  return {
    parseMode: "Markdown",
    text:
      `*Board:* ${picked.name}\n\n` +
      (sprint ? `🏃 *Sprint activo:* ${sprint.name}\n\n` : "🏃 *Sprint activo:* (ninguno)\n\n") +
      "📊 *Columnas*\n" +
      colLines,
  };
}
