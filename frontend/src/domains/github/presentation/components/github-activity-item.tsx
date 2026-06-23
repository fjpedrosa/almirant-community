"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  GitPullRequest,
  GitCommit,
  Play,
  Activity,
  Circle,
} from "lucide-react";
import type { GithubActivityItemProps, GithubEventType } from "../../domain/types";
import { timeAgo } from "./time-ago";

// ---- Event type icons -------------------------------------------------------

const eventIcon: Record<GithubEventType, React.ReactNode> = {
  pull_request: <GitPullRequest className="h-4 w-4 text-purple-500" aria-hidden="true" />,
  pull_request_review: <GitPullRequest className="h-4 w-4 text-blue-500" aria-hidden="true" />,
  push: <GitCommit className="h-4 w-4 text-green-500" aria-hidden="true" />,
  workflow_run: <Play className="h-4 w-4 text-yellow-500" aria-hidden="true" />,
  check_run: <Activity className="h-4 w-4 text-orange-500" aria-hidden="true" />,
  deployment: <Circle className="h-4 w-4 text-cyan-500" aria-hidden="true" />,
  installation: <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
};

const eventLabel: Record<GithubEventType, string> = {
  pull_request: "Pull request",
  pull_request_review: "Review",
  push: "Push",
  workflow_run: "Workflow",
  check_run: "Check run",
  deployment: "Deployment",
  installation: "Installation",
};

// ---- Component --------------------------------------------------------------

export const GithubActivityItem: React.FC<GithubActivityItemProps> = ({
  eventType,
  actorLogin,
  actorAvatarUrl,
  summary,
  createdAt,
}) => {
  const actorInitial = actorLogin ? actorLogin.charAt(0).toUpperCase() : "?";

  return (
    <div className="flex items-start gap-3 py-2" role="listitem">
      {/* Event type icon */}
      <span className="flex-shrink-0 mt-0.5" aria-label={eventLabel[eventType]}>
        {eventIcon[eventType]}
      </span>

      {/* Actor avatar */}
      <Avatar className="h-5 w-5 flex-shrink-0 mt-0.5">
        {actorAvatarUrl && (
          <AvatarImage src={actorAvatarUrl} alt={actorLogin ?? "Actor"} />
        )}
        <AvatarFallback className="text-[9px]">{actorInitial}</AvatarFallback>
      </Avatar>

      {/* Summary text */}
      <p className="flex-1 min-w-0 text-sm text-foreground">
        {actorLogin && (
          <span className="font-medium">{actorLogin}</span>
        )}{" "}
        <span className="text-muted-foreground">
          {summary ?? `${eventLabel[eventType]} event`}
        </span>
      </p>

      {/* Relative time */}
      <time
        dateTime={createdAt}
        className="flex-shrink-0 text-xs text-muted-foreground w-14 text-right mt-0.5"
      >
        {timeAgo(createdAt)}
      </time>
    </div>
  );
};
