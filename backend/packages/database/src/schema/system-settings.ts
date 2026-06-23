import { pgTable, uuid, boolean, integer, varchar, timestamp, text, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Per-skill override of the coding agent, provider connection ("account")
 * and/or model used when `createJob` enqueues one of Almirant's internal
 * processes. Only the skills listed in `INTERNAL_SKILL_KEYS` are honoured;
 * entries for other skills are ignored by the resolver. Any field left
 * `null` falls back to the next resolution layer (explicit caller input →
 * hardcoded default).
 *
 * `providerConnectionId` points to a row in `provider_connections` (category
 * = `ai`). When set, the runner uses those specific credentials instead of
 * falling through the org's default resolution order.
 *
 * `aiProvider` is retained only for backwards-compatibility with rows
 * persisted before the connection-based flow existed; new entries should
 * leave it `null` and rely on the connection's own `provider`.
 */
export type AgentRoutingEntry = {
  codingAgent: string | null;
  aiProvider: string | null;
  model: string | null;
  providerConnectionId: string | null;
};

export type AgentRoutingMap = Record<string, AgentRoutingEntry>;

/**
 * Canonical list of Almirant-internal skills that the admin settings UI
 * exposes for per-skill model/agent overrides. Entries for other skills are
 * ignored by the resolver so user-triggered skills keep their own defaults.
 */
export const INTERNAL_SKILL_KEYS = [
  "feedback-bug-analyze",
  "feedback-bug-fix",
  "feedback-triage",
  "feedback-triage-batch",
  "incident-analyze",
] as const;

export type InternalSkillKey = (typeof INTERNAL_SKILL_KEYS)[number];

export const systemSettings = pgTable("system_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  maintenanceMode: boolean("maintenance_mode").default(false).notNull(),
  maxUploadSizeMb: integer("max_upload_size_mb").default(50).notNull(),
  defaultLocale: varchar("default_locale", { length: 10 }).default("es").notNull(),
  allowNewRegistrations: boolean("allow_new_registrations").default(true).notNull(),
  sessionTimeoutMinutes: integer("session_timeout_minutes").default(1440).notNull(),
  agentRouting: jsonb("agent_routing").$type<AgentRoutingMap>().default({}).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by").references(() => user.id),
});

export type SystemSettings = typeof systemSettings.$inferSelect;
export type NewSystemSettings = typeof systemSettings.$inferInsert;
