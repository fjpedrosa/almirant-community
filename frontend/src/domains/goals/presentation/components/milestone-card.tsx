"use client";

import { CalendarDays, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { cn } from "@/lib/utils";
import type { MilestoneCardProps } from "../../domain/types";

const statusClass: Record<string, string> = {
  planned: "text-slate-600",
  in_progress: "text-amber-600",
  completed: "text-green-600",
  on_hold: "text-purple-600",
  cancelled: "text-red-600",
};

export const MilestoneCard: React.FC<MilestoneCardProps> = ({
  milestone,
  isSelected,
  onSelect,
  onEdit,
}) => {
  const t = useTranslations("goals");
  const { formatShort } = useFormattedDate();

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case "planned":
        return t("status.planned");
      case "in_progress":
        return t("status.in_progress");
      case "completed":
        return t("status.completed");
      case "on_hold":
        return t("status.on_hold");
      case "cancelled":
        return t("status.cancelled");
      default:
        return status.replace("_", " ");
    }
  };

  const formatTargetDate = (value: string | null): string => {
    if (!value) return t("card.noDate");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("card.noDate");
    return formatShort(date);
  };

  return (
    <button
      type="button"
      onClick={() => onSelect(milestone.id)}
      className={cn(
        "w-full rounded-xl border bg-card p-4 text-left transition-colors",
        "hover:border-primary/50 hover:bg-muted/20",
        isSelected && "border-primary ring-2 ring-primary/25"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-semibold">{milestone.title}</p>
          <p className={cn("text-xs uppercase tracking-wide", statusClass[milestone.status] ?? "text-slate-600")}>
            {getStatusLabel(milestone.status)}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(milestone);
          }}
          aria-label="Edit milestone"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        <div className="h-2 rounded-full bg-muted/80 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${Math.max(0, Math.min(100, milestone.progress))}%`,
              background:
                "linear-gradient(90deg, #f97316 0%, #facc15 45%, #22c55e 100%)",
            }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{milestone.completedItems}/{milestone.totalItems} {t("card.items")}</span>
          <span className="font-semibold text-foreground">{milestone.progress}%</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {formatTargetDate(milestone.targetDate)}
        </div>
      </div>
    </button>
  );
};
