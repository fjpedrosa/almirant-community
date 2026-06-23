import { pgTable, uuid, text, varchar, numeric, boolean, timestamp, integer, index } from "drizzle-orm/pg-core";
import { expenseRecurrenceEnum, currencyCodeEnum } from "./enums";
import { organization } from "./organization";
import { projects } from "./projects";
import { expenseCategories } from "./expense-categories";
import { user } from "./auth";

export const recurringExpenses = pgTable("recurring_expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
  paidByUserId: text("paid_by_user_id").references(() => user.id, { onDelete: "set null" }),
  title: varchar("title", { length: 500 }).notNull(),
  vendor: varchar("vendor", { length: 300 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: currencyCodeEnum("currency").notNull().default("EUR"),
  recurrence: expenseRecurrenceEnum("recurrence").notNull(),
  anchorDate: timestamp("anchor_date", { withTimezone: true }).notNull(),
  nextRenewalDate: timestamp("next_renewal_date", { withTimezone: true }),
  alertDaysBefore: integer("alert_days_before").default(7),
  isActive: boolean("is_active").default(true).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("recurring_expenses_org_idx").on(table.organizationId),
  index("recurring_expenses_project_idx").on(table.projectId),
  index("recurring_expenses_category_idx").on(table.categoryId),
  index("recurring_expenses_paid_by_idx").on(table.paidByUserId),
  index("recurring_expenses_active_idx").on(table.isActive),
  index("recurring_expenses_renewal_idx").on(table.nextRenewalDate),
  index("recurring_expenses_vendor_idx").on(table.vendor),
  index("recurring_expenses_org_active_renewal_idx").on(table.organizationId, table.isActive, table.nextRenewalDate),
]);

export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type NewRecurringExpense = typeof recurringExpenses.$inferInsert;
