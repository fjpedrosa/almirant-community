import {
  getBoardByIdInternal,
  getWorkItemByTaskIdExact,
} from "@almirant/database";
import type { TelegramReplyMarkup } from "../../telegram-bot";
import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";
import { callbackStore } from "../callback-store";
import { fuzzyPickOne } from "../format";

type PendingMove = {
  kind: "move";
  workItemId: string;
  taskId: string;
  destColumnId: string;
  destColumnName: string;
  boardName: string;
};

export async function handleMoveCommand(
  ctx: TelegramMessageContext,
  taskId: string,
  columnQuery: string
): Promise<TelegramOutboundMessage> {
  const item = await getWorkItemByTaskIdExact(taskId);
  if (!item) {
    return {
      parseMode: "Markdown",
      text: `No encontré el item \`${taskId}\`.`,
    };
  }

  const board = await getBoardByIdInternal(item.boardId);
  if (!board) {
    return {
      parseMode: "Markdown",
      text: "No pude cargar el board del item.",
    };
  }

  const picked = fuzzyPickOne(
    columnQuery,
    board.columns.map((c) => ({ id: c.id, name: c.name }))
  );
  if (!picked) {
    const cols = board.columns.map((c) => `- ${c.name}`).join("\n");
    return {
      parseMode: "Markdown",
      text:
        `No encontré una columna que coincida con \`${columnQuery}\` en *${board.name}*.\n\n` +
        `Columnas disponibles:\n${cols}`,
    };
  }

  const token = callbackStore.put<PendingMove>({
    kind: "move",
    workItemId: item.id,
    taskId: item.taskId,
    destColumnId: picked.id,
    destColumnName: picked.name,
    boardName: board.name,
  });

  const replyMarkup: TelegramReplyMarkup = {
    inline_keyboard: [
      [
        { text: "Confirmar", callback_data: `mc:move:confirm:${token}` },
        { text: "Cancelar", callback_data: `mc:move:cancel:${token}` },
      ],
    ],
  };

  return {
    parseMode: "Markdown",
    replyMarkup,
    text:
      `Vas a mover *${item.taskId}* a *${picked.name}* en *${board.name}*.\n\n` +
      "¿Confirmas?",
  };
}

export function takePendingMove(token: string): PendingMove | null {
  const data = callbackStore.take<PendingMove>(token);
  if (!data || data.kind !== "move") return null;
  return data;
}

