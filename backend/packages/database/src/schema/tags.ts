import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";

// Tags table
export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tags_name_organization_id_idx").on(table.name, table.organizationId),
  index("tags_organization_id_idx").on(table.organizationId),
]);

// Type exports
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
