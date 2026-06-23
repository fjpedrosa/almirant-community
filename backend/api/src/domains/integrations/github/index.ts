import { Elysia } from "elysia";
import { githubWebhooksRoutes } from "./routes/webhooks.routes";
import { githubRoutes } from "./routes/github.routes";
import { githubPullRequestsRoutes } from "./routes/pull-requests.routes";

export const githubModule = {
  /** Public webhook endpoint — mounted at root level (no session auth) */
  webhooks: () => new Elysia().use(githubWebhooksRoutes),
  /** Protected routes — mounted inside /api group (session auth) */
  protected: () => new Elysia().use(githubRoutes),
  /** Pull request routes — session OR API key auth, mounted outside /api group */
  pullRequests: () => new Elysia().use(githubPullRequestsRoutes),
};
