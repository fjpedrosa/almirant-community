import { searchWorkItems } from "@almirant/database";
import type { TelegramReplyMarkup } from "../../telegram-bot";
import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";

function resultsKeyboard(items: { id: string; taskId: string }[]): TelegramReplyMarkup | undefined {
  const rows = items.slice(0, 8).map((w) => [{ text: w.taskId, callback_data: `mc:item:open:${w.id}` }]);
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
}

export async function handleSearchCommand(
  _ctx: TelegramMessageContext,
  query: string
): Promise<TelegramOutboundMessage> {
  const q = query.trim();
  if (!q) {
    return { parseMode: "Markdown", text: "Uso: `/search <texto>`" };
  }

  const results = await searchWorkItems(q, 10);
  if (results.length === 0) {
    return { parseMode: "Markdown", text: "Sin resultados." };
  }

  const lines = results
    .slice(0, 10)
    .map((w) => `- ${w.taskId} ${w.title} (${w.boardName} / ${w.columnName})`)
    .join("\n");

  return {
    parseMode: "Markdown",
    replyMarkup: resultsKeyboard(results.map((w) => ({ id: w.id, taskId: w.taskId }))),
    text: `*Resultados*\n\n${lines}`,
  };
}

