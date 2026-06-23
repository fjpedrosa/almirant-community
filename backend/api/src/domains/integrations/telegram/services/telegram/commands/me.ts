import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";
import { telegramState } from "../state";

export async function handleMeCommand(
  ctx: TelegramMessageContext
): Promise<TelegramOutboundMessage> {
  const st = telegramState.get(ctx.chatId);

  const tgName =
    ctx.telegramAccount.username ||
    [ctx.telegramAccount.firstName, ctx.telegramAccount.lastName].filter(Boolean).join(" ") ||
    "N/A";

  return {
    parseMode: "Markdown",
    text:
      "*Tu cuenta*\n\n" +
      `👤 *Nombre:* ${ctx.user.name}\n` +
      `📧 *Email:* ${ctx.user.email}\n` +
      `🔗 *Telegram:* ${tgName}\n\n` +
      "*Contexto actual*\n" +
      `📦 *Proyecto:* ${st.activeProjectName ?? "No seleccionado"}\n` +
      `📋 *Board:* ${st.activeBoardName ?? "No seleccionado"}`,
  };
}

