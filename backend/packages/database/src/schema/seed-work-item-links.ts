import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { seeds } from "./seeds";
import { workItems } from "./work-items";
import { ideaItemWorkLinkTypeEnum } from "./enums";
import { user } from "./auth";

export const seedWorkItemLinks = pgTable(
  "seed_work_item_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seedId: uuid("seed_id")
      .notNull()
      .references(() => seeds.id, { onDelete: "cascade" }),
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
    uniqueIndex("seed_work_item_links_unique_idx").on(table.seedId, table.workItemId),
    index("seed_work_item_links_seed_idx").on(table.seedId),
    index("seed_work_item_links_work_item_idx").on(table.workItemId),
    index("seed_work_item_links_type_idx").on(table.linkType),
  ]
);

export type SeedWorkItemLink = typeof seedWorkItemLinks.$inferSelect;
export type NewSeedWorkItemLink = typeof seedWorkItemLinks.$inferInsert;
