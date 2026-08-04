import { db } from "../../client";
import { boardColumns, boards, workItems } from "../../schema";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  isNotNull,
  lt,
  notExists,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

const retentionChild = alias(workItems, "retention_child");

export const DONE_RETENTION_HOURS = 72;
export const DONE_RETENTION_BATCH_SIZE = 500;

export interface ArchivedDoneWorkItem {
  id: string;
  boardId: string;
  workspaceId: string;
}

interface WorkItemArchiveRow extends ArchivedDoneWorkItem {
  parentId: string | null;
}

type RetentionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const archiveParentChain = async (
  tx: RetentionTransaction,
  archivedItemIds: string[],
  now: Date,
): Promise<WorkItemArchiveRow[]> => {
  const archived: WorkItemArchiveRow[] = [];
  let childIds = archivedItemIds;

  while (childIds.length > 0) {
    const childRows = await tx
      .select({ parentId: workItems.parentId })
      .from(workItems)
      .where(inArray(workItems.id, childIds));
    const parentIds = [...new Set(
      childRows
        .map((row) => row.parentId)
        .filter((parentId): parentId is string => parentId !== null),
    )];
    if (parentIds.length === 0) break;

    const candidates = await tx
      .select({
        id: workItems.id,
        boardId: workItems.boardId,
        workspaceId: boards.workspaceId,
        parentId: workItems.parentId,
      })
      .from(workItems)
      .innerJoin(boards, eq(workItems.boardId, boards.id))
      .where(and(inArray(workItems.id, parentIds), isNull(workItems.archivedAt)))
      .for("update");

    const ready: WorkItemArchiveRow[] = [];
    for (const candidate of candidates) {
      const [activeChild] = await tx
        .select({ id: workItems.id })
        .from(workItems)
        .where(and(eq(workItems.parentId, candidate.id), isNull(workItems.archivedAt)))
        .limit(1);
      if (!activeChild) ready.push(candidate);
    }
    if (ready.length === 0) break;

    const updated = await tx
      .update(workItems)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          inArray(workItems.id, ready.map((row) => row.id)),
          isNull(workItems.archivedAt),
        ),
      )
      .returning({ id: workItems.id });
    const updatedIds = new Set(updated.map((row) => row.id));
    const archivedReady = ready.filter((row) => updatedIds.has(row.id));
    archived.push(...archivedReady);
    childIds = archivedReady.map((row) => row.id);
  }

  return archived;
};

/**
 * Archives active leaf work items whose Done clock is strictly older than the
 * retention cutoff. The row lock and conditional update make concurrent
 * workers idempotent; parent rows are archived only after every direct child
 * is already archived.
 */
export const archiveDoneWorkItems = async (args?: {
  now?: Date;
  retentionHours?: number;
  batchSize?: number;
}): Promise<ArchivedDoneWorkItem[]> => {
  const now = args?.now ?? new Date();
  const retentionHours = args?.retentionHours ?? DONE_RETENTION_HOURS;
  const batchSize = Math.max(1, Math.min(args?.batchSize ?? DONE_RETENTION_BATCH_SIZE, DONE_RETENTION_BATCH_SIZE));
  const cutoff = new Date(now.getTime() - retentionHours * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: workItems.id,
        boardId: workItems.boardId,
        workspaceId: boards.workspaceId,
        parentId: workItems.parentId,
      })
      .from(workItems)
      .innerJoin(boards, eq(workItems.boardId, boards.id))
      .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(
        and(
          isNull(workItems.archivedAt),
          isNotNull(workItems.enteredDoneAt),
          lt(workItems.enteredDoneAt, cutoff),
          eq(boardColumns.isDone, true),
          isNotNull(workItems.boardColumnId),
          // Only real leaves are candidates. Parent rows are reconciled below
          // after every descendant has been archived, including archived ones.
          notExists(
            tx
              .select({ id: retentionChild.id })
              .from(retentionChild)
              .where(eq(retentionChild.parentId, workItems.id)),
          ),
        ),
      )
      .orderBy(asc(workItems.enteredDoneAt), asc(workItems.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    if (candidates.length === 0) return [];

    const updated = await tx
      .update(workItems)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          inArray(workItems.id, candidates.map((row) => row.id)),
          isNull(workItems.archivedAt),
        ),
      )
      .returning({ id: workItems.id });
    const updatedIds = new Set(updated.map((row) => row.id));
    const archivedLeaves = candidates.filter((row) => updatedIds.has(row.id));
    const archivedParents = await archiveParentChain(
      tx,
      archivedLeaves.map((row) => row.id),
      now,
    );

    return [...archivedLeaves, ...archivedParents].map(({ id, boardId, workspaceId }) => ({
      id,
      boardId,
      workspaceId,
    }));
  });
};
