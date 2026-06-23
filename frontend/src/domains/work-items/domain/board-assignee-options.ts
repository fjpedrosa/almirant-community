import type { FilterOption } from "@/domains/shared/domain/filter-types";
import type { WorkItemWithContext } from "./types";

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ALPHANUMERIC_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{16,}$/;

const isOpaqueLegacyAssignee = (value: string): boolean => {
  const trimmedValue = value.trim();

  if (!trimmedValue) return true;
  if (UUID_LIKE_PATTERN.test(trimmedValue)) return true;

  return OPAQUE_ALPHANUMERIC_PATTERN.test(trimmedValue);
};

export const buildBoardAssigneeOptions = (
  columns: Array<Pick<{ items: WorkItemWithContext[] }, "items">>
): FilterOption[] => {
  const visibleAssignees = new Map<string, string>();

  for (const column of columns) {
    for (const item of column.items) {
      for (const assignee of item.assignees ?? []) {
        const userName = assignee.user?.name?.trim();
        if (userName) {
          visibleAssignees.set(userName, userName);
        }
      }

      const legacyAssignee = item.assignee?.trim();
      if (!legacyAssignee || visibleAssignees.has(legacyAssignee)) {
        continue;
      }

      if (!isOpaqueLegacyAssignee(legacyAssignee)) {
        visibleAssignees.set(legacyAssignee, legacyAssignee);
      }
    }
  }

  return Array.from(visibleAssignees.values())
    .map((name) => ({ value: name, label: name }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

