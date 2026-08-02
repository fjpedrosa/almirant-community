import { ScrollArea } from "@/components/ui/scroll-area";
import { BugFixAttemptTimelineItem } from "./bug-fix-attempt-timeline-item";
import type { BugFixAttemptSummary } from "../../domain/types";

export interface BugFixAttemptTimelineProps {
  attempts: BugFixAttemptSummary[];
}

/**
 * Timeline showing all bug fix attempts for a cluster.
 * Displays attempts in descending order by attempt number.
 *
 * Usage:
 * <BugFixAttemptTimeline attempts={cluster.bugFixAttempts} />
 */
export const BugFixAttemptTimeline: React.FC<BugFixAttemptTimelineProps> = ({
  attempts,
}) => {
  // Sort attempts descending by attemptNumber
  const sortedAttempts = [...attempts].sort(
    (a, b) => b.attemptNumber - a.attemptNumber
  );

  if (sortedAttempts.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No fix attempts yet
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-1">
        {sortedAttempts.map((attempt) => (
          <BugFixAttemptTimelineItem key={attempt.id} attempt={attempt} />
        ))}
      </div>
    </ScrollArea>
  );
};
