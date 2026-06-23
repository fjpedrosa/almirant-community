"use client";

import { CalendarDays, Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { cn } from "@/lib/utils";
import type { MilestoneProgressProps } from "../../domain/types";

const clampPercentage = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
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

export const MilestoneProgressBar: React.FC<MilestoneProgressProps> = ({
  percentage,
  targetDate,
}) => {
  const t = useTranslations("goals");
  const { formatShort } = useFormattedDate();

  const clampedPercentage = clampPercentage(percentage);
  const daysRemaining = getDaysRemaining(targetDate);

  const getMotivationalMessage = (pct: number): string => {
    if (pct === 0) return t("progressBar.motivationalMessages.ready");
    if (pct <= 25) return t("progressBar.motivationalMessages.goodStart");
    if (pct <= 50) return t("progressBar.motivationalMessages.halfway");
    if (pct <= 75) return t("progressBar.motivationalMessages.almostThere");
    if (pct < 100) return t("progressBar.motivationalMessages.nearlyDone");
    return t("progressBar.motivationalMessages.complete");
  };

  const getDeadlineLabel = (days: number | null): string => {
    if (days === null) return t("progressBar.noTargetDate");
    if (days === 0) return t("progressBar.dueToday");
    if (days < 0) return t("progressBar.daysOverdue", { count: Math.abs(days) });
    return t("progressBar.daysRemaining", { count: days });
  };

  const motivationalMessage = getMotivationalMessage(clampedPercentage);
  const formattedTargetDate =
    targetDate && !Number.isNaN(new Date(targetDate).getTime())
      ? formatShort(targetDate)
      : null;

  const deadlineTone =
    daysRemaining !== null && daysRemaining <= 7
      ? "text-red-600"
      : "text-muted-foreground";

  return (
    <div className="rounded-2xl border bg-card p-5 md:p-6 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Flag className="h-3.5 w-3.5" />
            {t("progressBar.currentProgress")}
          </div>
          <p className="text-5xl font-bold leading-none md:text-6xl">
            {clampedPercentage}%
          </p>
        </div>
        <p className="text-sm font-medium text-foreground/90 md:text-right">
          {motivationalMessage}
        </p>
      </div>

      <div className="space-y-2">
        <div className="h-8 rounded-full bg-muted/60 p-1 shadow-inner">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${clampedPercentage}%`,
              background:
                "linear-gradient(90deg, #f97316 0%, #facc15 45%, #22c55e 100%)",
            }}
          />
        </div>

        <div className={cn("flex items-center gap-2 text-sm", deadlineTone)}>
          <CalendarDays className="h-4 w-4" />
          <span>{getDeadlineLabel(daysRemaining)}</span>
          {formattedTargetDate && (
            <span className="text-muted-foreground">
              ({formattedTargetDate})
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
