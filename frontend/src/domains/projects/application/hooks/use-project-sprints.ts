"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import { sprintsApi } from "@/lib/api/client";
import { sprintKeys } from "@/domains/sprints/application/hooks/use-sprints";
import type { SprintWithCount } from "@/domains/sprints/domain/types";
import type { ProjectSprintItem } from "../../domain/types";

export const useProjectSprints = (_projectId: string) => {
  const { data: boards, isLoading: isLoadingBoards } =
    useAllBoards();

  const boardsList = useMemo(() => boards ?? [], [boards]);

  const sprintQueries = useQueries({
    queries: boardsList.map((board) => ({
      queryKey: sprintKeys.byBoard(board.id),
      queryFn: () =>
        sprintsApi.listByBoard(board.id) as Promise<SprintWithCount[]>,
      enabled: !!board.id,
      staleTime: 30_000,
    })),
  });

  const isLoadingSprints = sprintQueries.some((q) => q.isLoading);
  const isLoading = isLoadingBoards || isLoadingSprints;

  const sprints: ProjectSprintItem[] = useMemo(() => {
    const result: ProjectSprintItem[] = [];

    boardsList.forEach((board, index) => {
      const query = sprintQueries[index];
      if (!query?.data || !Array.isArray(query.data)) return;

      for (const sprint of query.data) {
        result.push({
          ...sprint,
          boardName: board.name,
        });
      }
    });

    // Sort: open sprints first, then by most recent closed/created date
    result.sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1;
      if (a.status !== "open" && b.status === "open") return 1;

      const dateA = a.closedAt ?? a.createdAt;
      const dateB = b.closedAt ?? b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return result;
  }, [boardsList, sprintQueries]);

  return {
    sprints,
    isLoading,
    isEmpty: !isLoading && sprints.length === 0,
  };
};
