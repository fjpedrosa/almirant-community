import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const state = {
  sentMessages: [] as string[],
  consumedPayloads: [] as string[],
  consumeResult: { ok: true, userId: "test-user" } as Record<string, unknown>,
};

mock.module("@almirant/config", () => ({
  env: {
    TELEGRAM_WEBHOOK_SECRET_TOKEN: undefined,
    TELEGRAM_BOT_TOKEN: "test-bot-token",
  },
  logger: { error: () => {} },
}));

mock.module("@almirant/database", () => ({
  consumeTelegramLinkCode: async (args: { code: string }) => {
    state.consumedPayloads.push(args.code);
    return state.consumeResult;
  },
  getTelegramAccountByChatId: async () => null,
  getUserById: async () => ({ id: "test-user", name: "Test User" }),
}));

mock.module("../services/telegram-bot", () => ({
  telegramBot: {
    sendMessage: async (args: { text: string }) => {
      state.sentMessages.push(args.text);
    },
    answerCallbackQuery: async () => {},
  },
}));

mock.module("../services/telegram-utils", () => ({
  getFrontendBaseUrl: () => "https://app.example",
  getTelegramSecretHeader: () => "",
  normalizeTelegramChatId: (value: unknown) => (value == null ? null : String(value)),
}));

mock.module("../services/telegram/command-router", () => ({
  applyCallbackResult: async () => {},
  routeTelegramCallback: async () => ({ kind: "noop" }),
  routeTelegramCommand: async () => ({ text: "ok" }),
}));

const makeRequest = (text: string): Request =>
  new Request("http://localhost/webhooks/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: "test-chat", type: "private" },
        from: { id: "test-sender" },
        text,
      },
    }),
  });

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("telegram webhook /start linking dispatch", () => {
  beforeEach(() => {
    state.sentMessages = [];
    state.consumedPayloads = [];
    state.consumeResult = { ok: true, userId: "test-user" };
  });

  it("consumes a /start payload once instead of returning generic instructions", async () => {
    const { telegramWebhooksRoutes } = await import("./webhooks.routes");
    const app = new Elysia().use(telegramWebhooksRoutes);

    await app.handle(makeRequest("/start synthetic-payload"));
    await settle();

    expect(state.consumedPayloads).toHaveLength(1);
    expect(state.consumedPayloads[0]?.length).toBeGreaterThan(0);
    expect(state.sentMessages.at(-1)).toContain("vinculada correctamente");
  });

  it("keeps bare /start on the generic linking instructions path", async () => {
    const { telegramWebhooksRoutes } = await import("./webhooks.routes");
    const app = new Elysia().use(telegramWebhooksRoutes);

    await app.handle(makeRequest("/start"));
    await settle();

    expect(state.consumedPayloads).toHaveLength(0);
    expect(state.sentMessages.at(-1)).toContain("vincular");
  });

  it("keeps invalid or expired payload failures generic", async () => {
    state.consumeResult = { ok: false, reason: "invalid_or_expired" };
    const { telegramWebhooksRoutes } = await import("./webhooks.routes");
    const app = new Elysia().use(telegramWebhooksRoutes);

    await app.handle(makeRequest("/start malformed-payload"));
    await settle();

    expect(state.consumedPayloads).toHaveLength(1);
    expect(state.sentMessages.at(-1)).toBe(
      "Codigo invalido o expirado. Genera uno nuevo en Almirant y vuelve a intentarlo.",
    );
  });
});

afterAll(() => {
  mock.restore();
});
