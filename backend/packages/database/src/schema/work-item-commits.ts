import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { workItems } from "./work-items";
import { githubCommits } from "./github";

// Work item <-> GitHub commit link (many-to-many)
export const workItemCommits = pgTable(
  "work_item_commits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    commitId: uuid("commit_id")
      .notNull()
      .references(() => githubCommits.id, { onDelete: "cascade" }),
    autoLinked: boolean("auto_linked").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("work_item_commits_unique_idx").on(
      table.workItemId,
      table.commitId
    ),
    index("work_item_commits_work_item_idx").on(table.workItemId),
    index("work_item_commits_commit_idx").on(table.commitId),
  ]
);

// Type exports
export type WorkItemCommit = typeof workItemCommits.$inferSelect;
export type NewWorkItemCommit = typeof workItemCommits.$inferInsert;
