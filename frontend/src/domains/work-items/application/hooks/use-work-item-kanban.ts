"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useMoveWorkItem } from "./use-work-item-board";
import { useBulkMove } from "./use-work-item-bulk";
import { workItemKeys } from "./use-work-items";
import type { WorkItemWithContext, WorkItemsByColumn } from "../../domain/types";
import { computeChildrenToMove, resolveSelectionToLeafIds } from "../../domain/hierarchy-utils";
import { parseChecklistStatus } from "../../domain/types";

const getColumnsFingerprint = (input: WorkItemsByColumn[]): string =>
  input
    .map((c) => `${c.column.id}:${c.items.length}:${c.items.map((i) =>
      `${i.id}${i.metadata?.generatedPrompt ? ":p" : ""}`
    ).join(",")}`)
    .join("|");

/**
 * Format a toast message for incomplete checklist items.
 */
const formatIncompleteChecklistToast = (uncheckedItems: string[]): string => {
  const itemsList = uncheckedItems.slice(0, 5).map((item) => `- ${item}`).join("\n");
  const suffix = uncheckedItems.length > 5 ? `\n... y ${uncheckedItems.length - 5} más` : "";
  return `Completa los siguientes items antes de mover a Done:\n${itemsList}${suffix}`;
};

/**
 * Check if an error response indicates incomplete checklist.
 */
const isIncompleteChecklistError = (error: unknown): boolean => {
  if (!error) return false;
  const errorStr = String(error);
  return errorStr.includes("INCOMPLETE_CHECKLIST") ||
         errorStr.toLowerCase().includes("incomplete checklist") ||
         errorStr.toLowerCase().includes("checklist incompleto");
};

