import {
  getActiveSprint,
  getBoardByIdInternal,
  getProjects,
  getWorkItemById,
  moveWorkItem,
} from "@almirant/database";
import type { TelegramReplyMarkup } from "../telegram-bot";
import { telegramBot } from "../telegram-bot";
import { getFrontendBaseUrl } from "../telegram-utils";
import { parseTelegramCommand } from "./command-parser";
import { handleHelpCommand } from "./commands/help";
import { handleMeCommand } from "./commands/me";
import { handleStatusCommand } from "./commands/status";
import { handleBoardsCommand, handleBoardCommand } from "./commands/boards";
import { handleTasksCommand } from "./commands/tasks";
import { handleMoveCommand, takePendingMove } from "./commands/move";
import { handleAssignCommand } from "./commands/assign";
import {
  handleCreateBoardCallback,
  handleCreateColumnCallback,
  handleCreateCommand,
} from "./commands/create";
import {
  handleSprintCloseCommand,
  handleSprintCloseConfirmCallback,
  handleSprintCommand,
} from "./commands/sprint";
import { handleSearchCommand } from "./commands/search";
import type { TelegramCallbackContext, TelegramMessageContext } from "./types";
import { callbackStore } from "./callback-store";
import { telegramState } from "./state";

type CallbackResult =
  | { kind: "edit"; text: string; replyMarkup?: TelegramReplyMarkup }
  | { kind: "message"; text: string; replyMarkup?: TelegramReplyMarkup }
  | { kind: "noop" };

