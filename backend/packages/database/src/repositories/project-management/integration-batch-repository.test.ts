import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { sql as drizzleSql } from "drizzle-orm";

type ValidatingLeafRow = {
  id: string;
  taskId: string | null;
  title: string;
  boardId: string;
  projectId: string | null;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
  validatingColumnOrder: number;
};

type AncestorRow = {
  id: string;
  taskId: string | null;
  title: string;
  boardId: string;
  projectId: string | null;
  parentId: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
};

type DescendantLeafColumnRow = {
  originalParentId: string;
  id: string;
  boardColumnId: string | null;
  columnRole: string | null;
  columnOrder: number | null;
  updatedAt: Date;
};

type RepoLinkRow = {
  repositoryId: string;
  githubRepoFullName: string;
  defaultBranch: string | null;
};

type GithubPullRequestOrderRow = {
  repositoryId: string;
  prNumber: number;
  prCreatedAt: Date;
};

type IntegrationBatchRepositoryModule = typeof import("./integration-batch-repository");

type ReleaseMetadataItemRow = {
  workItemId: string;
  status:
    | "pending"
    | "rebasing"
    | "migrating"
    | "type_checking"
    | "testing"
    | "merged"
    | "skipped"
    | "failed";
};

type AlreadyBatchedRow = {
  alreadyBatchedWorkItemId: string;
};

let getValidatingReleaseCandidates: IntegrationBatchRepositoryModule[
  "getValidatingReleaseCandidates"
];
let setReleasePullRequestForBatch: IntegrationBatchRepositoryModule[
  "setReleasePullRequestForBatch"
];
let ACTIVE_BATCH_ITEM_LIMIT_STATUSES: IntegrationBatchRepositoryModule[
  "ACTIVE_BATCH_ITEM_LIMIT_STATUSES"
];
let validatingLeafRows: ValidatingLeafRow[] = [];
let ancestorRows: AncestorRow[] = [];
let descendantLeafRows: DescendantLeafColumnRow[] = [];
let repoLinkRows: RepoLinkRow[] = [];
let githubPullRequestRows: GithubPullRequestOrderRow[] = [];
let releaseMetadataRows: ReleaseMetadataItemRow[] = [];
let alreadyBatchedRows: AlreadyBatchedRow[] = [];
let updateCalls: Array<{ values: Record<string, unknown>; returningCalled: boolean }> = [];
let selectCall = 0;

const createQueryBuilder = (selection?: Record<string, unknown>, callIndex = 0) => {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => {
      if (selection && "status" in selection && "workItemId" in selection) {
        return Promise.resolve(releaseMetadataRows);
      }

      if (selection && "alreadyBatchedWorkItemId" in selection) {
        return Promise.resolve(alreadyBatchedRows);
      }

      if (callIndex === 1) {
        return {
          orderBy: async () => validatingLeafRows,
        };
      }

      if (selection && "githubRepoFullName" in selection) {
        return Promise.resolve(repoLinkRows);
      }

      if (selection && "prCreatedAt" in selection && "prNumber" in selection) {
        return Promise.resolve(githubPullRequestRows);
      }

      if (selection && "originalParentId" in selection) {
        return Promise.resolve(descendantLeafRows);
      }

      if (selection && "validatingColumnOrder" in selection) {
        return {
          orderBy: async () => validatingLeafRows,
        };
      }

      return Promise.resolve(ancestorRows);
    },
    orderBy: async () => validatingLeafRows,
  };

  return builder;
};

beforeAll(async () => {
  mock.module("../../client", () => ({
    db: {
      select: (selection?: Record<string, unknown>) => {
        selectCall += 1;
        return createQueryBuilder(selection, selectCall);
      },
      update: () => {
        let values: Record<string, unknown> = {};
        const builder = {
          set: (nextValues: Record<string, unknown>) => {
            values = nextValues;
            return builder;
          },
          where: () => {
            updateCalls.push({ values, returningCalled: false });
            return builder;
          },
          returning: async () => {
            const lastCall = updateCalls.at(-1);
            if (lastCall) lastCall.returningCalled = true;
            return releaseMetadataRows
              .filter((row) => row.status === "merged")
              .map((row) => ({ id: row.workItemId }));
          },
        };
        return builder;
      },
    },
  }));

  ({
    getValidatingReleaseCandidates,
    setReleasePullRequestForBatch,
    ACTIVE_BATCH_ITEM_LIMIT_STATUSES,
  } = await import("./integration-batch-repository"));
});

