"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock3, ExternalLink } from "lucide-react";
import type { MilestoneChecklistProps, MilestoneWorkItem } from "../../domain/types";

const priorityColors: Record<string, string> = {
  low: "bg-slate-400",
  medium: "bg-blue-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

const inProgressPattern = /progress|review|testing|validating|en progreso/i;

const getStatusIcon = (item: MilestoneWorkItem) => {
  if (item.isDone) {
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  }

  if (inProgressPattern.test(item.boardColumnName)) {
    return <Clock3 className="h-4 w-4 text-amber-600" />;
  }

  return <Circle className="h-4 w-4 text-slate-400" />;
};

const buildWorkItemHref = (workItemId: string): string =>
  `/board?workItemId=${workItemId}`;

export const MilestoneChecklist: React.FC<MilestoneChecklistProps> = ({
  items,
  onOpenWorkItem,
}) => {
  const t = useTranslations("goals");

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {t("checklist.noWorkItems")}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{t("checklist.title")}</h3>
      </div>

      <div className="divide-y">
        {items.map((item) => {
          const titleClass = item.isDone ? "line-through text-muted-foreground" : "text-foreground";
          const priorityClass = priorityColors[item.priority] ?? "bg-slate-400";

          return (
            <div key={item.id} className="px-4 py-3 flex items-center gap-3">
              <div className="shrink-0">{getStatusIcon(item)}</div>

              <div className="min-w-0 flex-1 space-y-1">
                {onOpenWorkItem ? (
                  <button
                    type="button"
                    onClick={() => onOpenWorkItem(item.id)}
                    className={cn(
                      "w-full text-left text-sm font-medium hover:underline",
                      titleClass
                    )}
                  >
                    {item.taskId ? `${item.taskId} - ` : ""}
                    {item.title}
                  </button>
                ) : (
                  <Link
                    href={buildWorkItemHref(item.id)}
                    className={cn("inline-flex items-center gap-1 text-sm font-medium hover:underline", titleClass)}
                  >
                    {item.taskId ? `${item.taskId} - ` : ""}
                    {item.title}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}

                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="secondary" className="text-[11px] capitalize">
                    {item.type}
                  </Badge>

                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <span className={cn("h-2 w-2 rounded-full", priorityClass)} />
                    {item.priority}
                  </span>

                  <span className="text-muted-foreground">• {item.boardColumnName}</span>
                </div>
              </div>

              {item.assignee && (
                <Avatar className="h-7 w-7 border">
                  <AvatarFallback className="text-[10px]">
                    {item.assignee.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
