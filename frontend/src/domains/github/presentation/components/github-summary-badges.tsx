"use client";

import { Badge } from "@/components/ui/badge";
import { GitPullRequest, GitCommit, ExternalLink } from "lucide-react";
import type { GithubSummaryBadgesProps } from "../../domain/types";
import { GithubDeployBadge } from "./github-deploy-badge";
import { timeAgo } from "./time-ago";

export const GithubSummaryBadges: React.FC<GithubSummaryBadgesProps> = ({
  openPrCount,
  lastCommitAt,
  lastDeployStatus,
  githubRepoUrl,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-label="GitHub summary">
      {/* Open PR count */}
      <Badge variant="secondary" className="gap-1 text-xs">
        <GitPullRequest className="h-3 w-3" aria-hidden="true" />
        {openPrCount} {openPrCount === 1 ? "PR" : "PRs"}
      </Badge>

      {/* Last commit time */}
      {lastCommitAt && (
        <Badge variant="outline" className="gap-1 text-xs">
          <GitCommit className="h-3 w-3" aria-hidden="true" />
          {timeAgo(lastCommitAt)}
        </Badge>
      )}

      {/* Deploy status */}
      <GithubDeployBadge status={lastDeployStatus} />

      {/* GitHub link */}
      {githubRepoUrl && (
        <a
          href={githubRepoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label="Open repository on GitHub"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
};
