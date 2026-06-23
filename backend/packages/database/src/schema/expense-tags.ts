import { pgTable, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { expenses } from "./expenses";
import { tags } from "./tags";

export const expenseTags = pgTable("expense_tags", {
  expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("expense_tags_unique_idx").on(table.expenseId, table.tagId),
]);

export type ExpenseTag = typeof expenseTags.$inferSelect;
