import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";
import { sortLogsBySeq } from "../../domain/run-utils";
import type { AgentJobLog, AgentJobLogLevel, RecurrenceType } from "../../domain/types";
import { BoundaryBadge } from "./boundary-badge";
import { RecurrenceBadge } from "./recurrence-badge";

interface AgentJobLogsTimelineProps {
  title?: string;
  logs: AgentJobLog[];
  isLoading: boolean;
  isError?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  emptyLabel?: string;
  // Recurrence/boundary metadata (optional)
  runtime?: string | null;
  boundary?: string | null;
  recurrenceType?: RecurrenceType | null;
  recurrenceCount?: number | null;
}

const levelVariant = (
  level: AgentJobLogLevel
): "default" | "secondary" | "destructive" | "outline" => {
  switch (level) {
    case "error":
      return "destructive";
    case "warn":
      return "secondary";
    case "debug":
      return "outline";
    case "info":
    default:
      return "default";
  }
};

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const stringifyPayload = (payload: Record<string, unknown>): string => {
  try {
    const value = JSON.stringify(payload, null, 2);
    if (value.length <= 1600) return value;
    return `${value.slice(0, 1600)}\n...`;
  } catch {
    return "Unable to render payload";
  }
};

const TimelineSkeleton: React.FC = () => (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, idx) => (
      <Skeleton key={idx} className="h-20 w-full" />
    ))}
  </div>
);

export const AgentJobLogsTimeline: React.FC<AgentJobLogsTimelineProps> = ({
  title = "Timeline",
  logs,
  isLoading,
  isError = false,
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
  emptyLabel = "No logs yet.",
  runtime,
  boundary,
  recurrenceType,
  recurrenceCount,
}) => {
  const sortedLogs = sortLogsBySeq(logs);
  const hasMetadataBadges =
    (runtime != null && runtime !== "") ||
    (boundary != null && boundary !== "") ||
    (recurrenceType != null && recurrenceType !== "new");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasMetadataBadges && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-2"
            data-testid="timeline-metadata-badges"
          >
            <BoundaryBadge boundary={boundary} runtime={runtime} />
            <RecurrenceBadge
              recurrenceType={recurrenceType}
              recurrenceCount={recurrenceCount}
            />
          </div>
        )}

        {isLoading ? (
          <TimelineSkeleton />
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load logs.</p>
        ) : sortedLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ScrollArea className="max-h-[420px] pr-3">
            <div className="space-y-3">
              {sortedLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-md border border-border/70 p-3"
                  data-testid={`timeline-log-${log.seq}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      seq {log.seq}
                    </Badge>
                    <Badge variant={levelVariant(log.level)}>
                      {log.level}
                    </Badge>
                    <Badge variant="outline">{log.phase}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {log.eventType}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{log.message}</p>

                  {Object.keys(log.payload ?? {}).length > 0 && (
                    <details className="mt-2 rounded-md bg-muted/40 p-2 text-xs">
                      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                        Payload
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-all">
                        {stringifyPayload(log.payload)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {hasMore && onLoadMore && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="w-full"
          >
            <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
            {isLoadingMore ? "Loading more..." : "Load more logs"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
