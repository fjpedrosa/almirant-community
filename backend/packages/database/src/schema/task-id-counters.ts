import { pgTable, varchar, text, integer, primaryKey } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";

export const taskIdCounters = pgTable("task_id_counters", {
  prefix: varchar("prefix", { length: 10 }).notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  nextNumber: integer("next_number").notNull().default(1),
}, (table) => [
  primaryKey({ columns: [table.prefix, table.workspaceId] }),
]);

export type TaskIdCounterDb = typeof taskIdCounters.$inferSelect;
export type NewTaskIdCounter = typeof taskIdCounters.$inferInsert;
