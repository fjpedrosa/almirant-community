import { Elysia } from "elysia";
import { healthRoutes } from "./routes/health.routes";
import { analyticsRoutes } from "./routes/analytics.routes";
import { observabilityRoutes } from "./routes/observability.routes";

export const observabilityModule = {
  /** Public health check routes (no auth) - mounted outside /api */
  public: () => new Elysia().use(healthRoutes),
  /** Protected analytics and observability routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(analyticsRoutes).use(observabilityRoutes),
};
