"use client";

import { useProjectRoadmap } from "../../application/hooks/use-project-roadmap";
import { GanttChart } from "../components/gantt-chart";

interface GanttContainerProps {
  projectId: string;
}

export const GanttContainer: React.FC<GanttContainerProps> = ({
  projectId,
}) => {
  const {
    tasks,
    links,
    scales,
    columns,
    zoomLevel,
    setZoomLevel,
    colorMode,
    setColorMode,
    isLoading,
    onTaskClick,
  } = useProjectRoadmap(projectId);

  return (
    <GanttChart
      tasks={tasks}
      links={links}
      scales={scales}
      columns={columns}
      zoomLevel={zoomLevel}
      onZoomChange={setZoomLevel}
      colorMode={colorMode}
      onColorModeChange={setColorMode}
      onTaskClick={onTaskClick}
      isLoading={isLoading}
      readonly
    />
  );
};
