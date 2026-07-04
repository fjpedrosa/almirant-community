"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import type { WorkItemsByColumn } from "../../domain/types";
import { workItemKeys } from "./use-work-items";

export const useWorkItemsByBoard = (boardId: string, filterParams?: Record<string, string>) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const filterKey = filterParams ? JSON.stringify(filterParams) : "";
  const scopedKey = useOrgScopedKey([...workItemKeys.byBoard(boardId), filterKey]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => workItemsApi.getByBoard(boardId, filterParams) as Promise<WorkItemsByColumn[]>,
    // Gate on a confirmed org: otherwise the query fires once under `org:none`
    // and refetches under `org:<id>`, doubling the ~550KB board fetch.
    enabled: !!boardId && !!confirmedActiveTeamId,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // 5 minutes - board updates via mutations, not polling
  });
};

export const useWorkItemsByArea = (area: string, filterParams?: Record<string, string>) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const filterKey = filterParams ? JSON.stringify(filterParams) : "";
  const scopedKey = useOrgScopedKey([...workItemKeys.all, "byArea", area, filterKey]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => workItemsApi.getByArea(area, filterParams) as Promise<WorkItemsByColumn[]>,
    // Gate on a confirmed org (see useWorkItemsByBoard) to kill the double fetch.
    enabled: !!area && !!confirmedActiveTeamId,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // 5 minutes - area updates via mutations, not polling
  });
};

export const useMoveWorkItem = (boardId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, boardColumnId, position }: { id: string; boardColumnId: string; position: number }) =>
      workItemsApi.move(id, boardColumnId, position),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.byBoard(boardId) });
      queryClient.invalidateQueries({ queryKey: workItemKeys.byAreaPrefix() });
      queryClient.invalidateQueries({ queryKey: workItemKeys.detail(variables.id) });
    },
  });
};
