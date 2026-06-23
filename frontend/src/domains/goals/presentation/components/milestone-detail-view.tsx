"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil } from "lucide-react";
import { MilestoneChecklist } from "./milestone-checklist";
import { MilestoneMetrics } from "./milestone-metrics";
import { MilestoneProgressBar } from "./milestone-progress-bar";
import type { MilestoneDetailViewProps } from "../../domain/types";

const statusClass: Record<string, string> = {
  planned: "bg-slate-100 text-slate-700",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  on_hold: "bg-purple-100 text-purple-800",
  cancelled: "bg-red-100 text-red-800",
};

const getDaysRemaining = (targetDate: string | null): number | null => {
  if (!targetDate) return null;

  const deadline = new Date(targetDate);
  if (Number.isNaN(deadline.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDeadline = new Date(
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate()
  );

  const msDiff = startOfDeadline.getTime() - startOfToday.getTime();
  return Math.ceil(msDiff / (1000 * 60 * 60 * 24));
};

export const MilestoneDetailView: React.FC<MilestoneDetailViewProps> = ({
  milestone,
  isLoading,
  onEditMilestone,
  onOpenWorkItem,
}) => {
  const t = useTranslations("goals");

  const getStatusLabel = (status: string): string => {
    const key = `status.${status}` as const;
    return t(key);
  };

  const metrics = useMemo(() => {
    if (!milestone) {
      return {
        total: 0,
        completed: 0,
        inProgress: 0,
        pending: 0,
        daysRemaining: null,
      };
    }

    const inProgress = (milestone.workItems ?? []).filter(
      (item) => !item.isDone && /progress|review|testing|validating|en progreso/i.test(item.boardColumnName)
    ).length;

    const pending = Math.max(milestone.totalItems - milestone.completedItems - inProgress, 0);

    return {
      total: milestone.totalItems,
      completed: milestone.completedItems,
      inProgress,
      pending,
      daysRemaining: getDaysRemaining(milestone.targetDate),
    };
  }, [milestone]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!milestone) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center">
        <h3 className="text-lg font-semibold">{t("detail.selectMilestone")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("detail.selectMilestoneHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold">{milestone.title}</h2>
              <Badge
                variant="secondary"
                className={statusClass[milestone.status] ?? "bg-slate-100 text-slate-700"}
              >
                {getStatusLabel(milestone.status)}
              </Badge>
            </div>
            {milestone.description && (
              <p className="text-sm text-muted-foreground max-w-3xl">
                {milestone.description}
              </p>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditMilestone(milestone)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            {t("detail.edit")}
          </Button>
        </div>
      </div>

      <MilestoneProgressBar
        percentage={milestone.progress}
        targetDate={milestone.targetDate}
      />

      <MilestoneMetrics
        total={metrics.total}
        completed={metrics.completed}
        inProgress={metrics.inProgress}
        pending={metrics.pending}
        daysRemaining={metrics.daysRemaining}
      />

      <MilestoneChecklist
        items={milestone.workItems ?? []}
        onOpenWorkItem={onOpenWorkItem}
      />
    </div>
  );
};
