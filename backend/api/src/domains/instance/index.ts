import { Elysia } from "elysia";
import { instancePublicRoutes } from "./routes/instance-public.routes";
import { instanceOnboardingRoutes } from "./routes/instance-onboarding.routes";
import { tailscaleRoutes } from "./routes/tailscale.routes";
import { tailnetDatabaseRoutes } from "./routes/tailnet-database.routes";
import { githubAppRoutes } from "./routes/github-app.routes";
import { instanceVersionRoutes } from "./routes/instance-version.routes";
import { instanceUpdateRoutes } from "./routes/instance-update.routes";
import { instanceCapacityRoutes } from "./routes/instance-capacity.routes";
import { instanceServiceOperationsRoutes } from "./routes/instance-service-operations.routes";
import { effortEstimatorRoutes } from "./routes/effort-estimator.routes";

export const instanceModule = {
  /** Public config endpoint -- mounted at root level (no session auth) */
  public: () => new Elysia().use(instancePublicRoutes),
  /** Protected onboarding + tailscale + github-app + version + update routes -- mounted inside /api group (session auth + admin) */
  protected: () =>
    new Elysia()
      .use(instanceOnboardingRoutes)
      .use(tailscaleRoutes)
      .use(tailnetDatabaseRoutes)
      .use(githubAppRoutes)
      .use(instanceVersionRoutes)
      .use(instanceUpdateRoutes)
      .use(instanceCapacityRoutes)
      .use(instanceServiceOperationsRoutes)
      .use(effortEstimatorRoutes),
};
