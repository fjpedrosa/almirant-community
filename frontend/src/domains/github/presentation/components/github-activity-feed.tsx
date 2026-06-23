"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";
import type { GithubActivityFeedProps } from "../../domain/types";
import { GithubActivityItem } from "./github-activity-item";

export const GithubActivityFeed: React.FC<GithubActivityFeedProps> = ({
  events,
  isLoading,
}) => {
  const t = useTranslations("github");
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" aria-hidden="true" />
            {t("recentActivity")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 py-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" aria-hidden="true" />
          {t("recentActivity")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("noActivity")}
          </p>
        ) : (
          <div role="list" aria-label="Recent activity">
            {events.map((event) => (
              <GithubActivityItem
                key={event.id}
                eventType={event.eventType}
                action={event.action}
                actorLogin={event.actorLogin}
                actorAvatarUrl={event.actorAvatarUrl}
                summary={event.summary}
                createdAt={event.createdAt}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
