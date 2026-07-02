import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  createIntegrationBatch,
  addItemsToBatch,
  clearReleasePullRequestForBatch,
  getBatchByIdWithItems,
  getNextReleaseNumber,
  getOpenReleaseBatchForRepository,
  getGithubRepoFullNameByRepoId,
  getValidatingReleaseCandidates,
  listActiveBatchesByProject,
  listItemsByBatch,
  updateBatchStatus,
  createJob,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";

const orderWorkItemIdsByReleaseCandidateOrder = (
  workItemIds: string[],
  candidates: Array<{ id: string }>,
): string[] => {
  const originalOrder = new Map(workItemIds.map((id, index) => [id, index]));
  const releaseOrder = new Map(candidates.map((candidate, index) => [candidate.id, index]));

  return [...workItemIds].sort((a, b) => {
    const aOrder = releaseOrder.get(a);
    const bOrder = releaseOrder.get(b);

    if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (aOrder !== undefined && bOrder === undefined) return -1;
    if (aOrder === undefined && bOrder !== undefined) return 1;

    return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
  });
};

const buildReleaseIntegrationExecutionName = (
  repositoryFullName: string | null | undefined,
): string => {
  const normalized = repositoryFullName?.trim();
  return normalized ? `Integration — ${normalized}` : "Integration";
};

