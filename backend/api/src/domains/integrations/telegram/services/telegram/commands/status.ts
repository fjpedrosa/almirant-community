import {
  getInProgressWorkItemsForUser,
  getProjects,
} from "@almirant/database";
import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";
export async function handleStatusCommand(
  ctx: TelegramMessageContext
): Promise<TelegramOutboundMessage> {
  const [{ projects }, inProgress] = await Promise.all([
    getProjects({ page: 1, limit: 5, offset: 0 }, { status: "active" }),
    getInProgressWorkItemsForUser(ctx.userId, 25),
  ]);

  const projectsLine =
    projects.length > 0
      ? projects.map((p) => `- ${p.name}`).join("\n")
      : "- (sin proyectos activos)";

  return {
    parseMode: "Markdown",
    text:
      "*Status*\n\n" +
      "📁 *Proyectos activos*\n" +
      `${projectsLine}\n\n` +
      `🧩 *Tus items en progreso:* ${inProgress.length}\n` +
      (inProgress.length > 0
        ? inProgress
            .slice(0, 8)
            .map((w) => `- ${w.taskId} ${w.title} (${w.boardName})`)
            .join("\n")
        : "- (ninguno)"),
  };
}
