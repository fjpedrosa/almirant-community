import { Elysia } from "elysia";
import { discordInteractionsRoutes } from "./routes/interactions.routes";
import { discordOauthRoutes } from "./routes/oauth.routes";

export const discordModule = {
  /** Public interactions endpoint — mounted at root level (Ed25519 verification) */
  interactions: () => new Elysia().use(discordInteractionsRoutes),
  /** Protected OAuth routes — mounted inside /api group (session auth) */
  protected: () => new Elysia().use(discordOauthRoutes),
};