beforeEach(() => {
  validatingLeafRows = [];
  ancestorRows = [];
  descendantLeafRows = [];
  releaseMetadataRows = [];
  alreadyBatchedRows = [];
  githubPullRequestRows = [];
  updateCalls = [];
  selectCall = 0;
  repoLinkRows = [
    {
      repositoryId: "repo-1",
      githubRepoFullName: "example-org/example-repo",
      defaultBranch: "main",
    },
  ];
});

afterAll(() => {
  mock.module("../../client", () => ({
    db: {},
    schema: {},
    sql: drizzleSql,
    closeConnections: async () => {},
  }));
  mock.restore();
});

describe("release PR metadata", () => {
  test("only links merged batch items and clears stale release metadata from failed items", async () => {
    releaseMetadataRows = [
      { workItemId: "wi-merged", status: "merged" },
      { workItemId: "wi-failed", status: "failed" },
    ];

    const updated = await setReleasePullRequestForBatch("batch-1", {
      url: "https://github.com/acme/app/pull/77",
      number: 77,
      state: "open",
      branch: "release/main-v7",
      releaseNumber: 7,
    });

    expect(updated).toBe(1);
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]?.returningCalled).toBe(false);
    expect(updateCalls[1]?.returningCalled).toBe(true);
  });

  test("does not add release metadata when no batch items merged", async () => {
    releaseMetadataRows = [
      { workItemId: "wi-failed", status: "failed" },
      { workItemId: "wi-skipped", status: "skipped" },
    ];

    const updated = await setReleasePullRequestForBatch("batch-1", {
      url: "https://github.com/acme/app/pull/77",
      number: 77,
      state: "open",
      branch: "release/main-v7",
      releaseNumber: 7,
    });

    expect(updated).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.returningCalled).toBe(false);
  });
});

