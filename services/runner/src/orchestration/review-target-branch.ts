import type { WorkItemDetails } from "@almirant/remote-agent";

type PullRequestMetadata = {
  branch?: string;
  state?: string;
  merged?: boolean;
  number?: number;
  url?: string;
};

export type ReviewTargetBranchResolution = {
  branch: string;
  source: "base" | "pull-request";
  reason:
    | "pull_request_open_or_unmerged"
    | "pull_request_merged"
    | "pull_request_missing"
    | "pull_request_branch_missing"
    | "pull_request_branch_unsafe";
  pullRequest?: PullRequestMetadata;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readPullRequestMetadata = (
  workItem: WorkItemDetails | null | undefined,
): PullRequestMetadata | undefined => {
  const metadata = asRecord(workItem?.metadata);
  const pullRequest = asRecord(metadata?.pullRequest);
  if (!pullRequest) return undefined;

  return {
    branch: asString(pullRequest.branch),
    state: asString(pullRequest.state)?.toLowerCase(),
    merged: pullRequest.merged === true,
    number: asNumber(pullRequest.number),
    url: asString(pullRequest.url),
  };
};

const isSafeGitBranchName = (branch: string): boolean => {
  if (branch.startsWith("-")) return false;
  if (branch.includes("..")) return false;
  if (branch.includes("@{")) return false;
  if (branch.endsWith(".")) return false;

  return /^[A-Za-z0-9._/-]+$/.test(branch);
};

export const shouldUseWorkItemReviewBranch = (params: {
  jobType?: string | null;
  skillName?: string | null;
  source?: unknown;
  workspaceIntent?: unknown;
}): boolean => {
  const skillName = params.skillName?.toLowerCase();

  return (
    params.jobType === "review" ||
    skillName === "review" ||
    skillName === "dod-review" ||
    params.source === "dod-review" ||
    (params.workspaceIntent === "read-only" &&
      skillName !== undefined &&
      skillName.includes("review"))
  );
};

export const resolveReviewTargetBranch = (params: {
  workItem: WorkItemDetails | null | undefined;
  fallbackBranch?: string | null;
}): ReviewTargetBranchResolution => {
  const fallbackBranch = params.fallbackBranch?.trim() || "main";
  const pullRequest = readPullRequestMetadata(params.workItem);

  if (!pullRequest) {
    return {
      branch: fallbackBranch,
      source: "base",
      reason: "pull_request_missing",
    };
  }

  const isMerged = pullRequest.merged === true || pullRequest.state === "merged";
  if (isMerged) {
    return {
      branch: fallbackBranch,
      source: "base",
      reason: "pull_request_merged",
      pullRequest,
    };
  }

  if (!pullRequest.branch) {
    return {
      branch: fallbackBranch,
      source: "base",
      reason: "pull_request_branch_missing",
      pullRequest,
    };
  }

  if (!isSafeGitBranchName(pullRequest.branch)) {
    return {
      branch: fallbackBranch,
      source: "base",
      reason: "pull_request_branch_unsafe",
      pullRequest,
    };
  }

  return {
    branch: pullRequest.branch,
    source: "pull-request",
    reason: "pull_request_open_or_unmerged",
    pullRequest,
  };
};
