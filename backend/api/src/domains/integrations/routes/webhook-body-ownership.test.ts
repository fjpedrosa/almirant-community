import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const state = {
  consumedCodes: [] as string[],
};

mock.module("@almirant/config", () => ({
  env: {
    TELEGRAM_WEBHOOK_SECRET_TOKEN: undefined,
    TELEGRAM_BOT_TOKEN: "test-bot-token",
  },
  logger: { error: () => {}, info: () => {}, warn: () => {} },
}));

mock.module("@almirant/database", () => ({
  consumeTelegramLinkCode: async (args: { code: string }) => {
    state.consumedCodes.push(args.code);
    return { ok: true, userId: "test-user" };
  },
  getTelegramAccountByChatId: async () => null,
  getUserById: async () => ({ id: "test-user", name: "Test User" }),
}));

mock.module("../github/services/github-service", () => ({
  verifyWebhookSignature: async () => true,
}));

mock.module("../github/services/github-webhook-handlers", () => ({
  handlePushEvent: async () => {},
  handlePullRequestEvent: async () => {},
  handlePullRequestReviewEvent: async () => {},
  handleCheckRunEvent: async () => {},
  handleWorkflowRunEvent: async () => {},
  handleInstallationEvent: async () => {},
}));

mock.module("../telegram/services/telegram-bot", () => ({
  telegramBot: {
    sendMessage: async () => {},
    answerCallbackQuery: async () => {},
  },
}));

mock.module("../telegram/services/telegram-utils", () => ({
  getFrontendBaseUrl: () => "https://app.example",
  getTelegramSecretHeader: () => "",
  normalizeTelegramChatId: (value: unknown) => (value == null ? null : String(value)),
}));

mock.module("../telegram/services/telegram/command-router", () => ({
  applyCallbackResult: async () => {},
  routeTelegramCallback: async () => ({ kind: "noop" }),
  routeTelegramCommand: async () => ({ text: "ok" }),
}));

const makeTelegramRequest = (): Request =>
  new Request("http://localhost/webhooks/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      update_id: 1,
      message: {
        chat: { id: "test-chat" },
        from: { id: "test-sender" },
        text: "/start synthetic-payload",
      },
    }),
  });

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("composed webhook body ownership", () => {
  beforeEach(() => {
    state.consumedCodes = [];
  });

  it("preserves Telegram body access after the GitHub parser runs", async () => {
    const { githubWebhooksRoutes } = await import("../github/routes/webhooks.routes");
    const { telegramWebhooksRoutes } = await import("../telegram/routes/webhooks.routes");
    // Model the shared public parse lifecycle used by the integration composition.
    const app = new Elysia()
      .use(githubWebhooksRoutes.as("global"))
      .use(new Elysia().use(telegramWebhooksRoutes));

    const response = await app.handle(makeTelegramRequest());
    await settle();

    expect(response.status).toBe(200);
    expect(state.consumedCodes).toEqual(["synthetic-payload"]);
  });
});

afterAll(() => {
  mock.restore();
});
