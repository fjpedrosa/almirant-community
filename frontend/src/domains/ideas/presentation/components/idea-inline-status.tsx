"use client";

import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { IdeaInlineStatusProps, IdeaItemStatus } from "../../domain/types";

const IDEA_STATUSES: IdeaItemStatus[] = ["draft", "active", "to_review", "approved", "archived", "rejected"];

export const STATUS_COLORS: Record<IdeaItemStatus, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  to_review: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-violet-100 text-violet-700 border-violet-200",
  archived: "bg-gray-100 text-gray-600 border-gray-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
};

export const IdeaInlineStatus: React.FC<IdeaInlineStatusProps> = ({
  value,
  type: _type, // eslint-disable-line @typescript-eslint/no-unused-vars -- kept for interface compat; statuses are identical across types
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("ideas");

  const STATUS_LABELS: Record<IdeaItemStatus, string> = {
    draft: t("statuses.draft"),
    active: t("statuses.active"),
    to_review: t("statuses.to_review"),
    approved: t("statuses.approved"),
    archived: t("statuses.archived"),
    rejected: t("statuses.rejected"),
  };

  const options = IDEA_STATUSES;

  if (isLoading) {
    return (
      <Badge variant="outline" className="cursor-default">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        {STATUS_LABELS[value]}
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
            className={cn("cursor-pointer", STATUS_COLORS[value])}
          >
            {STATUS_LABELS[value]}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {options.map((status) => (
          <PopoverClose key={status} asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                status === value && "bg-accent/50",
              )}
              onClick={() => onChange(status)}
            >
              <span
                className={cn(
                  "inline-flex h-2 w-2 rounded-full",
                  STATUS_COLORS[status].split(" ")[0],
                )}
              />
              {STATUS_LABELS[status]}
              {status === value && (
                <Check className="ml-auto h-3.5 w-3.5 text-primary" />
              )}
            </button>
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
  );
};

// Helper function to get status labels for external use (e.g., in filter components)
export const getStatusLabels = (t: ReturnType<typeof useTranslations<"ideas">>): Record<IdeaItemStatus, string> => ({
  draft: t("statuses.draft"),
  active: t("statuses.active"),
  to_review: t("statuses.to_review"),
  approved: t("statuses.approved"),
  archived: t("statuses.archived"),
  rejected: t("statuses.rejected"),
});
