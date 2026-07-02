import { db } from "../client";
import { workItemEffortEstimates } from "../schema/work-item-effort-estimates";
import type { WorkItemEffortEstimate } from "../schema/work-item-effort-estimates";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpsertWorkItemEffortEstimateInput = {
  workItemId: string;
  estimatedSubagents: number;
  estimatedMemoryMb: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  contentHash: string;
  source: "llm" | "fallback_heuristic";
};

// ---------------------------------------------------------------------------
// upsertEstimate — ON CONFLICT (workItemId) DO UPDATE
// ---------------------------------------------------------------------------

/**
 * Upserts the 1:1 effort estimate for a work item.
 *
 * On insert: row is created with `stale=false` (default) and
 * `createdAt/updatedAt` set via column defaults.
 *
 * On conflict (unique workItemId): fields are replaced, `stale` is reset to
 * false, and `updatedAt` is bumped to `now()`. `createdAt` is preserved.
 */
export const upsertEstimate = async (
  data: UpsertWorkItemEffortEstimateInput,
): Promise<WorkItemEffortEstimate> => {
  const [row] = await db
    .insert(workItemEffortEstimates)
    .values({
      workItemId: data.workItemId,
      estimatedSubagents: data.estimatedSubagents,
      estimatedMemoryMb: data.estimatedMemoryMb,
      confidence: data.confidence,
      reasoning: data.reasoning,
      contentHash: data.contentHash,
      source: data.source,
      stale: false,
    })
    .onConflictDoUpdate({
      target: workItemEffortEstimates.workItemId,
      set: {
        estimatedSubagents: data.estimatedSubagents,
        estimatedMemoryMb: data.estimatedMemoryMb,
        confidence: data.confidence,
        reasoning: data.reasoning,
        contentHash: data.contentHash,
        source: data.source,
        stale: false,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  if (!row) {
    throw new Error(
      `Failed to upsert effort estimate for work item ${data.workItemId}`,
    );
  }

  return row;
};

// ---------------------------------------------------------------------------
// getByWorkItemId — fetch the estimate for a single work item
// ---------------------------------------------------------------------------

export const getByWorkItemId = async (
  workItemId: string,
): Promise<WorkItemEffortEstimate | null> => {
  const [row] = await db
    .select()
    .from(workItemEffortEstimates)
    .where(eq(workItemEffortEstimates.workItemId, workItemId))
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// markStale — flip stale=true (content changed since last estimate)
// ---------------------------------------------------------------------------

/**
 * Marks an existing estimate as stale. No-op if there is no row for the
 * given workItemId. Does NOT bump `updatedAt` — staleness is an independent
 * signal that should not look like a fresh estimate.
 */
export const markStale = async (
  workItemId: string,
): Promise<WorkItemEffortEstimate | null> => {
  const [row] = await db
    .update(workItemEffortEstimates)
    .set({ stale: true })
    .where(eq(workItemEffortEstimates.workItemId, workItemId))
    .returning();

  return row ?? null;
};
