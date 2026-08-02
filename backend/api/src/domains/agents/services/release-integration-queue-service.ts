/**
 * Ported verbatim from cloud (parity port for the backend-native
 * scheduled-agent-dispatcher tick, lote 13 / community issue #85), with one
 * rename: `resolveScheduledWorkerIdentity` -> `resolveScheduledConfigOwnerIdentity`
 * (see resolve-scheduled-config-owner-identity.ts for why). Every repository
 * function this file imports (getRecoverableReleaseBatchesWithoutActiveJob,
 * countActiveBatchItemsByProject, getValidatingReleaseCandidates,
 * getOpenReleaseBatchForRepository, getActiveBatchForRepository,
 * getBatchByIdWithItems, getNextReleaseNumber, createIntegrationBatch,
 * updateBatchStatus, addItemsToBatch, getGithubRepoFullNameByRepoId) already
 * existed in community before this batch.
 *
 * NOT wired into workers.routes.ts's existing inline
 * `POST /workers/release-integration/queue` route (~line 2868): that route
 * already implements equivalent candidate-queueing logic directly inline
 * rather than through an extracted service, and consolidating the two is
 * out of scope here -- workers.routes.ts is lote 16 territory and this batch
 * must not drag its diff. This service exists solely so
 * scheduled-agent-dispatcher.ts's `executeReleaseIntegration` branch can call
 * it directly (no HTTP hop), exactly like cloud.
 */
import {
  createJob,
  DuplicateOpenBatchError,
  getRecoverableReleaseBatchesWithoutActiveJob,
  getGithubRepoFullNameByRepoId,
  countActiveBatchItemsByProject,
  getValidatingReleaseCandidates,
  getOpenReleaseBatchForRepository,
  getActiveBatchForRepository,
  getBatchByIdWithItems,
  getNextReleaseNumber,
  createIntegrationBatch,
  updateBatchStatus,
  addItemsToBatch,
} from "@almirant/database";
import { BUILTIN_AUTOMATIONS_BY_ID } from "@almirant/shared";
import { resolveScheduledConfigOwnerIdentity } from "./resolve-scheduled-config-owner-identity";

/** Single source of truth for the skill name used by every job this service
 *  creates — see `@almirant/shared`'s builtin-automations catalog. */
const RELEASE_INTEGRATION_SKILL_NAME = BUILTIN_AUTOMATIONS_BY_ID["release-integration"].skillName;

export interface QueueReleaseIntegrationInput {
  workspaceId: string;
  projectId?: string;
  scheduledConfigId?: string;
  limit?: number;
  maxActiveItems?: number;
  minAgeMinutes?: number;
}

export interface QueueReleaseIntegrationBatch {
  batchId: string;
  repositoryId: string;
  projectId: string;
  created: boolean;
  enqueuedItemCount: number;
}

export interface QueueReleaseIntegrationSkipped {
  noCandidates: number;
  activeRunningBatches: number;
  activeProjectLimit: number;
  duplicateItems: number;
  missingPullRequest: number;
  unresolvedRepository: number;
}

export interface QueueReleaseIntegrationResult {
  batches: QueueReleaseIntegrationBatch[];
  skipped: QueueReleaseIntegrationSkipped;
}

const buildReleaseIntegrationExecutionName = (
  repositoryFullName: string | null | undefined,
): string => {
  const normalized = repositoryFullName?.trim();
  return normalized ? `Integration — ${normalized}` : "Integration";
};

/**
 * Batch validating work items into release integration jobs.
 *
 * Security: workspaceId must be derived from the caller's API key by the
 * invoking layer (route/dispatcher), never from untrusted request params.
 *
 * Returns null when the scheduledConfigId does not resolve to a known
 * scheduled agent config in the workspace; callers translate that into a
 * 404 over HTTP or an equivalent failure signal elsewhere.
 */
