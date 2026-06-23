import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { boards } from "./boards";
import { conversationStatusEnum } from "./enums";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    messages: jsonb("messages").notNull().default([]).$type<ConversationMessage[]>(),
    generatedWorkItemIds: jsonb("generated_work_item_ids").default([]).$type<string[]>(),
    status: conversationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_conversations_project_idx").on(table.projectId),
    index("ai_conversations_board_idx").on(table.boardId),
    index("ai_conversations_status_idx").on(table.status),
    index("ai_conversations_created_at_idx").on(table.createdAt),
  ]
);

export type AiConversationDb = typeof aiConversations.$inferSelect;
export type NewAiConversation = typeof aiConversations.$inferInsert;
