import { Elysia } from "elysia";
import { sessionAuthMiddleware, requireAuth, requireWorkspace } from "../shared/middleware/session-auth.middleware";
import { documentCategoriesModule } from "../domains/documents/categories";
import { documentsModule } from "../domains/documents";
import { authModule } from "../domains/auth";
import { observabilityModule } from "../domains/observability";
import { notificationsModule } from "../domains/notifications";
import { billingModule } from "../domains/billing";
import { connectionsModule } from "../domains/connections";
import { ideationModule } from "../domains/ideation";
import { notesModule } from "../domains/notes";
import { aiModule } from "../domains/ai";
import { integrationsModule } from "../domains/integrations";
import { projectManagementModule } from "../domains/project-management";
import { webhooksModule } from "../domains/webhooks";
import { agentsModule } from "../domains/agents";
import { instanceModule } from "../domains/instance";
import { storageModule } from "../domains/storage";
import { handbookModule } from "../domains/handbook";
import { feedbackModule } from "../domains/feedback";
import { debugModule } from "../domains/debug";
import { adminRoutes } from "../domains/admin";

/**
 * Canonical authenticated REST composition. Production and integration tests
 * share this factory so Notes cannot bypass session, workspace, or membership
 * middleware through a test-only mount.
 */
export const createProtectedApi = () =>
  new Elysia({ name: "protected-api" }).group("/api", (app) =>
    app
      // Keep the worker alias before session auth; runner API keys are not user
      // sessions and must never be interpreted as one.
      .use(projectManagementModule.internal())
      .use(sessionAuthMiddleware)
      .use(requireAuth)
      .use(authModule.authOnly())
      .use(projectManagementModule.authOnly())
      .use(storageModule.authOnly())
      .use(instanceModule.protected())
      .use(requireWorkspace)
      .use(projectManagementModule.protected())
      .use(webhooksModule.protected())
      .use(agentsModule.protected())
      .use(documentsModule.protected())
      .use(handbookModule.protected())
      .use(documentCategoriesModule())
      .use(authModule.protected())
      .use(integrationsModule.protected())
      .use(aiModule.protected())
      .use(notificationsModule.protected())
      .use(connectionsModule.protected())
      .use(observabilityModule.protected())
      .use(ideationModule.protected())
      .use(notesModule.protected())
      .use(billingModule.protected())
      .use(feedbackModule.protected())
      .use(debugModule.protected())
      .use(adminRoutes)
      .use(documentsModule.uploads()),
  );
