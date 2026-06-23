import { Elysia } from "elysia";
import { env, logger } from "@almirant/config";
import {
  consumeTelegramLinkCode,
  getTelegramAccountByChatId,
  getUserById,
} from "@almirant/database";
import { telegramBot } from "../services/telegram-bot";
import {
  getFrontendBaseUrl,
  getTelegramSecretHeader,
  normalizeTelegramChatId,
} from "../services/telegram-utils";
import {
  applyCallbackResult,
  routeTelegramCallback,
  routeTelegramCommand,
} from "../services/telegram/command-router";
import type { TelegramCallbackContext, TelegramMessageContext } from "../services/telegram/types";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
    from?: TelegramFrom;
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: {
      message_id?: number;
      chat?: { id?: number | string };
    };
  };
};

type TelegramFrom = {
  id?: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function rateLimitAllow(key: string): boolean {
  const now = Date.now();
  const existing = rateLimitState.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitState.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) return false;
  existing.count += 1;
  return true;
}

function extractText(update: TelegramUpdate): { chatId: string; text: string; from?: TelegramFrom } | null {
  const msg = update.message;
  const chatId = normalizeTelegramChatId(msg?.chat?.id);
  const text = (msg?.text ?? "").trim();
  if (!chatId || !text) return null;
  return { chatId, text, from: msg?.from };
}

function extractCallback(update: TelegramUpdate): { chatId: string; callbackQueryId: string; messageId: number; data: string } | null {
  const cb = update.callback_query;
  const chatId = normalizeTelegramChatId(cb?.message?.chat?.id);
  const callbackQueryId = (cb?.id ?? "").trim();
  const messageId = cb?.message?.message_id ?? null;
  const data = (cb?.data ?? "").trim();
  if (!chatId || !callbackQueryId || !messageId || !data) return null;
  return { chatId, callbackQueryId, messageId, data };
}

function isStartCommand(text: string): boolean {
  return text === "/start" || text.startsWith("/start ");
}

function looksLikeLinkCode(text: string): boolean {
  const normalized = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 8 && normalized.length <= 32;
}

async function handleTelegramText(update: TelegramUpdate): Promise<void> {
  const extracted = extractText(update);
  if (!extracted) return;

  const { chatId, text, from } = extracted;

  if (!rateLimitAllow(chatId)) {
    await telegramBot.sendMessage({
      chatId,
      text: "Demasiadas solicitudes. Intenta de nuevo en un minuto.",
    });
    return;
  }

  if (isStartCommand(text)) {
    const baseUrl = getFrontendBaseUrl();
    await telegramBot.sendMessage({
      chatId,
      text:
        "Para vincular tu cuenta:\n" +
        `1) Abre Almirant: ${baseUrl}/settings/telegram\n` +
        "2) Genera un codigo de vinculacion\n" +
        "3) Envia el codigo aqui\n\n" +
        "Si ya estas vinculado, puedes volver a generar un codigo para re-vincular.",
    });
    return;
  }

  // For any other commands, require that the chat is linked.
  if (text.startsWith("/")) {
    const linked = await getTelegramAccountByChatId(chatId);
    if (!linked) {
      await telegramBot.sendMessage({
        chatId,
        text: "Primero vincula tu cuenta con /start.",
      });
      return;
    }
    const user = await getUserById(linked.userId);
    if (!user) {
      await telegramBot.sendMessage({ chatId, text: "No pude cargar tu usuario. Reintenta más tarde." });
      return;
    }

    const cmdCtx: TelegramMessageContext = {
      chatId,
      userId: linked.userId,
      user,
      telegramAccount: linked,
    };
    const res = await routeTelegramCommand(cmdCtx, text);

    await telegramBot.sendMessage({
      chatId,
      text: res.text,
      parseMode: "Markdown",
      replyMarkup: res.replyMarkup,
    });
    return;
  }

  // Try to consume as a link code.
  if (!looksLikeLinkCode(text)) {
    const linked = await getTelegramAccountByChatId(chatId);
    if (!linked) {
      await telegramBot.sendMessage({
        chatId,
        text: "No reconozco ese mensaje. Usa /start para vincular tu cuenta.",
      });
      return;
    }
    // Linked user: no-op for now.
    return;
  }

  const result = await consumeTelegramLinkCode({
    code: text,
    chatId,
    telegramUserId: normalizeTelegramChatId(from?.id) ?? null,
    username: from?.username ?? null,
    firstName: from?.first_name ?? null,
    lastName: from?.last_name ?? null,
  });

  if (!result.ok) {
    const msg =
      result.reason === "invalid_or_expired"
        ? "Codigo invalido o expirado. Genera uno nuevo en Almirant y vuelve a intentarlo."
        : result.reason === "chat_already_linked"
          ? "Este chat ya esta vinculado a otra cuenta."
          : "Tu usuario ya tiene una cuenta de Telegram vinculada. Desvincula primero en Settings.";

    await telegramBot.sendMessage({ chatId, text: msg });
    return;
  }

  await telegramBot.sendMessage({
    chatId,
    text: result.alreadyLinked ? "Tu cuenta ya estaba vinculada." : "Cuenta vinculada correctamente.",
  });
}

async function handleTelegramCallback(update: TelegramUpdate): Promise<void> {
  const extracted = extractCallback(update);
  if (!extracted) return;

  const { chatId, callbackQueryId, messageId, data } = extracted;

  if (!rateLimitAllow(chatId)) {
    await telegramBot.answerCallbackQuery({
      callbackQueryId,
      text: "Demasiadas solicitudes. Intenta de nuevo en un minuto.",
      showAlert: false,
    });
    return;
  }

  const linked = await getTelegramAccountByChatId(chatId);
  if (!linked) {
    await telegramBot.answerCallbackQuery({
      callbackQueryId,
      text: "Primero vincula tu cuenta con /start.",
      showAlert: true,
    });
    return;
  }

  const user = await getUserById(linked.userId);
  if (!user) {
    await telegramBot.answerCallbackQuery({
      callbackQueryId,
      text: "No pude cargar tu usuario.",
      showAlert: true,
    });
    return;
  }

  const cbCtx: TelegramCallbackContext = {
    chatId,
    callbackQueryId,
    messageId,
    data,
    userId: linked.userId,
    user,
    telegramAccount: linked,
  };

  const result = await routeTelegramCallback(cbCtx);
  await applyCallbackResult(cbCtx, result);
}

export const telegramWebhooksRoutes = new Elysia()
  .post("/webhooks/telegram", async ({ request, set }) => {
    try {
      const secret = env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
      if (secret) {
        const header = getTelegramSecretHeader(request);
        if (header !== secret) {
          set.status = 401;
          return { error: "Invalid secret token" };
        }
      }

      if (!env.TELEGRAM_BOT_TOKEN) {
        set.status = 500;
        return { error: "Telegram integration not configured" };
      }

      const update = (await request.json()) as TelegramUpdate;

      // Fire-and-forget: respond fast to Telegram.
      handleTelegramText(update).catch((err) =>
        logger.error(err, "Telegram update handler failed")
      );
      handleTelegramCallback(update).catch((err) =>
        logger.error(err, "Telegram callback handler failed")
      );

      return { received: true };
    } catch (err) {
      logger.error(err, "Telegram webhook processing failed");
      set.status = 500;
      return { error: "Internal error" };
    }
  });
