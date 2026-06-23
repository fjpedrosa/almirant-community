import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { boardAreaEnum, columnRoleEnum } from "./enums";
import { organization } from "./organization";

// Boards
export const boards = pgTable("boards", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  area: boardAreaEnum("area").notNull().default("general"),
  isDefault: boolean("is_default").default(false),
  // Optional board-level constraint used to restrict what work item types can be created.
  // Null/empty means "allow all" for backward compatibility.
  allowedTypes: jsonb("allowed_types").$type<Array<"epic" | "feature" | "story" | "task" | "idea">>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Board columns
export const boardColumns = pgTable("board_columns", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
  order: integer("order").notNull().default(0),
  role: columnRoleEnum("role").notNull().default("other"),
  isDone: boolean("is_done").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Board templates
export const boardTemplates = pgTable("board_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  area: boardAreaEnum("area").notNull().default("general"),
  columns: jsonb("columns").notNull().$type<
    Array<{ name: string; color: string; order: number; isDone: boolean; role?: "backlog" | "todo" | "in_progress" | "review" | "testing" | "needs_fix" | "validating" | "release" | "to_document" | "done" | "other" }>
  >(),
  isBuiltIn: boolean("is_built_in").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
export type BoardColumn = typeof boardColumns.$inferSelect;
export type NewBoardColumn = typeof boardColumns.$inferInsert;
export type BoardTemplate = typeof boardTemplates.$inferSelect;
export type NewBoardTemplate = typeof boardTemplates.$inferInsert;
