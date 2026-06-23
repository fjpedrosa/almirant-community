import { Elysia } from "elysia";
import { githubModule } from "./github";
import { discordModule } from "./discord";
import { telegramModule } from "./telegram";
import { vercelModule } from "./vercel";
import { coolifyModule } from "./coolify";

export const integrationsModule = {
  /** Public webhook/interaction endpoints — mounted at root level (no session auth) */
  public: () =>
    new Elysia()
      .use(githubModule.webhooks())
      .use(discordModule.interactions())
      .use(telegramModule.webhooks())
      .use(vercelModule.webhooks())
      .use(coolifyModule.webhooks()),

  /** Protected routes — mounted inside /api group (session auth) */
  protected: () =>
    new Elysia()
      .use(githubModule.protected())
      .use(discordModule.protected())
      .use(telegramModule.protected())
      .use(vercelModule.protected()),

  /** GitHub PR routes — session OR API key auth, mounted outside /api group */
  pullRequests: () => githubModule.pullRequests(),
};
