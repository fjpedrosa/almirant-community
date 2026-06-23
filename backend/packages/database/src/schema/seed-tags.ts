import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { seeds } from "./seeds";
import { tags } from "./tags";

export const seedTags = pgTable(
  "seed_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seedId: uuid("seed_id")
      .notNull()
      .references(() => seeds.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("seed_tags_unique_idx").on(table.seedId, table.tagId),
  ]
);

export type SeedTag = typeof seedTags.$inferSelect;
export type NewSeedTag = typeof seedTags.$inferInsert;
