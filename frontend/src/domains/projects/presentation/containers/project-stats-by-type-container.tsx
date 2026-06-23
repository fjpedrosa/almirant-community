"use client";

import { useProjectStatsByType } from "../../application/hooks/use-project-stats-by-type";
import { ProjectStatsByType } from "../components/project-stats-by-type";

interface ProjectStatsByTypeContainerProps {
  projectId: string;
}

export const ProjectStatsByTypeContainer: React.FC<
  ProjectStatsByTypeContainerProps
> = ({ projectId }) => {
  const { stats, isLoading } = useProjectStatsByType(projectId);

  return <ProjectStatsByType stats={stats} isLoading={isLoading} />;
};
