import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const INSTANCE_TAILNET_DATABASE_ACCESS_SINGLETON_KEY = "default";

export type TailnetDatabaseAuthMethod = "auth_key" | "oauth_client";
export type TailnetDatabaseAccessStatus =
  | "not_configured"
  | "provisioning"
  | "connected"
  | "error";

export const instanceTailnetDatabaseAccess = pgTable(
  "instance_tailnet_database_access",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    singleton: text("singleton")
      .notNull()
      .default(INSTANCE_TAILNET_DATABASE_ACCESS_SINGLETON_KEY),
    enabled: boolean("enabled").default(false).notNull(),
    status: text("status")
      .$type<TailnetDatabaseAccessStatus>()
      .default("not_configured")
      .notNull(),
    authMethod: text("auth_method").$type<TailnetDatabaseAuthMethod | null>(),
    hostname: varchar("hostname", { length: 63 }).default("almirant-db").notNull(),
    tag: varchar("tag", { length: 128 }).default("tag:almirant-db").notNull(),
    tailscaleIp: text("tailscale_ip"),
    tailnetName: text("tailnet_name"),
    lastJobId: text("last_job_id"),
    lastError: text("last_error"),
    encryptedCredentials: text("encrypted_credentials"),
    credentialsIv: text("credentials_iv"),
    credentialsAuthTag: text("credentials_auth_tag"),
    connectionTestedAt: timestamp("connection_tested_at", { withTimezone: true }),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("instance_tailnet_database_access_singleton_unique_idx").on(
      table.singleton,
    ),
  ],
);

export type InstanceTailnetDatabaseAccess =
  typeof instanceTailnetDatabaseAccess.$inferSelect;
export type NewInstanceTailnetDatabaseAccess =
  typeof instanceTailnetDatabaseAccess.$inferInsert;
