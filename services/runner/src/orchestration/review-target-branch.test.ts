import { describe, expect, it } from "bun:test";
import type { WorkItemDetails } from "@almirant/remote-agent";
import {
  resolveReviewTargetBranch,
  shouldUseWorkItemReviewBranch,
} from "./review-target-branch";

const createWorkItem = (
  pullRequest?: Record<string, unknown>,
): WorkItemDetails =>
  ({
    id: "work-item-1",
    taskId: "F-E-23",
    title: "AI configure chat - backend orchestrator",
    description: null,
    boardId: "board-1",
    boardColumnId: "column-1",
    projectId: "project-1",
    parentId: null,
    type: "task",
    priority: "medium",
    metadata: pullRequest ? { pullRequest } : {},
    estimatedHours: null,
  }) as WorkItemDetails;

describe("resolveReviewTargetBranch", () => {
  it("uses the work item pull request branch while the PR is open", () => {
    const resolution = resolveReviewTargetBranch({
      workItem: createWorkItem({
        branch: "almirant/F-E-23",
        state: "open",
        number: 26,
        url: "https://github.com/example/repo/pull/26",
      }),
      fallbackBranch: "main",
    });

    expect(resolution).toMatchObject({
      branch: "almirant/F-E-23",
      source: "pull-request",
      reason: "pull_request_open_or_unmerged",
      pullRequest: {
        branch: "almirant/F-E-23",
        state: "open",
        number: 26,
      },
    });
  });

  it("uses the base branch when the pull request is already merged", () => {
    const resolution = resolveReviewTargetBranch({
      workItem: createWorkItem({
        branch: "almirant/F-E-23",
        state: "merged",
        number: 26,
      }),
      fallbackBranch: "main",
    });

    expect(resolution).toMatchObject({
      branch: "main",
      source: "base",
      reason: "pull_request_merged",
    });
  });

  it("falls back to the base branch when PR metadata has no branch", () => {
    const resolution = resolveReviewTargetBranch({
      workItem: createWorkItem({
        state: "open",
        number: 26,
      }),
      fallbackBranch: "develop",
    });

    expect(resolution).toMatchObject({
      branch: "develop",
      source: "base",
      reason: "pull_request_branch_missing",
    });
  });

  it("rejects unsafe branch names instead of injecting them into git", () => {
    const resolution = resolveReviewTargetBranch({
      workItem: createWorkItem({
        branch: "-c core.sshCommand=malicious",
        state: "open",
      }),
      fallbackBranch: "main",
    });

    expect(resolution).toMatchObject({
      branch: "main",
      source: "base",
      reason: "pull_request_branch_unsafe",
    });
  });
});

describe("shouldUseWorkItemReviewBranch", () => {
  it("enables branch selection for review and dod-review jobs", () => {
    expect(
      shouldUseWorkItemReviewBranch({
        jobType: "review",
        skillName: "dod-review",
        source: "dod-review",
        workspaceIntent: "read-only",
      }),
    ).toBe(true);
  });

  it("does not affect implementation jobs", () => {
    expect(
      shouldUseWorkItemReviewBranch({
        jobType: "implementation",
        skillName: "runner-implement",
      }),
    ).toBe(false);
  });
});
