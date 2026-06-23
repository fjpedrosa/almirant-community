"use client";

/**
 * A-772: Redesigned Todos card layout to match the unified pattern
 * (seeds-items-list / ideas-items-list).
 *
 * Changes from the previous version:
 * - Removed TodoStatusExpandingPill inline with title
 * - Added status badge BELOW the title as a static colored Badge
 * - Removed Eye button (clicking card opens details)
 * - Replaced hover actions (Eye+Trash) with QuickStatusActions (pending, in_progress, done)
 * - Integrated Lock/Unlock inside the QuickStatusActions group
 * - Moved OwnerAvatarPicker from right to LEFT side (consistency with Seeds/Ideas)
 * - Added project name in metadata row
 * - Kept checkbox, priority icon, description, due date, comment count
 */

import React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Circle, Lock, MessageCircle, Play, Unlock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { OwnerAvatarPicker } from "@/domains/shared/presentation/components/owner-avatar-picker";
import { QuickStatusActions } from "@/domains/shared/presentation/components/quick-status-actions";
import type { StatusOption } from "@/domains/shared/presentation/components/status-expanding-pill";
import { cn } from "@/lib/utils";
import type { TodoItemStatus, TodosListProps } from "../../domain/types";
import { PriorityIcon } from "./todo-priority-badge";

/** A-393: Status-based row background colors for todos */
const TODO_STATUS_ROW_BG: Record<TodoItemStatus, string> = {
  pending: "bg-gray-50 dark:bg-gray-950/30",
  in_progress: "bg-amber-50 dark:bg-amber-950/30",
  done: "bg-emerald-50 dark:bg-emerald-950/30",
  blocked: "bg-red-50 dark:bg-red-950/30",
};

/** A-772: Status-based left border colors */
const TODO_STATUS_BORDER_COLOR: Record<TodoItemStatus, string> = {
  pending: "border-l-amber-400",
  in_progress: "border-l-blue-500",
  done: "border-l-emerald-500",
  blocked: "border-l-red-500",
};

/** A-772: Status badge colors */
const TODO_STATUS_BADGE: Record<TodoItemStatus, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  done: "bg-green-100 text-green-700 border-green-200",
  blocked: "bg-red-100 text-red-700 border-red-200",
};

/** A-772: Status options for QuickStatusActions */
const TODO_STATUS_OPTIONS: StatusOption[] = [
  {
    value: "pending",
    label: "Pendiente",
    icon: Circle,
    color: "text-amber-700",
    bgColor: "bg-amber-100",
    borderColor: "border-amber-200",
  },
  {
    value: "in_progress",
    label: "En progreso",
    icon: Play,
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    borderColor: "border-blue-200",
  },
  {
    value: "done",
    label: "Completado",
    icon: CheckCircle2,
    color: "text-green-700",
    bgColor: "bg-green-100",
    borderColor: "border-green-200",
  },
];

/** A-772: Status labels for badge display */
const TODO_STATUS_LABELS: Record<TodoItemStatus, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  done: "Completado",
  blocked: "Bloqueado",
};

const TodosListSkeleton = () => {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-md border px-3 py-2"
        >
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      ))}
    </div>
  );
};

export const TodosList: React.FC<TodosListProps> = ({
  items,
  isLoading,
  hasActiveFilters,
  members,
  onToggleDone,
  onToggleBlocked,
  onOpenItem,
  onDelete,
  onOwnerChange,
  onStatusChange,
}) => {
  const t = useTranslations("todos");
  const { formatShort } = useFormattedDate();

  const formatDate = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatShort(date);
  };

  if (isLoading) {
    return <TodosListSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-muted-foreground">
        {hasActiveFilters
          ? t("list.emptyWithFilters")
          : t("list.emptyNoFilters")}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const formattedDueDate = formatDate(item.dueDate);

        return (
          <div
            key={item.id}
            className={cn(
              "group relative flex items-start gap-3 rounded-md border border-border/60 border-l-4 px-3 py-2 cursor-pointer hover:bg-muted/50",
              TODO_STATUS_BORDER_COLOR[item.status],
              TODO_STATUS_ROW_BG[item.status],
            )}
            onClick={() => onOpenItem(item)}
          >
            {/* Owner avatar picker — LEFT side (A-772) */}
            <div
              className="shrink-0 pt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <OwnerAvatarPicker
                currentOwnerId={item.ownerUserId}
                members={members}
                onOwnerChange={(userId) => onOwnerChange(item.id, userId)}
                size="sm"
              />
            </div>

            {/* Checkbox */}
            <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={item.status === "done"}
                disabled={item.status === "blocked"}
                onCheckedChange={() => onToggleDone(item)}
                aria-label={
                  item.status === "done"
                    ? t("list.markAsPending")
                    : t("list.markAsCompleted")
                }
              />
            </div>

            {/* Center content */}
            <div className="min-w-0 flex-1">
              {/* Title row */}
              <div className="flex items-center gap-2">
                {item.priority && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <PriorityIcon priority={item.priority} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {t(`priority.${item.priority}`)}
                    </TooltipContent>
                  </Tooltip>
                )}
                <p
                  className={cn(
                    "truncate text-sm font-medium leading-tight",
                    item.status === "done" && "line-through opacity-50",
                  )}
                >
                  {item.title}
                </p>
              </div>

              {/* Status badge below title (A-772) */}
              <div className="mt-1 flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={cn(
                    "h-5 px-1.5 text-[10px] font-medium border",
                    TODO_STATUS_BADGE[item.status],
                  )}
                >
                  {TODO_STATUS_LABELS[item.status]}
                </Badge>
              </div>

              {/* Description */}
              {item.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {item.description}
                </p>
              )}

              {/* Metadata row: project, due date, comments */}
              <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                {item.projectName && (
                  <span className="truncate">{item.projectName}</span>
                )}
                {formattedDueDate && (
                  <span className="shrink-0">{t("list.dueOn")} {formattedDueDate}</span>
                )}
                {/* Comment count */}
                {item.commentCount > 0 && (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenItem(item);
                    }}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>{item.commentCount}</span>
                    {item.lastComment?.userName && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Avatar className="h-4 w-4">
                            {item.lastComment.userImage && (
                              <AvatarImage src={item.lastComment.userImage} alt={item.lastComment.userName} />
                            )}
                            <AvatarFallback className="text-[8px]">
                              {item.lastComment.userName.slice(0, 1).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {t("list.lastComment")} {item.lastComment.userName}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Right side — quick actions (A-772) */}
            <div
              className="flex shrink-0 items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {/* QuickStatusActions — visible on hover (A-772) */}
              <QuickStatusActions
                statuses={TODO_STATUS_OPTIONS}
                currentStatus={item.status}
                onStatusChange={(status) =>
                  onStatusChange(item, status as TodoItemStatus)
                }
                actions={[
                  {
                    key: "toggle-blocked",
                    icon: item.status === "blocked" ? Lock : Unlock,
                    label: item.status === "blocked" ? t("list.unblock") : t("list.block"),
                    onClick: () => onToggleBlocked(item),
                    className: item.status === "blocked" ? "text-destructive" : undefined,
                  },
                ]}
                onDelete={() => onDelete(item)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
