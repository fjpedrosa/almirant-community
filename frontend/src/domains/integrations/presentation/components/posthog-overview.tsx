import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PosthogIcon } from "@/components/icons/posthog-icon";
import { AlertTriangle } from "lucide-react";
import type { PosthogOverviewProps } from "../../domain/types";

// ---------------------------------------------------------------------------
// PosthogOverview - Purely presentational
// ---------------------------------------------------------------------------

export const PosthogOverview: React.FC<PosthogOverviewProps> = ({
  insights,
  events,
  isLoadingInsights,
  isLoadingEvents,
  insightsError,
  eventsError,
}) => {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PosthogIcon className="size-4" />
          PostHog
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="insights">
          <TabsList className="mb-3">
            <TabsTrigger value="insights">
              Insights
              {!isLoadingInsights && insights.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {insights.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="events">
              Recent Events
              {!isLoadingEvents && events.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {events.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Insights tab */}
          <TabsContent value="insights" className="mt-0">
            {isLoadingInsights ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : insightsError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{insightsError}</span>
              </div>
            ) : insights.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No insights found in this project.
              </p>
            ) : (
              <div className="space-y-2">
                {insights.map((insight) => (
                  <div
                    key={insight.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {insight.name ?? `Insight #${insight.id}`}
                      </p>
                      {insight.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {insight.description}
                        </p>
                      )}
                    </div>
                    {insight.last_refresh && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(insight.last_refresh).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Events tab */}
          <TabsContent value="events" className="mt-0">
            {isLoadingEvents ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : eventsError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{eventsError}</span>
              </div>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No recent events found.
              </p>
            ) : (
              <div className="space-y-2">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{event.event}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {event.distinct_id}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
