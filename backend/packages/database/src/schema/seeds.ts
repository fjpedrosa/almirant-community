import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { seedStatusEnum, seedSourceEnum, priorityEnum } from "./enums";
import { projects } from "./projects";
import { organization } from "./organization";
import { user } from "./auth";

export const seeds = pgTable(
  "seeds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    status: seedStatusEnum("status").notNull().default("draft"),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    source: seedSourceEnum("source").notNull().default("manual"),
    priority: priorityEnum("priority"),
    selectedForIdeation: boolean("selected_for_ideation").notNull().default(false),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    maturityLevel: integer("maturity_level").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("seeds_organization_idx").on(table.organizationId),
    index("seeds_project_idx").on(table.projectId),
    index("seeds_status_idx").on(table.status),
    index("seeds_owner_user_idx").on(table.ownerUserId),
    index("seeds_selected_for_ideation_idx").on(table.selectedForIdeation),
    index("seeds_project_selected_status_idx").on(table.projectId, table.selectedForIdeation, table.status),
  ]
);

export type Seed = typeof seeds.$inferSelect;
export type NewSeed = typeof seeds.$inferInsert;
