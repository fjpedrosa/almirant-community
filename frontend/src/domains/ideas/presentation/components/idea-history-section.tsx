"use client";

import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { ChevronDown, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { IdeaHistorySectionProps, IdeaItemEvent } from "../../domain/types";

const normalizeValue = (t: ReturnType<typeof useTranslations<"ideas">>, value: string | null): string => {
  if (value === null || value === "") return t("history.emptyValue");
  if (value.length <= 100) return value;
  return `${value.slice(0, 100)}...`;
};

export const IdeaHistorySection: React.FC<IdeaHistorySectionProps> = ({
  events,
  isLoading,
  members,
  projects,
}) => {
  const t = useTranslations("ideas");
  const { formatDateTime } = useFormattedDate();

  const prettyFieldName = (fieldName: string | null): string => {
    if (!fieldName) return "item";
    const map: Record<string, string> = {
      projectId: t("fields.projectId"),
      type: t("fields.type"),
      status: t("fields.status"),
      title: t("fields.title"),
      description: t("fields.description"),
      ownerUserId: t("fields.ownerUserId"),
      dueDate: t("fields.dueDate"),
      metadata: t("fields.metadata"),
    };
    return map[fieldName] ?? fieldName;
  };

  const resolveFieldValue = (
    fieldName: string | null,
    value: string | null,
    membersList: IdeaHistorySectionProps["members"],
    projectsList: IdeaHistorySectionProps["projects"]
  ): string => {
    const normalized = normalizeValue(t, value);
    if (!fieldName || normalized === t("history.emptyValue")) return normalized;

    if (fieldName === "ownerUserId") {
      return membersList?.find((member) => member.id === value)?.name ?? normalized;
    }

    if (fieldName === "projectId") {
      return projectsList?.find((project) => project.id === value)?.name ?? normalized;
    }

    return normalized;
  };

  const renderEventMessage = (
    event: IdeaItemEvent,
    membersList: IdeaHistorySectionProps["members"],
    projectsList: IdeaHistorySectionProps["projects"]
  ): string => {
    if (event.eventType === "created") return t("history.itemCreated");
    if (event.eventType === "feedback_linked") return t("history.feedbackLinked");
    if (event.eventType === "feedback_unlinked") return t("history.feedbackUnlinked");
    if (event.eventType === "work_item_linked") return t("history.workItemLinked");
    if (event.eventType === "updated") {
      const field = prettyFieldName(event.fieldName);
      const oldValue = resolveFieldValue(event.fieldName, event.oldValue, membersList, projectsList);
      const newValue = resolveFieldValue(event.fieldName, event.newValue, membersList, projectsList);
      return `${field}: ${oldValue} → ${newValue}`;
    }
    return event.eventType;
  };

  const count = events.length;

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 [&[data-state=open]>svg:last-child]:rotate-180">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {t("detail.history")} {count > 0 && `(${count})`}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-2 pt-1">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : count === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              {t("detail.noChanges")}
            </p>
          ) : (
            <div className="relative ml-2 border-l-2 border-muted pl-4">
              {events.map((event) => (
                <div key={event.id} className="relative pb-4 last:pb-0">
                  <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground/40" />
                  <p className="text-sm">{renderEventMessage(event, members, projects)}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {event.triggeredByUserName ??
                        event.triggeredByUserEmail ??
                        event.triggeredBy}
                    </span>
                    <span>·</span>
                    <span>{formatDateTime(event.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
