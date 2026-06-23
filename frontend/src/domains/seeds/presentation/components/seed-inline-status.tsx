"use client";

import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SeedInlineStatusProps } from "../../domain/types";
import type { SeedStatus, SeedSource } from "@/domains/planning/domain/types";

const SEED_STATUSES: SeedStatus[] = [
  "draft",
  "active",
  "to_review",
  "approved",
  "archived",
  "rejected",
];

const SEED_STATUS_TRANSLATION_KEYS: Record<
  SeedStatus,
  "statuses.draft" | "statuses.active" | "statuses.to_review" | "statuses.approved" | "statuses.archived" | "statuses.rejected"
> = {
  draft: "statuses.draft",
  active: "statuses.active",
  to_review: "statuses.to_review",
  approved: "statuses.approved",
  archived: "statuses.archived",
  rejected: "statuses.rejected",
};

const SEED_SOURCE_TRANSLATION_KEYS: Record<
  SeedSource,
  "sources.manual" | "sources.feedback" | "sources.ai_generated" | "sources.import"
> = {
  manual: "sources.manual",
  feedback: "sources.feedback",
  ai_generated: "sources.ai_generated",
  import: "sources.import",
};

type SeedsTranslator = ReturnType<typeof useTranslations<"seeds">>;

export const getSeedStatusLabel = (status: SeedStatus, t: SeedsTranslator): string =>
  t(SEED_STATUS_TRANSLATION_KEYS[status]);

export const getSeedSourceLabel = (source: SeedSource, t: SeedsTranslator): string =>
  t(SEED_SOURCE_TRANSLATION_KEYS[source]);

export const SEED_STATUS_COLORS: Record<SeedStatus, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  to_review: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-violet-100 text-violet-700 border-violet-200",
  archived: "bg-gray-100 text-gray-600 border-gray-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
};

export const SeedInlineStatus: React.FC<SeedInlineStatusProps> = ({
  value,
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("seeds");

  if (isLoading) {
    return (
      <Badge variant="outline" className="cursor-default">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        {getSeedStatusLabel(value, t)}
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
            className={cn("cursor-pointer", SEED_STATUS_COLORS[value])}
          >
            {getSeedStatusLabel(value, t)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {SEED_STATUSES.map((status) => (
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
                  SEED_STATUS_COLORS[status].split(" ")[0],
                )}
              />
              {getSeedStatusLabel(status, t)}
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
