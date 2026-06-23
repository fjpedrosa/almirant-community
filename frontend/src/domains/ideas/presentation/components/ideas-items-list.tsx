"use client";

/**
 * Ideas list view (card/flex layout).
 *
 * A-655: Replaced Table layout with card/flex layout (pattern from todos-list.tsx).
 * A-656: Left border color represents status (STATUS_BORDER_COLOR).
 * A-657: Added quick actions on right side.
 * A-773: Redesigned layout — status badge below title, QuickStatusActions on right,
 *        discussed toggle as separate button, project name in metadata row.
 */

import React, { useMemo } from "react";
import { format } from "date-fns";
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  ChevronsUp,
  Eye,
  FileEdit,
  MessageSquare,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OwnerAvatarPicker } from "@/domains/shared/presentation/components/owner-avatar-picker";
import { QuickStatusActions } from "@/domains/shared/presentation/components/quick-status-actions";
import type { StatusOption } from "@/domains/shared/presentation/components/status-expanding-pill";
import { cn } from "@/lib/utils";
import type { Priority } from "@/domains/work-items/domain/types";
import type {
  IdeaItemStatus,
  IdeasItemsListProps,
} from "../../domain/types";
import { IdeaTagChips } from "./idea-tag-chips";

const formatDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "yyyy-MM-dd");
};

/** A-656: Status-based left border colors */
const STATUS_BORDER_COLOR: Record<IdeaItemStatus, string> = {
  draft: "border-l-slate-400",
  active: "border-l-emerald-500",
  to_review: "border-l-amber-500",
  approved: "border-l-violet-500",
  archived: "border-l-gray-400",
  rejected: "border-l-rose-500",
};

/** A-393: Status-based row background colors for ideas */
const STATUS_ROW_BG: Record<IdeaItemStatus, string> = {
  draft: "bg-gray-50 dark:bg-gray-950/30",
  active: "bg-emerald-50 dark:bg-emerald-950/30",
  to_review: "bg-amber-50 dark:bg-amber-950/30",
  approved: "bg-blue-50 dark:bg-blue-950/30",
  archived: "bg-slate-100 dark:bg-slate-950/30",
  rejected: "bg-red-50 dark:bg-red-950/30",
};

/** A-773: Status badge colors for inline badge below title */
const STATUS_BADGE_COLORS: Record<IdeaItemStatus, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  to_review: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-violet-100 text-violet-700 border-violet-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
};

const PRIORITY_ICON_BY_VALUE: Record<Priority, React.ElementType> = {
  low: ArrowDown,
  medium: ArrowRight,
  high: ArrowUp,
  urgent: ChevronsUp,
};

const PRIORITY_COLOR_BY_VALUE: Record<Priority, string> = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-orange-500",
  urgent: "text-red-500",
};

const parsePriorityFromMetadata = (
  metadata: Record<string, unknown> | null | undefined,
): Priority | undefined => {
  const raw = metadata?.priority;
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "urgent") {
    return raw;
  }
  return undefined;
};

/** A-773: Idea status options builder for QuickStatusActions (requires translation function) */
const buildIdeaStatusOptions = (
  t: (key: string) => string,
): StatusOption[] => [
  {
    value: "draft",
    label: t("statuses.draft"),
    icon: FileEdit,
    color: "text-slate-700",
    bgColor: "bg-slate-100",
    borderColor: "border-slate-200",
  },
  {
    value: "active",
    label: t("statuses.active"),
    icon: Zap,
    color: "text-emerald-700",
    bgColor: "bg-emerald-100",
    borderColor: "border-emerald-200",
  },
  {
    value: "to_review",
    label: t("statuses.to_review"),
    icon: Eye,
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    borderColor: "border-blue-200",
  },
  {
    value: "approved",
    label: t("statuses.approved"),
    icon: BadgeCheck,
    color: "text-violet-700",
    bgColor: "bg-violet-100",
    borderColor: "border-violet-200",
  },
  {
    value: "archived",
    label: t("statuses.archived"),
    icon: Archive,
    color: "text-gray-500",
    bgColor: "bg-gray-100",
    borderColor: "border-gray-200",
  },
  {
    value: "rejected",
    label: t("statuses.rejected"),
    icon: XCircle,
    color: "text-rose-700",
    bgColor: "bg-rose-100",
    borderColor: "border-rose-200",
  },
];

