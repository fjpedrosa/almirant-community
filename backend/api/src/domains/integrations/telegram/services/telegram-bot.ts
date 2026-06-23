import { env, logger } from "@almirant/config";

const TELEGRAM_API_BASE = "https://api.telegram.org";

type TelegramSendMessageArgs = {
  chatId: string;
  text: string;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramReplyMarkup;
};

type TelegramSendPhotoArgs = {
  chatId: string;
  photoUrl: string;
  caption?: string;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
};

export type TelegramInlineKeyboardButton =
  | { text: string; callback_data: string; url?: never }
  | { text: string; url: string; callback_data?: never };

export type TelegramReplyMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

type TelegramEditMessageTextArgs = {
  chatId: string;
  messageId: number;
  text: string;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramReplyMarkup;
};

type TelegramAnswerCallbackQueryArgs = {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
};

async function telegramRequest<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw new Error(json.description || `Telegram API error calling ${method}`);
  }
  return json.result as T;
}

export const telegramBot = {
  sendMessage: async (args: TelegramSendMessageArgs) => {
    try {
      return await telegramRequest("sendMessage", {
        chat_id: args.chatId,
        text: args.text,
        parse_mode: args.parseMode,
        disable_web_page_preview: args.disableWebPagePreview ?? true,
        ...(args.replyMarkup ? { reply_markup: args.replyMarkup } : {}),
      });
    } catch (err) {
      logger.error(err, "Telegram sendMessage failed");
      throw err;
    }
  },

  editMessageText: async (args: TelegramEditMessageTextArgs) => {
    try {
      return await telegramRequest("editMessageText", {
        chat_id: args.chatId,
        message_id: args.messageId,
        text: args.text,
        parse_mode: args.parseMode,
        disable_web_page_preview: args.disableWebPagePreview ?? true,
        ...(args.replyMarkup ? { reply_markup: args.replyMarkup } : {}),
      });
    } catch (err) {
      logger.error(err, "Telegram editMessageText failed");
      throw err;
    }
  },

  answerCallbackQuery: async (args: TelegramAnswerCallbackQueryArgs) => {
    try {
      return await telegramRequest("answerCallbackQuery", {
        callback_query_id: args.callbackQueryId,
        ...(args.text ? { text: args.text } : {}),
        show_alert: args.showAlert ?? false,
      });
    } catch (err) {
      logger.error(err, "Telegram answerCallbackQuery failed");
      throw err;
    }
  },

  sendPhoto: async (args: TelegramSendPhotoArgs) => {
    try {
      return await telegramRequest("sendPhoto", {
        chat_id: args.chatId,
        photo: args.photoUrl,
        caption: args.caption,
        parse_mode: args.parseMode,
      });
    } catch (err) {
      logger.error(err, "Telegram sendPhoto failed");
      throw err;
    }
  },
};
