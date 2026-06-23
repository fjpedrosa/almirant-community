import { pgTable, uuid, text, varchar, boolean, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organization } from "./organization";

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"), // self-referential, added in relations.ts
  name: varchar("name", { length: 200 }).notNull(),
  icon: varchar("icon", { length: 100 }),
  color: varchar("color", { length: 20 }),
  order: integer("order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("expense_categories_name_org_idx").on(table.name, table.organizationId),
  index("expense_categories_org_idx").on(table.organizationId),
  index("expense_categories_parent_idx").on(table.parentId),
]);

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type NewExpenseCategory = typeof expenseCategories.$inferInsert;
