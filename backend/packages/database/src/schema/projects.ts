import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { projectStatusEnum, docLinkTypeEnum, repositoryProviderEnum } from "./enums";
import type { ProjectAgentDefaults } from "../repositories/agents/backlog-drain-selection";
import { organization } from "./organization";

// Projects table
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  folderPath: text("folder_path"),
  color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
  icon: varchar("icon", { length: 50 }),
  status: projectStatusEnum("status").notNull().default("active"),
  clientName: varchar("client_name", { length: 255 }),
  productionUrl: text("production_url"),
  stagingUrl: text("staging_url"),
  screenshotUrl: text("screenshot_url"),
  techStack: text("tech_stack").array(),
  organizationId: text("organization_id").references(() => organization.id, { onDelete: "set null" }),
  skillConfig: jsonb("skill_config").$type<{
    skillSet: "platform" | "custom";
    customSkillsUrl: string | null;
    disabledSkills: string[];
    agentInstructions: string;
  }>().default({ skillSet: "platform", customSkillsUrl: null, disabledSkills: [], agentInstructions: "" }),
  nightlyValidation: jsonb("nightly_validation").default({
    enabled: false,
    startHour: 1,
    endHour: 6,
    timezone: "Europe/Madrid",
    provider: "claude-code",
  }),
  defaultProvider: varchar("default_provider", { length: 50 }),
  agentDefaults: jsonb("agent_defaults").$type<ProjectAgentDefaults>().default({}).notNull(),
  startDate: timestamp("start_date", { withTimezone: true }),
  targetDate: timestamp("target_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("projects_organization_id_idx").on(table.organizationId),
]);

// Project doc links
export const projectDocLinks = pgTable("project_doc_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  url: text("url").notNull(),
  type: docLinkTypeEnum("type").notNull().default("other"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Project repositories
export const projectRepositories = pgTable("project_repositories", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  url: text("url").notNull(),
  provider: repositoryProviderEnum("provider").notNull().default("github"),
  isMonorepo: boolean("is_monorepo").default(false),
  docsPath: varchar("docs_path", { length: 500 }),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Project notes (markdown)
export const projectNotes = pgTable("project_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectDocLink = typeof projectDocLinks.$inferSelect;
export type NewProjectDocLink = typeof projectDocLinks.$inferInsert;
export type ProjectRepositoryDb = typeof projectRepositories.$inferSelect;
export type NewProjectRepository = typeof projectRepositories.$inferInsert;
export type ProjectNote = typeof projectNotes.$inferSelect;
export type NewProjectNote = typeof projectNotes.$inferInsert;
