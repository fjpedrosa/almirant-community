import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ideaItemTypeEnum, ideaItemStatusEnum } from "./enums";
import { projects } from "./projects";
import { workspace } from "./workspace";
import { user } from "./auth";

export const ideaItems = pgTable(
  "idea_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    type: ideaItemTypeEnum("type").notNull().default("idea"),
    status: ideaItemStatusEnum("status").notNull().default("active"),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    discussed: boolean("discussed").notNull().default(false),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idea_items_workspace_idx").on(table.workspaceId),
    index("idea_items_project_idx").on(table.projectId),
    index("idea_items_owner_user_idx").on(table.ownerUserId),
    index("idea_items_created_by_user_idx").on(table.createdByUserId),
    index("idea_items_type_status_idx").on(table.type, table.status),
    index("idea_items_due_date_idx").on(table.dueDate),
    index("idea_items_discussed_idx").on(table.discussed),
    index("idea_items_completed_at_idx").on(table.completedAt),
    check(
      "idea_items_type_status_check",
      sql`(
        (${table.type} = 'idea' AND ${table.status} IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
        OR
        (${table.type} = 'seed' AND ${table.status} IN ('draft', 'active', 'to_review', 'approved', 'archived', 'rejected'))
      )`
    ),
  ]
);

export type IdeaItem = typeof ideaItems.$inferSelect;
export type NewIdeaItem = typeof ideaItems.$inferInsert;
