"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import {
  typeIcons,
  typeColors,
} from "@/domains/work-items/presentation/components/work-item-style";
import type { WorkItemType } from "@/domains/work-items/domain/types";
import type { ProjectStatsGridProps } from "../../domain/types";

const TYPE_ORDER: WorkItemType[] = ["epic", "feature", "story", "task"];

export const ProjectStatsGrid: React.FC<ProjectStatsGridProps> = ({
  workItemsCount,
  completedItemsCount,
  epicCount = 0,
  featureCount = 0,
  storyCount = 0,
  taskCount = 0,
  completedEpicCount = 0,
  completedFeatureCount = 0,
  completedStoryCount = 0,
  completedTaskCount = 0,
}) => {
  const t = useTranslations("projects.stats");

  const totalByType: Record<WorkItemType, number> = {
    epic: epicCount,
    feature: featureCount,
    story: storyCount,
    task: taskCount,
    idea: 0,
  };

  const completedByType: Record<WorkItemType, number> = {
    epic: completedEpicCount,
    feature: completedFeatureCount,
    story: completedStoryCount,
    task: completedTaskCount,
    idea: 0,
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">{t("totalTasks")}</p>
            <span className="text-2xl font-bold leading-none">{workItemsCount}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {TYPE_ORDER.map((type) => {
              const Icon = typeIcons[type];
              const colorClass = typeColors[type];
              return (
                <div key={type} className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
                  <div className="flex items-center justify-center gap-1">
                    {Icon && <Icon className={`h-3.5 w-3.5 ${colorClass}`} />}
                    <span className="text-sm font-semibold">{totalByType[type]}</span>
                  </div>
                  <p className={`text-[10px] font-medium ${colorClass} mt-0.5`}>
                    {t(type)}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground">{t("completed")}</p>
            <span className="text-2xl font-bold leading-none">{completedItemsCount}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {TYPE_ORDER.map((type) => {
              const Icon = typeIcons[type];
              const colorClass = typeColors[type];
              return (
                <div key={type} className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
                  <div className="flex items-center justify-center gap-1">
                    {Icon && <Icon className={`h-3.5 w-3.5 ${colorClass}`} />}
                    <span className="text-sm font-semibold">{completedByType[type]}</span>
                  </div>
                  <p className={`text-[10px] font-medium ${colorClass} mt-0.5`}>
                    {t(type)}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
