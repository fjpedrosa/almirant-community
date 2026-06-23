import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import {
  PenLine,
  Plus,
  ArrowRightLeft,
  Trash2,
  Paperclip,
  PaperclipIcon,
  Bot,
  MessageSquare,
  Monitor,
  Loader2,
  Sparkles,
} from "lucide-react";
import type {
  EventTimelineProps,
  WorkItemEventType,
  WorkItemEvent,
} from "../../domain/types";

const EVENT_ICONS: Record<WorkItemEventType, React.ElementType> = {
  created: Plus,
  updated: PenLine,
  moved: ArrowRightLeft,
  deleted: Trash2,
  attachment_added: Paperclip,
  attachment_removed: PaperclipIcon,
  ai_session: Bot,
  comment: MessageSquare,
};

const EVENT_ICON_COLORS: Record<WorkItemEventType, string> = {
  created: "text-green-500",
  updated: "text-blue-500",
  moved: "text-amber-500",
  deleted: "text-red-500",
  attachment_added: "text-teal-500",
  attachment_removed: "text-orange-500",
  ai_session: "text-purple-500",
  comment: "text-indigo-500",
};

const EVENT_NODE_BG: Record<WorkItemEventType, string> = {
  created: "bg-green-500/15",
  updated: "bg-blue-500/15",
  moved: "bg-amber-500/15",
  deleted: "bg-red-500/15",
  attachment_added: "bg-teal-500/15",
  attachment_removed: "bg-orange-500/15",
  ai_session: "bg-purple-500/15",
  comment: "bg-indigo-500/15",
};

const FIELD_LABEL_KEYS: Record<string, string> = {
  title: "fields.title",
  description: "fields.description",
  type: "fields.type",
  priority: "fields.priority",
  assignee: "fields.assignee",
  dueDate: "fields.dueDate",
  estimatedHours: "fields.estimatedHours",
  parentId: "fields.parentId",
  projectId: "fields.projectId",
  boardColumnId: "fields.boardColumnId",
};

const stripHtml = (html: string): string =>
  html.replace(/<[^>]*>/g, "").trim();

const truncateValue = (value: string | null, maxLength = 60): string => {
  if (!value) return "-";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
};

const resolveValueLabel = (
  fieldName: string | null,
  value: string | null,
  columnNameById?: Record<string, string>,
  projectNameById?: Record<string, string>
): string | null => {
  if (!value) return value;
  if (!fieldName) return value;

  if (fieldName === "boardColumnId") {
    return columnNameById?.[value] ?? value;
  }

  if (fieldName === "projectId") {
    return projectNameById?.[value] ?? value;
  }

  return value;
};

const getInitial = (name: string | null): string => {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
};

const getDateKey = (dateStr: string): string => {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

interface DayGroup {
  dateKey: string;
  date: Date;
  events: WorkItemEvent[];
}

const groupEventsByDay = (events: WorkItemEvent[]): DayGroup[] => {
  const groups: DayGroup[] = [];
  let currentKey = "";
  let currentGroup: DayGroup | null = null;

  for (const event of events) {
    const key = getDateKey(event.createdAt);
    if (key !== currentKey) {
      currentKey = key;
      currentGroup = {
        dateKey: key,
        date: new Date(event.createdAt),
        events: [],
      };
      groups.push(currentGroup);
    }
    currentGroup?.events.push(event);
  }

  return groups;
};

const formatDayLabel = (
  date: Date,
  t: (key: string) => string,
): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffDays = Math.round(
    (today.getTime() - eventDay.getTime()) / 86400000,
  );

  if (diffDays === 0) return t("dayGroup.today");
  if (diffDays === 1) return t("dayGroup.yesterday");

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
};

const getActorName = (
  event: WorkItemEvent,
  t: (key: string) => string,
): string => {
  if (event.triggeredBy === "claude-code") return "Claude Code";
  if (event.triggeredBy === "system") return t("actors.system");
  if (event.triggeredByUserName) return event.triggeredByUserName;
  return t("actors.user");
};

