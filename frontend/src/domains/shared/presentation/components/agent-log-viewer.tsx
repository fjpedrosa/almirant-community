"use client";

import { useEffect, useMemo, useRef } from "react";
import { TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AgentLogChunk, AgentLogViewerProps } from "../../domain/types";

const LEVEL_STYLES: Record<
  AgentLogChunk["level"],
  { badge: "default" | "secondary" | "destructive" | "outline"; dot: string }
> = {
  debug: { badge: "outline", dot: "bg-slate-400" },
  info: { badge: "default", dot: "bg-sky-500" },
  warn: { badge: "secondary", dot: "bg-amber-500" },
  error: { badge: "destructive", dot: "bg-red-500" },
};

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const TimelineSkeleton = () => (
  <div className="space-y-2">
    {Array.from({ length: 6 }).map((_, index) => (
      <Skeleton key={index} className="h-16 w-full rounded-lg" />
    ))}
  </div>
);

export const AgentLogViewer: React.FC<AgentLogViewerProps> = ({
  chunks,
  isLoading = false,
  isLive = false,
  title = "Session Output",
  emptyLabel = "No output yet.",
  className,
}) => {
  const contentRef = useRef<HTMLDivElement | null>(null);

  const orderedChunks = useMemo(
    () =>
      [...chunks].sort((left, right) => {
        if (left.seq !== right.seq) return left.seq - right.seq;
        return left.timestamp.localeCompare(right.timestamp);
      }),
    [chunks]
  );

  useEffect(() => {
    if (!isLive) return;
    const viewport = contentRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (!(viewport instanceof HTMLElement)) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [isLive, orderedChunks]);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TerminalSquare className="h-4 w-4" />
          {title}
        </CardTitle>
        {isLive && (
          <Badge variant="default" className="animate-pulse">
            Live
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <TimelineSkeleton />
        ) : orderedChunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ScrollArea ref={contentRef} className="max-h-[460px] pr-3">
            <div className="space-y-2">
              {orderedChunks.map((chunk) => {
                const levelStyle = LEVEL_STYLES[chunk.level];
                const hasPayload =
                  chunk.payload && Object.keys(chunk.payload).length > 0;

                return (
                  <div
                    key={chunk.id}
                    className="rounded-lg border border-border/70 bg-muted/20 p-3"
                    data-testid={`agent-log-chunk-${chunk.seq}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">#{chunk.seq}</span>
                      <span
                        className={cn("h-2 w-2 rounded-full", levelStyle.dot)}
                        aria-hidden="true"
                      />
                      <Badge variant={levelStyle.badge}>{chunk.level}</Badge>
                      <Badge variant="outline">{chunk.phase}</Badge>
                      <span>{chunk.eventType}</span>
                      <span className="ml-auto">{formatTimestamp(chunk.timestamp)}</span>
                    </div>

                    <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                      {chunk.message}
                    </pre>

                    {hasPayload && (
                      <details className="mt-2 rounded-md bg-background/70 p-2 text-xs">
                        <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                          Payload
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap break-all">
                          {JSON.stringify(chunk.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
