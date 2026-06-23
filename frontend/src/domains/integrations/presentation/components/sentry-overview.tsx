import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformProviderIcon } from "@/components/icons/platform-provider-icon";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SentryOverviewProps, SentryIssue } from "../../domain/types";

// ---------------------------------------------------------------------------
// Level badge color mapping
// ---------------------------------------------------------------------------

const LEVEL_VARIANT: Record<SentryIssue["level"], string> = {
  fatal: "bg-red-600 text-white",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  warning: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  debug: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
};

// ---------------------------------------------------------------------------
// SentryOverview - Purely presentational
// ---------------------------------------------------------------------------

export const SentryOverview: React.FC<SentryOverviewProps> = ({
  issues,
  isLoading,
  error,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlatformProviderIcon provider="sentry" className="size-4" size={16} />
            Sentry Issues
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlatformProviderIcon provider="sentry" className="size-4" size={16} />
            Sentry Issues
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PlatformProviderIcon provider="sentry" className="size-4" size={16} />
          Sentry Issues
          {issues.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {issues.length} unresolved
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No unresolved issues found.
          </p>
        ) : (
          <div className="space-y-2">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[10px] uppercase",
                        LEVEL_VARIANT[issue.level],
                      )}
                    >
                      {issue.level}
                    </Badge>
                    <span className="truncate font-medium">{issue.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{issue.shortId}</span>
                    <span>{issue.count} events</span>
                    <span>
                      Last seen{" "}
                      {new Date(issue.lastSeen).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                {issue.permalink && (
                  <a
                    href={issue.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${issue.shortId} in Sentry`}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
