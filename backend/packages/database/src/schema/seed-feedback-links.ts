import {
  pgTable,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { seeds } from "./seeds";
import { feedbackItems } from "./feedback-items";

export const seedFeedbackLinks = pgTable(
  "seed_feedback_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seedId: uuid("seed_id")
      .notNull()
      .references(() => seeds.id, { onDelete: "cascade" }),
    feedbackItemId: uuid("feedback_item_id")
      .notNull()
      .references(() => feedbackItems.id, { onDelete: "cascade" }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("seed_feedback_links_unique_idx").on(table.seedId, table.feedbackItemId),
    index("seed_feedback_links_seed_idx").on(table.seedId),
    index("seed_feedback_links_feedback_idx").on(table.feedbackItemId),
  ]
);

export type SeedFeedbackLink = typeof seedFeedbackLinks.$inferSelect;
export type NewSeedFeedbackLink = typeof seedFeedbackLinks.$inferInsert;
