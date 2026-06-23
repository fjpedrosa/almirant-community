import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sprintsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  SprintWithCount,
  SprintWorkItemDetail,
  DoneItemPreview,
  CloseByDateRangeRequest,
} from "../../domain/types";

// Query keys
export const sprintKeys = {
  all: ["sprints"] as const,
  byBoard: (boardId: string) => [...sprintKeys.all, "board", boardId] as const,
  active: (boardId: string) => [...sprintKeys.all, "active", boardId] as const,
  nextNumber: (boardId: string) =>
    [...sprintKeys.all, "nextNumber", boardId] as const,
  donePreview: (boardId: string) =>
    [...sprintKeys.all, "donePreview", boardId] as const,
  donePreviewByDateRange: (boardId: string, from: string, to: string) =>
    [...sprintKeys.all, "donePreviewByDateRange", boardId, from, to] as const,
  workItems: (boardId: string, sprintId: string) =>
    [...sprintKeys.all, "workItems", boardId, sprintId] as const,
};

// List sprints by board
export const useSprintsByBoard = (boardId: string) => {
  const scopedKey = useOrgScopedKey(sprintKeys.byBoard(boardId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => sprintsApi.listByBoard(boardId) as Promise<SprintWithCount[]>,
    enabled: !!boardId,
  });
};

// Get active sprint
export const useActiveSprint = (boardId: string) => {
  const scopedKey = useOrgScopedKey(sprintKeys.active(boardId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      sprintsApi.getActive(boardId) as Promise<SprintWithCount | null>,
    enabled: !!boardId,
  });
};

// Get next sprint number for auto-naming
export const useNextSprintNumber = (boardId: string, enabled = true) => {
  const scopedKey = useOrgScopedKey(sprintKeys.nextNumber(boardId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      sprintsApi.getNextNumber(boardId) as Promise<{ nextNumber: number }>,
    enabled: !!boardId && enabled,
  });
};

// Get done items preview for close dialog
export const useDonePreview = (boardId: string, enabled = true) => {
  const scopedKey = useOrgScopedKey(sprintKeys.donePreview(boardId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      sprintsApi.getDonePreview(boardId) as Promise<DoneItemPreview[]>,
    enabled: !!boardId && enabled,
  });
};

// Get work items for a specific sprint
export const useSprintWorkItems = (
  boardId: string,
  sprintId: string | null
) => {
  const scopedKey = useOrgScopedKey(sprintKeys.workItems(boardId, sprintId ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      sprintsApi.getWorkItems(
        boardId,
        sprintId!
      ) as Promise<SprintWorkItemDetail[]>,
    enabled: !!boardId && !!sprintId,
  });
};

// Create sprint mutation
export const useCreateSprint = (boardId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      startDate?: string;
      endDate?: string;
    }) => sprintsApi.create(boardId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.byBoard(boardId) });
      queryClient.invalidateQueries({ queryKey: sprintKeys.active(boardId) });
      queryClient.invalidateQueries({
        queryKey: sprintKeys.nextNumber(boardId),
      });
    },
  });
};

// Close sprint mutation
export const useCloseSprint = (boardId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sprintId: string) =>
      sprintsApi.close(boardId, sprintId) as Promise<SprintWithCount>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.byBoard(boardId) });
      queryClient.invalidateQueries({ queryKey: sprintKeys.active(boardId) });
      queryClient.invalidateQueries({
        queryKey: sprintKeys.nextNumber(boardId),
      });
      queryClient.invalidateQueries({
        queryKey: sprintKeys.donePreview(boardId),
      });
      // Also invalidate work items for the board (they get archived)
      queryClient.invalidateQueries({
        queryKey: ["workItems", "board", boardId],
      });
    },
  });
};

// Close sprint ad-hoc mutation (create + close in one step)
export const useCloseSprintAdHoc = (boardId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      sprintsApi.closeAdHoc(boardId, name) as Promise<SprintWithCount>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.byBoard(boardId) });
      queryClient.invalidateQueries({ queryKey: sprintKeys.active(boardId) });
      queryClient.invalidateQueries({
        queryKey: sprintKeys.nextNumber(boardId),
      });
      queryClient.invalidateQueries({
        queryKey: sprintKeys.donePreview(boardId),
      });
      queryClient.invalidateQueries({
        queryKey: ["workItems", "board", boardId],
      });
    },
  });
};

// Get done items preview filtered by date range
export const useDonePreviewByDateRange = (
  boardId: string,
  from: string | undefined,
  to: string | undefined,
  enabled = true
) => {
  const scopedKey = useOrgScopedKey(sprintKeys.donePreviewByDateRange(boardId, from ?? "", to ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      sprintsApi.getDonePreview(boardId, {
        from: from!,
        to: to!,
      }) as Promise<DoneItemPreview[]>,
    enabled: !!boardId && !!from && !!to && enabled,
  });
};

// Close sprint by date range mutation
export const useCloseSprintByDateRange = (boardId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CloseByDateRangeRequest) =>
      sprintsApi.closeByDateRange(boardId, {
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
      }) as Promise<SprintWithCount>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.byBoard(boardId) });
      queryClient.invalidateQueries({ queryKey: sprintKeys.active(boardId) });
      queryClient.invalidateQueries({
        queryKey: sprintKeys.nextNumber(boardId),
      });
      queryClient.invalidateQueries({
        queryKey: sprintKeys.donePreview(boardId),
      });
      queryClient.invalidateQueries({
        queryKey: ["workItems", "board", boardId],
      });
    },
  });
};
