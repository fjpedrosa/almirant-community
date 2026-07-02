import {
  createWorkItem,
  getAllBoards,
  getBoardByIdInternal,
} from "@almirant/database";
import type { TelegramReplyMarkup } from "../../telegram-bot";
import type { TelegramCallbackContext, TelegramMessageContext, TelegramOutboundMessage } from "../types";
import { callbackStore } from "../callback-store";
import { getFrontendBaseUrl } from "../../telegram-utils";
import { telegramState } from "../state";
import { getWorkspaceIdForUser } from "../workspace-context";

type CreateStep =
  | { step: "pick-board"; type: string; title: string; userId: string }
  | { step: "pick-column"; type: string; title: string; userId: string; boardId: string };

function isValidType(type: string): boolean {
  return ["task", "story", "feature", "epic"].includes(type);
}

export async function handleCreateCommand(
  ctx: TelegramMessageContext,
  typeRaw: string,
  title: string
): Promise<TelegramOutboundMessage> {
  const type = (typeRaw ?? "").trim().toLowerCase();
  const safeTitle = title.trim();
  if (!isValidType(type)) {
    return {
      parseMode: "Markdown",
      text: "Tipo inválido. Usa: `task`, `story`, `feature`, `epic`.\nEj: `/create task Fix login bug`",
    };
  }
  if (!safeTitle) {
    return {
      parseMode: "Markdown",
      text: "Falta el título.\nEj: `/create task Fix login bug`",
    };
  }

  const workspaceId = await getWorkspaceIdForUser(ctx.userId);
  if (!workspaceId) {
    return {
      parseMode: "Markdown",
      text: "No pude resolver tu organización activa para crear items.",
    };
  }

  const boards = await getAllBoards(workspaceId);
  const token = callbackStore.put<CreateStep>({
    step: "pick-board",
    type,
    title: safeTitle,
    userId: ctx.userId,
  });

  const rows = boards.slice(0, 8).map((b) => [
    { text: b.name, callback_data: `mc:create:board:${token}:${b.id}` },
  ]);

  const replyMarkup: TelegramReplyMarkup | undefined = rows.length > 0 ? { inline_keyboard: rows } : undefined;

  return {
    parseMode: "Markdown",
    replyMarkup,
    text:
      `Crearé un *${type}*:\n` +
      `- *Título:* ${safeTitle}\n\n` +
      "Selecciona el board:",
  };
}

export async function handleCreateBoardCallback(
  ctx: TelegramCallbackContext,
  token: string,
  boardId: string
): Promise<{ editText: string; replyMarkup?: TelegramReplyMarkup } | null> {
  const payload = callbackStore.take<CreateStep>(token);
  if (!payload || payload.step !== "pick-board") return null;

  const board = await getBoardByIdInternal(boardId);
  if (!board) return null;

  const nextToken = callbackStore.put<CreateStep>({
    step: "pick-column",
    type: payload.type,
    title: payload.title,
    userId: payload.userId,
    boardId,
  });

  const backlogFirst = board.columns.find((c) => c.name.toLowerCase() === "backlog") ?? board.columns[0];
  const ordered = [
    ...(backlogFirst ? [backlogFirst] : []),
    ...board.columns.filter((c) => !backlogFirst || c.id !== backlogFirst.id),
  ];

  const rows = ordered.slice(0, 8).map((c) => [
    { text: c.name, callback_data: `mc:create:column:${nextToken}:${c.id}` },
  ]);

  return {
    editText:
      `Board seleccionado: *${board.name}*\n\n` +
      "¿En qué columna lo creo?",
    replyMarkup: rows.length > 0 ? { inline_keyboard: rows } : undefined,
  };
}

export async function handleCreateColumnCallback(
  ctx: TelegramCallbackContext,
  token: string,
  columnId: string
): Promise<string | null> {
  const payload = callbackStore.take<CreateStep>(token);
  if (!payload || payload.step !== "pick-column") return null;

  const board = await getBoardByIdInternal(payload.boardId);
  if (!board) return null;
  const workspaceId = board.workspaceId;
  if (!workspaceId) return null;

  const created = await createWorkItem(
    workspaceId,
    {
      projectId: null,
      boardId: board.id,
      boardColumnId: columnId,
      title: payload.title,
      type: payload.type as never,
      priority: "medium",
      assignee: payload.userId,
      description: "",
      metadata: {},
    },
    { triggeredBy: "system", triggeredByUserId: payload.userId }
  );

  telegramState.setActiveBoard(ctx.chatId, { id: board.id, name: board.name });

  const baseUrl = getFrontendBaseUrl();
  const search = created.taskId ?? created.id;
  const link = `${baseUrl}/boards/${board.area}?search=${encodeURIComponent(search)}`;

  return (
    `✅ Creado: *${created.taskId}* ${created.title}\n` +
    `📋 Board: ${board.name}\n` +
    `🔎 Abrir: ${link}`
  );
}
