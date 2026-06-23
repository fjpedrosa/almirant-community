"use client";

import { useGithubTab } from "../../application/hooks/use-github-tab";
import { GithubPrList } from "../components/github-pr-list";
import { GithubCommitTimeline } from "../components/github-commit-timeline";
import { GithubActionsList } from "../components/github-actions-list";
import { GithubContributorsGrid } from "../components/github-contributors-grid";
import { GithubActivityFeed } from "../components/github-activity-feed";
import { GithubSyncButton } from "../components/github-sync-button";
import { GithubEmptyState } from "../components/github-empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { GithubTabContainerProps } from "../../domain/types";

export const GithubTabContainer: React.FC<GithubTabContainerProps> = ({
  projectId,
}) => {
  const {
    tabStatus,
    isStatusLoading,
    pullRequests,
    commits,
    actions,
    contributors,
    activity,
    isPrsLoading,
    isCommitsLoading,
    isActionsLoading,
    isContributorsLoading,
    isActivityLoading,
    handleSync,
    isSyncing,
    linkedRepoCount,
    lastSyncAt,
  } = useGithubTab(projectId);

  if (isStatusLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (tabStatus !== "synced") {
    return (
      <GithubEmptyState
        status={tabStatus}
        onSync={handleSync}
        isSyncing={isSyncing}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <GithubSyncButton
          onSync={handleSync}
          isSyncing={isSyncing}
          linkedRepoCount={linkedRepoCount}
          lastSyncAt={lastSyncAt}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GithubPrList pullRequests={pullRequests} isLoading={isPrsLoading} />
        <GithubCommitTimeline commits={commits} isLoading={isCommitsLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GithubActionsList workflowRuns={actions} isLoading={isActionsLoading} />
        <GithubContributorsGrid
          contributors={contributors}
          isLoading={isContributorsLoading}
        />
      </div>

      <GithubActivityFeed events={activity} isLoading={isActivityLoading} />
    </div>
  );
};
