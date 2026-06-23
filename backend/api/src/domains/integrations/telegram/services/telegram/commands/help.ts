import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";

export async function handleHelpCommand(
  _ctx: TelegramMessageContext
): Promise<TelegramOutboundMessage> {
  return {
    parseMode: "Markdown",
    text:
      "*Ayuda*\n\n" +
      "🧭 *Básicos*\n" +
      "- `/help` Lista de comandos\n" +
      "- `/status` Estado general\n" +
      "- `/me` Tu usuario vinculado\n\n" +
      "🛠️ *Gestión*\n" +
      "- `/tasks` Mis tareas en progreso\n" +
      "- `/tasks <proyecto>` Filtra por proyecto\n" +
      "- `/boards` Listar boards\n" +
      "- `/board <nombre>` Resumen de un board\n" +
      "- `/move <TASK_ID> <columna>` Mover un work item (con confirmación)\n" +
      "- `/assign <TASK_ID> <email|nombre|me>` Asignar un work item\n\n" +
      "🚀 *Avanzados*\n" +
      "- `/create <tipo> <titulo>` Crear work item (flujo con botones)\n" +
      "- `/sprint` Sprint activo del board actual\n" +
      "- `/sprint close` Cerrar sprint (con confirmación)\n" +
      "- `/search <texto>` Buscar work items por título\n\n" +
      "Notas:\n" +
      "- `TASK_ID` es algo como `MC-123`.\n" +
      "- Tipos para `/create`: `task`, `story`, `feature`, `epic`.",
  };
}
