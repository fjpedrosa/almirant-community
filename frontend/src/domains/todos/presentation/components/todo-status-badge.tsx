/**
 * Todo status constants - used by detail-panel and filter-bar only.
 *
 * The TodoStatusBadge component was removed in favour of StatusExpandingPill
 * which is now used in list views via TodoStatusExpandingPill.
 * These color maps are still consumed by:
 *   - todo-detail-panel.tsx  (inline status badge inside the panel)
 *   - todos-filter-bar.tsx   (filter dropdown labels)
 * 
 * Note: Status labels should be retrieved via useTranslations("todos") 
 * using t("status.pending"), t("status.in_progress"), etc.
 */
import type { TodoItemStatus } from "../../domain/types";

export const TODO_STATUS_COLORS: Record<TodoItemStatus, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  done: "bg-green-100 text-green-700 border-green-200",
  blocked: "bg-red-100 text-red-700 border-red-200",
};
