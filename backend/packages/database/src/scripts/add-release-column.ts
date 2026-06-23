/**
 * Idempotent migration script: adds a "Release" column between Validating and
 * Done on every existing board that has a Validating column but no Release.
 *
 * Usage:
 *   bun run --env-file .env.local src/scripts/add-release-column.ts
 *
 * Behavior:
 *   - Boards without a `validating`-role column are skipped.
 *   - Boards that already have a `release`-role column are skipped (idempotent).
 *   - Otherwise the script inserts a new column at the order of the first
 *     `done`-role column (or just after `validating` if no `done` exists)
 *     and shifts every column at or after that order +1.
 */

import { db } from "../client";
import { boards, boardColumns } from "../schema/boards";
import { eq, sql } from "drizzle-orm";

export type ColumnRole =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "testing"
  | "needs_fix"
  | "validating"
  | "release"
  | "to_document"
  | "done"
  | "other";

export interface ColumnInfo {
  id: string;
  name: string;
  role: ColumnRole;
  order: number;
  isDone: boolean;
  color: string;
}

export interface ReleaseInsertionPlan {
  insert: {
    name: string;
    role: "release";
    color: string;
    isDone: boolean;
    order: number;
  };
  /** Existing columns to shift (id → new order). */
  updates: Array<{ id: string; order: number }>;
}

const RELEASE_COLOR = "#a855f7";
const RELEASE_NAME = "To Release";

// ---------------------------------------------------------------------------
// Pure logic — TDD covered
// ---------------------------------------------------------------------------

export const computeReleaseInsertion = (
  columns: ColumnInfo[],
): ReleaseInsertionPlan | null => {
  const validating = columns.find((c) => c.role === "validating");
  if (!validating) return null;

  if (columns.some((c) => c.role === "release")) return null;

  const done = columns.find((c) => c.role === "done");
  const insertOrder = done ? done.order : validating.order + 1;

  const updates = columns
    .filter((c) => c.order >= insertOrder)
    .map((c) => ({ id: c.id, order: c.order + 1 }));

  return {
    insert: {
      name: RELEASE_NAME,
      role: "release",
      color: RELEASE_COLOR,
      isDone: false,
      order: insertOrder,
    },
    updates,
  };
};

// ---------------------------------------------------------------------------
// Script entry point
// ---------------------------------------------------------------------------

const isMainModule = import.meta.path === Bun.main;

const run = async (): Promise<void> => {
  console.log("🔍 Scanning boards for Release column migration...");

  const allBoards = await db.select().from(boards);
  console.log(`   Found ${allBoards.length} board(s).`);

  let planned = 0;
  let migrated = 0;

  for (const board of allBoards) {
    const cols = await db
      .select()
      .from(boardColumns)
      .where(eq(boardColumns.boardId, board.id));

    const colInfos: ColumnInfo[] = cols.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role as ColumnRole,
      order: c.order,
      isDone: c.isDone ?? false,
      color: c.color,
    }));

    const plan = computeReleaseInsertion(colInfos);
    if (!plan) continue;

    planned++;
    console.log(
      `🛠  Board "${board.name}" (${board.id}): inserting Release at order ${plan.insert.order}; shifting ${plan.updates.length} column(s).`,
    );

    await db.transaction(async (tx) => {
      // Shift each affected column to a temporary high order to avoid the unique
      // index conflict on (boardId, order) if one exists, then to the final value.
      // We do not assume such a unique index exists; this is a defensive
      // two-pass write.
      for (const u of plan.updates) {
        await tx
          .update(boardColumns)
          .set({ order: sql`${boardColumns.order} + 1000`, updatedAt: new Date() })
          .where(eq(boardColumns.id, u.id));
      }
      for (const u of plan.updates) {
        await tx
          .update(boardColumns)
          .set({ order: u.order, updatedAt: new Date() })
          .where(eq(boardColumns.id, u.id));
      }
      await tx.insert(boardColumns).values({
        boardId: board.id,
        name: plan.insert.name,
        color: plan.insert.color,
        order: plan.insert.order,
        role: plan.insert.role,
        isDone: plan.insert.isDone,
      });
    });
    migrated++;
  }

  console.log(
    `\n✅ Done. Planned: ${planned}, migrated: ${migrated}, skipped: ${allBoards.length - planned}.`,
  );
};

if (isMainModule) {
  run().catch((err) => {
    console.error("❌ Migration script failed:", err);
    process.exit(1);
  });
}
