import { Check, Circle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelinePhase } from "../../domain/types";

interface SessionEventTimelineProps {
  phases: TimelinePhase[];
  className?: string;
}

const formatPhaseTime = (timestamp: string | null): string => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const StatusIcon: React.FC<{
  status: TimelinePhase["status"];
  isError?: boolean;
}> = ({ status, isError }) => {
  if (status === "done" && isError) {
    return (
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-destructive">
        <X className="size-3" />
      </div>
    );
  }
  if (status === "done") {
    return (
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
        <Check className="size-3" />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
        <Loader2 className="size-3 animate-spin" />
      </div>
    );
  }
  return (
    <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Circle className="size-2.5" />
    </div>
  );
};

const VerticalConnector: React.FC<{ isDone: boolean }> = ({ isDone }) => (
  <div
    className={cn(
      "ml-[9px] w-px shrink-0 h-2",
      isDone ? "bg-emerald-500/40" : "border-l border-dashed border-muted-foreground/30",
    )}
  />
);

export const SessionEventTimeline: React.FC<SessionEventTimelineProps> = ({
  phases,
  className,
}) => {
  if (phases.length === 0) return null;

  return (
    <div className={cn("overflow-y-auto", className)}>
      <ol className="flex flex-col">
        {phases.map((phase, index) => {
          const isLast = index === phases.length - 1;
          return (
            <li key={phase.id} className="flex flex-col">
              <div className="flex items-start gap-2 py-0.5">
                <div className="mt-0.5">
                  <StatusIcon status={phase.status} />
                </div>
                <div className="min-w-0">
                  <span
                    className={cn(
                      "text-sm font-medium truncate block",
                      phase.status === "pending" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {phase.label}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {phase.startedAt && <span>{formatPhaseTime(phase.startedAt)}</span>}
                    {phase.eventCount > 0 && <span>{phase.eventCount} ev</span>}
                  </div>
                </div>
              </div>
              {!isLast && <VerticalConnector isDone={phase.status === "done"} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
};
