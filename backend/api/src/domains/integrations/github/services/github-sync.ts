import {
  getRepoIdsForProject,
  getLinkedReposByInstallation,
  upsertCommit,
  upsertPullRequest,
  upsertWorkflowRun,
  getWorkItemsWithStalePrState,
  updateWorkItem,
} from "@almirant/database";
import {
  fetchRecentCommits,
  fetchOpenPullRequests,
  fetchRecentlyUpdatedPullRequests,
  fetchWorkflowRuns,
} from "./github-service";
import { logger } from "@almirant/config";
import { autoLinkCommitsToWorkItems } from "./github-webhook-handlers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Installation {
  /** provider_connections.id (UUID) */
  id: string;
  /** Numeric GitHub App installation ID */
  installationId: number;
}

interface RepoSyncResult {
  repo: string;
  commits: number;
  pullRequests: number;
  workflowRuns: number;
  reconciledWorkItems: number;
}

interface SyncProjectResult {
  synced: boolean;
  repositories: Array<RepoSyncResult | { error: string }>;
}

// ---------------------------------------------------------------------------
// Core sync logic (extracted from POST /github/projects/:id/sync)
// ---------------------------------------------------------------------------

/**
 * Sync GitHub data (commits, PRs, workflow runs) for a single project.
 *
 * Resolves the project's repos, matches them against the provided
 * installations' linked repos, fetches fresh data from the GitHub API,
 * and upserts everything into the database.
 *
 * This function is safe to call fire-and-forget -- it never throws.
 * Errors for individual repos are captured in the returned results array.
 */
