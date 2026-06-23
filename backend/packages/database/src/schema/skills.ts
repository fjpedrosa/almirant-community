import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { skillSourceEnum } from "./enums";
import { organization } from "./organization";
import { projects } from "./projects";
import { user } from "./auth";

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    source: skillSourceEnum("source").notNull().default("custom"),
    sourcePath: text("source_path"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skills_slug_org_project_idx").on(
      table.slug,
      table.organizationId,
      table.projectId
    ),
    index("skills_organization_id_idx").on(table.organizationId),
    index("skills_project_id_idx").on(table.projectId),
    index("skills_source_idx").on(table.source),
    index("skills_content_hash_idx").on(table.contentHash),
    index("skills_archived_at_idx").on(table.archivedAt),
  ]
);

export type SkillDb = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
