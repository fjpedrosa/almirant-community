"use client";

import { useGithubSummary } from "./use-github-summary";
import { useGithubPrs } from "./use-github-prs";
import { useGithubCommits } from "./use-github-commits";
import { useGithubActions } from "./use-github-actions";
import { useGithubContributors } from "./use-github-contributors";
import { useGithubActivity } from "./use-github-activity";
import { useGithubSync } from "./use-github-sync";
import { useGithubStatus } from "./use-github-status";
import type { GithubTabStatus } from "../../domain/types";

export const useGithubTab = (projectId: string) => {
  const { data: statusData, isLoading: isStatusLoading } = useGithubStatus();
  const { data: summary, isLoading: isSummaryLoading } =
    useGithubSummary(projectId);
  const { data: pullRequests, isLoading: isPrsLoading } =
    useGithubPrs(projectId);
  const { data: commits, isLoading: isCommitsLoading } =
    useGithubCommits(projectId);
  const { data: actions, isLoading: isActionsLoading } =
    useGithubActions(projectId);
  const { data: contributors, isLoading: isContributorsLoading } =
    useGithubContributors(projectId);
  const { data: activity, isLoading: isActivityLoading } =
    useGithubActivity(projectId);
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
