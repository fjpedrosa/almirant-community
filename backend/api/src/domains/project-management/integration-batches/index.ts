import { Elysia } from "elysia";
import { integrationBatchesRoutes } from "./routes/integration-batches.routes";
import { internalIntegrationBatchesRoutes } from "./routes/internal-integration-batches.routes";

export const integrationBatchesModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(integrationBatchesRoutes),
  /** Internal routes (runner API key auth) - mounted under /api */
  internal: () => new Elysia().use(internalIntegrationBatchesRoutes),
};
