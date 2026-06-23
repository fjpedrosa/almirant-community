"use client";

import { useBoardsByArea } from "./use-boards";
import type { BoardWithStats } from "../../domain/types";

const EMPTY_BOARDS: BoardWithStats[] = [];

export const useBoardAreaPage = (area: string) => {
  const { data: boards, isLoading: boardsLoading } = useBoardsByArea(area);

  const boardList = (boards as BoardWithStats[]) ?? EMPTY_BOARDS;
  // Use the first board as the active one for metadata purposes (sprints, etc.)
  const activeBoardId = boardList[0]?.id || "";
  const activeBoard = boardList[0];

  return {
    boards: boardList,
    boardsLoading,
    activeBoardId,
    activeBoard,
  };
};
