import { pgTable, uuid, text, varchar, numeric, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { expenseStatusEnum, invoiceProcessingStatusEnum, currencyCodeEnum } from "./enums";
import { workspace } from "./workspace";
import { projects } from "./projects";
import { expenseCategories } from "./expense-categories";
import { user } from "./auth";

export const expenses = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
  paidByUserId: text("paid_by_user_id").references(() => user.id, { onDelete: "set null" }),
  recurringExpenseId: uuid("recurring_expense_id"),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  vendor: varchar("vendor", { length: 300 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: currencyCodeEnum("currency").notNull().default("EUR"),
  amountEur: numeric("amount_eur", { precision: 12, scale: 2 }),
  exchangeRate: numeric("exchange_rate", { precision: 16, scale: 8 }),
  status: expenseStatusEnum("status").notNull().default("draft"),
  expenseDate: timestamp("expense_date", { withTimezone: true }).notNull(),
  // Invoice fields
  invoiceFileName: varchar("invoice_file_name", { length: 500 }),
  invoiceFileUrl: text("invoice_file_url"),
  invoiceFileSize: integer("invoice_file_size"),
  invoiceMimeType: varchar("invoice_mime_type", { length: 100 }),
  invoiceProcessingStatus: invoiceProcessingStatusEnum("invoice_processing_status"),
  invoiceProcessedData: jsonb("invoice_processed_data").$type<Record<string, unknown>>(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("expenses_org_idx").on(table.workspaceId),
  index("expenses_project_idx").on(table.projectId),
  index("expenses_category_idx").on(table.categoryId),
  index("expenses_paid_by_idx").on(table.paidByUserId),
  index("expenses_status_idx").on(table.status),
  index("expenses_currency_idx").on(table.currency),
  index("expenses_date_idx").on(table.expenseDate),
  index("expenses_vendor_idx").on(table.vendor),
  index("expenses_recurring_idx").on(table.recurringExpenseId),
  index("expenses_archived_idx").on(table.archivedAt),
  index("expenses_org_status_date_idx").on(table.workspaceId, table.status, table.expenseDate),
]);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
