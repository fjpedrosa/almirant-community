"use client";

import { useState, useCallback } from "react";
import { useProjectSprints } from "../../application/hooks/use-project-sprints";
import { ProjectSprintsTab } from "../components/project-sprints-tab";
import { SprintReportContainer } from "@/domains/sprints/presentation/containers/sprint-report-container";
import type { ProjectSprintsContainerProps } from "../../domain/types";

export const ProjectSprintsContainer: React.FC<ProjectSprintsContainerProps> = ({
  projectId,
}) => {
  const { sprints, isLoading } = useProjectSprints(projectId);
  const [reportSprintId, setReportSprintId] = useState<string | null>(null);

  const handleSprintClick = useCallback((sprintId: string) => {
    setReportSprintId(sprintId);
  }, []);

  const handleCloseReport = useCallback((open: boolean) => {
    if (!open) setReportSprintId(null);
  }, []);

  return (
    <>
      <ProjectSprintsTab
        sprints={sprints}
        isLoading={isLoading}
        onSprintClick={handleSprintClick}
      />

      <SprintReportContainer
        sprintId={reportSprintId}
        open={!!reportSprintId}
        onOpenChange={handleCloseReport}
        projectId={projectId}
      />
    </>
  );
};