export const integrationBatchesRoutes = new Elysia({ prefix: "/integration-batches" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // POST /integration-batches — create a batch and enqueue the integration job
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, set, activeWorkspace, user }) => {
      const orgId = activeWorkspace!.id;

      const releaseCandidates = await getValidatingReleaseCandidates(orgId, body.projectId);
      const repositoryCandidates = releaseCandidates.candidates.filter(
        (candidate) => candidate.repositoryId === body.repositoryId,
      );
      const candidatesById = new Map(
        repositoryCandidates.map((candidate) => [candidate.id, candidate]),
      );
      const orderedWorkItemIds = orderWorkItemIdsByReleaseCandidateOrder(
        body.workItemIds,
        repositoryCandidates,
      );
      const repositoryFullName =
        repositoryCandidates[0]?.repositoryFullName ??
        (await getGithubRepoFullNameByRepoId(body.repositoryId));
      const executionName = buildReleaseIntegrationExecutionName(repositoryFullName);

      // If a release PR is still open for this repo, append to it instead of
      // creating a new batch. This is the "long-lived release PR" semantics:
      // every new wave of tasks accumulates onto the same release/main-v<N>.
      const openBatch = await getOpenReleaseBatchForRepository(orgId, body.repositoryId);
      if (openBatch) {
        const existingItems = await listItemsByBatch(openBatch.id);
        const existingWorkItemIds = new Set(existingItems.map((it) => it.workItemId));
        const startingOrder = existingItems.length;
        const newRows = orderedWorkItemIds
          .filter((id) => !existingWorkItemIds.has(id))
          .map((workItemId, idx) => {
            const candidate = candidatesById.get(workItemId);
            return {
              batchId: openBatch.id,
              workItemId,
              prNumber: candidate?.prNumber ?? null,
              prUrl: candidate?.prUrl ?? null,
              branchName: candidate?.branchName ?? null,
              processingOrder: startingOrder + idx,
            };
          });

        if (newRows.length > 0) {
          await addItemsToBatch(newRows);
        }

        // Re-enqueue process job so the runner picks up the new items.
        await createJob({
          workspaceId: orgId,
          projectId: body.projectId,
          boardId: body.boardId,
          provider: "claude-code",
          codingAgent: "claude-code",
          jobType: "integration",
          skillName: "runner-release-integration",
          promptTemplate: "runner-release-integration",
          triggerType: "event",
          priority: "high",
          config: {
            repoPath: "",
            baseBranch: openBatch.baseBranch,
            repositoryId: body.repositoryId,
            repositoryFullName: repositoryFullName ?? undefined,
            projectId: body.projectId,
            batchId: openBatch.id,
            integrationPhase: "process",
            skillName: "runner-release-integration",
            executionName,
            selfManagesPr: true,
          },
          createdByUserId: user!.id,
        });

        set.status = 200;
        return successResponse({ ...openBatch, appended: newRows.length });
      }

      const releaseNumber = await getNextReleaseNumber(orgId, body.repositoryId);
      const integrationBranch = `release/main-v${releaseNumber}`;
      const batch = await createIntegrationBatch({
        workspaceId: orgId,
        projectId: body.projectId,
        repositoryId: body.repositoryId,
        boardId: body.boardId ?? null,
        integrationBranch,
        baseBranch: body.baseBranch ?? "main",
        releaseNumber,
        triggeredByUserId: user!.id,
      });

      await addItemsToBatch(
        orderedWorkItemIds.map((workItemId, index) => {
          const candidate = candidatesById.get(workItemId);
          return {
            batchId: batch.id,
            workItemId,
            prNumber: candidate?.prNumber ?? null,
            prUrl: candidate?.prUrl ?? null,
            branchName: candidate?.branchName ?? null,
            processingOrder: index,
          };
        }),
      );

      await createJob({
        workspaceId: orgId,
        projectId: body.projectId,
        boardId: body.boardId,
        provider: "claude-code",
        codingAgent: "claude-code",
        jobType: "integration",
        skillName: "runner-release-integration",
        promptTemplate: "runner-release-integration",
        triggerType: "event",
        priority: "high",
        config: {
          repoPath: "",
          baseBranch: body.baseBranch ?? "main",
          repositoryId: body.repositoryId,
          repositoryFullName: repositoryFullName ?? undefined,
          projectId: body.projectId,
          batchId: batch.id,
          integrationPhase: "process",
          skillName: "runner-release-integration",
          executionName,
          selfManagesPr: true,
        },
        createdByUserId: user!.id,
      });

      set.status = 201;
      return successResponse(batch);
    },
    {
      body: t.Object({
        projectId: t.String(),
        repositoryId: t.String(),
        workItemIds: t.Array(t.String(), { minItems: 1 }),
        boardId: t.Optional(t.String()),
        baseBranch: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /integration-batches/active — list active batches in a project
  // -------------------------------------------------------
  .get(
    "/active",
    async ({ query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const batches = await listActiveBatchesByProject(orgId, query.projectId);
      return successResponse(batches);
    },
    {
      query: t.Object({
        projectId: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /integration-batches/:id — get batch with items
  // -------------------------------------------------------
  .get("/:id", async ({ params, set, activeWorkspace }) => {
    const orgId = activeWorkspace!.id;
    const batch = await getBatchByIdWithItems(params.id);
    if (!batch || batch.workspaceId !== orgId) {
      set.status = 404;
      return notFoundResponse("Integration batch");
    }
    return successResponse(batch);
  })

  // -------------------------------------------------------
  // POST /integration-batches/:id/approve — release the batch to main
  // -------------------------------------------------------
  .post("/:id/approve", async ({ params, set, activeWorkspace, user }) => {
    const orgId = activeWorkspace!.id;
    const batch = await getBatchByIdWithItems(params.id);
    if (!batch || batch.workspaceId !== orgId) {
      set.status = 404;
      return notFoundResponse("Integration batch");
    }
    if (batch.status !== "awaiting_release") {
      set.status = 409;
      return errorResponse(
        `Batch is not awaiting release (current status: ${batch.status})`,
      );
    }
    await updateBatchStatus(batch.id, "merging");
    const repositoryFullName = await getGithubRepoFullNameByRepoId(batch.repositoryId);

    await createJob({
      workspaceId: orgId,
      projectId: batch.projectId,
      boardId: batch.boardId ?? undefined,
      provider: "claude-code",
      codingAgent: "claude-code",
      jobType: "integration",
      skillName: "runner-release-integration",
      promptTemplate: "runner-release-integration",
      triggerType: "event",
      priority: "high",
      config: {
        repoPath: "",
        baseBranch: batch.baseBranch,
        repositoryId: batch.repositoryId,
        repositoryFullName: repositoryFullName ?? undefined,
        projectId: batch.projectId,
        batchId: batch.id,
        integrationPhase: "merge",
        skillName: "runner-release-integration",
        executionName: buildReleaseIntegrationExecutionName(repositoryFullName),
        selfManagesPr: true,
      },
      createdByUserId: user!.id,
    });

    return successResponse({ ...batch, status: "merging" });
  })

  // -------------------------------------------------------
  // POST /integration-batches/:id/reject — abort the batch entirely
  // -------------------------------------------------------
  .post("/:id/reject", async ({ params, set, activeWorkspace }) => {
    const orgId = activeWorkspace!.id;
    const batch = await getBatchByIdWithItems(params.id);
    if (!batch || batch.workspaceId !== orgId) {
      set.status = 404;
      return notFoundResponse("Integration batch");
    }
    if (batch.status !== "awaiting_release") {
      set.status = 409;
      return errorResponse(
        `Batch is not awaiting release (current status: ${batch.status})`,
      );
    }
    const updated = await updateBatchStatus(batch.id, "aborted", {
      completedAt: new Date(),
    });
    // Detach the rejected release from every linked work item — the cards
    // shouldn't keep showing a Rocket icon for a release that won't ship.
    await clearReleasePullRequestForBatch(batch.id);
    return successResponse(updated);
  });