export const queueReleaseIntegration = async (
  input: QueueReleaseIntegrationInput,
): Promise<QueueReleaseIntegrationResult | null> => {
  const { workspaceId } = input;
  const scheduledIdentity = await resolveScheduledConfigOwnerIdentity(
    workspaceId,
    input.scheduledConfigId,
  );
  if (!scheduledIdentity.found) {
    return null;
  }
  const maxActiveItems = typeof input.maxActiveItems === "number"
    ? Math.max(0, Math.floor(input.maxActiveItems))
    : undefined;
  const minAgeMinutes = typeof input.minAgeMinutes === "number"
    ? Math.max(0, Math.floor(input.minAgeMinutes))
    : undefined;
  let effectiveLimit = input.limit;

  const recoverableBatches = await getRecoverableReleaseBatchesWithoutActiveJob(
    workspaceId,
    input.projectId,
    maxActiveItems ?? input.limit,
  );

  if (recoverableBatches.length > 0) {
    const batches: QueueReleaseIntegrationBatch[] = [];

    for (const batch of recoverableBatches) {
      const integrationPhase = batch.status === "merging" ? "merge" : "process";
      const repositoryFullName = await getGithubRepoFullNameByRepoId(batch.repositoryId);
      await createJob({
        workspaceId,
        createdByUserId: scheduledIdentity.ownerUserId,
        projectId: batch.projectId,
        boardId: batch.boardId ?? undefined,
        provider: "claude-code",
        codingAgent: "claude-code",
        jobType: "integration",
        skillName: RELEASE_INTEGRATION_SKILL_NAME,
        promptTemplate: RELEASE_INTEGRATION_SKILL_NAME,
        triggerType: "scheduled",
        priority: "high",
        config: {
          repoPath: "",
          baseBranch: batch.baseBranch,
          repositoryId: batch.repositoryId,
          repositoryFullName: repositoryFullName ?? undefined,
          projectId: batch.projectId,
          batchId: batch.id,
          integrationPhase,
          ...(input.scheduledConfigId
            ? {
                scheduledConfigId: input.scheduledConfigId,
                scheduledConfigName: scheduledIdentity.scheduledConfigName ?? undefined,
              }
            : {}),
          skillName: RELEASE_INTEGRATION_SKILL_NAME,
          executionName: buildReleaseIntegrationExecutionName(repositoryFullName),
          selfManagesPr: true,
          source: "release-integration",
        },
      });

      batches.push({
        batchId: batch.id,
        repositoryId: batch.repositoryId,
        projectId: batch.projectId,
        created: false,
        enqueuedItemCount: batch.items.filter((item) =>
          item.status !== "merged" &&
          item.status !== "skipped" &&
          item.status !== "failed"
        ).length,
      });
    }

    return {
      batches,
      skipped: {
        noCandidates: 0,
        activeRunningBatches: 0,
        activeProjectLimit: 0,
        duplicateItems: 0,
        missingPullRequest: 0,
        unresolvedRepository: 0,
      },
    };
  }

  if (maxActiveItems !== undefined) {
    const activeCount = await countActiveBatchItemsByProject(
      workspaceId,
      input.projectId,
    );
    const availableSlots = Math.max(0, maxActiveItems - activeCount);
    if (availableSlots <= 0) {
      return {
        batches: [],
        skipped: {
          noCandidates: 0,
          activeRunningBatches: 0,
          activeProjectLimit: 1,
          duplicateItems: 0,
          missingPullRequest: 0,
          unresolvedRepository: 0,
        },
      };
    } else {
      effectiveLimit = Math.min(input.limit ?? availableSlots, availableSlots);
    }
  }

  const candidateResult = await getValidatingReleaseCandidates(
    workspaceId,
    input.projectId,
    effectiveLimit,
    { minAgeMinutes },
  );

  const groups = new Map<string, typeof candidateResult.candidates>();
  for (const candidate of candidateResult.candidates) {
    const key = [
      candidate.repositoryId,
      candidate.projectId,
      candidate.boardId,
      candidate.baseBranch,
    ].join(":");
    const existing = groups.get(key);
    if (existing) existing.push(candidate);
    else groups.set(key, [candidate]);
  }

  const batches: QueueReleaseIntegrationBatch[] = [];
  const skipped: QueueReleaseIntegrationSkipped = {
    noCandidates: candidateResult.candidates.length === 0 ? 1 : 0,
    activeRunningBatches: 0,
    activeProjectLimit: 0,
    duplicateItems: candidateResult.skipped.alreadyBatched,
    missingPullRequest: candidateResult.skipped.missingPullRequest,
    unresolvedRepository: candidateResult.skipped.unresolvedRepository,
  };

  for (const candidates of groups.values()) {
    const first = candidates[0];
    if (!first) continue;

    const openReleaseBatch = await getOpenReleaseBatchForRepository(
      workspaceId,
      first.repositoryId,
    );
    const active = openReleaseBatch ??
      await getActiveBatchForRepository(workspaceId, first.repositoryId);
    const activeWithItems = active ? await getBatchByIdWithItems(active.id) : null;
    if (active && (active.status === "running" || active.status === "merging")) {
      skipped.activeRunningBatches += candidates.length;
      continue;
    }

    const activeItems = activeWithItems?.items ?? [];
    // Failed items are NOT retried automatically. The release-integration
    // skill is required to resolve conflicts in a single pass; if the
    // agent escalated, a human owns the item now (DoD human_action
    // metadata is stamped by setItemFailure). We exclude failed items
    // from new-candidate dedup so the batch can keep accepting fresh
    // Validating work without re-queueing the failed one.
    const existingItemWorkIds = new Set(
      activeItems.map((item) => item.workItemId),
    );
    const newCandidates = candidates.filter(
      (candidate) => !existingItemWorkIds.has(candidate.id),
    );
    skipped.duplicateItems += candidates.length - newCandidates.length;
    if (newCandidates.length === 0) continue;

    const releaseNumber = activeWithItems
      ? activeWithItems.releaseNumber
      : await getNextReleaseNumber(workspaceId, first.repositoryId);

    let newlyCreatedBatch: Awaited<ReturnType<typeof createIntegrationBatch>> | null = null;
    if (!activeWithItems) {
      try {
        newlyCreatedBatch = await createIntegrationBatch({
          workspaceId,
          projectId: first.projectId,
          repositoryId: first.repositoryId,
          boardId: first.boardId,
          integrationBranch: `release/main-v${releaseNumber}`,
          baseBranch: first.baseBranch,
          releaseNumber,
          triggeredByUserId: null,
        });
      } catch (error) {
        if (error instanceof DuplicateOpenBatchError) {
          // Another concurrent run (the runner scheduler, another backend
          // replica, or the same dispatcher's next mode/scope) already
          // created the open batch for this repository between our read
          // (getOpenReleaseBatchForRepository/getActiveBatchForRepository
          // above) and this INSERT. Not an error: the next tick will find
          // that batch as "open" and append these candidates to it then.
          skipped.activeRunningBatches += candidates.length;
          continue;
        }
        throw error;
      }
    }
    const batch = activeWithItems ?? newlyCreatedBatch!;

    if (activeWithItems?.status === "awaiting_release") {
      await updateBatchStatus(batch.id, "queued");
    }

    const nextOrder = activeWithItems?.items.length ?? 0;
    await addItemsToBatch(
      newCandidates.map((candidate, index) => ({
        batchId: batch.id,
        workItemId: candidate.id,
        prNumber: candidate.prNumber,
        prUrl: candidate.prUrl,
        branchName: candidate.branchName,
        processingOrder: nextOrder + index,
      })),
    );

    if (!activeWithItems || activeWithItems.status === "awaiting_release") {
      await createJob({
        workspaceId,
        createdByUserId: scheduledIdentity.ownerUserId,
        projectId: first.projectId,
        boardId: first.boardId,
        provider: "claude-code",
        codingAgent: "claude-code",
        jobType: "integration",
        skillName: RELEASE_INTEGRATION_SKILL_NAME,
        promptTemplate: RELEASE_INTEGRATION_SKILL_NAME,
        triggerType: "scheduled",
        priority: "high",
        config: {
          repoPath: "",
          baseBranch: first.baseBranch,
          repositoryId: first.repositoryId,
          repositoryFullName: first.repositoryFullName,
          projectId: first.projectId,
          batchId: batch.id,
          integrationPhase: "process",
          ...(input.scheduledConfigId
            ? {
                scheduledConfigId: input.scheduledConfigId,
                scheduledConfigName: scheduledIdentity.scheduledConfigName ?? undefined,
              }
            : {}),
          skillName: RELEASE_INTEGRATION_SKILL_NAME,
          executionName: buildReleaseIntegrationExecutionName(first.repositoryFullName),
          selfManagesPr: true,
          source: "release-integration",
        },
      });
    }

    batches.push({
      batchId: batch.id,
      repositoryId: first.repositoryId,
      projectId: first.projectId,
      created: !activeWithItems,
      enqueuedItemCount: newCandidates.length,
    });
  }

  return { batches, skipped };
};
