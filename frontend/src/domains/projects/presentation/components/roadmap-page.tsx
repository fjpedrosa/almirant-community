"use client";

import { useTranslations } from "next-intl";
import { GanttChart as GanttChartIcon, FolderKanban } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GanttChart } from "./gantt-chart";
import { RoadmapFilters } from "./roadmap-filters";
import type {
  GanttTask,
  GanttLink,
  GanttColumnConfig,
  GanttZoomLevel,
  GanttColorMode,
  RoadmapStatusFilter,
  SelectOption,
} from "../../domain/types";
import type { IScaleConfig } from "@svar-ui/react-gantt";

interface RoadmapPageProps {
  // Project selection
  projects: Array<{ id: string; name: string; color: string }>;
  selectedProjectId: string | null;
  isLoadingProjects: boolean;
  onProjectChange: (projectId: string) => void;
  // Gantt data
  tasks: GanttTask[];
  links: GanttLink[];
  scales: IScaleConfig[];
  columns: GanttColumnConfig[];
  zoomLevel: GanttZoomLevel;
  onZoomChange: (level: GanttZoomLevel) => void;
  colorMode: GanttColorMode;
  onColorModeChange: (mode: GanttColorMode) => void;
  allExpanded: boolean;
  onToggleExpand: () => void;
  onTaskClick?: (taskId: number) => void;
  onTaskDateChange?: (data: { taskId: number; start: Date; end: Date }) => void;
  isLoading: boolean;
  // Filters
  filterProjectId: string | undefined;
  filterEpicId: string | undefined;
  filterDateFrom: Date | null;
  filterDateTo: Date | null;
  filterStatus: RoadmapStatusFilter;
  projectOptions: SelectOption[];
  epicOptions: SelectOption[];
  hasActiveFilters: boolean;
  onFilterProjectChange: (value: string | undefined) => void;
  onFilterEpicChange: (value: string | undefined) => void;
  onFilterDateFromChange: (date: Date | null) => void;
  onFilterDateToChange: (date: Date | null) => void;
  onFilterStatusChange: (value: RoadmapStatusFilter) => void;
  onClearFilters: () => void;
}

const ProjectSelector: React.FC<{
  projects: Array<{ id: string; name: string; color: string }>;
  selectedProjectId: string | null;
  onProjectChange: (projectId: string) => void;
  isLoading: boolean;
}> = ({ projects, selectedProjectId, onProjectChange, isLoading }) => {
  if (isLoading) {
    return <Skeleton className="h-9 w-[220px]" />;
  }

  return (
    <Select
      value={selectedProjectId ?? undefined}
      onValueChange={onProjectChange}
    >
      <SelectTrigger className="w-[220px]">
        <FolderKanban className="h-4 w-4 mr-2 shrink-0" />
        <SelectValue placeholder="Select project" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <div className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              {project.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const EmptyProjectState: React.FC = () => {
  const t = useTranslations("roadmap");

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <GanttChartIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-medium text-muted-foreground mb-1">
        {t("selectProject")}
      </h3>
    </div>
  );
};

export const RoadmapPage: React.FC<RoadmapPageProps> = ({
  projects,
  selectedProjectId,
  isLoadingProjects,
  onProjectChange,
  tasks,
  links,
  scales,
  columns,
  zoomLevel,
  onZoomChange,
  colorMode,
  onColorModeChange,
  allExpanded,
  onToggleExpand,
  onTaskClick,
  onTaskDateChange,
  isLoading,
  filterProjectId,
  filterEpicId,
  filterDateFrom,
  filterDateTo,
  filterStatus,
  projectOptions,
  epicOptions,
  hasActiveFilters,
  onFilterProjectChange,
  onFilterEpicChange,
  onFilterDateFromChange,
  onFilterDateToChange,
  onFilterStatusChange,
  onClearFilters,
}) => {
  const t = useTranslations("roadmap");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t("title")}</h1>
            <p className="text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <ProjectSelector
              projects={projects}
              selectedProjectId={selectedProjectId}
              onProjectChange={onProjectChange}
              isLoading={isLoadingProjects}
            />
          </div>
        </div>

        {/* Filters - only show when a project is selected */}
        {selectedProjectId && (
          <RoadmapFilters
            projectId={filterProjectId}
            epicId={filterEpicId}
            dateFrom={filterDateFrom}
            dateTo={filterDateTo}
            status={filterStatus}
            projectOptions={projectOptions}
            epicOptions={epicOptions}
            onProjectChange={onFilterProjectChange}
            onEpicChange={onFilterEpicChange}
            onDateFromChange={onFilterDateFromChange}
            onDateToChange={onFilterDateToChange}
            onStatusChange={onFilterStatusChange}
            onClearFilters={onClearFilters}
            hasActiveFilters={hasActiveFilters}
          />
        )}
      </div>

      {/* Gantt chart area */}
      <div className="flex-1 overflow-auto p-6">
        {!selectedProjectId && !isLoadingProjects ? (
          <EmptyProjectState />
        ) : (
          <GanttChart
            tasks={tasks}
            links={links}
            scales={scales}
            columns={columns}
            zoomLevel={zoomLevel}
            onZoomChange={onZoomChange}
            colorMode={colorMode}
            onColorModeChange={onColorModeChange}
            allExpanded={allExpanded}
            onToggleExpand={onToggleExpand}
            onTaskClick={onTaskClick}
            onTaskDateChange={onTaskDateChange}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  );
};
