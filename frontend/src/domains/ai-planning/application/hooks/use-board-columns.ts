"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { boardsApi } from "@/lib/api/client";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";
import type { BoardWithStats } from "@/domains/boards/domain/types";

// ---------------------------------------------------------------------------
// Hook: useBoardColumns
// ---------------------------------------------------------------------------
// Fetches board columns for the selected board and manages column selection
// state. Extracted from usePlanChatPage to keep the orchestrator lightweight.
// ---------------------------------------------------------------------------

export const useBoardColumns = (selectedBoardId: string) => {
  const boardQuery = useQuery({
    queryKey: boardKeys.detail(selectedBoardId),
    queryFn: () =>
      boardsApi.get(selectedBoardId) as Promise<BoardWithStats>,
    enabled: !!selectedBoardId,
  });

  const columns = useMemo(
    () => boardQuery.data?.columns ?? [],
    [boardQuery.data?.columns],
  );

  const defaultColumnId = useMemo(() => {
    const nonDone = columns.find((c) => !c.isDone);
    return nonDone?.id ?? columns[0]?.id ?? "";
  }, [columns]);

  const [selectedColumnId, setSelectedColumnId] = useState("");
  const activeColumnId = selectedColumnId || defaultColumnId;

  return {
    columns,
    activeColumnId,
    onColumnChange: setSelectedColumnId,
  };
};
