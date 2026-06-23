import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { planningSessions } from "./planning-sessions";

export const eventArchives = pgTable(
  "event_archives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planningSessionId: uuid("planning_session_id")
      .notNull()
      .references(() => planningSessions.id, { onDelete: "cascade" }),
    archiveKind: varchar("archive_kind", { length: 64 }).notNull(),
    storageBucket: varchar("storage_bucket", { length: 255 }),
    storageKey: text("storage_key").notNull(),
    storageUrl: text("storage_url"),
    format: varchar("format", { length: 32 }).notNull(),
    compression: varchar("compression", { length: 16 }).notNull().default("gzip"),
    contentType: varchar("content_type", { length: 128 }),
    rowCount: integer("row_count").notNull().default(0),
    lastSequenceNum: integer("last_sequence_num"),
    projectorVersion: integer("projector_version"),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_archives_session_kind_unique_idx").on(
      table.planningSessionId,
      table.archiveKind,
    ),
    index("event_archives_session_idx").on(table.planningSessionId),
    index("event_archives_kind_archived_at_idx").on(table.archiveKind, table.archivedAt),
  ],
);

export type EventArchiveDb = typeof eventArchives.$inferSelect;
export type NewEventArchive = typeof eventArchives.$inferInsert;
