import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  bigint,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  githubPrStateEnum,
  githubReviewStatusEnum,
  githubCiStatusEnum,
  githubEventTypeEnum,
} from "./enums";
import { projectRepositories } from "./projects";
import { providerConnections } from "./provider-connections";

// Links between project repositories and provider connections (GitHub installations)
export const repoInstallationLinks = pgTable("repo_installation_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => projectRepositories.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => providerConnections.id, { onDelete: "cascade" }),
  githubRepoFullName: varchar("github_repo_full_name", { length: 512 }).notNull(),
  defaultBranch: varchar("default_branch", { length: 255 }).default("main"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// GitHub commits cached locally
export const githubCommits = pgTable("github_commits", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => projectRepositories.id, { onDelete: "cascade" }),
  sha: varchar("sha", { length: 40 }).notNull(),
  message: text("message").notNull(),
  authorLogin: varchar("author_login", { length: 255 }),
  authorName: varchar("author_name", { length: 255 }),
  authorAvatarUrl: text("author_avatar_url"),
  branch: varchar("branch", { length: 255 }),
  additions: integer("additions").default(0),
  deletions: integer("deletions").default(0),
  committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("github_commits_repo_sha_idx").on(table.repoId, table.sha),
]);

// GitHub pull requests cached locally
export const githubPullRequests = pgTable("github_pull_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => projectRepositories.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  body: text("body"),
  state: githubPrStateEnum("state").notNull().default("open"),
  authorLogin: varchar("author_login", { length: 255 }),
  authorAvatarUrl: text("author_avatar_url"),
  labels: jsonb("labels").default([]),
  reviewStatus: githubReviewStatusEnum("review_status").notNull().default("pending"),
  ciStatus: githubCiStatusEnum("ci_status").notNull().default("pending"),
  baseBranch: varchar("base_branch", { length: 255 }),
  headBranch: varchar("head_branch", { length: 255 }),
  additions: integer("additions").default(0),
  deletions: integer("deletions").default(0),
  htmlUrl: text("html_url"),
  isDraft: boolean("is_draft").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  mergedAt: timestamp("merged_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("github_prs_repo_number_idx").on(table.repoId, table.number),
]);

// GitHub workflow runs cached locally
export const githubWorkflowRuns = pgTable("github_workflow_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => projectRepositories.id, { onDelete: "cascade" }),
  runId: bigint("run_id", { mode: "number" }).notNull(),
  name: varchar("name", { length: 255 }),
  status: varchar("status", { length: 50 }),
  conclusion: varchar("conclusion", { length: 50 }),
  branch: varchar("branch", { length: 255 }),
  headSha: varchar("head_sha", { length: 40 }),
  htmlUrl: text("html_url"),
  event: varchar("event", { length: 50 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("github_workflow_runs_repo_run_idx").on(table.repoId, table.runId),
]);

// GitHub events (activity feed)
export const githubEvents = pgTable("github_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => projectRepositories.id, { onDelete: "cascade" }),
  eventType: githubEventTypeEnum("event_type").notNull(),
  action: varchar("action", { length: 100 }),
  actorLogin: varchar("actor_login", { length: 255 }),
  actorAvatarUrl: text("actor_avatar_url"),
  summary: text("summary"),
  payload: jsonb("payload").default({}),
  githubDeliveryId: varchar("github_delivery_id", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type RepoInstallationLink = typeof repoInstallationLinks.$inferSelect;
export type NewRepoInstallationLink = typeof repoInstallationLinks.$inferInsert;
export type GithubCommit = typeof githubCommits.$inferSelect;
export type NewGithubCommit = typeof githubCommits.$inferInsert;
export type GithubPullRequest = typeof githubPullRequests.$inferSelect;
export type NewGithubPullRequest = typeof githubPullRequests.$inferInsert;
export type GithubWorkflowRun = typeof githubWorkflowRuns.$inferSelect;
export type NewGithubWorkflowRun = typeof githubWorkflowRuns.$inferInsert;
export type GithubEvent = typeof githubEvents.$inferSelect;
export type NewGithubEvent = typeof githubEvents.$inferInsert;
