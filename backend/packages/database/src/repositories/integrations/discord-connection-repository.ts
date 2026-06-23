import { db } from "../../client";
import {
  discordConnections,
  discordProjectChannels,
  discordNotificationPreferences,
} from "../../schema";
import { eq, and, isNull } from "drizzle-orm";
import type {
  DiscordConnection,
  NewDiscordConnection,
  DiscordProjectChannel,
  NewDiscordProjectChannel,
  DiscordNotificationPreference,
  NewDiscordNotificationPreference,
} from "../../schema/discord-connections";

// ---------------------------------------------------------------------------
// Discord Connections
// ---------------------------------------------------------------------------

/**
 * Get the active Discord connection for an organization.
 */
export const getDiscordConnectionByOrganization = async (
  organizationId: string,
): Promise<DiscordConnection | null> => {
  const [row] = await db
    .select()
    .from(discordConnections)
    .where(
      and(
        eq(discordConnections.organizationId, organizationId),
        eq(discordConnections.isActive, true),
      ),
    )
    .limit(1);

  return row ?? null;
};

/**
 * Get a Discord connection by ID, scoped to an organization.
 */
export const getDiscordConnectionById = async (
  id: string,
  organizationId: string,
): Promise<DiscordConnection | null> => {
  const [row] = await db
    .select()
    .from(discordConnections)
    .where(
      and(
        eq(discordConnections.id, id),
        eq(discordConnections.organizationId, organizationId),
      ),
    )
    .limit(1);

  return row ?? null;
};

/**
 * Create a new Discord connection.
 */
export const createDiscordConnection = async (
  data: NewDiscordConnection,
): Promise<DiscordConnection> => {
  const [created] = await db
    .insert(discordConnections)
    .values(data)
    .returning();

  if (!created) throw new Error("Failed to create Discord connection");
  return created;
};

/**
 * Update a Discord connection (partial update), scoped to an organization.
 */
export const updateDiscordConnection = async (
  id: string,
  organizationId: string,
  data: Partial<
    Omit<NewDiscordConnection, "id" | "createdAt" | "organizationId">
  >,
): Promise<DiscordConnection | null> => {
  const [updated] = await db
    .update(discordConnections)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(discordConnections.id, id),
        eq(discordConnections.organizationId, organizationId),
      ),
    )
    .returning();

  return updated ?? null;
};

/**
 * Hard delete a Discord connection, scoped to an organization.
 * Project channels are cascaded automatically by the FK constraint.
 */
export const deleteDiscordConnection = async (
  id: string,
  organizationId: string,
): Promise<boolean> => {
  const deleted = await db
    .delete(discordConnections)
    .where(
      and(
        eq(discordConnections.id, id),
        eq(discordConnections.organizationId, organizationId),
      ),
    )
    .returning({ id: discordConnections.id });

  return deleted.length > 0;
};

// ---------------------------------------------------------------------------
// Discord Project Channels
// ---------------------------------------------------------------------------

/**
 * Get a project channel override for a specific connection + project.
 */
export const getDiscordProjectChannel = async (
  connectionId: string,
  projectId: string,
): Promise<DiscordProjectChannel | null> => {
  const [row] = await db
    .select()
    .from(discordProjectChannels)
    .where(
      and(
        eq(discordProjectChannels.discordConnectionId, connectionId),
        eq(discordProjectChannels.projectId, projectId),
      ),
    )
    .limit(1);

  return row ?? null;
};

/**
 * Create or update a project channel override.
 * Uses ON CONFLICT on (discord_connection_id, project_id).
 */
export const upsertDiscordProjectChannel = async (
  data: Omit<NewDiscordProjectChannel, "id" | "createdAt">,
): Promise<DiscordProjectChannel> => {
  const [upserted] = await db
    .insert(discordProjectChannels)
    .values(data)
    .onConflictDoUpdate({
      target: [
        discordProjectChannels.discordConnectionId,
        discordProjectChannels.projectId,
      ],
      set: {
        channelId: data.channelId,
        channelName: data.channelName,
      },
    })
    .returning();

  if (!upserted) throw new Error("Failed to upsert Discord project channel");
  return upserted;
};

