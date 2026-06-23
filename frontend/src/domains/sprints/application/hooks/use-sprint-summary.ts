import { useMemo } from "react";
import { useSprintReport } from "./use-sprint-report";
import type { SprintSummaryData } from "../../domain/types";

export const useSprintSummary = (
  sprintId: string | null
): { summary: SprintSummaryData | null; isLoading: boolean } => {
  const { data: report, isLoading } = useSprintReport(sprintId, 0);

  const summary = useMemo<SprintSummaryData | null>(() => {
    if (!report) return null;
    return {
      completedCount: report.completedTasks.count,
      velocity: report.velocity,
      aiCost: report.aiCost.totalCost,
    };
  }, [report]);

  return { summary, isLoading };
};
