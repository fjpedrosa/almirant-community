import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { DuplicateOpenBatchError } from "@almirant/database";
import { createDatabaseMocks, restoreRealModules } from "../../../test/mocks";

// ---------------------------------------------------------------------------
// queueReleaseIntegration — duplicate-open-batch race handling.
//
// `integration_batches_repository_open_uidx` (migration 0236) guards against
// two concurrent `queueReleaseIntegration` runs (backend dispatcher tick +
// runner scheduler over POST /workers/release-integration/queue, or two
// backend replicas) both observing "no active batch" for a repository and
// each trying to create one. `createIntegrationBatch` translates the losing
// INSERT's 23505 into `DuplicateOpenBatchError` — this service must treat
// that as "lost the race, skip this group" (counted like the existing
// activeRunningBatches skip reason), never as an unhandled rejection that
// aborts the whole tick's release-integration batching.
// ---------------------------------------------------------------------------

const state = {
  recoverableBatches: [] as unknown[],
  candidatesResult: {
    candidates: [] as Array<Record<string, unknown>>,
    skipped: { alreadyBatched: 0, missingPullRequest: 0, unresolvedRepository: 0 },
  },
  openBatch: null as Record<string, unknown> | null,
  activeBatch: null as Record<string, unknown> | null,
  nextReleaseNumber: 1,
  createBatchThrow: null as Error | null,
  createdBatches: [] as Array<Record<string, unknown>>,
  addItemsCalls: [] as Array<Record<string, unknown>>,
  createJobCalls: [] as Array<Record<string, unknown>>,
};

const resetState = () => {
  state.recoverableBatches = [];
  state.candidatesResult = {
    candidates: [],
    skipped: { alreadyBatched: 0, missingPullRequest: 0, unresolvedRepository: 0 },
  };
  state.openBatch = null;
  state.activeBatch = null;
  state.nextReleaseNumber = 1;
  state.createBatchThrow = null;
  state.createdBatches = [];
  state.addItemsCalls = [];
  state.createJobCalls = [];
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getRecoverableReleaseBatchesWithoutActiveJob: async () => state.recoverableBatches,
    getGithubRepoFullNameByRepoId: async () => "acme/example-repo",
    countActiveBatchItemsByProject: async () => 0,
    getValidatingReleaseCandidates: async () => state.candidatesResult,
    getOpenReleaseBatchForRepository: async () => state.openBatch,
    getActiveBatchForRepository: async () => state.activeBatch,
    getBatchByIdWithItems: async () => null,
    getNextReleaseNumber: async () => state.nextReleaseNumber,
    createIntegrationBatch: async (input: Record<string, unknown>) => {
      if (state.createBatchThrow) throw state.createBatchThrow;
      const created = { id: `batch-${state.createdBatches.length + 1}`, ...input };
      state.createdBatches.push(created);
      return created;
    },
    updateBatchStatus: async () => null,
    addItemsToBatch: async (items: Record<string, unknown>) => {
      state.addItemsCalls.push(items as Record<string, unknown>);
      return [];
    },
    createJob: async (input: Record<string, unknown>) => {
      state.createJobCalls.push(input);
      return { id: `job-${state.createJobCalls.length}`, status: "queued", ...input };
    },
  }),
);

mock.module("./resolve-scheduled-config-owner-identity", () => ({
  resolveScheduledConfigOwnerIdentity: async () => ({
    found: true,
    ownerUserId: null,
    scheduledConfigName: null,
    config: null,
  }),
}));

const { queueReleaseIntegration } = await import("./release-integration-queue-service");

const candidate = {
  id: "wi-1",
  taskId: "T-1",
  title: "Ship it",
  boardId: "b1",
  projectId: "p1",
  repositoryId: "repo-1",
  repositoryFullName: "acme/example-repo",
  baseBranch: "main",
  prNumber: 42,
  prUrl: "https://github.com/acme/example-repo/pull/42",
  branchName: "feature/wi-1",
};

afterAll(() => {
  restoreRealModules();
});

describe("queueReleaseIntegration duplicate-open-batch handling", () => {
  beforeEach(() => {
    resetState();
  });

  it("skips the group as activeRunningBatches when createIntegrationBatch loses the race, without creating items or a job", async () => {
    state.candidatesResult = {
      candidates: [candidate],
      skipped: { alreadyBatched: 0, missingPullRequest: 0, unresolvedRepository: 0 },
    };
    state.createBatchThrow = new DuplicateOpenBatchError("workspace-1", "repo-1");

    const result = await queueReleaseIntegration({ workspaceId: "workspace-1" });

    expect(result).not.toBeNull();
    expect(result?.batches).toEqual([]);
    expect(result?.skipped.activeRunningBatches).toBe(1);
    expect(state.addItemsCalls).toEqual([]);
    expect(state.createJobCalls).toEqual([]);
  });

  it("rethrows unrelated errors from createIntegrationBatch instead of swallowing them", async () => {
    state.candidatesResult = {
      candidates: [candidate],
      skipped: { alreadyBatched: 0, missingPullRequest: 0, unresolvedRepository: 0 },
    };
    state.createBatchThrow = new Error("connection reset");

    await expect(
      queueReleaseIntegration({ workspaceId: "workspace-1" }),
    ).rejects.toThrow("connection reset");
  });

  it("creates the batch, items and job normally when there is no conflict", async () => {
    state.candidatesResult = {
      candidates: [candidate],
      skipped: { alreadyBatched: 0, missingPullRequest: 0, unresolvedRepository: 0 },
    };

    const result = await queueReleaseIntegration({ workspaceId: "workspace-1" });

    expect(result?.batches).toHaveLength(1);
    expect(result?.skipped.activeRunningBatches).toBe(0);
    expect(state.addItemsCalls).toHaveLength(1);
    expect(state.createJobCalls).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Skill-name contract pin — mirrors builtin-automations.ts's
  // "release-integration" entry (skillName: "runner-release-integration").
  // Pins that the top-level createJob params AND the nested config both
  // still carry the exact same literal now that it's sourced from the
  // catalog instead of four hand-typed strings.
  // ---------------------------------------------------------------------
  it("writes the catalog skillName consistently at the top level and in config", async () => {
    state.candidatesResult = {
      candidates: [candidate],
      skipped: { alreadyBatched: 0, missingPullRequest: 0, unresolvedRepository: 0 },
    };

    await queueReleaseIntegration({ workspaceId: "workspace-1" });

    expect(state.createJobCalls).toHaveLength(1);
    const call = state.createJobCalls[0]!;
    expect(call.skillName).toBe("runner-release-integration");
    expect(call.promptTemplate).toBe("runner-release-integration");
    expect((call.config as Record<string, unknown>).skillName).toBe("runner-release-integration");
  });
});
