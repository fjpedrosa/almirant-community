import {
  findUsersByQuery,
  getUserByEmail,
  getBoardByIdInternal,
  getWorkItemByTaskIdExact,
  updateWorkItem,
} from "@almirant/database";
import type { TelegramMessageContext, TelegramOutboundMessage } from "../types";

function normalizeAssigneeQuery(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("@")) return s.slice(1);
  return s;
}

export async function handleAssignCommand(
  ctx: TelegramMessageContext,
  taskId: string,
  assigneeQueryRaw: string | null
): Promise<TelegramOutboundMessage> {
  const item = await getWorkItemByTaskIdExact(taskId);
  if (!item) {
    return { parseMode: "Markdown", text: `No encontré el item \`${taskId}\`.` };
  }

  const q = assigneeQueryRaw ? normalizeAssigneeQuery(assigneeQueryRaw) : "";

  // Default: assign to self
  let targetUserId = ctx.userId;
  let targetLabel = `${ctx.user.name} (${ctx.user.email})`;

  if (q && q !== "me" && q !== "yo" && q !== "self") {
    const byEmail = q.includes("@") ? await getUserByEmail(q) : null;
    const candidates = byEmail ? [byEmail] : await findUsersByQuery(q, 5);
    const picked = candidates[0] ?? null;
    if (!picked) {
      return { parseMode: "Markdown", text: "No encontré ese usuario. Prueba con email o nombre." };
    }
    targetUserId = picked.id;
    targetLabel = `${picked.name} (${picked.email})`;
  }

  const board = await getBoardByIdInternal(item.boardId);
  const organizationId = board?.organizationId;
  if (!organizationId) {
    return { parseMode: "Markdown", text: "No pude resolver la organización del board." };
  }

  const updated = await updateWorkItem(
    organizationId,
    item.id,
    { assignee: targetUserId },
    { triggeredBy: "system", triggeredByUserId: ctx.userId }
  );

  if (!updated) {
    return { parseMode: "Markdown", text: "No pude asignar el item." };
  }

  return {
    parseMode: "Markdown",
    text: `✅ Asignado *${item.taskId}* a *${targetLabel}*.`,
  };
}
