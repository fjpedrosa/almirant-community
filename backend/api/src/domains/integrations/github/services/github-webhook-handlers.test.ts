import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { createDatabaseMocks, createLoggerMock, createWsMock, restoreRealModules } from "../../../../test/mocks";

type MockBugFixAttempt = {
  id: string;
  feedbackItemId: string;
  clusterId?: string | null;
  status: string;
  fixPrUrl?: string;
  metadata?: Record<string, unknown> | null;
};

type MockFeedbackItem = {
  id: string;
  status: string;
};

type MockCluster = {
  id: string;
  status: string;
};

type ClusterTransitionCall = {
  clusterId: string;
  toStatus: string;
  event: Record<string, unknown>;
};

const state = {
  notificationCalls: [] as Array<Record<string, unknown>>,
  authorLookupCalls: [] as Array<{ workspaceId: string; githubLogin: string }>,
  authorUserId: "user-pr-author" as string | null,
  bugFixAttemptsByPrUrl: [] as Array<MockBugFixAttempt>,
  latestAttemptByFeedbackId: {} as Record<string, MockBugFixAttempt | null>,
  feedbackItemsById: {} as Record<string, MockFeedbackItem | null>,
  clustersById: {} as Record<string, MockCluster | null>,
  attemptUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  feedbackUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  clusterTransitions: [] as Array<ClusterTransitionCall>,
  releaseWorkItemRows: [] as Array<{
    id: string;
    taskId: string | null;
    boardId: string | null;
    boardColumnId: string | null;
    metadata?: Record<string, unknown> | null;
    type?: string;
  }>,
  releaseDescendantLeafRows: [] as Array<{
    sourceWorkItemId: string;
    id: string;
    taskId: string | null;
    boardId: string | null;
    boardColumnId: string | null;
    metadata?: Record<string, unknown> | null;
  }>,
  movedWorkItems: [] as Array<{ id: string; columnId: string; position: number }>,
  moveFailures: new Set<string>(),
  workItemUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  batchStatusUpdates: [] as Array<{
    id: string;
    status: string;
    extra?: Record<string, unknown>;
  }>,
};

const hasIncompleteChecklistMock = (
  metadata: Record<string, unknown> | null | undefined
) => {
  const raw = metadata?.deployChecklist ?? metadata?.userActions;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { hasIncomplete: false, uncheckedCount: 0, uncheckedItems: [] };
  }

  const uncheckedItems = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (/^[-*]\s*\[(?:x|X)\]\s+/.test(line)) return false;
      return /^[-*]\s+/.test(line) || /^[-*]\s*\[\s\]\s+/.test(line);
    });

  return {
    hasIncomplete: uncheckedItems.length > 0,
    uncheckedCount: uncheckedItems.length,
    uncheckedItems,
  };
};

