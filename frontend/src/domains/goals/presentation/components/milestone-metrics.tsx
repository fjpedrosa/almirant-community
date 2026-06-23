"use client";

import type { ComponentType } from "react";
import { CalendarDays, CheckCircle2, Circle, Clock3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GoalMetricsProps } from "../../domain/types";

interface MetricItem {
  labelKey: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  accentClass: string;
}

export const MilestoneMetrics: React.FC<GoalMetricsProps> = ({
  total,
  completed,
  inProgress,
  pending,
  daysRemaining,
}) => {
  const t = useTranslations("goals");

  const deadlineTone =
    daysRemaining !== null && daysRemaining <= 7
      ? "text-red-600"
      : "text-muted-foreground";

  const getDeadlineValue = (): string => {
    if (daysRemaining === null) return t("metrics.noDate");
    if (daysRemaining < 0) return t("metrics.daysLate", { count: Math.abs(daysRemaining) });
    if (daysRemaining === 0) return t("metrics.today");
    return t("metrics.days", { count: daysRemaining });
  };

  const metrics: MetricItem[] = [
    {
      labelKey: "metrics.completed",
      value: `${completed}/${total}`,
      icon: CheckCircle2,
      accentClass: "text-green-600",
    },
    {
      labelKey: "metrics.inProgress",
      value: String(inProgress),
      icon: Clock3,
      accentClass: "text-amber-600",
    },
    {
      labelKey: "metrics.pending",
      value: String(pending),
      icon: Circle,
      accentClass: "text-slate-500",
    },
    {
      labelKey: "metrics.deadline",
      value: getDeadlineValue(),
      icon: CalendarDays,
      accentClass: daysRemaining !== null && daysRemaining <= 7 ? "text-red-600" : "text-sky-600",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.labelKey}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t(metric.labelKey)}
                  </p>
                  <p className={cn("text-2xl font-semibold", metric.labelKey === "metrics.deadline" && deadlineTone)}>
                    {metric.value}
                  </p>
                </div>
                <Icon className={cn("h-5 w-5", metric.accentClass)} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
