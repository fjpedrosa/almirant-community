import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspace } from "./workspace";

export type UserStorageObjectKind = "file" | "plugin_bundle";
export type UserStorageObjectStatus = "pending" | "ready";

export const userStorageUsage = pgTable(
  "user_storage_usage",
  {
    ownerUserId: text("owner_user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    quotaBytes: bigint("quota_bytes", { mode: "number" })
      .notNull()
      .default(1_073_741_824),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
    reservedBytes: bigint("reserved_bytes", { mode: "number" })
      .notNull()
      .default(0),
    quotaObjects: integer("quota_objects").notNull().default(10_000),
    usedObjects: integer("used_objects").notNull().default(0),
    reservedObjects: integer("reserved_objects").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("user_storage_usage_quota_nonnegative", sql`${table.quotaBytes} >= 0`),
    check("user_storage_usage_used_nonnegative", sql`${table.usedBytes} >= 0`),
    check(
      "user_storage_usage_reserved_nonnegative",
      sql`${table.reservedBytes} >= 0`,
    ),
    check(
      "user_storage_usage_capacity_check",
      sql`${table.usedBytes} + ${table.reservedBytes} <= ${table.quotaBytes}`,
    ),
    check(
      "user_storage_usage_object_quota_nonnegative",
      sql`${table.quotaObjects} >= 0`,
    ),
    check(
      "user_storage_usage_used_objects_nonnegative",
      sql`${table.usedObjects} >= 0`,
    ),
    check(
      "user_storage_usage_reserved_objects_nonnegative",
      sql`${table.reservedObjects} >= 0`,
    ),
    check(
      "user_storage_usage_object_capacity_check",
      sql`${table.usedObjects} + ${table.reservedObjects} <= ${table.quotaObjects}`,
    ),
  ],
);

export const userStorageDeletions = pgTable(
  "user_storage_deletions",
  {
    objectKey: text("object_key").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("user_storage_deletions_next_attempt_idx").on(
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    index("user_storage_deletions_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const userStorageObjects = pgTable(
  "user_storage_objects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspace.id, {
      onDelete: "set null",
    }),
    objectKey: text("object_key").notNull(),
    virtualPath: text("virtual_path").notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 255 })
      .notNull()
      .default("application/octet-stream"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 32 })
      .$type<UserStorageObjectKind>()
      .notNull()
      .default("file"),
    status: varchar("status", { length: 32 })
      .$type<UserStorageObjectStatus>()
      .notNull()
      .default("pending"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("user_storage_objects_object_key_unique").on(table.objectKey),
    index("user_storage_objects_owner_user_id_idx").on(table.ownerUserId),
    index("user_storage_objects_workspace_id_idx").on(table.workspaceId),
    index("user_storage_objects_kind_idx").on(table.kind),
    index("user_storage_objects_status_idx").on(table.status),
    uniqueIndex("user_storage_objects_owner_ready_path_uidx")
      .on(table.ownerUserId, table.virtualPath)
      .where(sql`${table.status} = 'ready'`),
    check("user_storage_objects_size_nonnegative", sql`${table.sizeBytes} >= 0`),
    check(
      "user_storage_objects_kind_check",
      sql`${table.kind} IN ('file', 'plugin_bundle')`,
    ),
    check(
      "user_storage_objects_status_check",
      sql`${table.status} IN ('pending', 'ready')`,
    ),
  ],
);

export type UserStorageUsageDb = typeof userStorageUsage.$inferSelect;
export type NewUserStorageUsage = typeof userStorageUsage.$inferInsert;
export type UserStorageObjectDb = typeof userStorageObjects.$inferSelect;
export type NewUserStorageObject = typeof userStorageObjects.$inferInsert;
export type UserStorageDeletionDb = typeof userStorageDeletions.$inferSelect;
