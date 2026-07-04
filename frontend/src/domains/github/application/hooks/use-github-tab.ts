"use client";

import { useGithubSummary } from "./use-github-summary";
import { useGithubPrs } from "./use-github-prs";
import { useGithubCommits } from "./use-github-commits";
import { useGithubActions } from "./use-github-actions";
import { useGithubContributors } from "./use-github-contributors";
import { useGithubActivity } from "./use-github-activity";
import { useGithubSync } from "./use-github-sync";
import { useGithubStatus } from "./use-github-status";
import { githubHooksEnabled } from "../../domain/tab-gating";
import type { GithubTabStatus } from "../../domain/types";

export const useGithubTab = (projectId: string) => {
  const { data: statusData, isLoading: isStatusLoading } = useGithubStatus();

  // Only hit the six upstream GitHub endpoints when the project is actually
  // connected + has linked repos. Otherwise they are wasted rate-limited calls.
  const dataEnabled = githubHooksEnabled(projectId, statusData);

  const { data: summary, isLoading: isSummaryLoading } =
    useGithubSummary(projectId, dataEnabled);
  const { data: pullRequests, isLoading: isPrsLoading } =
    useGithubPrs(projectId, undefined, dataEnabled);
  const { data: commits, isLoading: isCommitsLoading } =
    useGithubCommits(projectId, undefined, dataEnabled);
  const { data: actions, isLoading: isActionsLoading } =
    useGithubActions(projectId, undefined, dataEnabled);
  const { data: contributors, isLoading: isContributorsLoading } =
    useGithubContributors(projectId, dataEnabled);
  const { data: activity, isLoading: isActivityLoading } =
    useGithubActivity(projectId, undefined, dataEnabled);
  const syncMutation = useGithubSync(projectId);

  // Derive tab status from connection + data state
  let tabStatus: GithubTabStatus = "synced";
  if (!statusData?.configured || (statusData?.installations ?? []).length === 0) {
    tabStatus = "not_connected";
  } else if ((statusData?.linkedRepos ?? []).length === 0) {
    tabStatus = "no_repos_linked";
  } else if (!summary || (summary as { totalCommits?: number }).totalCommits === 0) {
    tabStatus = "not_synced";
  }

  const linkedRepoCount = (statusData?.linkedRepos ?? []).length;
  const lastSyncAt = summary
    ? (summary as { lastCommitAt?: string | null }).lastCommitAt ?? null
    : null;

  return {
    tabStatus,
    isStatusLoading,
    summary: summary || null,
    pullRequests: pullRequests || [],
    commits: commits || [],
    actions: actions || [],
    contributors: contributors || [],
    activity: activity || [],
    isLoading: isSummaryLoading,
    isPrsLoading,
    isCommitsLoading,
    isActionsLoading,
    isContributorsLoading,
    isActivityLoading,
    handleSync: () => syncMutation.mutate(),
    isSyncing: syncMutation.isPending,
    linkedRepoCount,
    lastSyncAt,
  };
};