export const syncProjectGithubData = async (
  projectId: string,
  installations: Installation[],
): Promise<SyncProjectResult> => {
  // 1. Resolve project repo IDs
  const projectRepoIds = await getRepoIdsForProject(projectId);

  if (projectRepoIds.length === 0) {
    return { synced: false, repositories: [] };
  }

  // 2. Collect all linked repos across installations that belong to this project
  const allLinkedRepos: Array<{
    repoId: string;
    githubInstallationId: number;
    githubRepoFullName: string;
  }> = [];

  for (const installation of installations) {
    const linked = await getLinkedReposByInstallation(installation.id);
    const projectRepos = linked.filter(
      (r: { repoId: string }) => projectRepoIds.includes(r.repoId),
    );
    for (const repo of projectRepos) {
      allLinkedRepos.push({
        repoId: repo.repoId,
        githubInstallationId: installation.installationId,
        githubRepoFullName: repo.githubRepoFullName,
      });
    }
  }

  if (allLinkedRepos.length === 0) {
    return { synced: false, repositories: [] };
  }

  // 3. Fetch fresh data from GitHub for each linked repo and persist to DB
  const syncResults = await Promise.allSettled(
    allLinkedRepos.map(async (linkedRepo) => {
      const parts = linkedRepo.githubRepoFullName.split("/");
      const owner = parts[0] ?? "";
      const repo = parts[1] ?? "";
      const instId = linkedRepo.githubInstallationId;

      const [commits, prs, recentlyUpdatedPrs, workflowData] = await Promise.all([
        fetchRecentCommits(instId, owner, repo).catch((e) => {
          logger.error(e, `Failed to fetch commits for ${linkedRepo.githubRepoFullName}`);
          return [];
        }),
        fetchOpenPullRequests(instId, owner, repo).catch((e) => {
          logger.error(e, `Failed to fetch open PRs for ${linkedRepo.githubRepoFullName}`);
          return [];
        }),
        fetchRecentlyUpdatedPullRequests(instId, owner, repo).catch((e) => {
          logger.error(e, `Failed to fetch recently updated PRs for ${linkedRepo.githubRepoFullName}`);
          return [];
        }),
        fetchWorkflowRuns(instId, owner, repo).catch((e) => {
          logger.error(e, `Failed to fetch workflows for ${linkedRepo.githubRepoFullName}`);
          return { workflow_runs: [] };
        }),
      ]);

      // Persist commits
      const upsertedCommits: Array<{ commitId: string; message: string }> = [];
      for (const commit of commits) {
        const row = await upsertCommit({
          repoId: linkedRepo.repoId,
          sha: commit.sha,
          message: commit.commit.message,
          authorLogin: commit.author?.login ?? null,
          authorName: commit.commit.author.name ?? null,
          branch: null,
          committedAt: new Date(commit.commit.author.date),
        });
        if (!row) continue;
        upsertedCommits.push({ commitId: row.id, message: commit.commit.message });
      }

      // Auto-link commits to work items (best-effort)
      try {
        await autoLinkCommitsToWorkItems(linkedRepo.repoId, "", upsertedCommits);
      } catch (e) {
        logger.error(`[github-sync] Auto-link commits failed for ${linkedRepo.githubRepoFullName}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Persist pull requests (open + recently updated, deduplicated by number)
      const seenPrNumbers = new Set<number>();
      const allPrs = [...prs, ...recentlyUpdatedPrs];
      for (const pr of allPrs) {
        if (seenPrNumbers.has(pr.number)) continue;
        seenPrNumbers.add(pr.number);

        const prState: "open" | "closed" | "merged" = pr.merged_at
          ? "merged"
          : pr.state === "closed"
            ? "closed"
            : "open";

        await upsertPullRequest({
          repoId: linkedRepo.repoId,
          number: pr.number,
          title: pr.title,
          body: pr.body ?? null,
          state: prState,
          authorLogin: pr.user?.login ?? null,
          authorAvatarUrl: pr.user?.avatar_url ?? null,
          labels: pr.labels.map((l: { name: string }) => l.name),
          baseBranch: pr.base?.ref ?? null,
          headBranch: pr.head?.ref ?? null,
          additions: pr.additions ?? 0,
          deletions: pr.deletions ?? 0,
          htmlUrl: pr.html_url ?? null,
          isDraft: pr.draft ?? false,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
        });
      }

      // Reconcile work item metadata with current PR state in the database.
      // This catches cases where a webhook was missed: the PR table has the
      // correct state from the fetch above, and now we propagate it to any
      // work items whose metadata.pullRequest.state is stale.
      let reconciledCount = 0;
      try {
        const staleItems = await getWorkItemsWithStalePrState(linkedRepo.repoId);

        for (const item of staleItems) {
          const updatedPr = {
            url: item.prHtmlUrl ?? (item.currentMetadata.pullRequest as Record<string, unknown>)?.url ?? "",
            number: item.prNumber,
            state: item.prState,
            branch: item.prHeadBranch ?? (item.currentMetadata.pullRequest as Record<string, unknown>)?.branch ?? "",
          };
          const merged = { ...item.currentMetadata, pullRequest: updatedPr };
          await updateWorkItem(item.organizationId, item.workItemId, { metadata: merged });
          reconciledCount++;
        }

        if (reconciledCount > 0) {
          logger.info(
            `[github-sync] Reconciled PR state for ${reconciledCount} work item(s) in ${linkedRepo.githubRepoFullName}`
          );
        }
      } catch (e) {
        logger.error(`[github-sync] PR state reconciliation failed for ${linkedRepo.githubRepoFullName}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Persist workflow runs
      const workflowRuns = workflowData.workflow_runs ?? [];
      for (const run of workflowRuns) {
        await upsertWorkflowRun({
          repoId: linkedRepo.repoId,
          runId: run.id,
          name: run.name ?? null,
          status: run.status ?? null,
          conclusion: run.conclusion ?? null,
          branch: run.head_branch ?? null,
          headSha: run.head_sha ?? null,
          htmlUrl: run.html_url ?? null,
          event: run.event ?? null,
          startedAt: run.run_started_at ? new Date(run.run_started_at) : null,
          completedAt: run.updated_at ? new Date(run.updated_at) : null,
        });
      }

      return {
        repo: linkedRepo.githubRepoFullName,
        commits: commits.length,
        pullRequests: seenPrNumbers.size,
        workflowRuns: workflowRuns.length,
        reconciledWorkItems: reconciledCount,
      } satisfies RepoSyncResult;
    }),
  );

  const repositories = syncResults.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason) },
  );

  return { synced: true, repositories };
};
