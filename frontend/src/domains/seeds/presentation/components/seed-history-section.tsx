"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, Clock } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import type { SeedHistorySectionProps } from "../../domain/types";
import type { SeedEvent } from "@/domains/planning/domain/types";

type FieldNameKey =
  | "projectId"
  | "status"
  | "title"
  | "description"
  | "ownerUserId"
  | "priority"
  | "source"
  | "selectedForIdeation";

const isKnownField = (fieldName: string): fieldName is FieldNameKey => {
  return [
    "projectId",
    "status",
    "title",
    "description",
    "ownerUserId",
    "priority",
    "source",
    "selectedForIdeation",
  ].includes(fieldName);
};

const normalizeValue = (value: string | null, emptyLabel: string): string => {
  if (value === null || value === "") return emptyLabel;
  if (value.length <= 100) return value;
  return `${value.slice(0, 100)}...`;
};

const prettyFieldName = (
  fieldName: string | null,
  t: (key: string) => string,
): string => {
  if (!fieldName) return "item";
  if (isKnownField(fieldName)) {
    return t(fieldName);
  }
  return fieldName;
};

const resolveFieldValue = (
  fieldName: string | null,
  value: string | null,
  emptyLabel: string,
  members?: SeedHistorySectionProps["members"],
  projects?: SeedHistorySectionProps["projects"],
): string => {
  const normalized = normalizeValue(value, emptyLabel);
  if (!fieldName || normalized === emptyLabel) return normalized;

  if (fieldName === "ownerUserId") {
    return members?.find((member) => member.id === value)?.name ?? normalized;
  }

  if (fieldName === "projectId") {
    return projects?.find((project) => project.id === value)?.name ?? normalized;
  }

  return normalized;
};

const renderEventMessage = (
  event: SeedEvent,
  tFields: (key: string) => string,
  tEvents: (key: string) => string,
  emptyLabel: string,
  members?: SeedHistorySectionProps["members"],
  projects?: SeedHistorySectionProps["projects"],
): string => {
  if (event.eventType === "created") return tEvents("created");
  if (event.eventType === "feedback_linked") return tEvents("feedbackLinked");
  if (event.eventType === "feedback_unlinked") return tEvents("feedbackUnlinked");
  if (event.eventType === "work_item_linked") return tEvents("workItemLinked");
  if (event.eventType === "updated") {
    const field = prettyFieldName(event.fieldName, tFields);
    const oldValue = resolveFieldValue(event.fieldName, event.oldValue, emptyLabel, members, projects);
    const newValue = resolveFieldValue(event.fieldName, event.newValue, emptyLabel, members, projects);
    return `${field}: ${oldValue} \u2192 ${newValue}`;
  }
  return event.eventType;
};

export const SeedHistorySection: React.FC<SeedHistorySectionProps> = ({
  events,
  isLoading,
  members,
  projects,
}) => {
  const t = useTranslations("seeds.history");
  const tFields = useTranslations("seeds.history.fields");
  const tEvents = useTranslations("seeds.history.events");
  const { formatDateTime } = useFormattedDate();
  const count = events.length;
  const emptyLabel = t("emptyValue");

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 [&[data-state=open]>svg:last-child]:rotate-180">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {t("title")} {count > 0 && `(${count})`}
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
              {t("empty")}
            </p>
          ) : (
            <div className="relative ml-2 border-l-2 border-muted pl-4">
              {events.map((event) => (
                <div key={event.id} className="relative pb-4 last:pb-0">
                  <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground/40" />
                  <p className="text-sm">
                    {renderEventMessage(event, tFields, tEvents, emptyLabel, members, projects)}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {event.triggeredByUserName ??
                        event.triggeredByUserEmail ??
                        event.triggeredBy}
                    </span>
                    <span>&middot;</span>
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
