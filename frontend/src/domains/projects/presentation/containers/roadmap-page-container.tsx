"use client";

import { useRoadmapPage } from "../../application/hooks/use-roadmap-page";
import { RoadmapPage } from "../components/roadmap-page";

export const RoadmapPageContainer: React.FC = () => {
  const {
    // Project selection
    projects,
    selectedProjectId,
    isLoadingProjects,
    handleProjectChange,
    // Gantt data
    tasks,
    links,
    scales,
    columns,
    zoomLevel,
    setZoomLevel,
    colorMode,
    setColorMode,
    allExpanded,
    toggleAllExpanded,
    onTaskClick,
    handleTaskDateChange,
    isLoading,
    // Filters
    filters,
    projectOptions,
    epicOptions,
    hasActiveFilters,
    setFilterProjectId,
    setEpicId,
    setDateFrom,
    setDateTo,
    setStatus,
    clearFilters,
  } = useRoadmapPage();

  return (
    <RoadmapPage
      // Project selection
      projects={projects}
      selectedProjectId={selectedProjectId}
      isLoadingProjects={isLoadingProjects}
      onProjectChange={handleProjectChange}
      // Gantt data
      tasks={tasks}
      links={links}
      scales={scales}
      columns={columns}
      zoomLevel={zoomLevel}
      onZoomChange={setZoomLevel}
      colorMode={colorMode}
      onColorModeChange={setColorMode}
      allExpanded={allExpanded}
      onToggleExpand={toggleAllExpanded}
      onTaskClick={onTaskClick}
      onTaskDateChange={handleTaskDateChange}
      isLoading={isLoading}
      // Filters
      filterProjectId={selectedProjectId ?? undefined}
      filterEpicId={filters.epicId}
      filterDateFrom={filters.dateRange.from}
      filterDateTo={filters.dateRange.to}
      filterStatus={filters.status}
      projectOptions={projectOptions}
      epicOptions={epicOptions}
      hasActiveFilters={hasActiveFilters}
      onFilterProjectChange={setFilterProjectId}
      onFilterEpicChange={setEpicId}
      onFilterDateFromChange={setDateFrom}
      onFilterDateToChange={setDateTo}
      onFilterStatusChange={setStatus}
      onClearFilters={clearFilters}
    />
  );
};