// ---------------------------------------------------------------------------
// Discord Notification Preferences
// ---------------------------------------------------------------------------

/**
 * Get notification preferences for a connection + optional project.
 * Pass projectId=null to get org-level defaults.
 */
export const getDiscordNotificationPreferences = async (
  connectionId: string,
  projectId: string | null,
): Promise<DiscordNotificationPreference | null> => {
  const projectCondition =
    projectId === null
      ? isNull(discordNotificationPreferences.projectId)
      : eq(discordNotificationPreferences.projectId, projectId);

  const [row] = await db
    .select()
    .from(discordNotificationPreferences)
    .where(
      and(
        eq(discordNotificationPreferences.discordConnectionId, connectionId),
        projectCondition,
      ),
    )
    .limit(1);

  return row ?? null;
};

/**
 * Create or update notification preferences.
 * Uses find-then-insert/update to handle nullable projectId correctly.
 */
export const upsertDiscordNotificationPreferences = async (
  data: Omit<NewDiscordNotificationPreference, "id" | "createdAt" | "updatedAt">,
): Promise<DiscordNotificationPreference> => {
  const existing = await getDiscordNotificationPreferences(
    data.discordConnectionId,
    data.projectId ?? null,
  );

  if (existing) {
    const { discordConnectionId, projectId, ...updateFields } = data;
    const [updated] = await db
      .update(discordNotificationPreferences)
      .set({ ...updateFields, updatedAt: new Date() })
      .where(eq(discordNotificationPreferences.id, existing.id))
      .returning();

    if (!updated)
      throw new Error("Failed to update Discord notification preferences");
    return updated;
  }

  const [created] = await db
    .insert(discordNotificationPreferences)
    .values(data)
    .returning();

  if (!created)
    throw new Error("Failed to create Discord notification preferences");
  return created;
};

/**
 * Check if a specific Discord notification event is enabled.
 * Resolution order: project override > org default > all-enabled fallback (returns true).
 */
export const isDiscordEventEnabled = async (
  connectionId: string,
  projectId: string | null,
  event: keyof Omit<
    DiscordNotificationPreference,
    "id" | "discordConnectionId" | "projectId" | "enabled" | "createdAt" | "updatedAt"
  >,
): Promise<boolean> => {
  // 1. Try project-level override if projectId is provided
  if (projectId !== null) {
    const projectPrefs = await getDiscordNotificationPreferences(
      connectionId,
      projectId,
    );
    if (projectPrefs) {
      return projectPrefs.enabled && projectPrefs[event];
    }
  }

  // 2. Try org-level defaults
  const orgPrefs = await getDiscordNotificationPreferences(connectionId, null);
  if (orgPrefs) {
    return orgPrefs.enabled && orgPrefs[event];
  }

  // 3. Fallback: all events enabled
  return true;
};

/**
 * List all notification preferences for a connection (org default + all project overrides).
 */
export const listDiscordNotificationPreferences = async (
  connectionId: string,
): Promise<DiscordNotificationPreference[]> => {
  return db
    .select()
    .from(discordNotificationPreferences)
    .where(
      eq(discordNotificationPreferences.discordConnectionId, connectionId),
    );
};

/**
 * Delete a project-level notification preferences override.
 */
export const deleteDiscordProjectNotificationPreferences = async (
  connectionId: string,
  projectId: string,
): Promise<boolean> => {
  const deleted = await db
    .delete(discordNotificationPreferences)
    .where(
      and(
        eq(discordNotificationPreferences.discordConnectionId, connectionId),
        eq(discordNotificationPreferences.projectId, projectId),
      ),
    )
    .returning({ id: discordNotificationPreferences.id });

  return deleted.length > 0;
};
