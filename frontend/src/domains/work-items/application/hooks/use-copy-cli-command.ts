import { useState, useCallback, useRef } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";

interface WorkItemForCommand {
  taskId: string | null;
  parentId: string | null;
  parentTaskId: string | null;
  type: string;
}

/**
 * Generates the `/implement` CLI command for selected work items.
 * The unified skill accepts any combination of IDs.
 */
const generateCliCommand = (items: WorkItemForCommand[]): string | null => {
  const itemsWithTaskId = items.filter(
    (item): item is WorkItemForCommand & { taskId: string } =>
      item.taskId !== null
  );

  if (itemsWithTaskId.length === 0) return null;

  // Single item
  if (itemsWithTaskId.length === 1) {
    return `/implement ${itemsWithTaskId[0].taskId}`;
  }

  // Multiple items: check if all share the same parent feature/epic
  const firstParentId = itemsWithTaskId[0].parentId;
  const allSameParent =
    firstParentId !== null &&
    itemsWithTaskId.every((item) => item.parentId === firstParentId);

  if (allSameParent) {
    // All children of the same parent - use the parent's taskId if available
    const parentTaskId = itemsWithTaskId[0].parentTaskId;
    if (parentTaskId) {
      return `/implement ${parentTaskId}`;
    }
  }

  // Different parents or no parent taskId - list individual tasks
  const taskIds = itemsWithTaskId.map((item) => item.taskId).join(" ");
  return `/implement ${taskIds}`;
};

const RESET_DELAY_MS = 2000;

export const useCopyCliCommand = () => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyToClipboard = useCallback(
    async (items: WorkItemForCommand[], successMessage?: string) => {
      const command = generateCliCommand(items);
      if (!command) return;

      try {
        await navigator.clipboard.writeText(command);
        setCopied(true);
        showToast.success(successMessage ?? command);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, RESET_DELAY_MS);
      } catch {
        showToast.error("Failed to copy to clipboard");
      }
    },
    []
  );

  const getCommand = useCallback((items: WorkItemForCommand[]) => {
    return generateCliCommand(items);
  }, []);

  return { copied, copyToClipboard, getCommand };
};
