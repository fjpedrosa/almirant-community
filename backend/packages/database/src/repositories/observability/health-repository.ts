import { sql } from "drizzle-orm";
import { db } from "../../client";
import {
  healthCheckRecords,
  type HealthCheckRecord,
  type NewHealthCheckRecord,
} from "../../schema/health";

/**
 * Persist a batch of health check results.
 *
 * Returns the inserted rows. Skips the database round-trip entirely when
 * called with an empty batch.
 */
export const insertHealthChecks = async (
  checks: NewHealthCheckRecord[]
): Promise<HealthCheckRecord[]> => {
  if (checks.length === 0) return [];

  return db.insert(healthCheckRecords).values(checks).returning();
};

/**
 * Delete health check records older than the retention window.
 *
 * @param retentionHours - How many hours of history to keep (default 168 = 7 days).
 * @returns Number of deleted records.
 */
export const cleanOldHealthRecords = async (
  retentionHours: number = 168
): Promise<number> => {
  const hours = Math.max(1, Math.floor(retentionHours));

  const deleted = await db
    .delete(healthCheckRecords)
    .where(
      sql`${healthCheckRecords.checkedAt} < NOW() - INTERVAL '${sql.raw(String(hours))} hours'`
    )
    .returning({ id: healthCheckRecords.id });

  return deleted.length;
};
