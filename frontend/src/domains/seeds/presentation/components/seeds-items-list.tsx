"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronsUp,
  MessageSquare,
  Sprout,
} from "lucide-react";
import {
  Archive,
  BadgeCheck,
  Eye,
  FileEdit,
  XCircle,
  Zap,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import type { SeedStatus } from "@/domains/planning/domain/types";
import type { SeedsItemsListProps } from "../../domain/types";
import { getSeedStatusLabel } from "./seed-inline-status";

/** Status-based left border colors */
const STATUS_BORDER_COLOR: Record<SeedStatus, string> = {
  draft: "border-l-slate-400",
  active: "border-l-emerald-500",
  to_review: "border-l-amber-500",
  approved: "border-l-violet-500",
  archived: "border-l-gray-400",
  rejected: "border-l-rose-500",
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

const ListSkeleton = () => (
  <div className="space-y-2">
    {Array.from({ length: 8 }).map((_, index) => (
      <div
        key={index}
        className="flex items-center gap-3 rounded-md border px-3 py-2"
      >
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    ))}
  </div>
);

export const SeedsItemsList: React.FC<SeedsItemsListProps> = ({
  items,
  isLoading,
  members,
  onOpenItem,
  onDelete,
  onStatusChange,
  onOwnerChange,
}) => {
  const t = useTranslations("seeds.list");
  const tp = useTranslations("seeds.priority");
  const ts = useTranslations("seeds");
  const seedStatusOptions: StatusOption[] = [
    {
      value: "draft",
      label: getSeedStatusLabel("draft", ts),
      icon: FileEdit,
      color: "text-slate-700",
      bgColor: "bg-slate-100",
      borderColor: "border-slate-200",
    },
    {
      value: "active",
      label: getSeedStatusLabel("active", ts),
      icon: Zap,
      color: "text-emerald-700",
      bgColor: "bg-emerald-100",
      borderColor: "border-emerald-200",
    },
    {
      value: "to_review",
      label: getSeedStatusLabel("to_review", ts),
      icon: Eye,
      color: "text-blue-700",
      bgColor: "bg-blue-100",
      borderColor: "border-blue-200",
    },
    {
      value: "approved",
      label: getSeedStatusLabel("approved", ts),
      icon: BadgeCheck,
      color: "text-violet-700",
      bgColor: "bg-violet-100",
      borderColor: "border-violet-200",
    },
    {
      value: "archived",
      label: getSeedStatusLabel("archived", ts),
      icon: Archive,
      color: "text-gray-500",
      bgColor: "bg-gray-100",
      borderColor: "border-gray-200",
    },
    {
      value: "rejected",
      label: getSeedStatusLabel("rejected", ts),
      icon: XCircle,
      color: "text-rose-700",
      bgColor: "bg-rose-100",
      borderColor: "border-rose-200",
    },
  ];

  if (isLoading) {
    return <ListSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const priority = item.priority;
        const PriorityIcon = priority
          ? PRIORITY_ICON_BY_VALUE[priority]
          : null;

        return (
          <div
            key={item.id}
            className={cn(
              "group relative flex items-start gap-3 rounded-md border border-border/60 border-l-4 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors",
              STATUS_BORDER_COLOR[item.status],
            )}
            onClick={() => onOpenItem(item)}
          >
            {/* Owner avatar picker */}
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

            {/* Content area — full width */}
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
                      {tp(priority)}
                    </TooltipContent>
                  </Tooltip>
                )}
                <p className="truncate text-sm font-medium leading-tight">
                  {item.title}
                </p>
                {item.selectedForIdeation && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Sprout className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {t("selectedForIdeation")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              {/* Project name — right below title */}
              {item.projectName && (
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                  <span className="truncate">{item.projectName}</span>
                </div>
              )}

              {/* Description — full width */}
              {item.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {item.description}
                </p>
              )}

              {/* Comment count */}
              {item.commentCount > 0 && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
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
                            {item.lastComment.userName
                              .slice(0, 1)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {t("lastComment", {
                          name: item.lastComment.userName,
                        })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            {/* Quick actions — absolute, appears on hover */}
            <div
              className="absolute right-2 top-2 flex items-center touch-visible"
              onClick={(e) => e.stopPropagation()}
            >
              <QuickStatusActions
                statuses={seedStatusOptions}
                currentStatus={item.status}
                onStatusChange={(status) =>
                  onStatusChange(item, status as SeedStatus)
                }
                onDelete={() => onDelete(item)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
