"use client";

import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronsUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TodoInlinePriorityProps, TodoItemPriority } from "../../domain/types";

const TODO_PRIORITIES: TodoItemPriority[] = ["low", "medium", "high", "urgent"];

export const TODO_PRIORITY_ICON_CONFIG: Record<
  TodoItemPriority,
  { icon: React.ElementType; colorClass: string }
> = {
  low: { icon: ArrowDown, colorClass: "text-slate-400" },
  medium: { icon: ArrowRight, colorClass: "text-blue-500" },
  high: { icon: ArrowUp, colorClass: "text-orange-500" },
  urgent: { icon: ChevronsUp, colorClass: "text-red-500" },
};

export const PriorityIcon: React.FC<{ priority: TodoItemPriority; className?: string }> = ({
  priority,
  className,
}) => {
  const config = TODO_PRIORITY_ICON_CONFIG[priority];
  const Icon = config.icon;
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", config.colorClass, className)} />;
};

export const TODO_PRIORITY_COLORS: Record<TodoItemPriority, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  urgent: "bg-red-100 text-red-700 border-red-200",
};

export const TodoPriorityBadge: React.FC<TodoInlinePriorityProps> = ({
  value,
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("todos");

  const getPriorityLabel = (priority: TodoItemPriority) => t(`priority.${priority}`);
  const noPriorityLabel = t("priority.noPriority");

  if (isLoading) {
    return (
      <Badge variant="outline" className="cursor-default">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        {value ? getPriorityLabel(value) : noPriorityLabel}
      </Badge>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge
            variant="outline"
            className={cn(
              "cursor-pointer",
              value ? TODO_PRIORITY_COLORS[value] : "bg-muted text-muted-foreground",
            )}
          >
            {value ? getPriorityLabel(value) : noPriorityLabel}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {TODO_PRIORITIES.map((priority) => (
          <button
            key={priority}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent",
              priority === value && "bg-accent/50",
            )}
            onClick={() => onChange(priority)}
          >
            <span
              className={cn(
                "inline-flex h-2 w-2 rounded-full",
                TODO_PRIORITY_COLORS[priority].split(" ")[0],
              )}
            />
            {getPriorityLabel(priority)}
            {priority === value && (
              <Check className="ml-auto h-3.5 w-3.5 text-primary" />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};
