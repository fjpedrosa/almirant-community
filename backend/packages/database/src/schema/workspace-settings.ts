import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";
import { aiKeyPolicyEnum, orchestrationStrategyEnum } from "./enums";

export const workspaceSettings = pgTable("workspace_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspace.id, { onDelete: "cascade" }),
  aiKeyPolicy: aiKeyPolicyEnum("ai_key_policy").default("user_preferred").notNull(),
  orchestrationStrategy: orchestrationStrategyEnum("orchestration_strategy"),
  maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
export type NewWorkspaceSettings = typeof workspaceSettings.$inferInsert;
