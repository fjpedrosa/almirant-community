import {
  getActiveSprint,
  getBoardByIdInternal,
  getInProgressWorkItemsForUser,
  getProjects,
} from "@almirant/database";
import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";
import { telegramState } from "../state";

export async function handleStatusCommand(
  ctx: TelegramMessageContext
): Promise<TelegramOutboundMessage> {
  const st = telegramState.get(ctx.chatId);

  const [{ projects }, inProgress] = await Promise.all([
    getProjects({ page: 1, limit: 5, offset: 0 }, { status: "active" }),
    getInProgressWorkItemsForUser(ctx.userId, 25),
  ]);

  let sprint = null;
  if (st.activeBoardId) {
    const board = await getBoardByIdInternal(st.activeBoardId);
    if (board) {
      sprint = await getActiveSprint(board.organizationId, st.activeBoardId);
    }
  }

  const projectsLine =
    projects.length > 0
      ? projects.map((p) => `- ${p.name}`).join("\n")
      : "- (sin proyectos activos)";

  const sprintLine = sprint
    ? `🏃 *Sprint activo:* ${sprint.name} (${sprint.workItemCount} items)`
    : "🏃 *Sprint activo:* (no detectado, usa `/board <nombre>` para seleccionar un board)";

  return {
    parseMode: "Markdown",
    text:
      "*Status*\n\n" +
      "📁 *Proyectos activos*\n" +
      `${projectsLine}\n\n` +
      `${sprintLine}\n\n` +
      `🧩 *Tus items en progreso:* ${inProgress.length}\n` +
      (inProgress.length > 0
        ? inProgress
            .slice(0, 8)
            .map((w) => `- ${w.taskId} ${w.title} (${w.boardName})`)
            .join("\n")
        : "- (ninguno)"),
  };
}
