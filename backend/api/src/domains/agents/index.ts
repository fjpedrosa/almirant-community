import { Elysia } from "elysia";
import { agentJobsRoutes } from "./routes/agent-jobs.routes";
import { agentWebhooksRoutes } from "./routes/agent-webhooks.routes";
import { workersRoutes } from "./routes/workers.routes";
import { workersDashboardRoutes } from "./routes/workers-dashboard.routes";
import { workerSessionTokenRoutes } from "./routes/worker-session-token.routes";
import { scheduledAgentsRoutes } from "./routes/scheduled-agents.routes";
import { scheduledAgentRunsRoutes } from "./routes/scheduled-agent-runs.routes";
import { skillsRoutes } from "./routes/skills.routes";
import { skillsSyncRoutes } from "./routes/skills-sync.routes";
import { memoryRoutes } from "./routes/memory.routes";
import { agentConnectionsRoutes } from "./routes/agent-connections.routes";

export const agentsModule = {
  /** API key auth routes — mounted at root level (no session auth) */
  public: () =>
    new Elysia()
      .use(workersRoutes)
      .use(workerSessionTokenRoutes)
      .use(skillsSyncRoutes)
      .use(agentWebhooksRoutes)
      .use(agentConnectionsRoutes.public()),

  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () =>
    new Elysia()
      .use(agentJobsRoutes)
      .use(scheduledAgentRunsRoutes)
      .use(scheduledAgentsRoutes)
      .use(skillsRoutes)
      .use(memoryRoutes)
      .use(agentConnectionsRoutes.protected()),

  /** Workers dashboard — mounted under /api/admin (admin auth) */
  dashboard: () => new Elysia().use(workersDashboardRoutes),
};
