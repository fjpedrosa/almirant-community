import { Elysia } from "elysia";
import { sessionAuthMiddleware } from "../../shared/middleware/session-auth.middleware";
import { apiKeysRoutes } from "./routes/api-keys.routes";
import { serviceAccountsRoutes } from "./routes/service-accounts.routes";
import { devAuthRoutes } from "./routes/dev-auth.routes";
import { usersRoutes } from "./routes/users.routes";
import { onboardingRoutes } from "./routes/onboarding.routes";
import { organizationSettingsRoutes } from "./routes/organization-settings.routes";
import { linkTokenPublicRoutes } from "./routes/link-token-public.routes";
import { mcpOAuthRoutes } from "./routes/mcp-oauth.routes";

export const authModule = {
  /** Public dev-auth routes (disabled in production) - mounted outside /api */
  public: () => new Elysia().use(devAuthRoutes),
  /** Public OAuth endpoints for ChatGPT/remote MCP clients. */
  mcpOAuth: () => new Elysia().use(sessionAuthMiddleware).use(mcpOAuthRoutes),
  /** Public link-token complete endpoint (unauthenticated, for CLI) - mounted outside /api */
  linkToken: () => new Elysia().use(linkTokenPublicRoutes),
  /** Auth-only routes (no active organization required) - mounted under /api after auth middleware */
  authOnly: () => new Elysia().use(usersRoutes).use(onboardingRoutes),
  /** Organization-scoped routes - mounted under /api after org middleware */
  protected: () =>
    new Elysia()
      .use(apiKeysRoutes)
      .use(serviceAccountsRoutes)
      .use(organizationSettingsRoutes),
};
