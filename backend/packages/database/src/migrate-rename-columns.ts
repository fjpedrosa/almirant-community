import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

/**
 * Migration script: normalize Desarrollo boards to the canonical workflow.
 *
 * Canonical visible flow:
 * 0-Backlog, 1-In Progress, 2-To Review, 3-Validating, 4-To Release, 5-Done
 *
 * Legacy/internal roles are removed from Desarrollo boards:
 * - todo       -> Backlog
 * - needs_fix  -> In Progress
 * - testing    -> Validating
 * - to_document -> To Release
 *
 * Display-name renames (handled implicitly by the canonical update loop):
 * - "Reviewing" → "To Review"  (role stays review)
 * - "Release"   → "To Release" (role stays release)
 *
 * Work items are moved before deleting legacy columns, preserving UUID-backed
 * item assignments while removing the obsolete visible statuses.
 */

type TemplateColumn = NonNullable<typeof schema.boardTemplates.$inferInsert.columns>[number];
type BoardColumn = typeof schema.boardColumns.$inferSelect;
type ColumnRole = NonNullable<BoardColumn["role"]>;

const CANONICAL_COLUMNS: TemplateColumn[] = [
  { name: "Backlog", color: "#94a3b8", order: 0, isDone: false, role: "backlog" },
  { name: "In Progress", color: "#f59e0b", order: 1, isDone: false, role: "in_progress" },
  { name: "To Review", color: "#8b5cf6", order: 2, isDone: false, role: "review" },
  { name: "Validating", color: "#ec4899", order: 3, isDone: false, role: "validating" },
  { name: "To Release", color: "#a855f7", order: 4, isDone: false, role: "release" },
  { name: "Done", color: "#22c55e", order: 5, isDone: true, role: "done" },
];

const LEGACY_ROLE_TARGETS: Partial<Record<ColumnRole, ColumnRole>> = {
  todo: "backlog",
  needs_fix: "in_progress",
  testing: "validating",
  to_document: "release",
};

const byRole = (columns: BoardColumn[]) => {
  const map = new Map<ColumnRole, BoardColumn>();
  for (const column of [...columns].sort((a, b) => a.order - b.order)) {
    if (!map.has(column.role)) {
      map.set(column.role, column);
    }
  }
  return map;
};

async function ensureCanonicalColumn(
  boardId: string,
  currentByRole: Map<ColumnRole, BoardColumn>,
  desired: TemplateColumn,
): Promise<BoardColumn> {
  const existing = currentByRole.get(desired.role as ColumnRole);
  if (existing) return existing;

  const [created] = await db
    .insert(schema.boardColumns)
    .values({
      boardId,
      name: desired.name,
      color: desired.color,
      order: desired.order,
      role: desired.role as ColumnRole,
      isDone: desired.isDone,
    })
    .returning();

  if (!created) throw new Error(`Failed to create ${desired.name} column for board ${boardId}`);
  currentByRole.set(created.role, created);
  return created;
}

async function migrateRenameColumns() {
  console.log("Normalizing Desarrollo board columns to canonical workflow...\n");

  const boards = await db
    .select({ id: schema.boards.id, name: schema.boards.name })
    .from(schema.boards)
    .where(eq(schema.boards.area, "desarrollo"));

  if (boards.length === 0) {
    console.log("No Desarrollo boards found. Nothing to migrate.");
    await client.end();
    process.exit(0);
  }

  console.log(`Found ${boards.length} Desarrollo board(s):\n`);

  for (const board of boards) {
    console.log(`Processing board: "${board.name}" (${board.id})`);

    let columns = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.boardId, board.id));

    let columnByRole = byRole(columns);

    for (const desired of CANONICAL_COLUMNS) {
      await ensureCanonicalColumn(board.id, columnByRole, desired);
    }

    columns = await db
      .select()
      .from(schema.boardColumns)
      .where(eq(schema.boardColumns.boardId, board.id));
    columnByRole = byRole(columns);

    for (const legacyColumn of columns.filter((column) => column.role in LEGACY_ROLE_TARGETS)) {
      const targetRole = LEGACY_ROLE_TARGETS[legacyColumn.role];
      if (!targetRole) continue;
      const targetColumn = columnByRole.get(targetRole);
      if (!targetColumn) throw new Error(`Missing target role ${targetRole} for board ${board.id}`);

      const moved = await db
        .update(schema.workItems)
        .set({ boardColumnId: targetColumn.id, updatedAt: new Date() })
        .where(eq(schema.workItems.boardColumnId, legacyColumn.id))
        .returning({ id: schema.workItems.id });

      await db
        .delete(schema.boardColumns)
        .where(eq(schema.boardColumns.id, legacyColumn.id));

      console.log(`  REMOVED: ${legacyColumn.name} (${legacyColumn.role}) -> ${targetColumn.name}; moved ${moved.length} item(s)`);
    }

    for (const desired of CANONICAL_COLUMNS) {
      const column = columnByRole.get(desired.role as ColumnRole);
      if (!column) continue;
      await db
        .update(schema.boardColumns)
        .set({
          name: desired.name,
          color: desired.color,
          order: desired.order,
          isDone: desired.isDone,
          updatedAt: new Date(),
        })
        .where(eq(schema.boardColumns.id, column.id));
      console.log(`  CANONICAL: [${desired.order}] ${desired.name} (${desired.role})`);
    }

    console.log("");
  }

  await db
    .update(schema.boardTemplates)
    .set({ columns: CANONICAL_COLUMNS })
    .where(eq(schema.boardTemplates.area, "desarrollo"));

  console.log("Updated Desarrollo board template columns JSON.");
  console.log("\nMigration complete. Desarrollo boards now use the 6-column canonical workflow.");

  await client.end();
  process.exit(0);
}

migrateRenameColumns().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
