import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { contactReasonEnum, contactStatusEnum } from "./enums";

export const contactSubmissions = pgTable(
  "contact_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    reason: contactReasonEnum("reason").notNull(),
    message: text("message").notNull(),
    status: contactStatusEnum("status").notNull().default("new"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("contact_submissions_status_created_idx").on(table.status, table.createdAt),
    index("contact_submissions_email_idx").on(table.email),
  ]
);

export type ContactSubmission = typeof contactSubmissions.$inferSelect;
export type NewContactSubmission = typeof contactSubmissions.$inferInsert;
