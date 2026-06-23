"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { aiApi } from "@/lib/api/client";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";
import type {
  GeneratedWorkItem,
  WorkItemPreview,
  GenerateWorkItemsResponse,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** UUID v4 prefix pattern — detects items already persisted in the database. */
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

/** Convert raw generated items into editable previews. */
const toPreviewItems = (items: GeneratedWorkItem[]): WorkItemPreview[] =>
  items.map((item) => ({ ...item, isEditing: false, isRemoved: false }));

/**
 * Collect all descendant tempIds for a given parent (recursive).
 * Walks the full tree so nested children are captured too.
 */
const collectDescendantIds = (
  parentTempId: string,
  items: WorkItemPreview[],
): Set<string> => {
  const result = new Set<string>();
  const directChildren = items.filter(
    (i) => i.parentTempId === parentTempId,
  );
  for (const child of directChildren) {
    result.add(child.tempId);
    const nested = collectDescendantIds(child.tempId, items);
    for (const id of nested) {
      result.add(id);
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useWorkItemGeneration = (
  generatedItems: GeneratedWorkItem[],
  projectId: string,
  boardId: string,
) => {
  const queryClient = useQueryClient();

  // -- Editable preview state ------------------------------------------------
  // Sync when generatedItems reference changes using the "store previous props
  // in state" pattern recommended by React for adjusting state during render.
  // See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevGeneratedItems, setPrevGeneratedItems] =
    useState<GeneratedWorkItem[]>(generatedItems);
  const [previewItems, setPreviewItems] = useState<WorkItemPreview[]>([]);
  const [createdItemIds, setCreatedItemIds] = useState<string[]>([]);

  // Items from planning:done with real workItemIds use UUID format as tempId.
  const isAlreadyCreated =
    generatedItems.length > 0 &&
    generatedItems.every((item) => UUID_PREFIX_RE.test(item.tempId));

  if (prevGeneratedItems !== generatedItems) {
    setPrevGeneratedItems(generatedItems);
    if (generatedItems.length > 0) {
      setPreviewItems(toPreviewItems(generatedItems));
      // When items are already persisted, populate createdItemIds immediately.
      setCreatedItemIds(
        isAlreadyCreated ? generatedItems.map((i) => i.tempId) : [],
      );
    }
  }

  // -- Update a single item locally -----------------------------------------
  const updateItem = useCallback(
    (tempId: string, changes: Partial<GeneratedWorkItem>) => {
      setPreviewItems((prev) =>
        prev.map((item) =>
          item.tempId === tempId ? { ...item, ...changes } : item,
        ),
      );
    },
    [],
  );

  // -- Remove item + descendants recursively --------------------------------
  const removeItem = useCallback((tempId: string) => {
    setPreviewItems((prev) => {
      const descendantIds = collectDescendantIds(tempId, prev);
      return prev.map((item) => {
        if (item.tempId === tempId || descendantIds.has(item.tempId)) {
          return { ...item, isRemoved: true };
        }
        return item;
      });
    });
  }, []);

  // -- Confirm generation mutation -------------------------------------------
  const generateMutation = useMutation<
    GenerateWorkItemsResponse,
    Error,
    { boardColumnId: string }
  >({
    mutationFn: ({ boardColumnId }) => {
      const activeItems: GeneratedWorkItem[] = previewItems
        .filter((i) => !i.isRemoved)
        .map(({ tempId, type, title, description, priority, parentTempId }) => ({
          tempId,
          type,
          title,
          description,
          priority,
          parentTempId,
        }));

      return aiApi.generateWorkItems({
        items: activeItems,
        projectId,
        boardId,
        boardColumnId,
      });
    },
    onSuccess: (data) => {
      setCreatedItemIds(data.createdIds);

      // Invalidate work items and board queries so the board refreshes.
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      queryClient.invalidateQueries({ queryKey: boardKeys.all });

      if (data.errors.length > 0) {
        showToast.warning(
          `Created ${data.createdIds.length} items, but ${data.errors.length} failed.`,
        );
      } else {
        showToast.success(
          `${data.createdIds.length} work items created successfully.`,
        );
      }
    },
    onError: (error) => {
      showToast.error(error.message || "Failed to create work items.");
    },
  });

  const confirmGeneration = useCallback(
    (boardColumnId: string) => {
      if (isAlreadyCreated) {
        // Items were created during the planning session — just refresh queries.
        queryClient.invalidateQueries({ queryKey: workItemKeys.all });
        queryClient.invalidateQueries({ queryKey: boardKeys.all });
        showToast.success(
          `${generatedItems.length} work items created during planning.`,
        );
        return;
      }
      generateMutation.mutate({ boardColumnId });
    },
    [generateMutation, isAlreadyCreated, generatedItems.length, queryClient],
  );

  // -- Reset all state -------------------------------------------------------
  const resetGeneration = useCallback(() => {
    setPreviewItems([]);
    setCreatedItemIds([]);
    generateMutation.reset();
  }, [generateMutation]);

  // -- Derived values --------------------------------------------------------
  const activeItemCount = previewItems.filter((i) => !i.isRemoved).length;

  return {
    previewItems,
    updateItem,
    removeItem,
    confirmGeneration,
    isConfirming: generateMutation.isPending,
    isAlreadyCreated,
    error: generateMutation.error,
    createdItemIds,
    activeItemCount,
    resetGeneration,
  };
};
