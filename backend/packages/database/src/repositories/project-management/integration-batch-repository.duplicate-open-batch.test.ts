import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mock } from "bun:test";

// Capture the real client module BEFORE the mock is registered so afterAll
// can restore it -- mirrors the pattern in integration-batch-repository.test.ts
// and agent-job-repository.claim-sql.test.ts.
const realClient = { ...(await import("../../client")) };

// `integration_batches_repository_open_uidx` (migration 0222, parity with
// cloud 0236) guards against two concurrent `queueReleaseIntegration`-style
// runs both creating an open batch for the same (workspace_id,
// repository_id). `createIntegrationBatch` must translate the resulting
// postgres 23505 into `DuplicateOpenBatchError` so callers can treat it as
// "lost the race" instead of an unexpected failure.

const insertState = {
  returningRows: [{ id: "created-batch-1" }] as Array<Record<string, unknown>>,
  throwError: null as (Error & { code?: string; constraint_name?: string }) | null,
};

mock.module("../../client", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: async () => {
          if (insertState.throwError) throw insertState.throwError;
          return [...insertState.returningRows];
        },
      }),
    }),
  },
}));

afterAll(() => {
  mock.module("../../client", () => realClient);
});

beforeEach(() => {
  insertState.returningRows = [{ id: "created-batch-1" }];
  insertState.throwError = null;
});

describe("createIntegrationBatch duplicate-open-batch handling", () => {
  test("translates the integration_batches_repository_open_uidx violation into DuplicateOpenBatchError", async () => {
    const { createIntegrationBatch, DuplicateOpenBatchError } = await import(
      "./integration-batch-repository"
    );

    const conflict = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "integration_batches_repository_open_uidx"',
      ),
      { code: "23505", constraint_name: "integration_batches_repository_open_uidx" },
    );
    insertState.throwError = conflict;

    const attempt = createIntegrationBatch({
      workspaceId: "ws-1",
      projectId: "p1",
      repositoryId: "repo-1",
      boardId: "b1",
      integrationBranch: "release/main-v1",
      baseBranch: "main",
      releaseNumber: 1,
      triggeredByUserId: null,
    });

    await expect(attempt).rejects.toBeInstanceOf(DuplicateOpenBatchError);
  });

  test("also classifies the violation when the driver wraps it one level in `cause`", async () => {
    const { createIntegrationBatch, DuplicateOpenBatchError } = await import(
      "./integration-batch-repository"
    );

    const wrapped = Object.assign(new Error("insert failed"), {
      cause: { code: "23505", constraint_name: "integration_batches_repository_open_uidx" },
    });
    insertState.throwError = wrapped as Error;

    await expect(
      createIntegrationBatch({
        workspaceId: "ws-1",
        projectId: "p1",
        repositoryId: "repo-1",
        boardId: "b1",
        integrationBranch: "release/main-v1",
        baseBranch: "main",
        releaseNumber: 1,
        triggeredByUserId: null,
      }),
    ).rejects.toBeInstanceOf(DuplicateOpenBatchError);
  });

  test("rethrows unrelated unique violations unchanged", async () => {
    const { createIntegrationBatch, DuplicateOpenBatchError } = await import(
      "./integration-batch-repository"
    );

    const unrelated = Object.assign(
      new Error('duplicate key value violates unique constraint "some_other_idx"'),
      { code: "23505", constraint_name: "some_other_idx" },
    );
    insertState.throwError = unrelated;

    const attempt = createIntegrationBatch({
      workspaceId: "ws-1",
      projectId: "p1",
      repositoryId: "repo-1",
      boardId: "b1",
      integrationBranch: "release/main-v1",
      baseBranch: "main",
      releaseNumber: 1,
      triggeredByUserId: null,
    });

    await expect(attempt).rejects.toThrow("some_other_idx");
    insertState.throwError = unrelated;
    await expect(
      createIntegrationBatch({
        workspaceId: "ws-1",
        projectId: "p1",
        repositoryId: "repo-1",
        boardId: "b1",
        integrationBranch: "release/main-v1",
        baseBranch: "main",
        releaseNumber: 1,
        triggeredByUserId: null,
      }),
    ).rejects.not.toBeInstanceOf(DuplicateOpenBatchError);
  });

  test("creates the batch normally when there is no conflict", async () => {
    const { createIntegrationBatch } = await import("./integration-batch-repository");

    const batch = await createIntegrationBatch({
      workspaceId: "ws-1",
      projectId: "p1",
      repositoryId: "repo-1",
      boardId: "b1",
      integrationBranch: "release/main-v1",
      baseBranch: "main",
      releaseNumber: 1,
      triggeredByUserId: null,
    });

    expect(batch).toMatchObject({ id: "created-batch-1" });
  });
});