export async function routeTelegramCommand(
  ctx: TelegramMessageContext,
  text: string
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const parsed = parseTelegramCommand(text);
  if (!parsed) return { text: "Comando inválido." };

  switch (parsed.command) {
    case "help": {
      const res = await handleHelpCommand(ctx);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "me": {
      const res = await handleMeCommand(ctx);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "status": {
      const res = await handleStatusCommand(ctx);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "boards": {
      const res = await handleBoardsCommand(ctx);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "board": {
      const q = parsed.args;
      const res = await handleBoardCommand(ctx, q);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "tasks": {
      const projectFilter = parsed.args ? parsed.args : null;
      const res = await handleTasksCommand(ctx, projectFilter);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "move": {
      const taskId = parsed.parts[0] ?? "";
      const col = parsed.parts.slice(1).join(" ");
      if (!taskId || !col) {
        return { text: "Uso: `/move <TASK_ID> <columna>`" };
      }
      const res = await handleMoveCommand(ctx, taskId, col);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "assign": {
      const taskId = parsed.parts[0] ?? "";
      const q = parsed.parts.slice(1).join(" ").trim();
      if (!taskId) return { text: "Uso: `/assign <TASK_ID> <email|nombre|me>`" };
      const res = await handleAssignCommand(ctx, taskId, q || null);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "create": {
      const type = parsed.parts[0] ?? "";
      const title = parsed.parts.slice(1).join(" ");
      const res = await handleCreateCommand(ctx, type, title);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "sprint": {
      if (parsed.parts[0]?.toLowerCase() === "close") {
        const res = await handleSprintCloseCommand(ctx);
        return { text: res.text, replyMarkup: res.replyMarkup };
      }
      const res = await handleSprintCommand(ctx);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "search": {
      const res = await handleSearchCommand(ctx, parsed.args);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "list": {
      // Minimal: alias to /search (or /tasks if user asks "in-progress").
      const arg = (parsed.args ?? "").trim().toLowerCase();
      if (arg === "in-progress" || arg === "inprogress") {
        const res = await handleTasksCommand(ctx, null);
        return { text: res.text, replyMarkup: res.replyMarkup };
      }
      const res = await handleSearchCommand(ctx, parsed.args);
      return { text: res.text, replyMarkup: res.replyMarkup };
    }
    case "project": {
      const q = parsed.args.trim();
      if (!q) return { text: "Uso: `/project <nombre>`" };
      const { projects } = await getProjects({ page: 1, limit: 10, offset: 0 }, { search: q });
      if (projects.length === 0) return { text: "No encontré proyectos con ese nombre." };
      const picked = projects[0]!;
      telegramState.setActiveProject(ctx.chatId, { id: picked.id, name: picked.name });
      return { text: `✅ Proyecto activo: *${picked.name}*` };
    }
    case "report": {
      const st = telegramState.get(ctx.chatId);
      if (!st.activeBoardId) {
        return { text: "Usa `/board <nombre>` para seleccionar un board primero." };
      }
      const board = await getBoardByIdInternal(st.activeBoardId);
      const sprint = board ? await getActiveSprint(board.organizationId, board.id) : null;
      if (!board || !sprint) return { text: "No hay sprint activo." };
      const baseUrl = getFrontendBaseUrl();
      const link = `${baseUrl}/boards/${board.area}/sprints/${sprint.id}`;
      return { text: `📈 Reporte del sprint: ${link}` };
    }
    default:
      return { text: "Comando no reconocido. Usa `/help`." };
  }
}

function itemDetailKeyboard(args: {
  itemId: string;
  reviewColumnId?: string;
  doneColumnId?: string;
}): TelegramReplyMarkup {
  const rows: { text: string; callback_data: string }[][] = [
    [{ text: "Refrescar", callback_data: `mc:item:open:${args.itemId}` }],
  ];

  if (args.reviewColumnId) {
    rows.push([
      { text: "Mover a Review", callback_data: `mc:item:move:${args.itemId}:${args.reviewColumnId}` },
    ]);
  }
  if (args.doneColumnId) {
    rows.push([
      { text: "Mover a Done", callback_data: `mc:item:move:${args.itemId}:${args.doneColumnId}` },
    ]);
  }

  return {
    inline_keyboard: rows,
  };
}

export async function routeTelegramCallback(
  ctx: TelegramCallbackContext
): Promise<CallbackResult> {
  const parts = ctx.data.split(":");
  if (parts[0] !== "mc") return { kind: "noop" };

  const scope = parts[1] ?? "";
  const action = parts[2] ?? "";

  if (scope === "board" && action === "open") {
    const boardId = parts[3] ?? "";
    const board = await getBoardByIdInternal(boardId);
    if (!board) return { kind: "edit", text: "Board no encontrado." };
    telegramState.setActiveBoard(ctx.chatId, { id: board.id, name: board.name });
    const res = await handleBoardCommand(ctx, board.name);
    return { kind: "edit", text: res.text, replyMarkup: res.replyMarkup };
  }

  if (scope === "item" && action === "open") {
    const itemId = parts[3] ?? "";
    const item = itemId ? await getWorkItemById(itemId) : null;
    if (!item) return { kind: "edit", text: "Item no encontrado." };

    const board = await getBoardByIdInternal(item.boardId);
    if (board) telegramState.setActiveBoard(ctx.chatId, { id: board.id, name: board.name });

    const baseUrl = getFrontendBaseUrl();
    const search = item.taskId ?? item.id;
    const link = board ? `${baseUrl}/boards/${board.area}?search=${encodeURIComponent(search)}` : baseUrl;

    const doneCol = board?.columns.find((c) => c.isDone) ?? null;
    const reviewCol = board?.columns.find((c) => c.name.toLowerCase().includes("review")) ?? null;

    const txt =
      `*${item.taskId}* ${item.title}\n\n` +
      `📋 *Board:* ${item.boardName}\n` +
      `🧱 *Columna:* ${item.columnName}\n` +
      (item.projectName ? `📦 *Proyecto:* ${item.projectName}\n` : "") +
      `🔎 Abrir: ${link}`;

    return {
      kind: "edit",
      text: txt,
      replyMarkup: itemDetailKeyboard({
        itemId: item.id,
        reviewColumnId: reviewCol?.id,
        doneColumnId: doneCol?.id,
      }),
    };
  }

  if (scope === "item" && action === "move") {
    const itemId = parts[3] ?? "";
    const destColumnId = parts[4] ?? "";
    if (!itemId || !destColumnId) return { kind: "noop" };

    const item = await getWorkItemById(itemId);
    if (!item) return { kind: "edit", text: "Item no encontrado." };

    const board = await getBoardByIdInternal(item.boardId);
    const dest = board?.columns.find((c) => c.id === destColumnId) ?? null;
    if (!dest) return { kind: "edit", text: "Columna no encontrada." };

    const token = callbackStore.put({
      kind: "move",
      workItemId: item.id,
      taskId: item.taskId,
      destColumnId: dest.id,
      destColumnName: dest.name,
      boardName: board?.name ?? "",
    });

    return {
      kind: "edit",
      text: `Vas a mover *${item.taskId}* a *${dest.name}*.\n\n¿Confirmas?`,
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "Confirmar", callback_data: `mc:move:confirm:${token}` },
            { text: "Cancelar", callback_data: `mc:move:cancel:${token}` },
          ],
        ],
      },
    };
  }

  if (scope === "move" && action === "confirm") {
    const token = parts[3] ?? "";
    const pending = takePendingMove(token);
    if (!pending) return { kind: "edit", text: "Acción expirada. Reintenta `/move ...`." };

    await moveWorkItem(
      pending.workItemId,
      pending.destColumnId,
      0,
      { triggeredBy: "system", triggeredByUserId: ctx.userId }
    );

    return { kind: "edit", text: `✅ Movido *${pending.taskId}* a *${pending.destColumnName}*.` };
  }

  if (scope === "move" && action === "cancel") {
    return { kind: "edit", text: "Cancelado." };
  }

  if (scope === "create" && action === "board") {
    const token = parts[3] ?? "";
    const boardId = parts[4] ?? "";
    const res = await handleCreateBoardCallback(ctx, token, boardId);
    if (!res) return { kind: "edit", text: "Acción expirada. Reintenta `/create ...`." };
    return { kind: "edit", text: res.editText, replyMarkup: res.replyMarkup };
  }

  if (scope === "create" && action === "column") {
    const token = parts[3] ?? "";
    const colId = parts[4] ?? "";
    const res = await handleCreateColumnCallback(ctx, token, colId);
    if (!res) return { kind: "edit", text: "Acción expirada. Reintenta `/create ...`." };
    return { kind: "edit", text: res };
  }

  if (scope === "sprint" && action === "close") {
    const sub = parts[3] ?? "";
    const token = parts[4] ?? "";
    if (sub === "confirm") {
      const res = await handleSprintCloseConfirmCallback(ctx, token);
      if (!res) return { kind: "edit", text: "Acción expirada. Reintenta `/sprint close`." };
      return { kind: "edit", text: res };
    }
    if (sub === "cancel") {
      return { kind: "edit", text: "Cancelado." };
    }
  }

  return { kind: "noop" };
}

export async function applyCallbackResult(ctx: TelegramCallbackContext, result: CallbackResult): Promise<void> {
  // Always answer callback query to stop Telegram client spinner.
  await telegramBot.answerCallbackQuery({ callbackQueryId: ctx.callbackQueryId }).catch(() => {});

  if (result.kind === "noop") return;

  if (result.kind === "message") {
    await telegramBot.sendMessage({
      chatId: ctx.chatId,
      text: result.text,
      parseMode: "Markdown",
      replyMarkup: result.replyMarkup,
    });
    return;
  }

  await telegramBot.editMessageText({
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    text: result.text,
    parseMode: "Markdown",
    replyMarkup: result.replyMarkup,
  });
}
