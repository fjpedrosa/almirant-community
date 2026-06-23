"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type HumanActionRequiredBadgeRequirement = {
  itemId?: string | null;
  taskId?: string | null;
  message: string;
};

export const HUMAN_ACTION_TOOLTIP_CONTENT_CLASS =
  "max-h-[min(28rem,calc(100vh-4rem))] max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl";

export const HumanActionRequiredTooltipBody = ({
  label,
  actionLabel,
  message,
  requirements,
}: {
  label: string;
  actionLabel: string;
  message: string;
  requirements?: HumanActionRequiredBadgeRequirement[];
}) => {
  const hasRequirements = !!requirements && requirements.length > 0;

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className="text-sm font-semibold leading-none">{label}</p>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {actionLabel}
        </p>
      </div>
      {hasRequirements ? (
        <ul className="space-y-2">
          {requirements.map((requirement, index) => (
            <li
              key={`${requirement.itemId ?? requirement.taskId ?? "requirement"}-${index}`}
              className="rounded-lg border bg-muted/30 p-2"
            >
              {(requirement.taskId || requirement.itemId) && (
                <p className="mb-1 font-mono text-[11px] font-semibold text-foreground">
                  {requirement.taskId ?? requirement.itemId}
                </p>
              )}
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {requirement.message}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {message}
        </p>
      )}
    </div>
  );
};

export const HumanActionRequiredBadge = ({
  label,
  actionLabel,
  message,
  requirements,
  compact = false,
}: {
  label: string;
  actionLabel: string;
  message: string;
  requirements?: HumanActionRequiredBadgeRequirement[];
  compact?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm ring-1 ring-orange-400/50",
          compact ? "h-3.5 w-3.5" : "h-4 w-4",
        )}
        aria-label={label}
      >
        <Check className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3")} strokeWidth={3} />
      </span>
    </TooltipTrigger>
    <TooltipContent
      align="start"
      className={HUMAN_ACTION_TOOLTIP_CONTENT_CLASS}
    >
      <HumanActionRequiredTooltipBody
        label={label}
        actionLabel={actionLabel}
        message={message}
        requirements={requirements}
      />
    </TooltipContent>
  </Tooltip>
);
