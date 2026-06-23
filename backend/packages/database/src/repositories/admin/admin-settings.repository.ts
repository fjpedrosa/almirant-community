import { db } from "../../client";
import { systemSettings } from "../../schema/system-settings";
import { eq, sql } from "drizzle-orm";
import type { SystemSettings, AgentRoutingMap } from "../../schema/system-settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateSystemSettingsData {
  maintenanceMode?: boolean;
  maxUploadSizeMb?: number;
  defaultLocale?: string;
  allowNewRegistrations?: boolean;
  sessionTimeoutMinutes?: number;
  agentRouting?: AgentRoutingMap;
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * Get the system settings row, inserting a default row if none exists.
 * The table is designed to hold exactly one row.
 */
export const getSystemSettings = async (): Promise<SystemSettings> => {
  const rows = await db.select().from(systemSettings).limit(1);

  if (rows.length > 0) {
    const [settings] = rows;
    if (settings) {
      return settings;
    }
  }

  // No row exists yet — insert defaults and return
  const [inserted] = await db
    .insert(systemSettings)
    .values({})
    .returning();

  if (!inserted) {
    throw new Error("Failed to create default system settings");
  }

  return inserted;
};

/**
 * Update system settings with a partial merge.
 * Creates the row first if it doesn't exist (upsert pattern).
 */
export const updateSystemSettings = async (
  data: UpdateSystemSettingsData,
  userId: string
): Promise<SystemSettings> => {
  // Ensure the row exists
  const current = await getSystemSettings();

  const [updated] = await db
    .update(systemSettings)
    .set({
      ...data,
      updatedBy: userId,
      updatedAt: sql`now()`,
    })
    .where(eq(systemSettings.id, current.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to update system settings");
  }

  return updated;
};
