import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import {
  groupTimelineEvents,
  getEventId,
  type ClusterTimelineEvent,
} from "../../domain/cluster-timeline";
import { describeTimelineEvent } from "../../domain/cluster-timeline-describe";

export interface ClusterDetailTimelineProps {
  events: ClusterTimelineEvent[];
  now: Date;
}

const INITIAL_VISIBLE = 10;

const formatRelative = (iso: string, now: Date): string => {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return iso;
  const diffMs = target - now.getTime();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < minute) return rtf.format(Math.round(diffMs / 1000), "second");
  if (absMs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (absMs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  return rtf.format(Math.round(diffMs / day), "day");
};

const EventRow: React.FC<{ event: ClusterTimelineEvent; now: Date }> = ({
  event,
  now,
}) => {
  const { icon: Icon, iconClassName, label } = describeTimelineEvent(event);
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${iconClassName}`}
        aria-hidden="true"
      />
      <span className="flex-1 truncate text-foreground/80">{label}</span>
      <time
        dateTime={event.at}
        className="shrink-0 text-muted-foreground"
        title={new Date(event.at).toLocaleString("es")}
      >
        {formatRelative(event.at, now)}
      </time>
    </div>
  );
};

/**
 * Collapsible chronological timeline rendered inside the cluster detail hero.
 *
 * - Events are grouped via `groupTimelineEvents` (collapses ticket bursts).
 * - Sorted descending (most-recent first).
 * - Default-collapsed with a "{N} eventos" trigger.
 * - First 10 events render eagerly when expanded; overflow is nested under a
 *   secondary collapsible so very long histories don't dominate the hero.
 */
export const ClusterDetailTimeline: React.FC<ClusterDetailTimelineProps> = ({
  events,
  now,
}) => {
  const grouped = groupTimelineEvents(events);
  const sorted = [...grouped].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );

  if (sorted.length === 0) return null;

  const initial = sorted.slice(0, INITIAL_VISIBLE);
  const overflow = sorted.slice(INITIAL_VISIBLE);

  return (
    <Collapsible className="mt-1">
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
        {sorted.length} eventos
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1.5 border-l pl-3">
        {initial.map((event) => (
          <EventRow key={getEventId(event)} event={event} now={now} />
        ))}
        {overflow.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Ver {overflow.length} más anteriores
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 space-y-1.5">
              {overflow.map((event) => (
                <EventRow key={getEventId(event)} event={event} now={now} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};
