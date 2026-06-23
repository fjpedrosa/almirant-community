"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, ChevronsDownUp, ChevronsUpDown, Palette, ZoomIn, ZoomOut } from "lucide-react";
import type { GanttChartProps, GanttColorMode, GanttZoomLevel } from "../../domain/types";
import type { ITask } from "@svar-ui/react-gantt";

import { GanttLegend } from "./gantt-legend";
import "./gantt-chart.css";

// @svar-ui/react-gantt touches DOM APIs; keep it client-only to avoid SSR crashes.
const Gantt = dynamic(
  () => import("@svar-ui/react-gantt").then((mod) => mod.Gantt),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  }
);

const TYPE_ICONS: Record<string, string> = {
  epic: "◆",
  feature: "▸",
  story: "○",
  task: "·",
};

const TaskBarTemplate: React.FC<{
  data: ITask;
}> = ({ data }) => {
  const workItemType = (data as Record<string, unknown>).workItemType as
    | "epic"
    | "feature"
    | "story"
    | undefined;
  const progress = (data as Record<string, unknown>).progress as number | undefined;
  const type = workItemType ?? "task";
  const icon = TYPE_ICONS[type];

  return (
    <div
      className="wx-content"
      title={data.text ?? ""}
      data-work-item-type={type}
    >
      <span className="gantt-type-icon">{icon}</span>
      <span className="gantt-bar-text">{data.text ?? ""}</span>
      {progress !== undefined && progress > 0 && (
        <span className="gantt-progress-label">{progress}%</span>
      )}
    </div>
  );
};

const ZOOM_LEVELS: GanttZoomLevel[] = ["week", "month", "quarter"];

const ZOOM_LABEL_KEYS: Record<GanttZoomLevel, string> = {
  week: "zoomWeek",
  month: "zoomMonth",
  quarter: "zoomQuarter",
};

const ZoomControls: React.FC<{
  zoomLevel: GanttZoomLevel;
  onZoomChange: (level: GanttZoomLevel) => void;
}> = ({ zoomLevel, onZoomChange }) => {
  const t = useTranslations("roadmap.gantt");
  const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel);
  const canZoomIn = currentIndex > 0;
  const canZoomOut = currentIndex < ZOOM_LEVELS.length - 1;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={!canZoomIn}
        onClick={() => canZoomIn && onZoomChange(ZOOM_LEVELS[currentIndex - 1])}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-0.5">
        {ZOOM_LEVELS.map((level) => (
          <Button
            key={level}
            variant={zoomLevel === level ? "default" : "ghost"}
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => onZoomChange(level)}
          >
            {t(ZOOM_LABEL_KEYS[level])}
          </Button>
        ))}
      </div>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={!canZoomOut}
        onClick={() =>
          canZoomOut && onZoomChange(ZOOM_LEVELS[currentIndex + 1])
        }
        aria-label="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
    </div>
  );
};

const COLOR_MODES: GanttColorMode[] = ["status", "type"];

const COLOR_MODE_LABEL_KEYS: Record<GanttColorMode, string> = {
  status: "colorStatus",
  type: "colorType",
};

const ColorModeToggle: React.FC<{
  colorMode: GanttColorMode;
  onColorModeChange: (mode: GanttColorMode) => void;
}> = ({ colorMode, onColorModeChange }) => {
  const t = useTranslations("roadmap.gantt");

  return (
    <div className="flex items-center gap-1">
      <Palette className="h-4 w-4 text-muted-foreground" />
      {COLOR_MODES.map((mode) => (
        <Button
          key={mode}
          variant={colorMode === mode ? "default" : "ghost"}
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() => onColorModeChange(mode)}
        >
          {t(COLOR_MODE_LABEL_KEYS[mode])}
        </Button>
      ))}
    </div>
  );
};

const GanttEmptyState: React.FC = () => {
  const t = useTranslations("roadmap.gantt");

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Calendar className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-medium text-muted-foreground mb-1">
        {t("emptyTitle")}
      </h3>
      <p className="text-sm text-muted-foreground/70">
        {t("emptyDescription")}
      </p>
    </div>
  );
};

const GanttLoadingSkeleton: React.FC = () => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-8 w-64" />
    </div>
    <Skeleton className="h-[400px] w-full" />
  </div>
);

export const GanttChart: React.FC<GanttChartProps> = ({
  tasks,
  links,
  scales,
  columns,
  zoomLevel,
  onZoomChange,
  colorMode,
  onColorModeChange,
  onTaskClick,
  onTaskDateChange,
  isLoading = false,
  readonly = false,
  allExpanded,
  onToggleExpand,
}) => {
  const t = useTranslations("roadmap.gantt");

  if (isLoading) {
    return <GanttLoadingSkeleton />;
  }

  if (tasks.length === 0) {
    return <GanttEmptyState />;
  }

  // Map our GanttColumnConfig to the library's expected format
  const ganttColumns =
    columns?.map((col) => ({
      id: col.id,
      header: col.header,
      width: col.width,
      align: col.align,
      flexgrow: col.flexgrow,
    })) ?? [
      { id: "text", header: t("columnTask"), flexgrow: 1 },
      { id: "start", header: t("columnStart"), width: 100, align: "center" as const },
      { id: "end", header: t("columnEnd"), width: 100, align: "center" as const },
    ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("itemCount", { count: tasks.length })}
        </h3>
        <div className="flex items-center gap-2">
          <ColorModeToggle colorMode={colorMode} onColorModeChange={onColorModeChange} />
          <div className="h-5 w-px bg-border" />
          {onToggleExpand && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs gap-1.5"
              onClick={onToggleExpand}
            >
              {allExpanded ? (
                <ChevronsUpDown className="h-4 w-4" />
              ) : (
                <ChevronsDownUp className="h-4 w-4" />
              )}
              {allExpanded ? t("collapseAll") : t("expandAll")}
            </Button>
          )}
          <ZoomControls zoomLevel={zoomLevel} onZoomChange={onZoomChange} />
        </div>
      </div>
      <GanttLegend colorMode={colorMode} />
      <div className="gantt-chart-wrapper rounded-lg border bg-background overflow-hidden">
        <Gantt
          tasks={tasks}
          links={links}
          scales={scales}
          columns={ganttColumns}
          readonly={readonly}
          cellHeight={36}
          cellBorders="full"
          taskTemplate={TaskBarTemplate}
          {...(onTaskDateChange
            ? {
                onupdatetask: (ev: Record<string, unknown>) => {
                  const inProgress = ev.inProgress as boolean | undefined;
                  if (!inProgress) {
                    const task = ev.task as Record<string, unknown> | undefined;
                    const taskId = ev.id as number;
                    if (task?.start && task?.end) {
                      onTaskDateChange({
                        taskId,
                        start: task.start as Date,
                        end: task.end as Date,
                      });
                    }
                  }
                },
              }
            : {})}
          {...(onTaskClick
            ? {
                onselectionchange: (ev: Record<string, unknown>) => {
                  const selected = ev.selected as number[] | undefined;
                  if (selected && selected.length > 0) {
                    onTaskClick(selected[0]);
                  }
                },
              }
            : {})}
        />
      </div>
    </div>
  );
};
