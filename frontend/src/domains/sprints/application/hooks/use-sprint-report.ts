import { useQuery } from "@tanstack/react-query";
import { sprintsApi } from "@/lib/api/client";
import type { SprintReportData } from "../../domain/types";

export const sprintReportKeys = {
  all: ["sprintReport"] as const,
  byId: (sprintId: string) => [...sprintReportKeys.all, sprintId] as const,
  byIdAndProject: (sprintId: string, projectId: string) =>
    [...sprintReportKeys.all, sprintId, "project", projectId] as const,
};

export const useSprintReport = (
  sprintId: string | null,
  compareCount = 5,
  projectId?: string
) => {
  const queryKey = projectId
    ? sprintReportKeys.byIdAndProject(sprintId ?? "", projectId)
    : sprintReportKeys.byId(sprintId ?? "");

  return useQuery({
    queryKey,
    queryFn: () =>
      sprintsApi.getReport(
        sprintId!,
        compareCount,
        projectId
      ) as Promise<SprintReportData>,
    enabled: !!sprintId,
  });
};
