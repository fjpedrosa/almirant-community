/**
 * PR lifecycle management for agent jobs.
 *
 * Extracted from JobExecutor — handles creating branches, draft PRs,
 * marking PRs ready for review, late PR creation, and collecting/pushing
 * changes from agent containers.
 */

import type { AlmirantWorkerClient, ClaimedJob, WorkItemDetails } from "@almirant/remote-agent";
import type { ContainerManager } from "../workspace/container-manager";
import { GITHUB_BOT_EMAIL, GITHUB_BOT_NAME } from "./github-identity";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import { extractRepoFullName } from "../shared/job-helpers";
import { collectChanges, cleanupCollectedChanges } from "./change-collector";
import { pushChanges } from "./runner-push";

const COLLECT_CHANGES_TIMEOUT_MS = 60_000;

const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type PrManagerDeps = {
  workerClient: AlmirantWorkerClient;
  containerManager: ContainerManager;
};

export type PrApiConfig = {
  apiBaseUrl?: string;
  apiKey?: string;
  workerId: string;
};

// ---------------------------------------------------------------------------
// createBranchAndDraftPr
// ---------------------------------------------------------------------------

export type CreateBranchAndDraftPrParams = {
  job: ClaimedJob;
  workItem: WorkItemDetails | null;
  repositoryId?: string;
  repoUrl: string;
  baseBranch: string;
  eventLogger: RunnerJobEventLogger;
};

export type CreateBranchAndDraftPrResult = {
  branchName: string;
  baseBranch: string;
  prUrl?: string;
  prNumber?: number;
  completedTaskIds?: string[];
  prCreatedByThisJob: boolean;
};

export type RunnerPrIdentity = {
  branchName: string;
  displayRef: string;
  title: string;
  prTitle: string;
  contextLines: string[];
};

const SHORT_ID_LENGTH = 8;

const toShortId = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, SHORT_ID_LENGTH)
    .toLowerCase() || "unknown";

const buildWorkItemRef = (value: string | null | undefined): string =>
  `WI-${toShortId(value)}`;

const buildJobRef = (value: string | null | undefined): string =>
  `JOB-${toShortId(value)}`;

const buildWorkItemBranchRef = (value: string | null | undefined): string =>
  `item-${toShortId(value)}`;

const buildJobBranchRef = (value: string | null | undefined): string =>
  `job-${toShortId(value)}`;

