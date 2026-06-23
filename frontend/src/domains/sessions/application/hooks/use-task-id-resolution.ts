"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { extractTaskIds } from "../../domain/task-id-linker";

export interface ResolvedTaskId {
  workItemId: string;
  boardArea: string;
}

export const useTaskIdResolution = (transcript: string | undefined) => {
  const taskIds = useMemo(
    () => (transcript ? extractTaskIds(transcript) : []),
    [transcript],
  );

  const { data } = useQuery({
    queryKey: ["task-id-resolution", taskIds],
    queryFn: () => workItemsApi.resolveTaskIds(taskIds),
    enabled: taskIds.length > 0,
    staleTime: Infinity,
  });

  const taskIdMap = useMemo(() => {
    const map = new Map<string, ResolvedTaskId>();
    if (!data) return map;
    for (const item of data) {
      map.set(item.taskId, {
        workItemId: item.workItemId,
        boardArea: item.boardArea,
      });
    }
    return map;
  }, [data]);

  return taskIdMap;
};
