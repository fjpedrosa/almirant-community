import {
  pgTable,
  uuid,
  timestamp,
  jsonb,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ideaItems } from "./idea-items";
import { feedbackItems } from "./feedback-items";
import { workItems } from "./work-items";
import { ideaItemWorkLinkTypeEnum } from "./enums";
import { user } from "./auth";

export const ideaItemFeedbackLinks = pgTable(
  "idea_item_feedback_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ideaItemId: uuid("idea_item_id")
      .notNull()
      .references(() => ideaItems.id, { onDelete: "cascade" }),
    feedbackItemId: uuid("feedback_item_id")
      .notNull()
      .references(() => feedbackItems.id, { onDelete: "cascade" }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idea_item_feedback_links_unique_idx").on(table.ideaItemId, table.feedbackItemId),
    index("idea_item_feedback_links_idea_item_idx").on(table.ideaItemId),
    index("idea_item_feedback_links_feedback_item_idx").on(table.feedbackItemId),
  ]
);

export const ideaItemWorkItemLinks = pgTable(
  "idea_item_work_item_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ideaItemId: uuid("idea_item_id")
      .notNull()
      .references(() => ideaItems.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    linkType: ideaItemWorkLinkTypeEnum("link_type").notNull().default("related_to"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idea_item_work_item_links_unique_idx").on(table.ideaItemId, table.workItemId),
    index("idea_item_work_item_links_idea_item_idx").on(table.ideaItemId),
    index("idea_item_work_item_links_work_item_idx").on(table.workItemId),
    index("idea_item_work_item_links_type_idx").on(table.linkType),
  ]
);

export type IdeaItemFeedbackLink = typeof ideaItemFeedbackLinks.$inferSelect;
export type NewIdeaItemFeedbackLink = typeof ideaItemFeedbackLinks.$inferInsert;
export type IdeaItemWorkItemLink = typeof ideaItemWorkItemLinks.$inferSelect;
export type NewIdeaItemWorkItemLink = typeof ideaItemWorkItemLinks.$inferInsert;