export const deriveRunnerPrIdentity = (
  job: ClaimedJob,
  workItem: WorkItemDetails | null,
): RunnerPrIdentity => {
  const anchorTaskId = workItem?.parent?.taskId ?? workItem?.taskId ?? null;
  const anchorDisplayRef = anchorTaskId
    ?? (workItem?.parent?.id ? buildWorkItemRef(workItem.parent.id) : null)
    ?? (workItem?.id ? buildWorkItemRef(workItem.id) : buildJobRef(job.id));
  const anchorBranchRef = anchorTaskId
    ?? (workItem?.parent?.id ? buildWorkItemBranchRef(workItem.parent.id) : null)
    ?? (workItem?.id ? buildWorkItemBranchRef(workItem.id) : buildJobBranchRef(job.id));
  const anchorTitle = workItem?.parent?.title ?? workItem?.title ?? `Runner job ${toShortId(job.id)}`;
  const branchName = `almirant/${anchorBranchRef}`;

  const contextLines = [
    `- Job: ${job.id}`,
    workItem?.taskId
      ? `- Task: ${workItem.taskId} — ${workItem.title}`
      : workItem
        ? `- Work item: ${anchorDisplayRef} — ${workItem.title}`
        : null,
    workItem?.parent
      ? `- Parent: ${workItem.parent.taskId ?? buildWorkItemRef(workItem.parent.id)} — ${workItem.parent.title}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return {
    branchName,
    displayRef: anchorDisplayRef,
    title: anchorTitle,
    prTitle: `[${anchorDisplayRef}] ${anchorTitle}`,
    contextLines,
  };
};

/**
 * Create a deterministic branch and a draft PR BEFORE the agent starts.
 *
 * For runner-implement jobs, this:
 *  1. Derives a deterministic branch name from parent task id, task id, work item id, or job id
 *  2. Creates the branch on the remote with an empty initial commit
 *  3. Creates a draft PR via the backend API
 *  4. Returns branch name and PR metadata so the container can clone this branch
 */
export async function createBranchAndDraftPr(
  deps: PrManagerDeps,
  config: PrApiConfig,
  params: CreateBranchAndDraftPrParams,
): Promise<CreateBranchAndDraftPrResult | null> {
  const { job, workItem, repositoryId, repoUrl, baseBranch, eventLogger } = params;

  if (!repositoryId) {
    eventLogger.warn("pr", "pr.skip_no_repo", "Skipping PR-first flow: no repositoryId configured");
    return null;
  }

  const repoFullName = extractRepoFullName(repoUrl);
  if (!repoFullName) {
    eventLogger.warn("pr", "pr.skip_bad_url", "Skipping PR-first flow: cannot extract owner/repo from URL", {
      repoUrl,
    });
    return null;
  }

  const prIdentity = deriveRunnerPrIdentity(job, workItem);
  const { branchName } = prIdentity;

  eventLogger.info("pr", "pr.branch_create_start", "Creating branch for PR-first flow", {
    branchName,
    baseBranch,
    repoFullName,
  });

  // Get GitHub token
  let githubToken: string;
  try {
    const tokenResult = await deps.workerClient.getGithubToken(repositoryId);
    githubToken = tokenResult.token;
  } catch (error) {
    eventLogger.warn("pr", "pr.token_failed", "Failed to get GitHub token for branch creation", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const { tmpdir } = await import("node:os");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const run = async (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ stdout: string; stderr: string }> => {
    return execFileAsync(cmd, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      maxBuffer: 10 * 1024 * 1024,
    });
  };

  const tempBase = join(tmpdir(), "almirant-branch-");
  const tempDir = await mkdtemp(tempBase);
  const cloneDir = join(tempDir, "repo");

  try {
    const authenticatedUrl = repoUrl.replace(
      /^https:\/\//,
      `https://x-access-token:${githubToken}@`
    );

    // Try to clone the branch directly (handles retry scenario where branch exists)
    let branchExists = false;
    let completedTaskIds: string[] = [];
    try {
      // Use depth=100 on retry so we can parse commit history for completed task IDs
      await run("git", [
        "clone", "--depth=100", "--branch", branchName,
        authenticatedUrl, cloneDir,
      ]);
      branchExists = true;

      // Parse commit messages for task IDs already completed on this branch
      // Convention: commit messages contain the task ID in parens, e.g. feat(A-T-123): ...
      try {
        const { stdout: logOutput } = await run("git", [
          "log", "--oneline", "--format=%s",
        ], { cwd: cloneDir });
        const taskIdPattern = /\(([A-Z]+-T-\d+)\)/g;
        const found = new Set<string>();
        for (const line of logOutput.split("\n")) {
          let match: RegExpExecArray | null;
          while ((match = taskIdPattern.exec(line)) !== null) {
            found.add(match[1]);
          }
        }
        completedTaskIds = [...found];
        eventLogger.info("pr", "pr.branch_exists", "Branch already exists, reusing", {
          branchName,
          completedTaskIds,
        });
      } catch {
        eventLogger.info("pr", "pr.branch_exists", "Branch already exists, reusing (could not parse commits)", { branchName });
      }
    } catch {
      // Branch doesn't exist — clone base branch and create it
      await run("git", [
        "clone", "--depth=1", "--branch", baseBranch,
        authenticatedUrl, cloneDir,
      ]);
    }

    if (!branchExists) {
      // Create the new branch from baseBranch
      await run("git", ["checkout", "-b", branchName], { cwd: cloneDir });

      // Create an empty initial commit
      await run("git", [
        "-c", `user.name=${GITHUB_BOT_NAME}`,
        "-c", `user.email=${GITHUB_BOT_EMAIL}`,
        "commit", "--allow-empty",
        "-m", `chore: initialize branch for ${prIdentity.displayRef}\n\n${prIdentity.title}`,
      ], { cwd: cloneDir });

      // Push the new branch
      await run("git", ["push", "origin", branchName], { cwd: cloneDir });

      eventLogger.info("pr", "pr.branch_created", "Branch created and pushed", { branchName });
    }

    // Create draft PR via backend API
    let prUrl: string | undefined;
    let prNumber: number | undefined;
    let prCreatedByThisJob = false;

    try {
      const prBody = [
        "> Draft PR created automatically by Almirant Runner",
        "",
        "## Context",
        ...prIdentity.contextLines,
        "",
        "_This PR will be updated as the agent works._",
      ].join("\n");

      const apiBaseUrl = config.apiBaseUrl;
      const apiKey = config.apiKey;

      const prApiUrl = apiBaseUrl
        ? `${apiBaseUrl.replace(/\/+$/, "")}/api/github/pull-requests`
        : undefined;

      if (prApiUrl && apiKey) {
        const prRes = await fetch(prApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            repoFullName,
            head: branchName,
            base: baseBranch,
            title: prIdentity.prTitle,
            body: prBody,
            isDraft: true,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        const prText = await prRes.text().catch(() => "");
        let prPayload: Record<string, unknown> | null = null;
        try {
          prPayload = JSON.parse(prText) as Record<string, unknown>;
        } catch {
          prPayload = null;
        }

        const prData = (prPayload as { data?: Record<string, unknown> } | null)?.data ?? prPayload;

        if (prData && typeof prData.prUrl === "string" && typeof prData.prNumber === "number") {
          prUrl = prData.prUrl as string;
          prNumber = prData.prNumber as number;
          prCreatedByThisJob = prData.alreadyExists !== true;
          eventLogger.info("pr", "pr.draft_created", "Draft PR created", {
            prUrl,
            prNumber,
            branchName,
            alreadyExists: prData.alreadyExists === true,
          });
        } else if (prData && prData.previousPrCompleted === true) {
          // Previous PR was merged/closed — no active PR to reuse.
          // PR will be created after the agent pushes new commits.
          eventLogger.info("pr", "pr.previous_completed", "Previous PR was merged/closed, will create new PR after push", {
            previousPrUrl: prData.previousPrUrl,
            previousPrNumber: prData.previousPrNumber,
            previousPrMerged: prData.previousPrMerged,
            branchName,
          });
        } else {
          eventLogger.warn("pr", "pr.create_failed", "Draft PR creation returned unexpected response", {
            status: prRes.status,
            body: prText.slice(0, 500),
          });
        }
      } else {
        eventLogger.warn("pr", "pr.skip_no_api", "Cannot create PR: no API base URL or key available");
      }
    } catch (error) {
      // PR creation failure is non-fatal
      eventLogger.warn("pr", "pr.create_error", "Draft PR creation failed (non-fatal)", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    // Update job status with branch and PR info
    try {
      await deps.workerClient.updateJobStatus(job.id, {
        status: "running",
        workerId: config.workerId,
        branchName,
        prUrl,
        prNumber,
      });
    } catch {
      // Non-fatal: job status update failure doesn't block execution
    }

    return { branchName, baseBranch, prUrl, prNumber, completedTaskIds, prCreatedByThisJob };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// updatePrSummary / markPrReadyForReview
// ---------------------------------------------------------------------------

export type UpdatePrSummaryParams = {
  repoUrl: string;
  prNumber: number;
  eventLogger: RunnerJobEventLogger;
  summary: string;
};

/**
 * Update the PR body with the runner summary without changing draft state.
 *
 * This intentionally stays separate from markPrReadyForReview: a failed or
 * incomplete runner job can still leave useful audit information in the PR
 * while remaining draft.
 */
export async function updatePrSummary(
  config: PrApiConfig,
  params: UpdatePrSummaryParams,
): Promise<void> {
  const { repoUrl, prNumber, eventLogger, summary } = params;

  if (!summary.trim()) return;

  const repoFullName = extractRepoFullName(repoUrl);
  if (!repoFullName) return;

  const apiBaseUrl = config.apiBaseUrl;
  const apiKey = config.apiKey;

  if (!apiBaseUrl || !apiKey) {
    eventLogger.warn("pr", "pr.summary_skip", "Cannot update PR summary: no API base URL or key available");
    return;
  }

  const patchUrl = `${apiBaseUrl.replace(/\/+$/, "")}/api/github/pull-requests/${prNumber}`;
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      repoFullName,
      body: summary,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  eventLogger.info("pr", "pr.summary_updated", "PR summary updated", { prNumber });
}

export type MarkPrReadyForReviewParams = {
  repoUrl: string;
  prNumber: number;
  eventLogger: RunnerJobEventLogger;
  /** Optional summary to set as the PR body (replaces the draft placeholder). */
  summary?: string;
};

/**
 * Mark a draft PR as ready for review via the backend API.
 */
export async function markPrReadyForReview(
  config: PrApiConfig,
  params: MarkPrReadyForReviewParams,
): Promise<void> {
  const { repoUrl, prNumber, eventLogger, summary } = params;

  const repoFullName = extractRepoFullName(repoUrl);
  if (!repoFullName) return;

  const apiBaseUrl = config.apiBaseUrl;
  const apiKey = config.apiKey;

  if (!apiBaseUrl || !apiKey) {
    eventLogger.warn("pr", "pr.undraft_skip", "Cannot undraft PR: no API base URL or key available");
    return;
  }

  const patchBody: Record<string, unknown> = {
    repoFullName,
    draft: false,
  };

  if (summary && summary.trim().length > 0) {
    patchBody.body = summary;
  }

  const patchUrl = `${apiBaseUrl.replace(/\/+$/, "")}/api/github/pull-requests/${prNumber}`;
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(patchBody),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  eventLogger.info("pr", "pr.marked_ready", "PR marked as ready for review", { prNumber });
}

// ---------------------------------------------------------------------------
// closeDraftPr
// ---------------------------------------------------------------------------

export type CloseDraftPrParams = {
  repoUrl: string;
  prNumber: number;
  eventLogger: RunnerJobEventLogger;
};

/**
 * Close an orphaned draft PR via the backend API.
 *
 * Used when a job fails without pushing any changes, leaving the draft PR
 * empty on GitHub. The branch is preserved for retry support.
 */
export async function closeDraftPr(
  config: PrApiConfig,
  params: CloseDraftPrParams,
): Promise<void> {
  const { repoUrl, prNumber, eventLogger } = params;

  const repoFullName = extractRepoFullName(repoUrl);
  if (!repoFullName) return;

  const apiBaseUrl = config.apiBaseUrl;
  const apiKey = config.apiKey;

  if (!apiBaseUrl || !apiKey) {
    eventLogger.warn("pr", "pr.close_skip", "Cannot close draft PR: no API base URL or key available");
    return;
  }

  const patchUrl = `${apiBaseUrl.replace(/\/+$/, "")}/api/github/pull-requests/${prNumber}`;
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ repoFullName, state: "closed" }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  eventLogger.info("pr", "pr.draft_closed", "Draft PR closed", { prNumber });
}

// ---------------------------------------------------------------------------
// createLatePr
// ---------------------------------------------------------------------------

export type CreateLatePrParams = {
  repoUrl: string;
  branchName: string;
  baseBranch: string;
  workItem: WorkItemDetails | null;
  eventLogger: RunnerJobEventLogger;
};

/**
 * Create a PR after the agent has finished and pushed commits.
 * Used when the initial PR creation failed because the previous PR was merged/closed.
 */
export async function createLatePr(
  config: PrApiConfig,
  params: CreateLatePrParams,
): Promise<{ prUrl: string; prNumber: number } | null> {
  const { repoUrl, branchName, baseBranch, workItem, eventLogger } = params;

  const repoFullName = extractRepoFullName(repoUrl);
  if (!repoFullName) return null;

  const apiBaseUrl = config.apiBaseUrl;
  const apiKey = config.apiKey;
  if (!apiBaseUrl || !apiKey) {
    eventLogger.warn("pr", "pr.late_skip_no_api", "Cannot create late PR: no API base URL or key");
    return null;
  }

  const latePrIdentity = deriveRunnerPrIdentity(
    { id: branchName, config: null } as ClaimedJob,
    workItem,
  );
  const lateBranchRef = branchName.split("/").at(-1) ?? branchName;
  const prTitle = workItem ? latePrIdentity.prTitle : `[${buildJobRef(lateBranchRef)}] ${lateBranchRef}`;
  const contextLines = workItem
    ? [...latePrIdentity.contextLines.filter((line) => !line.startsWith("- Job:")), `- Branch: ${branchName}`]
    : [`- Branch: ${branchName}`];

  const prBody = [
    "> PR created by Almirant Runner after push",
    "",
    "## Context",
    ...contextLines,
  ].join("\n");

  const prApiUrl = `${apiBaseUrl.replace(/\/+$/, "")}/api/github/pull-requests`;
  const prRes = await fetch(prApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      repoFullName,
      head: branchName,
      base: baseBranch,
      title: prTitle,
      body: prBody,
      isDraft: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const prText = await prRes.text().catch(() => "");
  let prPayload: Record<string, unknown> | null = null;
  try {
    prPayload = JSON.parse(prText) as Record<string, unknown>;
  } catch {
    prPayload = null;
  }

  const prData = (prPayload as { data?: Record<string, unknown> } | null)?.data ?? prPayload;

  if (prData && typeof prData.prUrl === "string" && typeof prData.prNumber === "number") {
    eventLogger.info("pr", "pr.late_created", "PR created after push (previous was merged/closed)", {
      prUrl: prData.prUrl,
      prNumber: prData.prNumber,
      branchName,
    });
    return { prUrl: prData.prUrl as string, prNumber: prData.prNumber as number };
  }

  eventLogger.warn("pr", "pr.late_create_unexpected", "Late PR creation returned unexpected response", {
    status: prRes.status,
    body: prText.slice(0, 500),
  });
  return null;
}

// ---------------------------------------------------------------------------
// collectAndPushChanges
// ---------------------------------------------------------------------------

export type CollectAndPushChangesParams = {
  containerId: string;
  job: ClaimedJob;
  repositoryId?: string;
  repoUrl: string;
  branch: string;
  eventLogger: RunnerJobEventLogger;
};

/**
 * Collect changes from the container and push them using runner credentials.
 *
 * Delegates to change-collector for extraction and runner-push for pushing.
 * Acts as a safety net — the agent normally pushes from inside the container.
 */
export async function collectAndPushChanges(
  deps: PrManagerDeps,
  params: CollectAndPushChangesParams,
): Promise<void> {
  const { containerId, job, repositoryId, repoUrl, branch, eventLogger } = params;

  // 1. Collect changes from the container (diff + archive)
  console.log(`[job:${job.id}] Collecting changes from container ${containerId} at /workspace/repo`);
  eventLogger.info("push", "push.collect_start", "Collecting changes from container");
  let collected: Awaited<ReturnType<typeof collectChanges>>;
  const collectTimeoutMessage = `Timed out collecting changes after ${Math.round(COLLECT_CHANGES_TIMEOUT_MS / 1000)}s`;
  try {
    collected = await withTimeout(
      collectChanges(deps.containerManager, containerId, "/workspace/repo", COLLECT_CHANGES_TIMEOUT_MS),
      COLLECT_CHANGES_TIMEOUT_MS,
      collectTimeoutMessage,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const timedOut = msg === collectTimeoutMessage || msg.includes("Timed out extracting archive");
    console.error(`[job:${job.id}] Failed to collect changes: ${msg}`);
    eventLogger.warn("push", timedOut ? "push.collect_timeout" : "push.collect_failed", timedOut ? "Timed out collecting changes from container" : "Failed to collect changes from container", {
      errorMessage: msg,
      timeoutMs: timedOut ? COLLECT_CHANGES_TIMEOUT_MS : undefined,
    });
    throw new Error(`Archive collection failed: ${msg}`);
  }
  console.log(`[job:${job.id}] Collected: modifiedFiles=${collected.modifiedFiles.length} archiveMode=${collected.archiveMode} archiveSize=${collected.archiveBuffer.length} diffLines=${collected.fullDiff.split("\n").length}`);
  eventLogger.info("push", "push.collected", "Changes collected from container", {
    modifiedFiles: collected.modifiedFiles.length,
    archiveMode: collected.archiveMode,
    archivePaths: collected.archivePaths.length,
    archiveSizeBytes: collected.archiveBuffer.length,
    diffLines: collected.fullDiff.split("\n").length,
  });

  // 2. Get a fresh GitHub token for push
  if (!repositoryId) {
    const msg = "Cannot push — no repositoryId configured";
    console.error(`[job:${job.id}] ${msg}`);
    eventLogger.warn("push", "push.no_repository_id", msg);
    await cleanupCollectedChanges(collected);
    throw new Error(msg);
  }

  let githubToken: string;
  try {
    const tokenResult = await deps.workerClient.getGithubToken(repositoryId);
    githubToken = tokenResult.token;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[job:${job.id}] Failed to get GitHub token: ${msg}`);
    eventLogger.warn("push", "push.token_failed", "Failed to get GitHub token for push", {
      errorMessage: msg,
    });
    await cleanupCollectedChanges(collected);
    throw new Error(`GitHub token retrieval failed: ${msg}`);
  }

  // 3. Push changes from the runner side
  eventLogger.info("push", "push.pushing", "Pushing changes to remote", { branch });
  try {
    const result = await pushChanges({
      collected,
      repoUrl,
      branch,
      gitToken: githubToken,
      jobId: job.id,
    });

    if (result.success) {
      if (result.modifiedFileCount === 0) {
        eventLogger.info("push", "push.no_diff", "No effective diff after overlay — skipping push");
      } else {
        eventLogger.info("push", "push.success", "Changes pushed successfully", {
          branch,
          modifiedFiles: result.modifiedFileCount,
        });
      }
    } else {
      throw new Error(result.errorMessage ?? "Push failed");
    }
  } finally {
    await cleanupCollectedChanges(collected);
  }
}