export const useWorkItemKanban = (
  activeBoardId: string,
  columns: WorkItemsByColumn[],
  selectedIds?: Set<string>,
  onSelectionMoved?: () => void,
  onMovedToDone?: (workItemId: string, workItemTitle: string) => void,
) => {
  const moveWorkItem = useMoveWorkItem(activeBoardId);
  const bulkMove = useBulkMove(activeBoardId);
  const queryClient = useQueryClient();
  const isMutatingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const displacedCardIdRef = useRef<string | null>(null);
  const displacedAtRef = useRef(0);

  const [localColumns, setLocalColumns] = useState<WorkItemsByColumn[]>(columns);
  const [activeItem, setActiveItem] = useState<WorkItemWithContext | null>(null);
  const [justDroppedIds, setJustDroppedIds] = useState<Set<string>>(new Set());

  const localColumnsRef = useRef(localColumns);
  // Sync ref during render (not in useEffect) so it's always up to date for handleDragEnd
  // eslint-disable-next-line react-hooks/refs
  localColumnsRef.current = localColumns;

  // Sync server columns into local state via useEffect.
  // Only sync when the server reference actually changes and we're not mid-drag or mid-mutation.
  // Uses content fingerprint to avoid infinite loops when reference changes but content is the same.
  const lastSyncedColumnsRef = useRef<WorkItemsByColumn[]>([]);
  const lastSyncedFingerprintRef = useRef("");

  useEffect(() => {
    if (
      columns.length > 0 &&
      columns !== lastSyncedColumnsRef.current &&
      !isMutatingRef.current &&
      !isDraggingRef.current
    ) {
      // Compute a lightweight fingerprint (column ids + item ids + counts + metadata signal)
      const fingerprint = getColumnsFingerprint(columns);

      if (fingerprint !== lastSyncedFingerprintRef.current) {
        const localFingerprint = getColumnsFingerprint(localColumnsRef.current);
        lastSyncedFingerprintRef.current = fingerprint;
        lastSyncedColumnsRef.current = columns;
        if (fingerprint !== localFingerprint) {
          setLocalColumns(columns);
        }
      } else {
        // Content is the same, just update the ref to prevent re-entering
        lastSyncedColumnsRef.current = columns;
      }
    }
  }, [columns]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const columnIds = useMemo(
    () => new Set(localColumns.map((c) => c.column.id)),
    [localColumns]
  );

  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);

      // If we just did a cross-column move, briefly filter the displaced card out of
      // collision candidates so it can't trigger an immediate bounce-back reorder.
      // Auto-expires after 150ms so the midpoint check can take over.
      const filterDisplaced = (collisions: ReturnType<typeof pointerWithin>) => {
        if (!displacedCardIdRef.current) return collisions;
        if (Date.now() - displacedAtRef.current > 150) {
          displacedCardIdRef.current = null;
          return collisions;
        }
        return collisions.filter((c) => c.id !== displacedCardIdRef.current);
      };

      if (pointerHits.length > 0) {
        const cardHits = filterDisplaced(
          pointerHits.filter((c) => !columnIds.has(c.id as string))
        );
        if (cardHits.length > 0) {
          if (cardHits.length === 1) return cardHits;
          const hitIds = new Set(cardHits.map((c) => c.id));
          return closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((c) => hitIds.has(c.id)),
          });
        }
        return pointerHits.filter((c) => columnIds.has(c.id as string));
      }
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => columnIds.has(c.id as string)),
      });
    },
    [columnIds]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true;
    displacedCardIdRef.current = null;
    const item = event.active.data.current?.item as WorkItemWithContext;
    if (item) setActiveItem(item);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      setLocalColumns((prev) => {
        const findIn = (itemId: string): string | undefined => {
          for (const col of prev) {
            if (col.items.some((i) => i.id === itemId)) return col.column.id;
          }
          return undefined;
        };

        const activeContainer = findIn(activeId);
        const overContainer = columnIds.has(overId)
          ? overId
          : findIn(overId);

        if (!activeContainer || !overContainer) return prev;

        // Same-column reordering
        if (activeContainer === overContainer) {
          if (columnIds.has(overId)) return prev;

          const colIdx = prev.findIndex((c) => c.column.id === activeContainer);
          if (colIdx === -1) return prev;
          const col = prev[colIdx];
          const activeIdx = col.items.findIndex((i) => i.id === activeId);
          const overIdx = col.items.findIndex((i) => i.id === overId);
          if (activeIdx === -1 || overIdx === -1 || activeIdx === overIdx) return prev;

          // Prevent ping-pong by checking cursor position relative to over item's midpoint
          const isBelowOverItem =
            active.rect.current.translated != null &&
            active.rect.current.translated.top > over.rect.top + over.rect.height / 2;

          // Moving down: only reorder when cursor passes below midpoint
          if (activeIdx < overIdx && !isBelowOverItem) return prev;
          // Moving up: only reorder when cursor passes above midpoint
          if (activeIdx > overIdx && isBelowOverItem) return prev;

          displacedCardIdRef.current = null;
          const newCols = [...prev];
          newCols[colIdx] = { ...col, items: arrayMove(col.items, activeIdx, overIdx) };
          localColumnsRef.current = newCols;
          return newCols;
        }

        // Cross-column move
        const srcIdx = prev.findIndex((c) => c.column.id === activeContainer);
        const dstIdx = prev.findIndex((c) => c.column.id === overContainer);
        if (srcIdx === -1 || dstIdx === -1) return prev;
        const item = prev[srcIdx].items.find((i) => i.id === activeId);
        if (!item) return prev;

        let insertIdx: number;
        if (columnIds.has(overId)) {
          insertIdx = prev[dstIdx].items.length;
        } else {
          const overIndex = prev[dstIdx].items.findIndex((i) => i.id === overId);
          if (overIndex < 0) {
            insertIdx = prev[dstIdx].items.length;
          } else {
            const isBelowOverItem =
              active.rect.current.translated != null &&
              active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
            insertIdx = isBelowOverItem ? overIndex + 1 : overIndex;
          }
        }

        // Record the card at insertIdx as displaced so collision detection filters it briefly
        const displacedCard = prev[dstIdx].items[insertIdx];
        displacedCardIdRef.current = displacedCard?.id ?? null;
        displacedAtRef.current = Date.now();

        const newCols = [...prev];
        newCols[srcIdx] = {
          ...prev[srcIdx],
          items: prev[srcIdx].items.filter((i) => i.id !== activeId),
          count: prev[srcIdx].count - 1,
        };
        const dstItems = [...prev[dstIdx].items];
        dstItems.splice(insertIdx, 0, item);
        newCols[dstIdx] = { ...prev[dstIdx], items: dstItems, count: prev[dstIdx].count + 1 };
        localColumnsRef.current = newCols;
        return newCols;
      });
    },
    [columnIds]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active } = event;
      const activeId = active.id as string;

      // Set mutating BEFORE clearing drag flag to prevent render-time sync gap
      // that causes "Maximum update depth exceeded"
      isMutatingRef.current = true;

      isDraggingRef.current = false;
      displacedCardIdRef.current = null;
      setActiveItem(null);

      // Read final position from localColumns (kept in sync by handleDragOver)
      const cols = localColumnsRef.current;
      let destColumnId: string | null = null;
      let position = 0;
      for (const col of cols) {
        const idx = col.items.findIndex((i) => i.id === activeId);
        if (idx !== -1) {
          destColumnId = col.column.id;
          position = idx;
          break;
        }
      }
      if (!destColumnId) {
        isMutatingRef.current = false;
        setLocalColumns(columns);
        return;
      }

      // Multi-select drag: if dragged item is selected and there are multiple selections
      const isMultiDrag = selectedIds && selectedIds.size > 1 && selectedIds.has(activeId);
      if (isMultiDrag) {
        const originalCol = columns.find((c) => c.items.some((i) => i.id === activeId));
        const destCol = cols.find((c) => c.column.id === destColumnId);
        const columnChanged = !originalCol || originalCol.column.id !== destColumnId;

        // Gate: block move to Done if any selected item has incomplete checklist
        if (columnChanged && destCol?.column.isDone) {
          const allItems = columns.flatMap((c) => c.items);
          const selectedItems = Array.from(selectedIds)
            .map((id) => allItems.find((i) => i.id === id))
            .filter((item): item is WorkItemWithContext => item !== undefined);

          const allUncheckedItems: string[] = [];
          for (const item of selectedItems) {
            const status = parseChecklistStatus(item.metadata);
            if (status.hasIncomplete) {
              allUncheckedItems.push(...status.uncheckedItems);
            }
          }

          if (allUncheckedItems.length > 0) {
            isMutatingRef.current = false;
            setLocalColumns(columns);
            showToast.error(formatIncompleteChecklistToast(allUncheckedItems));
            return;
          }
        }

        if (columnChanged) {
          // Resolve the selection to concrete leaf IDs before moving: any
          // selected parent/grouped card must be expanded to its descendant
          // leaves (directional, mirroring the single grouped-card drag), never
          // sent as a raw parent id — which the bulk-move endpoint cannot move.
          const columnsWithOrder = cols.map((c) => ({ id: c.column.id, order: c.column.order }));
          const allBoardItems = columns.flatMap((c) => c.items);
          const idsToMove = resolveSelectionToLeafIds(selectedIds, allBoardItems, destColumnId, columnsWithOrder);

          if (idsToMove.length === 0) {
            isMutatingRef.current = false;
            setLocalColumns(columns);
            showToast.info("No hay tareas que mover");
            return;
          }

          queryClient.cancelQueries({ queryKey: workItemKeys.all });
          bulkMove.mutate(
            { workItemIds: idsToMove, boardColumnId: destColumnId },
            {
              onSuccess: () => {
                setJustDroppedIds(new Set(selectedIds));
                setTimeout(() => setJustDroppedIds(new Set()), 400);
                onSelectionMoved?.();
              },
              onError: (error) => {
                setLocalColumns(columns);
                if (isIncompleteChecklistError(error)) {
                  showToast.error("Algunos items tienen checklist incompleto. Completa todos los items antes de mover a Done.");
                } else {
                  showToast.error("Error al mover items");
                }
              },
              onSettled: () => {
                isMutatingRef.current = false;
              },
            }
          );
        } else {
          isMutatingRef.current = false;
          setLocalColumns(columns);
        }
        return;
      }

      // Grouped card drag: move children that are in less-advanced columns
      // Backend validates each child's checklist, so no frontend gate here
      const draggedItem = active.data.current?.item as WorkItemWithContext | undefined;
      if (draggedItem?.isVirtualColumn && draggedItem.childrenSummary) {
        const columnsWithOrder = cols.map((c) => ({ id: c.column.id, order: c.column.order }));
        const idsToMove = computeChildrenToMove(draggedItem.childrenSummary, destColumnId, columnsWithOrder);

        if (idsToMove.length === 0) {
          isMutatingRef.current = false;
          setLocalColumns(columns);
          showToast.info("No hay tareas que mover");
          return;
        }

        queryClient.cancelQueries({ queryKey: workItemKeys.all });
        bulkMove.mutate(
          { workItemIds: idsToMove, boardColumnId: destColumnId },
          {
            onSuccess: () => {
              setJustDroppedIds(new Set(idsToMove));
              setTimeout(() => setJustDroppedIds(new Set()), 400);
            },
            onError: (error) => {
              setLocalColumns(columns);
              if (isIncompleteChecklistError(error)) {
                showToast.error("Algunos items tienen checklist incompleto. Completa todos los items antes de mover a Done.");
              } else {
                showToast.error("Error al mover items");
              }
            },
            onSettled: () => {
              isMutatingRef.current = false;
            },
          }
        );
        return;
      }

      const originalCol = columns.find((c) => c.items.some((i) => i.id === activeId));
      const originalPosition = originalCol?.items.findIndex((i) => i.id === activeId) ?? -1;
      const columnChanged = !originalCol || originalCol.column.id !== destColumnId;
      const positionChanged = originalPosition !== position;

      if (columnChanged || positionChanged) {
        // Detect move to a done column (for doc generation prompt and gate)
        const destCol = cols.find((c) => c.column.id === destColumnId);
        const wasAlreadyDone = originalCol?.column.isDone ?? false;
        const isNowDone = destCol?.column.isDone ?? false;
        const movedToDone = columnChanged && isNowDone && !wasAlreadyDone;
        const movedItem = originalCol?.items.find((i) => i.id === activeId);

        // Gate: block move to Done if item has incomplete checklist
        if (movedToDone && movedItem) {
          const checklistStatus = parseChecklistStatus(movedItem.metadata);
          if (checklistStatus.hasIncomplete) {
            isMutatingRef.current = false;
            setLocalColumns(columns);
            showToast.error(formatIncompleteChecklistToast(checklistStatus.uncheckedItems));
            return;
          }
        }

        queryClient.cancelQueries({ queryKey: workItemKeys.all });

        moveWorkItem.mutate(
          { id: activeId, boardColumnId: destColumnId, position },
          {
            onSuccess: () => {
              if (movedToDone && movedItem && onMovedToDone) {
                onMovedToDone(activeId, movedItem.title);
              }
            },
            onError: (error) => {
              setLocalColumns(columns);
              if (isIncompleteChecklistError(error)) {
                showToast.error("Este item tiene checklist incompleto. Completa todos los items antes de mover a Done.");
              } else {
                showToast.error("Error al mover item");
              }
            },
            onSettled: () => {
              isMutatingRef.current = false;
            },
          }
        );
      } else {
        isMutatingRef.current = false;
        setLocalColumns(columns);
      }
    },
    [columns, moveWorkItem, bulkMove, queryClient, selectedIds, onSelectionMoved, onMovedToDone]
  );

  return {
    localColumns,
    activeItem,
    justDroppedIds,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
};
