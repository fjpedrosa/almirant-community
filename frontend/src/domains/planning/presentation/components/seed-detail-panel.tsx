"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronsUp,
  Clock,
  Loader2,
  MessageCircle,
  Send,
  Sprout,
  User,
  Calendar,
  Tag,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SeedStatus } from "../../domain/types";
import type { SeedDetailPanelProps } from "../../domain/types";
import type { Priority } from "@/domains/work-items/domain/types";

// --- Priority config ---
const PRIORITY_ICON: Record<Priority, React.ElementType> = {
  low: ArrowDown,
  medium: ArrowRight,
  high: ArrowUp,
  urgent: ChevronsUp,
};

const PRIORITY_COLOR: Record<Priority, string> = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-orange-500",
  urgent: "text-red-500",
};

const STATUS_BG: Record<
  SeedStatus,
  { bgClass: string; borderClass: string }
> = {
  draft: {
    bgClass: "bg-slate-50 dark:bg-slate-950/30",
    borderClass: "border-slate-300 dark:border-slate-700",
  },
  active: {
    bgClass: "bg-emerald-50 dark:bg-emerald-950/30",
    borderClass: "border-emerald-300 dark:border-emerald-700",
  },
  to_review: {
    bgClass: "bg-amber-50 dark:bg-amber-950/30",
    borderClass: "border-amber-300 dark:border-amber-700",
  },
  approved: {
    bgClass: "bg-blue-50 dark:bg-blue-950/30",
    borderClass: "border-blue-300 dark:border-blue-700",
  },
  archived: {
    bgClass: "bg-gray-50 dark:bg-gray-950/30",
    borderClass: "border-gray-300 dark:border-gray-700",
  },
  rejected: {
    bgClass: "bg-rose-50 dark:bg-rose-950/30",
    borderClass: "border-rose-300 dark:border-rose-700",
  },
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const resolveDateLocale = (locale: string) => (locale.startsWith("es") ? es : enUS);

const formatDate = (dateStr: string, locale: string): string => {
  const date = new Date(dateStr);
  return format(date, "d MMM yyyy, HH:mm", { locale: resolveDateLocale(locale) });
};

// --- Loading skeleton ---
const LoadingSkeleton = () => (
  <div className="space-y-4 p-4">
    <div className="flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="space-y-1.5 flex-1">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
    <Skeleton className="h-20 w-full" />
    <div className="flex gap-2">
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-8 w-20" />
    </div>
  </div>
);

// --- Info Tab ---
const InfoTab: React.FC<{
  seed: NonNullable<SeedDetailPanelProps["seed"]>;
  members: SeedDetailPanelProps["members"];
  isUpdatingStatus: boolean;
  isUpdatingOwner: boolean;
  onStatusChange: (status: SeedStatus) => void;
  onOwnerChange: (ownerUserId: string | null) => void;
  statusLabels: Record<SeedStatus, string>;
  priorityLabels: Record<Priority, string>;
  formatDateValue: (dateStr: string) => string;
  t: ReturnType<typeof useTranslations<"planning.seedDetail">>;
}> = ({
  seed,
  members,
  isUpdatingStatus,
  isUpdatingOwner,
  onStatusChange,
  onOwnerChange,
  statusLabels,
  priorityLabels,
  formatDateValue,
  t,
}) => {
  const PriorityIcon = seed.priority ? PRIORITY_ICON[seed.priority] : null;
  const priorityColor = seed.priority ? PRIORITY_COLOR[seed.priority] : "";

  const statusOptions: { value: SeedStatus; label: string }[] = [
    { value: "draft", label: statusLabels.draft },
    { value: "active", label: statusLabels.active },
    { value: "to_review", label: statusLabels.to_review },
    { value: "approved", label: statusLabels.approved },
    { value: "archived", label: statusLabels.archived },
    { value: "rejected", label: statusLabels.rejected },
  ];

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-4 p-4">
        {/* Description */}
        {seed.description && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{t("description")}</h4>
            <p className="text-sm">{seed.description}</p>
          </div>
        )}

        {/* Status */}
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{t("statusLabel")}</h4>
          <Select
            value={seed.status}
            onValueChange={(v) => onStatusChange(v as SeedStatus)}
            disabled={isUpdatingStatus}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Owner */}
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{t("owner")}</h4>
          <Select
            value={seed.ownerUserId ?? "none"}
            onValueChange={(v) => onOwnerChange(v === "none" ? null : v)}
            disabled={isUpdatingOwner}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={t("unassigned")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="text-muted-foreground">{t("unassigned")}</span>
              </SelectItem>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  <span className="flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={member.image ?? undefined} />
                      <AvatarFallback className="text-[10px]">
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    {member.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Priority */}
        {seed.priority && PriorityIcon && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{t("priorityLabel")}</h4>
            <div className="flex items-center gap-2">
              <PriorityIcon className={cn("h-4 w-4", priorityColor)} />
              <span className="text-sm">{priorityLabels[seed.priority]}</span>
            </div>
          </div>
        )}

        {/* Tags */}
        {(seed.tags?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {t("tags")}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {seed.tags!.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="text-xs"
                  style={
                    tag.color
                      ? { borderColor: tag.color, color: tag.color }
                      : undefined
                  }
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Project */}
        {seed.projectName && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{t("project")}</h4>
            <p className="text-sm">{seed.projectName}</p>
          </div>
        )}

        {/* Dates */}
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {t("dates")}
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">{t("created")}</span>
              <p className="font-medium">{formatDateValue(seed.createdAt)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("updated")}</span>
              <p className="font-medium">{formatDateValue(seed.updatedAt)}</p>
            </div>
          </div>
        </div>

        {/* Created by */}
        {seed.createdBy && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{t("createdBy")}</h4>
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={seed.createdBy.image ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(seed.createdBy.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm">{seed.createdBy.name}</span>
            </div>
          </div>
        )}

        {/* Feedback links */}
        {seed.feedbackLinks.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{t("feedbackLinks")}</h4>
            <div className="space-y-1">
              {seed.feedbackLinks.map((link) => (
                <div key={link.id} className="text-xs text-muted-foreground">
                  {link.title}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Work item links */}
        {(seed.workItemLinks?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{t("workItemLinks")}</h4>
            <div className="space-y-1">
              {seed.workItemLinks!.map((link) => (
                <div key={link.id} className="text-xs text-muted-foreground">
                  [{link.type}] {link.title}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

// --- Comments Tab ---
const CommentsTab: React.FC<{
  comments: SeedDetailPanelProps["comments"];
  isLoading: boolean;
  isAdding: boolean;
  currentUserId: string | null;
  onAddComment: (content: string) => void;
  noCommentsText: string;
  placeholderText: string;
  hintText: string;
}> = ({ comments, isLoading, isAdding, currentUserId, onAddComment, noCommentsText, placeholderText, hintText }) => {
  const [newComment, setNewComment] = React.useState("");

  const handleSubmit = () => {
    if (!newComment.trim() || isAdding) return;
    onAddComment(newComment.trim());
    setNewComment("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sortedComments = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 p-4">
          {sortedComments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MessageCircle className="mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm">{noCommentsText}</p>
            </div>
          ) : (
            sortedComments.map((comment) => (
              <div
                key={comment.id}
                className={cn(
                  "flex items-start gap-2.5",
                  comment.userId === currentUserId && "flex-row-reverse"
                )}
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarImage src={comment.author.image ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(comment.author.name)}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    "max-w-[80%] rounded-xl px-3 py-2",
                    comment.userId === currentUserId
                      ? "rounded-tr-sm bg-primary/10"
                      : "rounded-tl-sm bg-muted"
                  )}
                >
                  <p className="text-sm">{comment.content}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add comment form */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={placeholderText}
            className="min-h-[60px] text-sm resize-none"
            disabled={isAdding}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button
            size="icon"
            className="shrink-0 h-[60px] w-10"
            disabled={!newComment.trim() || isAdding}
            onClick={handleSubmit}
          >
            {isAdding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {hintText}
        </p>
      </div>
    </div>
  );
};

// --- History Tab ---
const HistoryTab: React.FC<{
  history: SeedDetailPanelProps["history"];
  isLoading: boolean;
  noActivityText: string;
  historyLabels: {
    system: string;
    createdSeed: string;
    changedStatus: string;
    changedOwner: string;
    changedPriority: string;
    editedTitle: string;
    editedDescription: string;
    updated: string;
  };
  formatRelativeTime: (dateStr: string) => string;
}> = ({ history, isLoading, noActivityText, historyLabels, formatRelativeTime }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <div className="text-center">
          <Clock className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">{noActivityText}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-1 p-4">
        {history.map((event) => {
          const actorName = event.triggeredByUserName ?? historyLabels.system;

          return (
            <div key={event.id} className="flex gap-2.5 py-2">
              <Avatar className="h-6 w-6 shrink-0">
                {event.triggeredByUserImage && (
                  <AvatarImage src={event.triggeredByUserImage} />
                )}
                <AvatarFallback className="text-[10px]">
                  {getInitials(actorName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-xs">
                <div className="flex items-start gap-1 flex-wrap">
                  <span className="font-medium text-foreground">{actorName}</span>
                  <span className="text-muted-foreground">
                    {event.eventType === "created" && historyLabels.createdSeed}
                    {event.eventType === "updated" && (
                      <>
                        {event.fieldName === "status" && historyLabels.changedStatus}
                        {event.fieldName === "ownerUserId" && historyLabels.changedOwner}
                        {event.fieldName === "priority" && historyLabels.changedPriority}
                        {event.fieldName === "title" && historyLabels.editedTitle}
                        {event.fieldName === "description" && historyLabels.editedDescription}
                        {!event.fieldName && historyLabels.updated}
                      </>
                    )}
                  </span>
                  {event.eventType === "updated" && event.oldValue && event.newValue && (
                    <span className="text-muted-foreground">
                      <span className="line-through">{event.oldValue}</span>
                      {" → "}
                      <span className="text-foreground">{event.newValue}</span>
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/60">
                  {formatRelativeTime(event.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};

// --- Main component ---
export const SeedDetailPanel: React.FC<SeedDetailPanelProps> = ({
  seed,
  isLoading,
  members,
  currentUserId,
  onStatusChange,
  onOwnerChange,
  onAddComment,
  isUpdatingStatus,
  isUpdatingOwner,
  isAddingComment,
  comments,
  isLoadingComments,
  history,
  isLoadingHistory,
}) => {
  const t = useTranslations("planning.seedDetail");
  const locale = useLocale();
  const formatDateValue = (dateStr: string) => formatDate(dateStr, locale);

  const statusLabels: Record<SeedStatus, string> = {
    draft: t("status.draft"),
    active: t("status.active"),
    to_review: t("status.to_review"),
    approved: t("status.approved"),
    archived: t("status.archived"),
    rejected: t("status.rejected"),
  };

  const priorityLabels: Record<Priority, string> = {
    low: t("priority.low"),
    medium: t("priority.medium"),
    high: t("priority.high"),
    urgent: t("priority.urgent"),
  };

  const historyLabels = {
    system: t("history.system"),
    createdSeed: t("history.createdSeed"),
    changedStatus: t("history.changedStatus"),
    changedOwner: t("history.changedOwner"),
    changedPriority: t("history.changedPriority"),
    editedTitle: t("history.editedTitle"),
    editedDescription: t("history.editedDescription"),
    updated: t("history.updated"),
  };

  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t("relativeTime.now");
    if (diffMins < 60) return t("relativeTime.minutes", { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("relativeTime.hours", { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t("relativeTime.days", { count: diffDays });
    return formatDateValue(dateStr);
  };

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!seed) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Sprout className="mx-auto mb-2 h-10 w-10 opacity-40" />
          <p className="text-sm">{t("emptyState")}</p>
        </div>
      </div>
    );
  }

  const statusBg = STATUS_BG[seed.status];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 p-4 border-b">
        <div className="flex items-start gap-3">
          {seed.owner ? (
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={seed.owner.image ?? undefined} />
              <AvatarFallback>{getInitials(seed.owner.name)}</AvatarFallback>
            </Avatar>
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40">
              <User className="h-4 w-4 text-muted-foreground/60" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{seed.title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0", statusBg.borderClass)}
              >
                {statusLabels[seed.status]}
              </Badge>
              {seed.priority && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  {(() => {
                    const Icon = PRIORITY_ICON[seed.priority];
                    return Icon ? (
                      <Icon className={cn("h-3 w-3", PRIORITY_COLOR[seed.priority])} />
                    ) : null;
                  })()}
                  {priorityLabels[seed.priority]}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info" className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0 mx-4 mt-2">
          <TabsTrigger value="info" className="text-xs cursor-pointer">
            {t("tabs.info")}
          </TabsTrigger>
          <TabsTrigger value="comments" className="text-xs cursor-pointer">
            {t("tabs.comments")}
            {comments.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({comments.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs cursor-pointer">
            {t("tabs.history")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="flex-1 min-h-0 mt-0">
          <InfoTab
            seed={seed}
            members={members}
            isUpdatingStatus={isUpdatingStatus}
            isUpdatingOwner={isUpdatingOwner}
            onStatusChange={onStatusChange}
            onOwnerChange={onOwnerChange}
            statusLabels={statusLabels}
            priorityLabels={priorityLabels}
            formatDateValue={formatDateValue}
            t={t}
          />
        </TabsContent>

        <TabsContent value="comments" className="flex-1 min-h-0 mt-0">
          <CommentsTab
            comments={comments}
            isLoading={isLoadingComments}
            isAdding={isAddingComment}
            currentUserId={currentUserId}
            onAddComment={onAddComment}
            noCommentsText={t("noComments")}
            placeholderText={t("commentPlaceholder")}
            hintText={t("commentHint")}
          />
        </TabsContent>

        <TabsContent value="history" className="flex-1 min-h-0 mt-0">
          <HistoryTab
            history={history}
            isLoading={isLoadingHistory}
            noActivityText={t("noActivity")}
            historyLabels={historyLabels}
            formatRelativeTime={formatRelativeTime}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};
