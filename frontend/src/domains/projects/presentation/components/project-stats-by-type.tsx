"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  typeIcons,
  typeColors,
} from "@/domains/work-items/presentation/components/work-item-style";
import type { WorkItemType } from "@/domains/work-items/domain/types";
import type { ProjectStatsByTypeProps } from "../../domain/types";

const typeBgColors: Record<string, string> = {
  epic: "bg-purple-50 dark:bg-purple-950/20",
  feature: "bg-blue-50 dark:bg-blue-950/20",
  story: "bg-green-50 dark:bg-green-950/20",
  task: "bg-slate-50 dark:bg-slate-950/20",
};

const typeProgressColors: Record<string, string> = {
  epic: "[&_[data-slot=progress-indicator]]:bg-purple-500",
  feature: "[&_[data-slot=progress-indicator]]:bg-blue-500",
  story: "[&_[data-slot=progress-indicator]]:bg-green-500",
  task: "[&_[data-slot=progress-indicator]]:bg-slate-500",
};

const DISPLAY_ORDER: WorkItemType[] = ["epic", "feature", "story", "task"];

export const ProjectStatsByType: React.FC<ProjectStatsByTypeProps> = ({
  stats,
  isLoading,
}) => {
  const t = useTranslations("projects.stats");

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (stats.length === 0) {
    return null;
  }

  // Sort stats to match display order
  const orderedStats = DISPLAY_ORDER.map((type) =>
    stats.find((s) => s.type === type)
  ).filter(Boolean);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">
        {t("byTypeTitle")}
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {orderedStats.map((stat) => {
          if (!stat) return null;
          const Icon = typeIcons[stat.type as WorkItemType];
          const colorClass = typeColors[stat.type as WorkItemType];
          const bgClass = typeBgColors[stat.type] ?? "";
          const progressColorClass = typeProgressColors[stat.type] ?? "";
          const progress =
            stat.totalCount > 0
              ? Math.round((stat.completedCount / stat.totalCount) * 100)
              : 0;

          return (
            <Card key={stat.type} className={`${bgClass} border-0 shadow-sm`}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-2">
                  {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
                  <span className="text-xs font-medium text-muted-foreground">
                    {t(stat.type as "epic" | "feature" | "story" | "task")}
                  </span>
                </div>
                <div className="text-lg font-bold leading-none mb-2">
                  {stat.completedCount}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / {stat.totalCount}
                  </span>
                </div>
                <Progress
                  value={progress}
                  className={`h-1.5 ${progressColorClass}`}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
