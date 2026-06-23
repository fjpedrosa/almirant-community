/**
 * PGlite + Drizzle ORM Proof of Concept
 *
 * Tests viability of PGlite (PostgreSQL compiled to WASM) as an embedded
 * database for lightweight sandbox environments in Almirant.
 *
 * What this POC validates:
 *   1. PGlite instantiation (in-memory and file-persisted)
 *   2. Drizzle ORM connection via the pglite adapter
 *   3. pgEnum support (custom PostgreSQL enum types)
 *   4. Table creation with foreign keys, indexes, defaults, arrays, JSONB
 *   5. Basic CRUD operations (insert, select, update, delete)
 *   6. Relational queries (joins)
 *   7. Transaction support
 *   8. Performance timing for all operations
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run src/pglite-poc/poc.ts
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  varchar,
  boolean,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { eq, and, sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// 1. Schema definition (subset of Almirant's real schema)
// ---------------------------------------------------------------------------

// Enums - matching the real schema's pgEnum definitions
const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
  "on_hold",
]);

const boardAreaEnum = pgEnum("board_area", [
  "desarrollo",
  "ventas",
  "prospeccion",
  "marketing",
  "general",
]);

const columnRoleEnum = pgEnum("column_role", [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "testing",
  "done",
  "other",
]);

const workItemTypeEnum = pgEnum("work_item_type", [
  "epic",
  "feature",
  "story",
  "task",
  "idea",
]);

const priorityEnum = pgEnum("priority", ["low", "medium", "high", "urgent"]);

// Tables - matching the real schema structure

const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("user"),
  locale: varchar("locale", { length: 5 }).notNull().default("es"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
    icon: varchar("icon", { length: 50 }),
    status: projectStatusEnum("status").notNull().default("active"),
    techStack: text("tech_stack").array(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("projects_organization_id_idx").on(table.organizationId)]
);

const boards = pgTable("boards", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  area: boardAreaEnum("area").notNull().default("general"),
  isDefault: boolean("is_default").default(false),
  allowedTypes: jsonb("allowed_types").$type<
    Array<"epic" | "feature" | "story" | "task" | "idea">
  >(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

const boardColumns = pgTable("board_columns", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
  order: integer("order").notNull().default(0),
  role: columnRoleEnum("role").notNull().default("other"),
  isDone: boolean("is_done").default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    boardColumnId: uuid("board_column_id").references(() => boardColumns.id, {
      onDelete: "restrict",
    }),
    type: workItemTypeEnum("type").notNull().default("task"),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    priority: priorityEnum("priority").notNull().default("medium"),
    assignee: varchar("assignee", { length: 255 }),
    position: integer("position").notNull().default(0),
    metadata: jsonb("metadata")
      .default({})
      .$type<Record<string, unknown>>(),
    taskId: varchar("task_id", { length: 20 }).unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("work_items_board_column_position_idx").on(
      table.boardId,
      table.boardColumnId,
      table.position
    ),
    index("work_items_type_idx").on(table.type),
    index("work_items_priority_idx").on(table.priority),
  ]
);

// ---------------------------------------------------------------------------
// 2. Helpers
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  status: "PASS" | "FAIL";
  durationMs: number;
  detail?: string;
  error?: string;
}

const results: TestResult[] = [];

const time = async <T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | null> => {
  process.stdout.write(`  Running: ${name}...`);
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    results.push({ name, status: "PASS", durationMs });
    process.stdout.write(` PASS (${durationMs}ms)\n`);
    return result;
  } catch (err) {
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, status: "FAIL", durationMs, error });
    process.stdout.write(` FAIL (${durationMs}ms)\n`);
    return null;
  }
};

// ---------------------------------------------------------------------------
// 3. Main POC
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(70));
  console.log("  PGlite + Drizzle ORM - Proof of Concept");
  console.log("=".repeat(70));
  console.log();

  const totalStart = performance.now();

  // ---- Test 1: Instantiate PGlite (in-memory) ----
  const pglite = await time("1. PGlite in-memory instantiation", async () => {
    const pg = new PGlite();
    // Wait for it to be ready
    await pg.waitReady;
    return pg;
  });
  if (!pglite) {
    console.error("Cannot continue without PGlite instance.");
    process.exit(1);
  }

  // Print PGlite version
  const versionResult = await pglite.query("SELECT version()");
  console.log(
    `  PostgreSQL version: ${(versionResult.rows[0] as any).version}\n`
  );

  // ---- Test 2: Connect Drizzle ----
  const db = await time("2. Drizzle ORM connection", async () => {
    return drizzle(pglite);
  });
  if (!db) process.exit(1);

  // ---- Test 3: Create enums via raw SQL ----
  // NOTE: PGlite does NOT support multiple statements per execute() call.
  // Each statement must be sent individually.
  await time("3. Create pgEnum types (5 enums)", async () => {
    await db.execute(sql`CREATE TYPE "project_status" AS ENUM ('active', 'archived', 'on_hold')`);
    await db.execute(sql`CREATE TYPE "board_area" AS ENUM ('desarrollo', 'ventas', 'prospeccion', 'marketing', 'general')`);
    await db.execute(sql`CREATE TYPE "column_role" AS ENUM ('backlog', 'todo', 'in_progress', 'review', 'testing', 'done', 'other')`);
    await db.execute(sql`CREATE TYPE "work_item_type" AS ENUM ('epic', 'feature', 'story', 'task', 'idea')`);
    await db.execute(sql`CREATE TYPE "priority" AS ENUM ('low', 'medium', 'high', 'urgent')`);
  });

  // ---- Test 4: Create tables ----
  await time("4. Create 6 tables with FK, indexes, defaults", async () => {
    // organization
    await db.execute(sql`
      CREATE TABLE "organization" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "slug" text UNIQUE NOT NULL,
        "logo" text,
        "metadata" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // user
    await db.execute(sql`
      CREATE TABLE "user" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "email" text UNIQUE NOT NULL,
        "email_verified" boolean NOT NULL DEFAULT false,
        "image" text,
        "role" text NOT NULL DEFAULT 'user',
        "locale" varchar(5) NOT NULL DEFAULT 'es',
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // projects
    await db.execute(sql`
      CREATE TABLE "projects" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "name" varchar(255) NOT NULL,
        "description" text,
        "color" varchar(7) NOT NULL DEFAULT '#6366f1',
        "icon" varchar(50),
        "status" "project_status" NOT NULL DEFAULT 'active',
        "tech_stack" text[],
        "organization_id" text REFERENCES "organization"("id") ON DELETE SET NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX "projects_organization_id_idx" ON "projects" ("organization_id")`
    );

    // boards
    await db.execute(sql`
      CREATE TABLE "boards" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
        "name" varchar(255) NOT NULL,
        "description" text,
        "area" "board_area" NOT NULL DEFAULT 'general',
        "is_default" boolean DEFAULT false,
        "allowed_types" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

    // board_columns
    await db.execute(sql`
      CREATE TABLE "board_columns" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "name" varchar(255) NOT NULL,
        "color" varchar(7) NOT NULL DEFAULT '#6366f1',
        "order" integer NOT NULL DEFAULT 0,
        "role" "column_role" NOT NULL DEFAULT 'other',
        "is_done" boolean DEFAULT false,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

    // work_items
    await db.execute(sql`
      CREATE TABLE "work_items" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "board_column_id" uuid REFERENCES "board_columns"("id") ON DELETE RESTRICT,
        "type" "work_item_type" NOT NULL DEFAULT 'task',
        "title" varchar(500) NOT NULL,
        "description" text,
        "priority" "priority" NOT NULL DEFAULT 'medium',
        "assignee" varchar(255),
        "position" integer NOT NULL DEFAULT 0,
        "metadata" jsonb DEFAULT '{}',
        "task_id" varchar(20) UNIQUE,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX "work_items_board_column_position_idx"
        ON "work_items" ("board_id", "board_column_id", "position")
    `);
    await db.execute(
      sql`CREATE INDEX "work_items_type_idx" ON "work_items" ("type")`
    );
    await db.execute(
      sql`CREATE INDEX "work_items_priority_idx" ON "work_items" ("priority")`
    );
  });

  // ---- Test 5: INSERT operations ----
  await time("5. INSERT - organization + user", async () => {
    await db.insert(organization).values({
      id: "org-1",
      name: "Almirant Test Org",
      slug: "almirant-test",
    });

    await db.insert(user).values({
      id: "user-1",
      name: "Test User",
      email: "test@almirant.ai",
    });
  });

  const projectInsert = await time(
    "6. INSERT - project with enum + array columns",
    async () => {
      const [project] = await db
        .insert(projects)
        .values({
          name: "Almirant Platform",
          description: "Main platform project",
          status: "active",
          techStack: ["Next.js", "Elysia", "Drizzle", "PostgreSQL"],
          organizationId: "org-1",
        })
        .returning();
      return project;
    }
  );

  const boardInsert = await time(
    "7. INSERT - board with JSONB column",
    async () => {
      const [board] = await db
        .insert(boards)
        .values({
          organizationId: "org-1",
          name: "Development Board",
          area: "desarrollo",
          isDefault: true,
          allowedTypes: ["task", "story", "epic"],
        })
        .returning();
      return board;
    }
  );

  let columnIds: { todo: string; inProgress: string; done: string } = {
    todo: "",
    inProgress: "",
    done: "",
  };

  await time("8. INSERT - 3 board columns", async () => {
    const cols = await db
      .insert(boardColumns)
      .values([
        {
          boardId: boardInsert!.id,
          name: "To Do",
          color: "#64748b",
          order: 0,
          role: "todo",
        },
        {
          boardId: boardInsert!.id,
          name: "In Progress",
          color: "#3b82f6",
          order: 1,
          role: "in_progress",
        },
        {
          boardId: boardInsert!.id,
          name: "Done",
          color: "#22c55e",
          order: 2,
          role: "done",
          isDone: true,
        },
      ])
      .returning();
    columnIds.todo = cols[0].id;
    columnIds.inProgress = cols[1].id;
    columnIds.done = cols[2].id;
  });

  await time(
    "9. INSERT - 10 work items with enums, JSONB metadata",
    async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        projectId: projectInsert!.id,
        boardId: boardInsert!.id,
        boardColumnId: i < 4 ? columnIds.todo : i < 7 ? columnIds.inProgress : columnIds.done,
        type: "task" as const,
        title: `Work item ${i + 1}`,
        description: `Description for work item ${i + 1}`,
        priority: (["low", "medium", "high", "urgent"] as const)[i % 4],
        position: i,
        taskId: `A-T-${i + 1}`,
        metadata: { source: "poc", index: i, tags: ["test", `batch-${i}`] },
      }));
      await db.insert(workItems).values(items);
    }
  );

  // ---- Test 6: SELECT operations ----
  await time("10. SELECT - all projects with enum filtering", async () => {
    const activeProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.status, "active"));
    if (activeProjects.length !== 1)
      throw new Error(`Expected 1 project, got ${activeProjects.length}`);
    // Verify array column
    if (!activeProjects[0].techStack?.includes("Drizzle"))
      throw new Error("techStack array not persisted correctly");
  });

  await time("11. SELECT - work items with enum + JSONB", async () => {
    const highPriority = await db
      .select()
      .from(workItems)
      .where(eq(workItems.priority, "high"));
    if (highPriority.length === 0)
      throw new Error("Expected high priority work items");

    // Verify JSONB
    const metadata = highPriority[0].metadata as Record<string, unknown>;
    if (metadata.source !== "poc")
      throw new Error("JSONB metadata not persisted correctly");
  });

  await time("12. SELECT - JOIN projects + boards", async () => {
    const result = await db
      .select({
        projectName: projects.name,
        boardName: boards.name,
        boardArea: boards.area,
      })
      .from(projects)
      .innerJoin(boards, eq(projects.organizationId, boards.organizationId));
    if (result.length === 0) throw new Error("JOIN returned no results");
    if (result[0].boardArea !== "desarrollo")
      throw new Error("Enum value not correct after JOIN");
  });

  await time(
    "13. SELECT - subquery: count work items per column",
    async () => {
      const counts = await db
        .select({
          columnName: boardColumns.name,
          role: boardColumns.role,
          itemCount: sql<number>`count(${workItems.id})::int`,
        })
        .from(boardColumns)
        .leftJoin(workItems, eq(boardColumns.id, workItems.boardColumnId))
        .where(eq(boardColumns.boardId, boardInsert!.id))
        .groupBy(boardColumns.id, boardColumns.name, boardColumns.role);

      if (counts.length !== 3)
        throw new Error(`Expected 3 columns, got ${counts.length}`);
      const totalItems = counts.reduce((sum, c) => sum + c.itemCount, 0);
      if (totalItems !== 10)
        throw new Error(`Expected 10 items total, got ${totalItems}`);
    }
  );

  // ---- Test 7: UPDATE operations ----
  await time("14. UPDATE - project status enum change", async () => {
    await db
      .update(projects)
      .set({ status: "on_hold", updatedAt: new Date() })
      .where(eq(projects.id, projectInsert!.id));

    const [updated] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectInsert!.id));
    if (updated.status !== "on_hold")
      throw new Error(`Status not updated: ${updated.status}`);
  });

  await time("15. UPDATE - JSONB metadata merge", async () => {
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.taskId, "A-T-1"));

    await db
      .update(workItems)
      .set({
        metadata: {
          ...(item.metadata as Record<string, unknown>),
          reviewed: true,
          reviewer: "user-1",
        },
      })
      .where(eq(workItems.id, item.id));

    const [updated] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, item.id));
    const meta = updated.metadata as Record<string, unknown>;
    if (meta.reviewed !== true)
      throw new Error("JSONB update did not persist");
  });

  // ---- Test 8: DELETE operations ----
  await time("16. DELETE - single work item", async () => {
    const [deleted] = await db
      .delete(workItems)
      .where(eq(workItems.taskId, "A-T-10"))
      .returning();
    if (!deleted) throw new Error("Delete returned nothing");
    if (deleted.taskId !== "A-T-10")
      throw new Error("Deleted wrong item");
  });

  await time(
    "17. DELETE CASCADE - board deletion cascades to columns + items",
    async () => {
      // First count items before
      const [beforeCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workItems);

      // Delete the board - should cascade to columns and work items
      await db.delete(boards).where(eq(boards.id, boardInsert!.id));

      const [afterItemCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workItems);
      const [afterColCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(boardColumns);

      if (afterItemCount.count !== 0)
        throw new Error(
          `Expected 0 work items after cascade, got ${afterItemCount.count}`
        );
      if (afterColCount.count !== 0)
        throw new Error(
          `Expected 0 columns after cascade, got ${afterColCount.count}`
        );
    }
  );

  // ---- Test 9: Transactions ----
  await time("18. TRANSACTION - atomic multi-table insert", async () => {
    await db.transaction(async (tx) => {
      const [newBoard] = await tx
        .insert(boards)
        .values({
          organizationId: "org-1",
          name: "TX Board",
          area: "general",
        })
        .returning();

      const [col] = await tx
        .insert(boardColumns)
        .values({
          boardId: newBoard.id,
          name: "Backlog",
          role: "backlog",
          order: 0,
        })
        .returning();

      await tx.insert(workItems).values({
        boardId: newBoard.id,
        boardColumnId: col.id,
        title: "TX Work Item",
        type: "task",
        priority: "high",
        position: 0,
        taskId: "A-TX-1",
      });
    });

    // Verify
    const [txItem] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.taskId, "A-TX-1"));
    if (!txItem) throw new Error("Transaction item not found");
  });

  await time("19. TRANSACTION ROLLBACK - error causes rollback", async () => {
    // IMPORTANT: PGlite is single-connection. Inside a tx callback you MUST
    // use `tx` for all queries, never `db`, or it will deadlock.
    const countBefore = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workItems);

    // Get IDs before entering the transaction
    const [existingBoard] = await db.select({ id: boards.id }).from(boards).limit(1);
    const [existingCol] = await db.select({ id: boardColumns.id }).from(boardColumns).limit(1);

    try {
      await db.transaction(async (tx) => {
        await tx.insert(workItems).values({
          boardId: existingBoard.id,
          boardColumnId: existingCol.id,
          title: "Should be rolled back",
          type: "task",
          priority: "low",
          position: 99,
          taskId: "A-ROLLBACK-1",
        });
        // Force an error to trigger rollback
        throw new Error("Intentional rollback");
      });
    } catch {
      // Expected
    }

    const countAfter = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workItems);
    if (countBefore[0].count !== countAfter[0].count)
      throw new Error("Rollback did not work - item count changed");
  });

  // ---- Test 10: Bulk insert performance ----
  await time("20. PERF - bulk insert 100 work items", async () => {
    const boardId = (
      await db.select({ id: boards.id }).from(boards).limit(1)
    )[0].id;
    const colId = (
      await db.select({ id: boardColumns.id }).from(boardColumns).limit(1)
    )[0].id;

    const bulkItems = Array.from({ length: 100 }, (_, i) => ({
      boardId,
      boardColumnId: colId,
      type: "task" as const,
      title: `Bulk item ${i}`,
      priority: (["low", "medium", "high", "urgent"] as const)[i % 4],
      position: i,
      taskId: `BULK-${i}`,
      metadata: { bulk: true, index: i },
    }));
    await db.insert(workItems).values(bulkItems);
  });

  await time("21. PERF - SELECT all 101 work items", async () => {
    const all = await db.select().from(workItems);
    if (all.length < 100)
      throw new Error(`Expected ~101 items, got ${all.length}`);
  });

  await time(
    "22. PERF - filtered SELECT with enum + ORDER BY",
    async () => {
      const filtered = await db
        .select()
        .from(workItems)
        .where(eq(workItems.priority, "urgent"))
        .orderBy(workItems.position);
      if (filtered.length === 0) throw new Error("No urgent items found");
    }
  );

  // ---- Test 11: File-persisted PGlite (Node/Bun only) ----
  await time("23. PGlite file-persisted instantiation", async () => {
    const tmpDir = `/tmp/pglite-poc-${Date.now()}`;
    const filePg = new PGlite(tmpDir);
    await filePg.waitReady;

    // Create a table and insert data
    await filePg.query(`CREATE TABLE test_persist (id serial, value text)`);
    await filePg.query(`INSERT INTO test_persist (value) VALUES ('hello')`);

    // Verify it works
    const result = await filePg.query(`SELECT * FROM test_persist`);
    if ((result.rows as any[]).length !== 1)
      throw new Error("File-persisted query failed");

    await filePg.close();

    // Reopen and verify persistence
    const filePg2 = new PGlite(tmpDir);
    await filePg2.waitReady;
    const result2 = await filePg2.query(`SELECT * FROM test_persist`);
    if ((result2.rows as any[]).length !== 1)
      throw new Error("Data not persisted across restarts");
    await filePg2.close();

    // Cleanup
    const { rmSync } = await import("fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- Test 12: Raw SQL features ----
  await time(
    "24. RAW SQL - CTE + window functions",
    async () => {
      const result = await db.execute(sql`
      WITH ranked AS (
        SELECT
          title,
          priority,
          position,
          ROW_NUMBER() OVER (PARTITION BY priority ORDER BY position) as rn
        FROM work_items
      )
      SELECT * FROM ranked WHERE rn <= 3
    `);
      if ((result.rows as any[]).length === 0)
        throw new Error("CTE + window function returned no results");
    }
  );

  await time("25. RAW SQL - JSON aggregation", async () => {
    const result = await db.execute(sql`
      SELECT
        bc.name as column_name,
        json_agg(json_build_object('title', wi.title, 'priority', wi.priority))
          as items
      FROM board_columns bc
      LEFT JOIN work_items wi ON wi.board_column_id = bc.id
      GROUP BY bc.id, bc.name
    `);
    if ((result.rows as any[]).length === 0)
      throw new Error("JSON aggregation failed");
  });

  // ---- Cleanup ----
  await pglite.close();

  // ---- Results ----
  const totalDuration =
    Math.round((performance.now() - totalStart) * 100) / 100;

  console.log("\n" + "=".repeat(70));
  console.log("  RESULTS");
  console.log("=".repeat(70));

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  for (const r of results) {
    const icon = r.status === "PASS" ? "[PASS]" : "[FAIL]";
    const timing = `${r.durationMs}ms`.padStart(10);
    console.log(`  ${icon} ${timing}  ${r.name}`);
    if (r.error) {
      console.log(`                     Error: ${r.error}`);
    }
  }

  console.log("\n" + "-".repeat(70));
  console.log(`  Total: ${passed} passed, ${failed} failed, ${results.length} tests`);
  console.log(`  Total time: ${totalDuration}ms`);
  console.log("-".repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
