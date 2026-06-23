import { pgTable, varchar, text, integer, primaryKey } from "drizzle-orm/pg-core";
import { organization } from "./organization";

export const taskIdCounters = pgTable("task_id_counters", {
  prefix: varchar("prefix", { length: 10 }).notNull(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  nextNumber: integer("next_number").notNull().default(1),
}, (table) => [
  primaryKey({ columns: [table.prefix, table.organizationId] }),
]);

export type TaskIdCounterDb = typeof taskIdCounters.$inferSelect;
export type NewTaskIdCounter = typeof taskIdCounters.$inferInsert;