const ListSkeleton = () => (
  <div className="space-y-2">
    {Array.from({ length: 8 }).map((_, index) => (
      <div key={index} className="flex items-center gap-3 rounded-md border px-3 py-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    ))}
  </div>
);

export const IdeasItemsList: React.FC<IdeasItemsListProps> = ({
  items,
  isLoading,
  members,
  onOpenItem,
  onDelete,
  onStatusChange,
  onDiscussedToggle,
  onOwnerChange,
}) => {
  const t = useTranslations("ideas");
  const firstCompletedIndex = items.findIndex((item) => item.completedAt !== null);

  // A-1639: Build status options with translations
  const statusOptions = useMemo(() => buildIdeaStatusOptions(t), [t]);
  const statusLabels = useMemo<Record<IdeaItemStatus, string>>(
    () => ({
      draft: t("statuses.draft"),
      active: t("statuses.active"),
      to_review: t("statuses.to_review"),
      approved: t("statuses.approved"),
      archived: t("statuses.archived"),
      rejected: t("statuses.rejected"),
    }),
    [t],
  );

  if (isLoading) {
    return <ListSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-muted-foreground">
        {t("list.emptyState")}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((item, index) => {
        const priority = parsePriorityFromMetadata(item.metadata);
        const PriorityIcon = priority ? PRIORITY_ICON_BY_VALUE[priority] : null;
        const formattedDueDate = formatDate(item.dueDate);

        return (
          <React.Fragment key={item.id}>
            {/* A-655: Completed section divider */}
            {firstCompletedIndex !== -1 && index === firstCompletedIndex && (
              <div className="flex items-center gap-2 py-2 text-xs font-medium text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>{t("list.completedSection")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            {/* Card row */}
            <div
              className={cn(
                "group relative flex items-start gap-3 rounded-md border border-border/60 border-l-4 px-3 py-2 cursor-pointer hover:bg-muted/50",
                STATUS_BORDER_COLOR[item.status],
                STATUS_ROW_BG[item.status],
              )}
              onClick={() => onOpenItem(item)}
            >
              {/* Owner avatar picker -- stopPropagation so click doesn't open panel */}
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

              {/* Center content -- clickable area */}
              <div className="min-w-0 flex-1">
                {/* Title row */}
                <div className="flex items-center gap-2">
                  {priority && PriorityIcon && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <PriorityIcon
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              PRIORITY_COLOR_BY_VALUE[priority],
                            )}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {t(`priority.${priority}`)}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <p className="truncate text-sm font-medium leading-tight">
                    {item.title}
                  </p>
                </div>

                {/* A-773: Status badge below title */}
                <div className="mt-1">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 px-1.5 text-[10px] font-medium",
                      STATUS_BADGE_COLORS[item.status],
                    )}
                  >
                    {statusLabels[item.status]}
                  </Badge>
                </div>

                {/* Description */}
                {item.description && (
                  <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                )}

                {/* Tags */}
                {item.tags && item.tags.length > 0 && (
                  <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                    <IdeaTagChips
                      tags={item.tags}
                      availableTags={[]}
                      onAddTag={() => {}}
                      onRemoveTag={() => {}}
                      isCompact
                    />
                  </div>
                )}

                {/* Metadata row: project, due date, comments */}
                <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                  {item.projectName && (
                    <span className="truncate">{item.projectName}</span>
                  )}
                  {formattedDueDate && (
                    <span className="shrink-0">{formattedDueDate}</span>
                  )}
                  {/* Comment count */}
                  {item.commentCount > 0 && (
                    <span className="flex shrink-0 items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      <span>{item.commentCount}</span>
                      {item.lastComment?.userName && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Avatar className="h-4 w-4">
                              {item.lastComment.userImage && (
                                <AvatarImage
                                  src={item.lastComment.userImage}
                                  alt={item.lastComment.userName}
                                />
                              )}
                              <AvatarFallback className="text-[8px]">
                                {item.lastComment.userName.slice(0, 1).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {t("list.lastCommentBy", { name: item.lastComment.userName })}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  )}
                </div>
              </div>

              {/* Right side -- quick actions (A-773) */}
              <div
                className="flex shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Discussed toggle -- Ideas-specific, before QuickStatusActions */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7 shrink-0",
                        item.discussed
                          ? "text-emerald-600 hover:text-emerald-700"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDiscussedToggle(item);
                      }}
                      aria-label={t("list.markAsDiscussed", { title: item.title })}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span className="sr-only">
                        {t("list.markAsDiscussed", { title: item.title })}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t("list.markAsDiscussed", { title: item.title })}
                  </TooltipContent>
                </Tooltip>

                {/* A-773: QuickStatusActions with 6 statuses + delete */}
                <QuickStatusActions
                  statuses={statusOptions}
                  currentStatus={item.status}
                  onStatusChange={(status) =>
                    onStatusChange(item, status as IdeaItemStatus)
                  }
                  onDelete={() => onDelete(item)}
                />
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
