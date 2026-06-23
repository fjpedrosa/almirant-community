import type { TelegramReplyMarkup } from "../telegram-bot";
import type { TelegramUser, User } from "@almirant/database";

export type TelegramMessageContext = {
  chatId: string;
  userId: string;
  user: User;
  telegramAccount: TelegramUser;
};

export type TelegramOutboundMessage = {
  text: string;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramReplyMarkup;
};

export type TelegramCallbackContext = TelegramMessageContext & {
  callbackQueryId: string;
  messageId: number;
  data: string;
};