const createReleaseDbQueryBuilder = (selection?: Record<string, unknown>) => {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => {
      if (selection && "sourceWorkItemId" in selection) {
        return Promise.resolve(state.releaseDescendantLeafRows);
      }

      return Promise.resolve(state.releaseWorkItemRows);
    },
  };

  return builder;
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    upsertCommit: async () => null,
    upsertPullRequest: async () => null,
    upsertWorkflowRun: async () => null,
    createGithubEvent: async () => null,
    upsertInstallation: async () => null,
    deleteInstallationByGithubId: async () => false,
    getInstallationByGithubId: async () => null,
    getRepoIdByGithubFullName: async () => "repo-1",
    getWorkspaceIdByRepoId: async () => "org-1",
    getProjectIdByRepoId: async () => "project-1",
    updatePullRequestReviewStatus: async () => null,
    updatePullRequestCiStatus: async () => [],
    getWorkItemsByTaskIds: async () => [],
    getBugFixAttemptsByFixPrUrl: async (fixPrUrl: string) =>
      state.bugFixAttemptsByPrUrl.filter((attempt) => attempt.fixPrUrl === fixPrUrl),
    getLatestBugFixAttemptByFeedbackItemId: async (feedbackItemId: string) =>
      state.latestAttemptByFeedbackId[feedbackItemId] ?? null,
    getFeedbackItemById: async (feedbackItemId: string) =>
      state.feedbackItemsById[feedbackItemId] ?? null,
    updateBugFixAttempt: async (id: string, data: Record<string, unknown>) => {
      state.attemptUpdates.push({ id, data });
      const current =
        state.bugFixAttemptsByPrUrl.find((attempt) => attempt.id === id) ??
        Object.values(state.latestAttemptByFeedbackId).find(
          (attempt) => attempt?.id === id
        ) ??
        null;
      return current ? { ...current, ...data } : null;
    },
    updateFeedbackItem: async (id: string, data: Record<string, unknown>) => {
      state.feedbackUpdates.push({ id, data });
      return { id, ...data };
    },
    getFeedbackClusterById: async (id: string) =>
      state.clustersById[id] ?? null,
    transitionCluster: async (
      clusterId: string,
      toStatus: string,
      event: Record<string, unknown>
    ) => {
      state.clusterTransitions.push({ clusterId, toStatus, event });
      const current = state.clustersById[clusterId];
      if (!current) {
        return { success: false, reason: "cluster_not_found" as const };
      }
      const from = current.status;
      // Mirror the real helper's idempotency: same status → no-op success.
      if (from === toStatus) {
        return { success: true, from, to: toStatus, cluster: current };
      }
      state.clustersById[clusterId] = { ...current, status: toStatus };
      return {
        success: true,
        from,
        to: toStatus,
        cluster: state.clustersById[clusterId]!,
      };
    },
    updateWorkItem: async (
      id: string,
      dataOrId: string | Record<string, unknown>,
      maybeData?: Record<string, unknown>
    ) => {
      const workItemId = typeof dataOrId === "string" ? dataOrId : id;
      const data = typeof dataOrId === "string" ? maybeData ?? {} : dataOrId;
      state.workItemUpdates.push({ id: workItemId, data });
      return { id: workItemId, ...data };
    },
    linkCommitToWorkItem: async () => null,
    getMembersByWorkspaceId: async () => [
      { userId: "user-pr-author" },
      { userId: "user-other-member" },
    ],
    getWorkspaceMemberUserIdByGithubLogin: async (
      workspaceId: string,
      githubLogin: string
    ) => {
      state.authorLookupCalls.push({ workspaceId, githubLogin });
      return state.authorUserId;
    },
    updateBatchStatus: async (
      id: string,
      status: string,
      extra?: Record<string, unknown>
    ) => {
      state.batchStatusUpdates.push({ id, status, extra });
      return { id, status, ...(extra ?? {}) };
    },
    updateReleasePullRequestStateForBatch: async () => 0,
    hasIncompleteChecklist: hasIncompleteChecklistMock,
    getBoardColumns: async () => [
      {
        id: "validating-col",
        boardId: "board-1",
        name: "Validating",
        role: "validating",
        order: 6,
        isDone: false,
        color: null,
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
        updatedAt: new Date("2026-05-03T00:00:00.000Z"),
      },
      {
        id: "done-col",
        boardId: "board-1",
        name: "Done",
        role: "done",
        order: 9,
        isDone: true,
        color: null,
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
        updatedAt: new Date("2026-05-03T00:00:00.000Z"),
      },
    ],
    moveWorkItem: async (
      id: string,
      columnId: string,
      position: number,
    ) => {
      if (state.moveFailures.has(id)) {
        throw new Error(`move failed for ${id}`);
      }
      state.movedWorkItems.push({ id, columnId, position });
      return true;
    },
    db: {
      select: (selection?: Record<string, unknown>) =>
        createReleaseDbQueryBuilder(selection),
    },
  })
);

mock.module("@almirant/config", () => createLoggerMock());

mock.module("./github-docs-sync-handler", () => ({
  handleDocSync: async () => {},
}));

mock.module("../../../../shared/ws/ws-connection-manager", () => createWsMock());

mock.module("../../../../shared/services/notification-service", () => ({
  sendNotification: async () => null,
  sendNotificationBatch: async () => [],
  sendMentionNotification: async () => null,
  upsertNotificationBySource: async (payload: Record<string, unknown>) => {
    state.notificationCalls.push(payload);
    return { id: "notif-1" };
  },
}));

