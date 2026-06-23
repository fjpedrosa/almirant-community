import { Elysia } from "elysia";
import { aiRoutes } from "./generation/routes/ai.routes";
import { aiSkillGenerateRoutes } from "./generation/routes/ai-skill-generate.routes";
import { aiChatRoutes } from "./chat/routes/ai-chat.routes";
import { aiConversationsRoutes } from "./chat/routes/ai-conversations.routes";
import { askRoutes } from "./ask/routes/ask.routes";

export const aiModule = {
  /** Protected routes — mounted inside /api group (session auth) */
  protected: () =>
    new Elysia()
      .use(aiRoutes)
      .use(aiSkillGenerateRoutes)
      .use(aiChatRoutes)
      .use(aiConversationsRoutes)
      .use(askRoutes),
};
