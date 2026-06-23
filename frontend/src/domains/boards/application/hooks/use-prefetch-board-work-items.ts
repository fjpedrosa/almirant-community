"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import { boardKeys } from "./use-boards";
import { boardsApi } from "@/lib/api/client";
import type { BoardWithStats } from "../../domain/types";

/**
 * Prefetches board-by-area data and work items for the first board in each area.
 * When the user clicks a board card on the boards overview page, they navigate to
 * `/boards/${area}` which loads boards by area + work items for the first board.
 * This hook ensures that data is already cached before navigation.
 *
 * Prefetch only runs once after boards load. React Query's `prefetchQuery`
 * is a no-op if data is already cached and fresh, so no duplicate requests occur.
 */
export const usePrefetchBoardWorkItems = (boards: BoardWithStats[] | undefined) => {
  const queryClient = useQueryClient();
  const hasPrefetched = useRef(false);

  useEffect(() => {
    if (!boards || boards.length === 0 || hasPrefetched.current) return;
    hasPrefetched.current = true;

    // Group boards by area to know which areas to prefetch
    const areaSet = new Set<string>();
    const firstBoardByArea = new Map<string, string>();

    for (const board of boards) {
      if (!areaSet.has(board.area)) {
        areaSet.add(board.area);
        firstBoardByArea.set(board.area, board.id);
      }
    }

    // Prefetch boards-by-area queries (used by the area page)
    for (const area of areaSet) {
      queryClient.prefetchQuery({
        queryKey: boardKeys.listByArea(area),
        queryFn: () => boardsApi.listByArea(area),
        staleTime: 30_000,
      });
    }

    // Prefetch work items for the first board in each area
    // (the area page defaults to the first board)
    for (const [, boardId] of firstBoardByArea) {
      queryClient.prefetchQuery({
        queryKey: [...workItemKeys.byBoard(boardId), ""],
        queryFn: () => workItemsApi.getByBoard(boardId),
        staleTime: 30_000,
      });
    }
  }, [boards, queryClient]);
};
