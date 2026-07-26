import type { EffortEstimationReason } from "../../domains/agents/services/enqueue-effort-estimation";

/**
 * Which effort estimations a work-item write should trigger.
 *
 * The MCP tools call `createWorkItem` / `updateWorkItem` directly instead of
 * going through the REST routes, so they miss the estimation hook those routes
 * apply (work-items.routes.ts). Without it nothing an agent creates is ever
 * estimated, and its runner jobs then wait out the full 10-minute escape in the
 * `claimJobs` estimate gate.
 *
 * The decision lives here — as pure functions returning what to enqueue — so it
 * can be tested without standing up the whole MCP tool surface.
 */
export type EstimationEnqueue = readonly [string, EffortEstimationReason];

export const planEstimationEnqueuesForCreate = (item: {
  id: string;
  parentId?: string | null;
}): EstimationEnqueue[] => {
  const enqueues: EstimationEnqueue[] = [[item.id, "created"]];
  if (item.parentId) {
    // The parent's estimate is derived partly from its children, so it has to
    // be re-run when it gains one.
    enqueues.push([item.parentId, "child-added"]);
  }
  return enqueues;
};

type ContentFields = {
  title: string;
  description: string | null;
  type: string;
  parentId: string | null;
};

/**
 * Only the fields feeding the content hash (title, description, type,
 * parentId) matter: a metadata-only write leaves the hash untouched, so
 * re-estimating would burn provider quota for an identical input.
 */
export const planEstimationEnqueuesForUpdate = (
  id: string,
  before: ContentFields,
  changes: Partial<{
    title: string;
    description: string;
    type: string;
    parentId: string | null;
  }>,
): EstimationEnqueue[] => {
  const parentChanged =
    changes.parentId !== undefined &&
    (changes.parentId ?? null) !== (before.parentId ?? null);

  const contentFieldChanged =
    (changes.title !== undefined && changes.title !== before.title) ||
    (changes.description !== undefined &&
      (changes.description ?? null) !== (before.description ?? null)) ||
    (changes.type !== undefined && changes.type !== before.type) ||
    parentChanged;

  const enqueues: EstimationEnqueue[] = [];
  if (contentFieldChanged) {
    enqueues.push([id, "updated"]);
  }

  if (parentChanged) {
    if (before.parentId) {
      enqueues.push([before.parentId, "child-removed"]);
    }
    if (changes.parentId) {
      enqueues.push([changes.parentId, "child-added"]);
    }
  }

  return enqueues;
};