const EventAvatar: React.FC<{ event: WorkItemEvent }> = ({ event }) => {
  if (event.triggeredBy === "claude-code") {
    return (
      <Avatar className="h-7 w-7">
        <AvatarFallback className="bg-purple-500/15 text-purple-500">
          <Sparkles className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
    );
  }

  if (event.triggeredBy === "system") {
    return (
      <Avatar className="h-7 w-7">
        <AvatarFallback className="bg-muted text-muted-foreground">
          <Monitor className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <Avatar className="h-7 w-7">
      {event.triggeredByUserImage && (
        <AvatarImage
          src={event.triggeredByUserImage}
          alt={event.triggeredByUserName ?? ""}
        />
      )}
      <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
        {getInitial(event.triggeredByUserName)}
      </AvatarFallback>
    </Avatar>
  );
};

const EventNode: React.FC<{ eventType: WorkItemEventType }> = ({ eventType }) => {
  const Icon = EVENT_ICONS[eventType] ?? PenLine;
  const iconColor = EVENT_ICON_COLORS[eventType] ?? "text-blue-500";
  const nodeBg = EVENT_NODE_BG[eventType] ?? "bg-blue-500/15";

  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full",
        nodeBg,
        iconColor,
      )}
    >
      <Icon className="h-3 w-3" />
    </div>
  );
};

const EventDescription: React.FC<{
  event: WorkItemEvent;
  t: (key: string) => string;
  columnNameById?: Record<string, string>;
  projectNameById?: Record<string, string>;
}> = ({ event, t, columnNameById, projectNameById }) => {
  if (event.eventType === "created") {
    return (
      <span className="text-foreground">{t("actions.createdItem")}</span>
    );
  }

  if (event.eventType === "moved") {
    const fromLabel = resolveValueLabel("boardColumnId", event.oldValue, columnNameById, projectNameById);
    const toLabel = resolveValueLabel("boardColumnId", event.newValue, columnNameById, projectNameById);

    return (
      <span className="flex items-center gap-1.5 flex-wrap">
        <span>{t("actions.movedFrom")}</span>
        {fromLabel && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {truncateValue(fromLabel, 30)}
          </Badge>
        )}
        <span>{t("actions.movedTo")}</span>
        {toLabel && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {truncateValue(toLabel, 30)}
          </Badge>
        )}
      </span>
    );
  }

  if (event.eventType === "deleted") {
    return (
      <span className="text-foreground">{t("actions.deletedItem")}</span>
    );
  }

  if (event.eventType === "attachment_added") {
    return (
      <span className="flex items-center gap-1.5 flex-wrap">
        <span>{t("actions.attachmentAdded")}</span>
        {event.newValue && (
          <span className="text-foreground font-medium">
            {truncateValue(event.newValue, 40)}
          </span>
        )}
      </span>
    );
  }

  if (event.eventType === "attachment_removed") {
    return (
      <span className="flex items-center gap-1.5 flex-wrap">
        <span>{t("actions.attachmentRemoved")}</span>
        {event.oldValue && (
          <span className="text-foreground line-through">
            {truncateValue(event.oldValue, 40)}
          </span>
        )}
      </span>
    );
  }

  if (event.eventType === "ai_session") {
    return (
      <span className="text-foreground">{t("actions.aiSession")}</span>
    );
  }

  if (event.eventType === "comment") {
    const snippet = event.newValue
      ? truncateValue(stripHtml(event.newValue), 100)
      : null;

    return (
      <span className="flex flex-col gap-1">
        <span className="text-foreground">{t("actions.commented")}</span>
        {snippet && snippet !== "-" && (
          <span className="rounded-md bg-muted/60 px-2.5 py-1.5 text-muted-foreground text-xs leading-relaxed border-l-2 border-indigo-500/40">
            &ldquo;{snippet}&rdquo;
          </span>
        )}
      </span>
    );
  }

  if (event.eventType === "updated") {
    const oldValueLabel = resolveValueLabel(event.fieldName, event.oldValue, columnNameById, projectNameById);
    const newValueLabel = resolveValueLabel(event.fieldName, event.newValue, columnNameById, projectNameById);

    if (event.fieldName === "assignee") {
      return (
        <span className="flex items-center gap-1.5 flex-wrap">
          {newValueLabel ? (
            <>
              <span>{t("actions.assignedTo")}</span>
              <span className="text-foreground font-medium">
                {truncateValue(newValueLabel, 40)}
              </span>
            </>
          ) : (
            <span>{t("actions.unassigned")}</span>
          )}
        </span>
      );
    }

    if (event.fieldName === "priority") {
      return (
        <span className="flex items-center gap-1.5 flex-wrap">
          <span>{t("actions.changedPriority")}</span>
          {event.newValue && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {event.newValue}
            </Badge>
          )}
        </span>
      );
    }

    const fieldLabel = event.fieldName
      ? FIELD_LABEL_KEYS[event.fieldName]
        ? t(FIELD_LABEL_KEYS[event.fieldName])
        : event.fieldName
      : "";

    return (
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span>
            {t("actions.changed")}{" "}
            <span className="text-foreground font-medium">{fieldLabel}</span>
          </span>
        </span>
        {(event.oldValue || event.newValue) && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="line-through truncate max-w-[140px]">
              {truncateValue(oldValueLabel)}
            </span>
            <span className="text-muted-foreground/50">&rarr;</span>
            <span className="truncate max-w-[140px] text-foreground">
              {truncateValue(newValueLabel)}
            </span>
          </span>
        )}
      </span>
    );
  }

  return (
    <span>{event.eventType}</span>
  );
};

