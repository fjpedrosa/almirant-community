/**
 * Work Item Sync Service
 *
 * Provides utility functions for querying work item hierarchy and board column
 * metadata. Cascade synchronization has been removed (A-180) since parent-type
 * items now derive their status implicitly from children.
 */

import {
  db,
  workItems,
  boardColumns,
  eq,
} from "@almirant/database";

/**
 * Get the parent of a work item.
 *
 * @param workItemId - The work item ID whose parent to find
 * @returns Parent work item basic info, or null if no parent
 */
export const getParentForSync = async (
  workItemId: string,
): Promise<{
  id: string;
  boardId: string;
  boardColumnId: string | null;
  type: string;
  title: string;
  parentId: string | null;
} | null> => {
  const [item] = await db
    .select({ parentId: workItems.parentId })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);

  if (!item?.parentId) return null;

  const [parent] = await db
    .select({
      id: workItems.id,
      boardId: workItems.boardId,
      boardColumnId: workItems.boardColumnId,
      type: workItems.type,
      title: workItems.title,
      parentId: workItems.parentId,
    })
    .from(workItems)
    .where(eq(workItems.id, item.parentId))
    .limit(1);

  return parent ?? null;
};

/**
 * Check if a board column is a "done" column.
 *
 * @param boardColumnId - The board column ID to check
 * @returns true if the column is marked as done
 */
export const isColumnDone = async (boardColumnId: string): Promise<boolean> => {
  const [column] = await db
    .select({ isDone: boardColumns.isDone })
    .from(boardColumns)
    .where(eq(boardColumns.id, boardColumnId))
    .limit(1);

  return column?.isDone === true;
};

/**
 * Get the order/position of a board column within its board.
 *
 * @param boardColumnId - The board column ID
 * @returns The column order number, or -1 if not found
 */
export const getColumnOrder = async (boardColumnId: string): Promise<number> => {
  const [column] = await db
    .select({ order: boardColumns.order })
    .from(boardColumns)
    .where(eq(boardColumns.id, boardColumnId))
    .limit(1);

  return column?.order ?? -1;
};
