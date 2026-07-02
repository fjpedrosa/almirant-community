import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { integrationBatchStatusEnum } from "./enums";
import { workspace } from "./workspace";
import { projects, projectRepositories } from "./projects";
import { boards } from "./boards";
import { user } from "./auth";

export const integrationBatches = pgTable(
  "integration_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => projectRepositories.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    integrationBranch: varchar("integration_branch", { length: 255 }).notNull(),
    baseBranch: varchar("base_branch", { length: 255 }).notNull().default("main"),
    // Nullable because legacy `integration/<timestamp>` batches predate this feature.
    // The new release flow always sets it; queries should filter `releaseNumber IS NOT NULL`.
    releaseNumber: integer("release_number"),
    status: integrationBatchStatusEnum("status").notNull().default("queued"),
    triggeredByUserId: text("triggered_by_user_id").references(() => user.id, { onDelete: "set null" }),
    currentItemIndex: integer("current_item_index").notNull().default(0),
    sandboxContainerId: varchar("sandbox_container_id", { length: 128 }),
    finalPrUrl: text("final_pr_url"),
    finalPrNumber: integer("final_pr_number"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_batches_workspace_idx").on(table.workspaceId),
    index("integration_batches_project_idx").on(table.projectId),
    index("integration_batches_repository_idx").on(table.repositoryId),
    index("integration_batches_board_idx").on(table.boardId),
    index("integration_batches_status_idx").on(table.status),
    index("integration_batches_repository_status_idx").on(table.repositoryId, table.status),
    uniqueIndex("integration_batches_repository_release_number_idx").on(
      table.repositoryId,
      table.releaseNumber,
    ),
  ]
);

export type IntegrationBatch = typeof integrationBatches.$inferSelect;
export type NewIntegrationBatch = typeof integrationBatches.$inferInsert;
