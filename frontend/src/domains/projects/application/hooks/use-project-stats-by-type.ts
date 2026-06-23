"use client";

import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api/client";
import { projectKeys } from "./use-projects";
import type { WorkItemTypeStat } from "../../domain/types";

const VISIBLE_TYPES = ["epic", "feature", "story", "task"];

export const useProjectStatsByType = (projectId: string) => {
  const { data, isLoading } = useQuery({
    queryKey: projectKeys.statsByType(projectId),
    queryFn: () => projectsApi.getStatsByType(projectId),
    enabled: !!projectId,
  });

  const stats: WorkItemTypeStat[] = data
    ? data.byType.filter((s) => VISIBLE_TYPES.includes(s.type))
    : [];

  return { stats, isLoading };
};
