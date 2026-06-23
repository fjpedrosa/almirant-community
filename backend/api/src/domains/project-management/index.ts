import { Elysia } from "elysia";
import { boardsModule } from "./boards";
import { projectsModule } from "./projects";
import { sprintsModule } from "./sprints";
import { importsModule } from "./imports";
import { workItemsModule } from "./work-items";
import { tagsModule } from "./tags";
import { milestonesModule } from "./milestones";
import { savedViewsModule, userViewPreferencesModule } from "./saved-views";
import { integrationBatchesModule } from "./integration-batches";

export const projectManagementModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () =>
    new Elysia()
      .use(boardsModule.protected())
      .use(projectsModule.protected())
      .use(sprintsModule.protected())
      .use(importsModule.protected())
      .use(workItemsModule.protected())
      .use(tagsModule())
      .use(milestonesModule())
      .use(savedViewsModule())
      .use(integrationBatchesModule.protected()),

  /** Auth-only routes (no active organization required) */
  authOnly: () =>
    new Elysia()
      .use(userViewPreferencesModule()),

  /** Internal runner routes (API key auth, no session required) */
  internal: () =>
    new Elysia()
      .use(integrationBatchesModule.internal()),
};