describe("github-webhook-handlers", () => {
  beforeEach(() => {
    state.notificationCalls = [];
    state.authorLookupCalls = [];
    state.authorUserId = "user-pr-author";
    state.bugFixAttemptsByPrUrl = [];
    state.latestAttemptByFeedbackId = {};
    state.feedbackItemsById = {};
    state.clustersById = {};
    state.attemptUpdates = [];
    state.feedbackUpdates = [];
    state.clusterTransitions = [];
    state.releaseWorkItemRows = [];
    state.releaseDescendantLeafRows = [];
    state.movedWorkItems = [];
    state.moveFailures = new Set<string>();
    state.workItemUpdates = [];
    state.batchStatusUpdates = [];
  });

  it("notifies only the PR author for pull_request_review events", async () => {
    const { handlePullRequestReviewEvent } = await import("./github-webhook-handlers");

    await handlePullRequestReviewEvent(
      {
        repository: { full_name: "owner/repo" },
        review: {
          state: "changes_requested",
          html_url: "https://github.com/owner/repo/pull/17#pullrequestreview-1",
          user: { login: "reviewer-login", avatar_url: "https://example.com/avatar.png" },
        },
        pull_request: {
          number: 17,
          title: "Improve notifications",
          html_url: "https://github.com/owner/repo/pull/17",
          user: { login: "author-login" },
        },
      },
      "delivery-1"
    );

    // notifyPullRequestReview is fire-and-forget inside handler; allow queued microtasks to complete.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.authorLookupCalls).toEqual([
      { workspaceId: "org-1", githubLogin: "author-login" },
    ]);
    expect(state.notificationCalls).toHaveLength(1);
    expect(state.notificationCalls[0]?.recipientUserId).toBe("user-pr-author");
  });

  it("skips notification when PR author cannot be resolved", async () => {
    state.authorUserId = null;
    const { handlePullRequestReviewEvent } = await import("./github-webhook-handlers");

    await handlePullRequestReviewEvent(
      {
        repository: { full_name: "owner/repo" },
        review: {
          state: "approved",
          user: { login: "reviewer-login" },
        },
        pull_request: {
          number: 18,
          title: "Another PR",
          user: { login: "missing-author" },
        },
      },
      "delivery-2"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.notificationCalls).toHaveLength(0);
  });

  it("moves related feedback bugs to pending_validation when their PR is merged", async () => {
    state.bugFixAttemptsByPrUrl = [
      {
        id: "attempt-1",
        feedbackItemId: "feedback-1",
        status: "implementing",
        fixPrUrl: "https://github.com/owner/repo/pull/42",
        metadata: {
          workflowGuards: {
            errorSave: {
              performedAt: "2026-04-12T10:00:00.000Z",
            },
          },
        },
      },
    ];
    state.latestAttemptByFeedbackId["feedback-1"] = state.bugFixAttemptsByPrUrl[0]!;
    state.feedbackItemsById["feedback-1"] = {
      id: "feedback-1",
      status: "implementing",
    };

    const { handlePullRequestEvent } = await import("./github-webhook-handlers");

    await handlePullRequestEvent(
      {
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 42,
          title: "fix(auto): restore planning spinner",
          html_url: "https://github.com/owner/repo/pull/42",
          merged: true,
          state: "closed",
          draft: false,
          body: "",
          user: { login: "author-login", avatar_url: null },
          head: { ref: "fix/auto-feedback-1-attempt-1" },
          base: { ref: "main" },
          labels: [],
          additions: 10,
          deletions: 2,
          merged_at: "2026-04-12T10:10:00.000Z",
          closed_at: "2026-04-12T10:10:00.000Z",
        },
        sender: { login: "merger-login", avatar_url: null },
      },
      "delivery-merge-1"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.attemptUpdates).toContainEqual({
      id: "attempt-1",
      data: { status: "merged" },
    });
    expect(state.feedbackUpdates).toContainEqual({
      id: "feedback-1",
      data: { status: "pending_validation" },
    });
  });

  it("does not move the feedback item when the merged PR belongs to a stale attempt", async () => {
    state.bugFixAttemptsByPrUrl = [
      {
        id: "attempt-1",
        feedbackItemId: "feedback-1",
        status: "implementing",
        fixPrUrl: "https://github.com/owner/repo/pull/43",
        metadata: {
          workflowGuards: {
            errorSave: {
              performedAt: "2026-04-12T10:00:00.000Z",
            },
          },
        },
      },
    ];
    state.latestAttemptByFeedbackId["feedback-1"] = {
      id: "attempt-2",
      feedbackItemId: "feedback-1",
      status: "implementing",
      metadata: {
        workflowGuards: {
          errorSave: {
            performedAt: "2026-04-12T10:05:00.000Z",
          },
        },
      },
    };
    state.feedbackItemsById["feedback-1"] = {
      id: "feedback-1",
      status: "implementing",
    };

    const { handlePullRequestEvent } = await import("./github-webhook-handlers");

    await handlePullRequestEvent(
      {
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 43,
          title: "fix(auto): stale attempt",
          html_url: "https://github.com/owner/repo/pull/43",
          merged: true,
          state: "closed",
          draft: false,
          body: "",
          user: { login: "author-login", avatar_url: null },
          head: { ref: "fix/auto-feedback-1-attempt-1" },
          base: { ref: "main" },
          labels: [],
          additions: 3,
          deletions: 1,
          merged_at: "2026-04-12T10:10:00.000Z",
          closed_at: "2026-04-12T10:10:00.000Z",
        },
        sender: { login: "merger-login", avatar_url: null },
      },
      "delivery-merge-2"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.attemptUpdates).toContainEqual({
      id: "attempt-1",
      data: { status: "merged" },
    });
    expect(state.feedbackUpdates).toHaveLength(0);
  });

  it("transitions the cluster to resolved when the bug-fix PR is merged (A-1826)", async () => {
    state.bugFixAttemptsByPrUrl = [
      {
        id: "attempt-resolved",
        feedbackItemId: "feedback-resolved",
        clusterId: "cluster-resolved",
        status: "implementing",
        fixPrUrl: "https://github.com/owner/repo/pull/50",
        metadata: {
          workflowGuards: {
            errorSave: { performedAt: "2026-04-12T10:00:00.000Z" },
          },
        },
      },
    ];
    state.latestAttemptByFeedbackId["feedback-resolved"] =
      state.bugFixAttemptsByPrUrl[0]!;
    state.feedbackItemsById["feedback-resolved"] = {
      id: "feedback-resolved",
      status: "implementing",
    };
    state.clustersById["cluster-resolved"] = {
      id: "cluster-resolved",
      status: "fix_ready",
    };

    const { handlePullRequestEvent } = await import("./github-webhook-handlers");

    await handlePullRequestEvent(
      {
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 50,
          title: "fix(auto): resolved cluster",
          html_url: "https://github.com/owner/repo/pull/50",
          merged: true,
          state: "closed",
          draft: false,
          body: "",
          user: { login: "author-login", avatar_url: null },
          head: { ref: "fix/auto-feedback-resolved-attempt-1" },
          base: { ref: "main" },
          labels: [],
          additions: 4,
          deletions: 1,
          merged_at: "2026-04-12T10:10:00.000Z",
          closed_at: "2026-04-12T10:10:00.000Z",
        },
        sender: { login: "merger-login", avatar_url: null },
      },
      "delivery-resolved-1"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.clusterTransitions).toHaveLength(1);
    expect(state.clusterTransitions[0]).toMatchObject({
      clusterId: "cluster-resolved",
      toStatus: "resolved",
      event: {
        triggeredByKind: "webhook",
        reason: "pr_merged",
        triggeredByAttemptId: "attempt-resolved",
      },
    });
  });

  it("does not re-resolve a cluster already in resolved status (idempotency)", async () => {
    state.bugFixAttemptsByPrUrl = [
      {
        id: "attempt-already-resolved",
        feedbackItemId: "feedback-already-resolved",
        clusterId: "cluster-already-resolved",
        status: "merged",
        fixPrUrl: "https://github.com/owner/repo/pull/51",
        metadata: {
          workflowGuards: {
            errorSave: { performedAt: "2026-04-12T10:00:00.000Z" },
          },
        },
      },
    ];
    state.latestAttemptByFeedbackId["feedback-already-resolved"] =
      state.bugFixAttemptsByPrUrl[0]!;
    state.feedbackItemsById["feedback-already-resolved"] = {
      id: "feedback-already-resolved",
      status: "verified",
    };
    state.clustersById["cluster-already-resolved"] = {
      id: "cluster-already-resolved",
      status: "resolved",
    };

    const { handlePullRequestEvent } = await import("./github-webhook-handlers");

    await handlePullRequestEvent(
      {
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 51,
          title: "fix(auto): redelivered merge",
          html_url: "https://github.com/owner/repo/pull/51",
          merged: true,
          state: "closed",
          draft: false,
          body: "",
          user: { login: "author-login", avatar_url: null },
          head: { ref: "fix/auto-feedback-already-resolved-attempt-1" },
          base: { ref: "main" },
          labels: [],
          additions: 1,
          deletions: 0,
          merged_at: "2026-04-12T10:10:00.000Z",
          closed_at: "2026-04-12T10:10:00.000Z",
        },
        sender: { login: "merger-login", avatar_url: null },
      },
      "delivery-resolved-2"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    // The cluster is no longer in fix_ready, so no transition is attempted.
    expect(state.clusterTransitions).toHaveLength(0);
  });

  it("fails the attempt and reopens the cluster when PR is closed without merge (A-1826)", async () => {
    state.bugFixAttemptsByPrUrl = [
      {
        id: "attempt-closed",
        feedbackItemId: "feedback-closed",
        clusterId: "cluster-closed",
        status: "implementing",
        fixPrUrl: "https://github.com/owner/repo/pull/60",
      },
    ];
    state.clustersById["cluster-closed"] = {
      id: "cluster-closed",
      status: "fix_ready",
    };

    const { handlePullRequestEvent } = await import("./github-webhook-handlers");

    await handlePullRequestEvent(
      {
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 60,
          title: "fix(auto): rejected PR",
          html_url: "https://github.com/owner/repo/pull/60",
          merged: false,
          state: "closed",
          draft: false,
          body: "",
          user: { login: "author-login", avatar_url: null },
          head: { ref: "fix/auto-feedback-closed-attempt-1" },
          base: { ref: "main" },
          labels: [],
          additions: 1,
          deletions: 1,
          merged_at: null,
          closed_at: "2026-04-12T10:15:00.000Z",
        },
        sender: { login: "closer-login", avatar_url: null },
      },
      "delivery-closed-1"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.attemptUpdates).toContainEqual({
      id: "attempt-closed",
      data: {
        status: "failed",
        failureReason: "PR #60 closed without merge",
        failureDetectedBy: "webhook",
      },
    });
    expect(state.clusterTransitions).toHaveLength(1);
    expect(state.clusterTransitions[0]).toMatchObject({
      clusterId: "cluster-closed",
      toStatus: "open",
      event: {
        triggeredByKind: "webhook",
        reason: "pr_closed_without_merge",
        triggeredByAttemptId: "attempt-closed",
      },
    });
  });

  it("does not fail an already-terminal attempt when a close webhook is redelivered", async () => {
    state.bugFixAttemptsByPrUrl = [
      {
        id: "attempt-already-failed",
        feedbackItemId: "feedback-already-failed",
        clusterId: "cluster-already-failed",
        status: "failed",
        fixPrUrl: "https://github.com/owner/repo/pull/61",
      },
    ];
    state.clustersById["cluster-already-failed"] = {
      id: "cluster-already-failed",
      status: "open",
    };

    const { handlePullRequestEvent } = await import("./github-webhook-handlers");

    await handlePullRequestEvent(
      {
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 61,
          title: "fix(auto): redelivered close",
          html_url: "https://github.com/owner/repo/pull/61",
          merged: false,
          state: "closed",
          draft: false,
          body: "",
          user: { login: "author-login", avatar_url: null },
          head: { ref: "fix/auto-feedback-already-failed-attempt-1" },
          base: { ref: "main" },
          labels: [],
          additions: 1,
          deletions: 0,
          merged_at: null,
          closed_at: "2026-04-12T10:20:00.000Z",
        },
        sender: { login: "closer-login", avatar_url: null },
      },
      "delivery-closed-2"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    // No attempt update and no cluster transition because the attempt is
    // already in a terminal state.
    expect(state.attemptUpdates).toHaveLength(0);
    expect(state.clusterTransitions).toHaveLength(0);
  });

  it("does not regress feedback already verified when a merge webhook is redelivered", async () => {
    state.bugFixAttemptsByPrUrl = [
      {
        id: "attempt-1",
        feedbackItemId: "feedback-1",
        status: "merged",
        fixPrUrl: "https://github.com/owner/repo/pull/44",
        metadata: {
          workflowGuards: {
            errorSave: {
              performedAt: "2026-04-12T10:00:00.000Z",
            },
          },
        },
      },
    ];
    state.latestAttemptByFeedbackId["feedback-1"] = state.bugFixAttemptsByPrUrl[0]!;
    state.feedbackItemsById["feedback-1"] = {
      id: "feedback-1",
      status: "verified",
    };

    const { handlePullRequestEvent } = await import("./github-webhook-handlers");

    await handlePullRequestEvent(
      {
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 44,
          title: "fix(auto): already verified",
          html_url: "https://github.com/owner/repo/pull/44",
          merged: true,
          state: "closed",
          draft: false,
          body: "",
          user: { login: "author-login", avatar_url: null },
          head: { ref: "fix/auto-feedback-1-attempt-1" },
          base: { ref: "main" },
          labels: [],
          additions: 1,
          deletions: 1,
          merged_at: "2026-04-12T10:10:00.000Z",
          closed_at: "2026-04-12T10:10:00.000Z",
        },
        sender: { login: "merger-login", avatar_url: null },
      },
      "delivery-merge-3"
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.attemptUpdates).toHaveLength(0);
    expect(state.feedbackUpdates).toHaveLength(0);
  });

  it("moves leaf descendants to Done when a release batch item represents a parent block", async () => {
    state.releaseWorkItemRows = [
      {
        id: "feature-1",
        taskId: "O-F-1",
        boardId: "board-1",
        boardColumnId: null,
        type: "feature",
      },
    ];
    state.releaseDescendantLeafRows = [
      {
        sourceWorkItemId: "feature-1",
        id: "child-1",
        taskId: "O-1",
        boardId: "board-1",
        boardColumnId: "validating-col",
      },
      {
        sourceWorkItemId: "feature-1",
        id: "child-2",
        taskId: "O-2",
        boardId: "board-1",
        boardColumnId: "validating-col",
      },
    ];

    const { handleReleasePrMerged } = await import("./github-webhook-handlers");

    await handleReleasePrMerged(
      "org-1",
      {
        id: "batch-1",
        status: "awaiting_release",
        items: [
          {
            id: "batch-item-1",
            batchId: "batch-1",
            workItemId: "feature-1",
            prNumber: 10,
            prUrl: "https://github.com/example-org/example-repo/pull/10",
            branchName: "almirant/O-F-1",
            processingOrder: 0,
            status: "merged",
            failureCategory: null,
            failureReason: null,
            commitShaBefore: null,
            commitShaAfter: null,
            migrationRegenerated: false,
            startedAt: null,
            completedAt: null,
            createdAt: new Date("2026-05-03T10:00:00.000Z"),
            updatedAt: new Date("2026-05-03T10:00:00.000Z"),
          },
        ],
      } as never,
      {
        number: 77,
        html_url: "https://github.com/example-org/example-repo/pull/77",
      },
    );

    expect(state.movedWorkItems.map((call) => call.id)).toEqual([
      "child-1",
      "child-2",
    ]);
    expect(state.movedWorkItems.every((call) => call.columnId === "done-col")).toBe(true);
    expect(state.movedWorkItems.some((call) => call.id === "feature-1")).toBe(false);
  });

  it("still reconciles release items to Done when a merged release webhook is redelivered after batch completion", async () => {
    state.releaseWorkItemRows = [
      {
        id: "task-1",
        taskId: "O-1",
        boardId: "board-1",
        boardColumnId: "validating-col",
        type: "task",
      },
    ];

    const { handleReleasePrMerged } = await import("./github-webhook-handlers");

    await handleReleasePrMerged(
      "org-1",
      {
        id: "batch-completed",
        status: "completed",
        items: [
          {
            id: "batch-item-1",
            batchId: "batch-completed",
            workItemId: "task-1",
            prNumber: 10,
            prUrl: "https://github.com/example-org/example-repo/pull/10",
            branchName: "almirant/O-1",
            processingOrder: 0,
            status: "merged",
            failureCategory: null,
            failureReason: null,
            commitShaBefore: null,
            commitShaAfter: null,
            migrationRegenerated: false,
            startedAt: null,
            completedAt: null,
            createdAt: new Date("2026-05-03T10:00:00.000Z"),
            updatedAt: new Date("2026-05-03T10:00:00.000Z"),
          },
        ],
      } as never,
      {
        number: 77,
        html_url: "https://github.com/example-org/example-repo/pull/77",
      },
    );

    expect(state.movedWorkItems).toEqual([
      { id: "task-1", columnId: "done-col", position: 0 },
    ]);
  });

  it("preserves release deploy checklist metadata before moving shipped items to Done", async () => {
    state.releaseWorkItemRows = [
      {
        id: "task-checklist",
        taskId: "O-3",
        boardId: "board-1",
        boardColumnId: "validating-col",
        type: "task",
        metadata: {
          deployChecklist: "- Verify production worker\n- Confirm logs are clean",
          userActions: "No deploy actions needed.",
          documentationNotes: "Original docs note.",
        },
      },
    ];

    const { handleReleasePrMerged } = await import("./github-webhook-handlers");

    await handleReleasePrMerged(
      "org-1",
      {
        id: "batch-checklist",
        status: "awaiting_release",
        items: [
          {
            id: "batch-item-1",
            batchId: "batch-checklist",
            workItemId: "task-checklist",
            prNumber: 10,
            prUrl: "https://github.com/example-org/example-repo/pull/10",
            branchName: "almirant/O-3",
            processingOrder: 0,
            status: "merged",
            failureCategory: null,
            failureReason: null,
            commitShaBefore: null,
            commitShaAfter: null,
            migrationRegenerated: false,
            startedAt: null,
            completedAt: null,
            createdAt: new Date("2026-05-03T10:00:00.000Z"),
            updatedAt: new Date("2026-05-03T10:00:00.000Z"),
          },
        ],
      } as never,
      {
        number: 77,
        html_url: "https://github.com/example-org/example-repo/pull/77",
      },
    );

    expect(state.movedWorkItems).toEqual([
      { id: "task-checklist", columnId: "done-col", position: 0 },
    ]);

    const metadataUpdate = state.workItemUpdates.find(
      (update) => update.id === "task-checklist"
    )?.data.metadata as Record<string, unknown> | undefined;

    expect(metadataUpdate).toBeDefined();
    expect(metadataUpdate?.deployChecklist).toContain(
      "[x] Release PR #77 merged"
    );
    expect(metadataUpdate?.userActions).toContain("No deploy actions pending");
    expect(metadataUpdate?.documentationNotes).toContain("Original docs note.");
    expect(metadataUpdate?.documentationNotes).toContain(
      "Release Done reconciliation"
    );
    expect(metadataUpdate?.releaseDoneReconciliation).toMatchObject({
      batchId: "batch-checklist",
      releasePrNumber: 77,
      finalPrUrl: "https://github.com/example-org/example-repo/pull/77",
      originalDeployChecklist:
        "- Verify production worker\n- Confirm logs are clean",
      originalUserActions: "No deploy actions needed.",
      originalDocumentationNotes: "Original docs note.",
    });
    expect(state.batchStatusUpdates).toContainEqual(
      expect.objectContaining({ id: "batch-checklist", status: "completed" })
    );
  });

  it("does not mark a release batch completed when Done reconciliation fails", async () => {
    state.releaseWorkItemRows = [
      {
        id: "task-fail",
        taskId: "O-4",
        boardId: "board-1",
        boardColumnId: "validating-col",
        type: "task",
      },
    ];
    state.moveFailures.add("task-fail");

    const { handleReleasePrMerged } = await import("./github-webhook-handlers");

    await handleReleasePrMerged(
      "org-1",
      {
        id: "batch-fail",
        status: "awaiting_release",
        items: [
          {
            id: "batch-item-1",
            batchId: "batch-fail",
            workItemId: "task-fail",
            prNumber: 10,
            prUrl: "https://github.com/example-org/example-repo/pull/10",
            branchName: "almirant/O-4",
            processingOrder: 0,
            status: "merged",
            failureCategory: null,
            failureReason: null,
            commitShaBefore: null,
            commitShaAfter: null,
            migrationRegenerated: false,
            startedAt: null,
            completedAt: null,
            createdAt: new Date("2026-05-03T10:00:00.000Z"),
            updatedAt: new Date("2026-05-03T10:00:00.000Z"),
          },
        ],
      } as never,
      {
        number: 78,
        html_url: "https://github.com/example-org/example-repo/pull/78",
      },
    );

    expect(state.movedWorkItems).toHaveLength(0);
    expect(state.batchStatusUpdates).toHaveLength(1);
    expect(state.batchStatusUpdates[0]).toMatchObject({
      id: "batch-fail",
      status: "failed",
    });
    expect(
      String(state.batchStatusUpdates[0]?.extra?.errorMessage ?? "")
    ).toContain("Done reconciliation failed");
    expect(
      state.batchStatusUpdates.some((update) => update.status === "completed")
    ).toBe(false);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
