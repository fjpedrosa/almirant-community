import {
  getDiscordConnectionByWorkspace,
  getDiscordProjectChannel,
  isDiscordEventEnabled,
} from "@almirant/database";
import type { DiscordNotificationPreference } from "@almirant/database";
import { env, logger } from "@almirant/config";

export interface ResolvedDiscordChannel {
  channelId: string;
  source: "project" | "organization" | "env";
}

/**
 * Resolve the Discord channel to use for a work item notification.
 *
 * Resolution chain:
 * 1. Project-specific channel override (if org connection + projectId exist)
 * 2. Workspace default channel (from the active Discord connection)
 * 3. Legacy env var fallback (DISCORD_CHANNEL_ID)
 * 4. null — no channel configured
 */
export const resolveDiscordChannel = async (params: {
  projectId: string | null;
  workspaceId: string | null;
}): Promise<ResolvedDiscordChannel | null> => {
  // Step 1 & 2: Try workspace connection
  if (params.workspaceId) {
    try {
      const connection = await getDiscordConnectionByWorkspace(
        params.workspaceId,
      );

      if (connection) {
        // Step 1: Project-specific override
        if (params.projectId) {
          const projectChannel = await getDiscordProjectChannel(
            connection.id,
            params.projectId,
          );

          if (projectChannel?.channelId) {
            return { channelId: projectChannel.channelId, source: "project" };
          }
        }

        // Step 2: Workspace default channel
        if (connection.defaultChannelId) {
          return {
            channelId: connection.defaultChannelId,
            source: "organization",
          };
        }
      }
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          workspaceId: params.workspaceId,
        },
        "Failed to resolve Discord channel from database, falling back to env",
      );
    }
  }

  // Step 3: Legacy env var fallback
  const envChannelId = env.DISCORD_CHANNEL_ID?.trim();
  if (envChannelId) {
    return { channelId: envChannelId, source: "env" };
  }

  // Step 4: No channel configured
  return null;
};

// ---------------------------------------------------------------------------
// Notification resolution (channel + preference check)
// ---------------------------------------------------------------------------

export type DiscordNotificationEvent = keyof Omit<
  DiscordNotificationPreference,
  "id" | "discordConnectionId" | "projectId" | "enabled" | "createdAt" | "updatedAt"
>;

export interface ResolvedDiscordNotification {
  channelId: string;
  source: "project" | "organization" | "env";
}

/**
 * Resolve the Discord channel AND check notification preferences for a given event.
 *
 * Returns null when:
 * - No channel is configured
 * - No connection exists for the workspace
 * - The event is disabled in notification preferences
 *
 * For env-sourced channels (legacy mode), preference checks are skipped
 * and all events are considered enabled.
 */
export const resolveDiscordNotification = async (params: {
  projectId: string | null;
  workspaceId: string | null;
  event: DiscordNotificationEvent;
}): Promise<ResolvedDiscordNotification | null> => {
  // 1. Resolve the channel first (reuse existing resolveDiscordChannel)
  const channel = await resolveDiscordChannel({
    projectId: params.projectId,
    workspaceId: params.workspaceId,
  });

  if (!channel) return null;

  // 2. For env-sourced channels, skip preference check (legacy mode, all enabled)
  if (channel.source === "env") {
    return { channelId: channel.channelId, source: channel.source };
  }

  // 3. For org/project-sourced channels, check notification preferences
  if (params.workspaceId) {
    try {
      const connection = await getDiscordConnectionByWorkspace(
        params.workspaceId,
      );

      if (connection) {
        const enabled = await isDiscordEventEnabled(
          connection.id,
          params.projectId,
          params.event,
        );

        if (!enabled) return null;
      }
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          workspaceId: params.workspaceId,
          event: params.event,
        },
        "Failed to check Discord notification preferences, allowing notification",
      );
    }
  }

  return { channelId: channel.channelId, source: channel.source };
};