describe("release integration validating candidates", () => {
  test("does not count awaiting-release batches as active item capacity", () => {
    expect(ACTIVE_BATCH_ITEM_LIMIT_STATUSES).toEqual([
      "queued",
      "running",
      "merging",
    ]);
    expect(ACTIVE_BATCH_ITEM_LIMIT_STATUSES).not.toContain("awaiting_release");
  });

  test("orders candidates by synchronized PR creation date instead of board update order", async () => {
    validatingLeafRows = [
      {
        id: "feature-pr-30",
        taskId: "O-F-30",
        title: "Later PR by creation date",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/30",
            number: 30,
            branch: "almirant/O-F-30",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T09:00:00.000Z"),
        validatingColumnOrder: 6,
      },
      {
        id: "feature-pr-20",
        taskId: "O-F-20",
        title: "Earlier PR by creation date",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/20",
            number: 20,
            branch: "almirant/O-F-20",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T10:00:00.000Z"),
        validatingColumnOrder: 6,
      },
    ];
    githubPullRequestRows = [
      {
        repositoryId: "repo-1",
        prNumber: 30,
        prCreatedAt: new Date("2026-05-03T12:00:00.000Z"),
      },
      {
        repositoryId: "repo-1",
        prNumber: 20,
        prCreatedAt: new Date("2026-05-03T08:00:00.000Z"),
      },
    ];

    const result = await getValidatingReleaseCandidates("org-1", "project-1");

    expect(result.candidates.map((candidate) => candidate.prNumber)).toEqual([20, 30]);
  });

  test("falls back to PR number order when synchronized PR creation dates are unavailable", async () => {
    validatingLeafRows = [
      {
        id: "feature-pr-30",
        taskId: "O-F-30",
        title: "Higher PR number",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/30",
            number: 30,
            branch: "almirant/O-F-30",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T09:00:00.000Z"),
        validatingColumnOrder: 6,
      },
      {
        id: "feature-pr-20",
        taskId: "O-F-20",
        title: "Lower PR number",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/20",
            number: 20,
            branch: "almirant/O-F-20",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T10:00:00.000Z"),
        validatingColumnOrder: 6,
      },
    ];

    const result = await getValidatingReleaseCandidates("org-1", "project-1");

    expect(result.candidates.map((candidate) => candidate.prNumber)).toEqual([20, 30]);
  });

  test("uses the nearest validating parent block PR instead of requiring PR metadata on each leaf task", async () => {
    validatingLeafRows = [
      {
        id: "child-1",
        taskId: "O-1",
        title: "Login shell",
        boardId: "board-1",
        projectId: "project-1",
        parentId: "feature-1",
        metadata: {},
        updatedAt: new Date("2026-05-03T10:00:00.000Z"),
        validatingColumnOrder: 6,
      },
      {
        id: "child-2",
        taskId: "O-2",
        title: "Navigation",
        boardId: "board-1",
        projectId: "project-1",
        parentId: "feature-1",
        metadata: {},
        updatedAt: new Date("2026-05-03T10:05:00.000Z"),
        validatingColumnOrder: 6,
      },
    ];
    ancestorRows = [
      {
        id: "feature-1",
        taskId: "O-F-1",
        title: "Back office: acceso y arquitectura base",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/10",
            number: 10,
            branch: "almirant/O-F-1",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T09:00:00.000Z"),
      },
    ];
    descendantLeafRows = [
      {
        originalParentId: "feature-1",
        id: "child-1",
        boardColumnId: "validating-col",
        columnRole: "validating",
        columnOrder: 6,
        updatedAt: new Date("2026-05-03T10:00:00.000Z"),
      },
      {
        originalParentId: "feature-1",
        id: "child-2",
        boardColumnId: "validating-col",
        columnRole: "validating",
        columnOrder: 6,
        updatedAt: new Date("2026-05-03T10:05:00.000Z"),
      },
    ];

    const result = await getValidatingReleaseCandidates("org-1", "project-1");

    expect(result.skipped).toEqual({
      missingPullRequest: 0,
      unresolvedRepository: 0,
      alreadyBatched: 0,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "feature-1",
      taskId: "O-F-1",
      title: "Back office: acceso y arquitectura base",
      repositoryId: "repo-1",
      repositoryFullName: "example-org/example-repo",
      prNumber: 10,
      prUrl: "https://github.com/example-org/example-repo/pull/10",
      branchName: "almirant/O-F-1",
    });
  });

  test("does not integrate a parent block until all leaf descendants have reached the validating column or beyond", async () => {
    validatingLeafRows = [
      {
        id: "child-1",
        taskId: "O-1",
        title: "Login shell",
        boardId: "board-1",
        projectId: "project-1",
        parentId: "feature-1",
        metadata: {},
        updatedAt: new Date("2026-05-03T10:00:00.000Z"),
        validatingColumnOrder: 6,
      },
    ];
    ancestorRows = [
      {
        id: "feature-1",
        taskId: "O-F-1",
        title: "Back office: acceso y arquitectura base",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/10",
            number: 10,
            branch: "almirant/O-F-1",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T09:00:00.000Z"),
      },
    ];
    descendantLeafRows = [
      {
        originalParentId: "feature-1",
        id: "child-1",
        boardColumnId: "validating-col",
        columnRole: "validating",
        columnOrder: 6,
        updatedAt: new Date("2026-05-03T10:00:00.000Z"),
      },
      {
        originalParentId: "feature-1",
        id: "child-2",
        boardColumnId: "review-col",
        columnRole: "review",
        columnOrder: 3,
        updatedAt: new Date("2026-05-03T10:05:00.000Z"),
      },
    ];

    const result = await getValidatingReleaseCandidates("org-1", "project-1");

    expect(result.skipped.missingPullRequest).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  test("does not let an already-batched candidate consume the release queue limit", async () => {
    alreadyBatchedRows = [
      { alreadyBatchedWorkItemId: "feature-duplicate" },
    ];
    validatingLeafRows = [
      {
        id: "feature-duplicate",
        taskId: "O-F-1",
        title: "Already batched block",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/10",
            number: 10,
            branch: "almirant/O-F-1",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T10:00:00.000Z"),
        validatingColumnOrder: 6,
      },
      {
        id: "feature-fresh",
        taskId: "O-F-2",
        title: "Fresh block",
        boardId: "board-1",
        projectId: "project-1",
        parentId: null,
        metadata: {
          pullRequest: {
            url: "https://github.com/example-org/example-repo/pull/11",
            number: 11,
            branch: "almirant/O-F-2",
            state: "open",
          },
        },
        updatedAt: new Date("2026-05-03T10:05:00.000Z"),
        validatingColumnOrder: 6,
      },
    ];

    const result = await getValidatingReleaseCandidates("org-1", "project-1", 1);

    expect(result.skipped).toEqual({
      missingPullRequest: 0,
      unresolvedRepository: 0,
      alreadyBatched: 1,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "feature-fresh",
      taskId: "O-F-2",
      prNumber: 11,
    });
  });
});
