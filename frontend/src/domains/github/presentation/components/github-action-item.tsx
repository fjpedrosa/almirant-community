"use client";

import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ExternalLink,
  GitBranch,
} from "lucide-react";
import type { GithubActionItemProps } from "../../domain/types";
import { timeAgo } from "./time-ago";

// ---- Status mapping ---------------------------------------------------------

const statusConfig: Record<
  string,
  { icon: React.ReactNode; label: string; className: string }
> = {
  success: {
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
    label: "Success",
    className: "text-green-500",
  },
  failure: {
    icon: <XCircle className="h-4 w-4" aria-hidden="true" />,
    label: "Failed",
    className: "text-red-500",
  },
  in_progress: {
    icon: <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />,
    label: "In progress",
    className: "text-yellow-500",
  },
  queued: {
    icon: <Clock className="h-4 w-4" aria-hidden="true" />,
    label: "Queued",
    className: "text-muted-foreground",
  },
  pending: {
    icon: <Clock className="h-4 w-4" aria-hidden="true" />,
    label: "Pending",
    className: "text-yellow-500",
  },
  cancelled: {
    icon: <XCircle className="h-4 w-4" aria-hidden="true" />,
    label: "Cancelled",
    className: "text-gray-400",
  },
};

const resolveStatus = (
  status: string | null,
  conclusion: string | null
): { icon: React.ReactNode; label: string; className: string } => {
  if (conclusion && statusConfig[conclusion]) return statusConfig[conclusion];
  if (status && statusConfig[status]) return statusConfig[status];
  return {
    icon: <Clock className="h-4 w-4" aria-hidden="true" />,
    label: status ?? "Unknown",
    className: "text-muted-foreground",
  };
};

// ---- Component --------------------------------------------------------------

export const GithubActionItem: React.FC<GithubActionItemProps> = ({
  name,
  status,
  conclusion,
  branch,
  htmlUrl,
  startedAt,
  completedAt,
}) => {
  const resolved = resolveStatus(status, conclusion);
  const displayTime = completedAt ?? startedAt;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors">
      {/* Status icon */}
      <span className={`flex-shrink-0 ${resolved.className}`} role="status" aria-label={resolved.label}>
        {resolved.icon}
      </span>

      {/* Workflow name */}
      <span className="flex-1 min-w-0 text-sm font-medium truncate">
        {name ?? "Unnamed workflow"}
      </span>

      {/* Branch badge */}
      {branch && (
        <Badge variant="outline" className="flex-shrink-0 text-[10px] px-1.5 py-0 gap-1">
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {branch}
        </Badge>
      )}

      {/* Relative time */}
      {displayTime && (
        <time
          dateTime={displayTime}
          className="flex-shrink-0 text-xs text-muted-foreground w-14 text-right"
        >
          {timeAgo(displayTime)}
        </time>
      )}

      {/* External link */}
      {htmlUrl && (
        <a
          href={htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label={`Open workflow run ${name ?? ""} on GitHub`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
};