const isAiTriggered = (event: WorkItemEvent): boolean =>
  event.triggeredBy === "claude-code" || event.eventType === "ai_session";

export const EventTimeline: React.FC<EventTimelineProps> = ({
  events,
  isLoading,
  columnNameById,
  projectNameById,
}) => {
  const t = useTranslations("workItems.timeline");

  const formatTimestamp = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return t("now");
    if (diffMin < 60) return t("minutesAgo", { count: diffMin });
    if (diffHr < 24) return t("hoursAgo", { count: diffHr });
    if (diffDays < 7) return t("daysAgo", { count: diffDays });

    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        {t("noEvents")}
      </div>
    );
  }

  const dayGroups = groupEventsByDay(events);

  return (
    <div className="space-y-5">
      {dayGroups.map((group) => (
        <div key={group.dateKey}>
          {/* Day separator badge */}
          <div className="flex items-center gap-2.5 mb-3">
            <Badge
              variant="secondary"
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 shrink-0"
              suppressHydrationWarning
            >
              {formatDayLabel(group.date, t)}
            </Badge>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Events with vertical rail */}
          <div className="relative ml-0.5">
            {group.events.map((event, index) => {
              const actorName = getActorName(event, t);
              const meta = event.metadata as { source?: string; processType?: string; skillName?: string } | null;
              const hasProvenance = meta?.source && meta.source !== "web" || meta?.processType && meta.processType !== "manual" || meta?.skillName;
              const isLast = index === group.events.length - 1;
              const isAi = isAiTriggered(event);
              const isComment = event.eventType === "comment";

              return (
                <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Vertical connector line */}
                  {!isLast && (
                    <div
                      className="absolute left-3 top-6 h-[calc(100%-12px)] w-px -translate-x-1/2 bg-border"
                    />
                  )}

                  {/* Event type node on rail */}
                  <div className="relative z-10 shrink-0">
                    <EventNode eventType={event.eventType} />
                  </div>

                  {/* Event content */}
                  <div
                    className={cn(
                      "flex-1 min-w-0 rounded-lg px-2.5 py-1.5 -mt-0.5",
                      isComment && "bg-muted/50 border border-border/50",
                      isAi && !isComment && "bg-purple-500/[0.04] dark:bg-purple-500/[0.06]",
                    )}
                  >
                    {/* Header row: actor + timestamp */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div className="shrink-0">
                        <EventAvatar event={event} />
                      </div>
                      <span className="text-xs font-medium text-foreground shrink-0">
                        {actorName}
                      </span>
                      <span
                        className="text-[10px] text-muted-foreground/60 ml-auto shrink-0"
                        suppressHydrationWarning
                      >
                        {formatTimestamp(event.createdAt)}
                      </span>
                    </div>

                    {/* Event description */}
                    <div className="text-xs text-muted-foreground ml-[calc(1.75rem+0.375rem)]">
                      <EventDescription
                        event={event}
                        t={t}
                        columnNameById={columnNameById}
                        projectNameById={projectNameById}
                      />
                    </div>

                    {/* Provenance badges */}
                    {hasProvenance && (
                      <div className="flex gap-1 mt-1 ml-[calc(1.75rem+0.375rem)] flex-wrap">
                        {meta?.source && meta.source !== "web" && (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground/70">
                            {meta.source}
                          </span>
                        )}
                        {meta?.processType && meta.processType !== "manual" && (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground/70">
                            {meta.processType}
                          </span>
                        )}
                        {meta?.skillName && (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground/70">
                            {meta.skillName}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
