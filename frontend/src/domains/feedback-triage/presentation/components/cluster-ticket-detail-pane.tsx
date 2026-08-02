import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { GitMerge, GitPullRequest, GitPullRequestClosed, ExternalLink } from "lucide-react";
import { FeedbackItemStatusBadge } from "./feedback-item-status-badge";
import { AvatarWithFallback } from "@/domains/shared/presentation/components/avatar-with-fallback";
import { BugDebugInfo } from "@/domains/shared/presentation/components/feedback";
import type { ClusterTicketItem, BugFixAttemptSummary } from "../../domain/types";
import type { DebugContext } from "@/domains/feedback/domain/types";

export interface ClusterTicketDetailPaneProps {
  ticket: ClusterTicketItem | null;
  attempts?: BugFixAttemptSummary[];
}

/**
 * Type guard to check if metadata is a DebugContext.
 * Uses duck-typing on distinguishing fields.
 */
const isDebugContextMetadata = (meta: unknown): meta is DebugContext => {
  if (typeof meta !== "object" || meta === null) {
    return false;
  }
  const obj = meta as Record<string, unknown>;
  // Check for fields unique to DebugContext
  return (
    (typeof obj.browser === "string" && obj.browser !== "") ||
    (typeof obj.viewport === "object" && obj.viewport !== null) ||
    (typeof obj.viewportWidth === "number") ||
    (typeof obj.viewportHeight === "number") ||
    (Array.isArray(obj.consoleErrors)) ||
    (typeof obj.userAgent === "string" && obj.userAgent !== "")
  );
};

/**
 * Format a date to localized long format.
 */
const formatDateLong = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
};

/**
 * Format a relative timestamp (e.g., "2 days ago").
 */
const formatRelativeTime = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 30) {
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    if (diffDays > 0) {
      return `${diffDays}d ago`;
    }
    if (diffHours > 0) {
      return `${diffHours}h ago`;
    }
    if (diffMins > 0) {
      return `${diffMins}m ago`;
    }
    return "just now";
  } catch {
    return dateStr;
  }
};

/**
 * Get PR state icon and color based on state.
 */
const getPrStateDisplay = (state: "open" | "closed" | "merged" | null) => {
  switch (state) {
    case "merged":
      return {
        Icon: GitMerge,
        className: "text-violet-600 dark:text-violet-400",
        label: "Merged",
      };
    case "open":
      return {
        Icon: GitPullRequest,
        className: "text-blue-600 dark:text-blue-400",
        label: "Open",
      };
    case "closed":
      return {
        Icon: GitPullRequestClosed,
        className: "text-muted-foreground",
        label: "Closed",
      };
    default:
      return {
        Icon: GitPullRequest,
        className: "text-muted-foreground",
        label: "Unknown",
      };
  }
};

/**
 * Center pane of the cluster detail modal.
 * Shows enriched detail of the selected ticket with avatar, title, status,
 * debug info, and associated PRs.
 *
 * This component is purely presentational - no hooks (useState, useEffect, etc.).
 *
 * Usage:
 * <ClusterTicketDetailPane
 *   ticket={selectedTicket}
 *   attempts={bugFixAttempts}
 * />
 */
export const ClusterTicketDetailPane: React.FC<ClusterTicketDetailPaneProps> = ({
  ticket,
  attempts = [],
}) => {
  if (!ticket) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a ticket to view details
      </div>
    );
  }

  const { author, metadata, debugBundleId, ticketNumber, aiCategory } = ticket;
  const authorName = author.name ?? (author.isAnonymous ? "Anonimo" : null);
  const debugContext = isDebugContextMetadata(metadata) ? metadata : null;

  // Filter attempts that have PRs
  const attemptsWithPr = attempts.filter((a) => a.fixPrUrl && a.fixPrNumber);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-1">
        {/* Header row: Avatar + Author info */}
        <div className="flex items-start gap-3">
          <AvatarWithFallback
            avatarUrl={author.avatarUrl}
            email={author.email}
            name={author.name}
            userId={author.userId}
            fallbackSeed={ticket.id}
            size={40}
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-medium leading-tight">
              {authorName ?? "Anonimo"}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{formatDateLong(ticket.createdAt)}</span>
              {ticketNumber && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                  {ticketNumber}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-semibold leading-tight">{ticket.title}</h2>

        {/* Badges row: Status + AI Category */}
        <div className="flex flex-wrap items-center gap-2">
          <FeedbackItemStatusBadge status={ticket.status} />
          {aiCategory && (
            <Badge variant="secondary" className="text-xs">
              {aiCategory}
            </Badge>
          )}
        </div>

        {/* Divider */}
        <Separator />

        {/* Content card */}
        <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-muted/30 p-3">
          {ticket.content ? (
            <p className="whitespace-pre-wrap m-0">{ticket.content}</p>
          ) : (
            <p className="text-muted-foreground italic m-0">No content provided</p>
          )}
        </div>

        {/* Debug context - when metadata is a DebugContext */}
        {debugContext && (
          <>
            <Separator />
            <BugDebugInfo
              debugContext={debugContext}
              feedbackItemId={ticket.id}
            />
          </>
        )}

        {/* Debug bundle link */}
        {debugBundleId && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Incident Bundle</h4>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2"
                      disabled
                    >
                      <ExternalLink className="h-4 w-4" />
                      Ver incident bundle completo
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Bundle viewer coming soon</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </>
        )}

        {/* Pull Requests section */}
        {attemptsWithPr.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Pull Requests</h4>
              <div className="space-y-2">
                {attemptsWithPr.map((attempt) => {
                  const prState = attempt.pr?.state ?? null;
                  const { Icon, className: iconClassName, label } = getPrStateDisplay(prState);
                  const mergedAt = attempt.pr?.mergedAt;

                  return (
                    <div
                      key={attempt.id}
                      className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm"
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} aria-label={label} />
                      <Link
                        href={attempt.fixPrUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-primary hover:underline"
                      >
                        #{attempt.fixPrNumber}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(attempt.createdAt)}
                      </span>
                      {mergedAt && (
                        <span className="text-xs text-violet-600 dark:text-violet-400">
                          merged {formatRelativeTime(mergedAt)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
};
