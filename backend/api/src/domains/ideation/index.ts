import { Elysia } from "elysia";
import { ideasRoutes } from "./ideas/routes/ideas.routes";
import { seedsRoutes } from "./seeds/routes/seeds.routes";
import { todosRoutes } from "./todos/routes/todos.routes";
import { planningSessionsRoutes } from "./planning-sessions/routes/planning-sessions.routes";
import { skillInterviewRoutes } from "./skill-interview/routes/skill-interview.routes";

export const ideationModule = {
  /** Protected routes — mounted inside /api group (session auth) */
  protected: () =>
    new Elysia()
      .use(ideasRoutes)
      .use(seedsRoutes)
      .use(todosRoutes)
      .use(planningSessionsRoutes)
      .use(skillInterviewRoutes),
};
