import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelinePhase } from "../../domain/types";

interface SessionEventTimelineProps {
  phases: TimelinePhase[];
  className?: string;
  label?: string;
}

const formatPhaseTime = (timestamp: string | null): string => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** Marker geometry is shared with the connector so the rail always lands on the
 *  centre of the dot, whatever height a row ends up taking. */
const MARKER_SIZE = "size-[18px]";

const PhaseMarker: React.FC<{ status: TimelinePhase["status"] }> = ({
  status,
}) => {
  if (status === "done") {
    return (
      <span
        className={cn(
          MARKER_SIZE,
          "relative z-10 flex shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500 ring-1 ring-inset ring-emerald-500/30",
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  }

  if (status === "active") {
    return (
      <span
        className={cn(
          MARKER_SIZE,
          "relative z-10 flex shrink-0 items-center justify-center rounded-full bg-primary/15 ring-1 ring-inset ring-primary/40",
        )}
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/25 motion-reduce:animate-none" />
        <span className="relative size-1.5 rounded-full bg-primary" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        MARKER_SIZE,
        "relative z-10 flex shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-inset ring-border",
      )}
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
    </span>
  );
};

export const SessionEventTimeline: React.FC<SessionEventTimelineProps> = ({
  phases,
  className,
  label = "Progress",
}) => {
  if (phases.length === 0) return null;

  return (
    <section className={cn("min-w-0", className)}>
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </h3>
      <ol className="min-w-0">
        {phases.map((phase, index) => {
          const isLast = index === phases.length - 1;
          const isPending = phase.status === "pending";
          const time = formatPhaseTime(phase.startedAt);
          const detail = phase.details?.join(" · ");

          return (
            <li key={phase.id} className="relative flex min-w-0 gap-2.5 pb-3 last:pb-0">
              {/* Connector: starts at the marker centre, stops before the next row. */}
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[8px] top-[18px] bottom-0 w-px",
                    phase.status === "done"
                      ? "bg-emerald-500/25"
                      : "bg-border",
                  )}
                />
              )}
              <PhaseMarker status={phase.status} />
              <div className="min-w-0 flex-1 pt-px">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "truncate text-[13px] font-medium leading-5",
                      isPending ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {phase.label}
                  </span>
                  {time && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                      {time}
                    </span>
                  )}
                </div>
                {(detail || phase.eventCount > 0) && (
                  <div className="flex min-w-0 items-baseline justify-between gap-2 text-[11px] text-muted-foreground/60">
                    <span className="truncate">{detail}</span>
                    {phase.eventCount > 0 && (
                      <span className="shrink-0 tabular-nums">
                        {phase.eventCount}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
