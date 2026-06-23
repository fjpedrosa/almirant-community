"use client";

import { Badge } from "@/components/ui/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import type { GithubPrItemProps, GithubReviewStatus, GithubCiStatus } from "../../domain/types";
import { timeAgo } from "./time-ago";

// ---- Helpers (pure mappings) ------------------------------------------------

const reviewIcon: Record<GithubReviewStatus, React.ReactNode> = {
  approved: <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />,
  changes_requested: <AlertCircle className="h-4 w-4 text-orange-500" aria-hidden="true" />,
  pending: <Clock className="h-4 w-4 text-yellow-500" aria-hidden="true" />,
  commented: <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
  dismissed: <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
};

const reviewLabel: Record<GithubReviewStatus, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  pending: "Review pending",
  commented: "Commented",
  dismissed: "Dismissed",
};

const ciColor: Record<GithubCiStatus, string> = {
  success: "bg-green-500",
  failure: "bg-red-500",
  pending: "bg-yellow-500",
  queued: "bg-yellow-500",
  in_progress: "bg-yellow-500",
  cancelled: "bg-gray-400",
  skipped: "bg-gray-400",
  neutral: "bg-gray-400",
};

const ciLabel: Record<GithubCiStatus, string> = {
  success: "CI passed",
  failure: "CI failed",
  pending: "CI pending",
  queued: "CI queued",
  in_progress: "CI running",
  cancelled: "CI cancelled",
  skipped: "CI skipped",
  neutral: "CI neutral",
};

// ---- Component --------------------------------------------------------------

export const GithubPrItem: React.FC<GithubPrItemProps> = ({
  title,
  number,
  authorLogin,
  authorAvatarUrl,
  labels,
  reviewStatus,
  ciStatus,
  isDraft,
  createdAt,
  htmlUrl,
  additions,
  deletions,
}) => {
  const authorInitial = authorLogin ? authorLogin.charAt(0).toUpperCase() : "?";

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors"
        role="row"
      >
        {/* CI status dot */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`flex-shrink-0 h-2.5 w-2.5 rounded-full ${ciColor[ciStatus]}`}
              role="status"
              aria-label={ciLabel[ciStatus]}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {ciLabel[ciStatus]}
          </TooltipContent>
        </Tooltip>

        {/* Author avatar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Avatar className="h-6 w-6 flex-shrink-0">
              {authorAvatarUrl && (
                <AvatarImage src={authorAvatarUrl} alt={authorLogin ?? "Author"} />
              )}
              <AvatarFallback className="text-[10px]">{authorInitial}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {authorLogin ?? "Unknown author"}
          </TooltipContent>
        </Tooltip>

        {/* Title + number + labels */}
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          {htmlUrl ? (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium truncate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              aria-label={`Pull request #${number}: ${title}`}
            >
              {title}
            </a>
          ) : (
            <span className="text-sm font-medium truncate">{title}</span>
          )}

          <span className="text-xs text-muted-foreground flex-shrink-0">#{number}</span>

          {isDraft && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Draft
            </Badge>
          )}

          {labels.map((label) => (
            <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0">
              {label}
            </Badge>
          ))}
        </div>

        {/* Review status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-shrink-0" aria-label={reviewLabel[reviewStatus]}>
              {reviewIcon[reviewStatus]}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {reviewLabel[reviewStatus]}
          </TooltipContent>
        </Tooltip>

        {/* Additions / deletions */}
        <span className="flex-shrink-0 flex items-center gap-1.5 text-xs tabular-nums">
          <span className="text-green-600" aria-label={`${additions} additions`}>
            +{additions}
          </span>
          <span className="text-red-500" aria-label={`${deletions} deletions`}>
            -{deletions}
          </span>
        </span>

        {/* Relative time */}
        <time
          dateTime={createdAt}
          className="flex-shrink-0 text-xs text-muted-foreground w-14 text-right"
        >
          {timeAgo(createdAt)}
        </time>

        {/* External link icon */}
        {htmlUrl && (
          <a
            href={htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-label={`Open PR #${number} on GitHub`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </TooltipProvider>
  );
};
