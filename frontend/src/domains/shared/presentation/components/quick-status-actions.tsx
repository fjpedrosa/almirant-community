"use client";

import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { StatusOption } from "./status-expanding-pill";

export interface QuickActionItem {
  key: string;
  icon: StatusOption["icon"];
  label: string;
  onClick: () => void;
  className?: string;
  iconClassName?: string;
}

export interface QuickStatusActionsProps {
  statuses: StatusOption[];
  currentStatus: string;
  onStatusChange: (status: string) => void;
  onDelete?: () => void;
  isLoading?: boolean;
  actions?: QuickActionItem[];
}

export const QuickStatusActions: React.FC<QuickStatusActionsProps> = ({
  statuses,
  currentStatus,
  onStatusChange,
  onDelete,
  isLoading = false,
  actions = [],
}) => {
  const t = useTranslations("shared.quickActions");

  const availableStatuses = statuses.filter((status) => status.value !== currentStatus);
  const actionButtonClassName =
    "group/quick-action h-7 w-7 shrink-0 hover:bg-transparent focus-visible:bg-transparent active:bg-transparent dark:hover:bg-transparent dark:focus-visible:bg-transparent dark:active:bg-transparent";
  const iconBaseClassName =
    "h-4 w-4 transform-gpu transition-transform duration-150 ease-out group-hover/quick-action:scale-125 group-focus-visible/quick-action:scale-125";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center px-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-0.5 touch-visible"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      {availableStatuses.map((status) => {
        const Icon = status.icon;

        return (
          <Tooltip key={status.value}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  actionButtonClassName,
                  status.color,
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(status.value);
                }}
                aria-label={t("changeStatusTo", { label: status.label })}
              >
                <Icon className={cn(iconBaseClassName, status.color)} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {status.label}
            </TooltipContent>
          </Tooltip>
        );
      })}

      {actions.map((action) => {
        const Icon = action.icon;

        return (
          <Tooltip key={action.key}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(actionButtonClassName, action.className)}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                }}
                aria-label={action.label}
              >
                <Icon className={cn(iconBaseClassName, action.iconClassName)} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {action.label}
            </TooltipContent>
          </Tooltip>
        );
      })}

      {onDelete && (
        <>
          <span className="mx-0.5 h-3 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={actionButtonClassName}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                aria-label={t("delete")}
              >
                <Trash2
                  className={cn(
                    iconBaseClassName,
                    "text-muted-foreground group-hover/quick-action:text-destructive",
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {t("delete")}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
};
