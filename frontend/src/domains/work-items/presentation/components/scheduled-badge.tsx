import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { isFutureDate } from "../../domain/utils";

interface ScheduledBadgeProps {
  /** The work item's `startDate` (backend gate #47 field). */
  startDate: Date | string | null | undefined;
  /** Pre-formatted, already-localized label, e.g. "Scheduled · in 3 days". */
  label: string;
  /** Reference time for the future check. Defaults to `new Date()`. */
  now?: Date;
  compact?: boolean;
}

/**
 * "Scheduled" pill shown on the board card and detail panel while a work
 * item's start date is still in the future — i.e. while the backlog drain
 * gate (issue #47, `isScheduledForLater` in backlog-drain-selection.ts) is
 * still skipping it. Once the date passes, the item behaves like any other
 * ready item and this badge renders nothing.
 */
export const ScheduledBadge: React.FC<ScheduledBadgeProps> = ({
  startDate,
  label,
  now,
  compact = false,
}) => {
  if (!isFutureDate(startDate, now)) return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-400",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
      )}
    >
      <CalendarClock className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {label}
    </span>
  );
};

ScheduledBadge.displayName = "ScheduledBadge";
