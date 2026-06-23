import { Elysia } from "elysia";
import { connectionsRoutes } from "./routes/connections.routes";
import { providerKeysRoutes } from "./routes/provider-keys.routes";

export const connectionsModule = {
  /** Protected routes — mounted inside /api group (session auth) */
  protected: () =>
    new Elysia()
      .use(connectionsRoutes)
      .use(providerKeysRoutes),
};
